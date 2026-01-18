import io
import re
from dataclasses import dataclass
from typing import Optional

import chess
import chess.pgn

CLOCK_REGEX = re.compile(r"\[%clk\s+([0-9:\.]+)\]")
TIME_CONTROL_REGEX = re.compile(r"^(\d+)(?:\+(\d+))?$")


@dataclass(frozen=True)
class ParsedMove:
    ply: int
    move_san: str
    move_uci: str
    fen_before: str
    fen_after: str
    is_check: bool
    is_mate: bool
    capture_piece: Optional[str]
    promotion: Optional[str]
    clock_remaining_ms: Optional[int]
    time_spent_ms: Optional[int]


def parse_time_control(value: Optional[str]) -> Optional[tuple[int, int]]:
    if not value:
        return None
    normalized = value.strip()
    if not normalized or normalized in {"?", "-"} or "/" in normalized:
        return None
    match = TIME_CONTROL_REGEX.match(normalized)
    if not match:
        return None
    base = int(match.group(1))
    increment = int(match.group(2) or 0)
    return base, increment


def parse_clock_seconds(clock_value: str) -> Optional[float]:
    parts = clock_value.split(":")
    if len(parts) not in {2, 3}:
        return None
    try:
        seconds = float(parts[-1])
        minutes = int(parts[-2])
        hours = int(parts[-3]) if len(parts) == 3 else 0
    except ValueError:
        return None
    if minutes < 0 or hours < 0 or seconds < 0:
        return None
    return hours * 3600 + minutes * 60 + seconds


def extract_clock_seconds(comment: str) -> Optional[float]:
    if not comment:
        return None
    match = CLOCK_REGEX.search(comment)
    if not match:
        return None
    return parse_clock_seconds(match.group(1))


def build_moves_from_pgn(pgn: str, time_control: Optional[str]) -> list[ParsedMove]:
    if not pgn or not pgn.strip():
        raise ValueError("PGN is empty.")

    game = chess.pgn.read_game(io.StringIO(pgn))
    if not game:
        raise ValueError("Unable to parse PGN.")

    time_settings = parse_time_control(time_control) or parse_time_control(
        game.headers.get("TimeControl")
    )
    base_seconds = float(time_settings[0]) if time_settings else None
    increment_seconds = float(time_settings[1]) if time_settings else None

    white_prev = base_seconds
    black_prev = base_seconds

    board = game.board()
    parsed: list[ParsedMove] = []

    node = game
    ply = 0

    while node.variations:
        node = node.variation(0)
        move = node.move
        ply += 1

        side_is_white = board.turn
        fen_before = board.fen()
        move_san = board.san(move)
        move_uci = move.uci()
        capture_symbol = None
        if board.is_capture(move):
            if board.is_en_passant(move):
                capture_symbol = "p"
            else:
                capture_piece = board.piece_at(move.to_square)
                capture_symbol = capture_piece.symbol().lower() if capture_piece else None
        promotion = chess.piece_symbol(move.promotion) if move.promotion else None

        board.push(move)
        fen_after = board.fen()
        is_check = board.is_check()
        is_mate = board.is_checkmate()

        clock_seconds = extract_clock_seconds(node.comment)
        clock_remaining_ms = int(round(clock_seconds * 1000)) if clock_seconds is not None else None

        time_spent_ms = None
        if clock_seconds is None:
            if side_is_white:
                white_prev = None
            else:
                black_prev = None
        elif increment_seconds is None:
            if side_is_white:
                white_prev = clock_seconds
            else:
                black_prev = clock_seconds
        else:
            prev = white_prev if side_is_white else black_prev
            if prev is None:
                time_spent_ms = None
            else:
                spent_seconds = prev + increment_seconds - clock_seconds
                spent_ms = int(round(spent_seconds * 1000))
                if spent_ms < -50:
                    time_spent_ms = None
                else:
                    time_spent_ms = max(spent_ms, 0)

            if side_is_white:
                white_prev = clock_seconds
            else:
                black_prev = clock_seconds

        parsed.append(
            ParsedMove(
                ply=ply,
                move_san=move_san,
                move_uci=move_uci,
                fen_before=fen_before,
                fen_after=fen_after,
                is_check=is_check,
                is_mate=is_mate,
                capture_piece=capture_symbol,
                promotion=promotion,
                clock_remaining_ms=clock_remaining_ms,
                time_spent_ms=time_spent_ms,
            )
        )

    return parsed
