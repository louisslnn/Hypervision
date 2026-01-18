from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.schemas.coach import MoveCommentaryReport
from app.services.engine import hash_fen
from app.services.engine_analysis import get_engine_metadata, get_game_analysis_rows
from app.services.game_parser import count_game_moves

MOVE_COACH_SYSTEM_PROMPT = (
    "You are a chess coach. Use only the provided JSON payload. "
    "For every move in the payload, return a detailed, grounded explanation (3-5 sentences). "
    "Explain why the played move was strong or weak, and tie it to evaluation changes, "
    "classification, and any available clock context. "
    "Also include best_move_explanation explaining why the best move is better (1-2 sentences). "
    "Do not invent moves, evaluations, or positions. "
    "Do not mention eval_before/after fields or numeric evaluation values in the text. "
    "Keep evaluation references qualitative (e.g., improved/worsened) since numeric evals "
    "are shown elsewhere in the UI. "
    "Do not mention move_id, fen_hash, or internal IDs in the text; those are already provided "
    "as structured fields. "
    "If the payload is missing data, add it to limitations. "
    "Return JSON that matches the provided schema exactly."
)

GAME_RECAP_SYSTEM_PROMPT = (
    "You are a chess coach. Use only the provided JSON payload. "
    "Summarize the game with grounded takeaways and cite move_id + fen_hash for key moments. "
    "Do not invent moves, evaluations, or positions. "
    "If the payload is missing data, add it to limitations. "
    "Return JSON that matches the provided schema exactly."
)

COMMENTARY_WIZARD_SYSTEM_PROMPT = (
    "You are a chess coach. Use only the provided JSON payload. "
    "Answer the question about the current move commentary, grounded in the payload. "
    "Return a list of segments; each segment is either a text segment or a move segment. "
    "Text segments should be concise, clear sentences. "
    "Move segments must be SAN moves that are legal from current_fen. "
    "Interleave move segments inside the explanation so the UI can play them on the board. "
    "Do not mention move_id, fen_hash, or internal IDs. "
    "Do not include numeric evaluation values; keep evaluation references qualitative. "
    "If information is missing, list it in limitations. "
    "Return JSON that matches the provided schema exactly."
)


def sanitize_commentary_text(text: str) -> str:
    cleaned = re.sub(r"\([^)]*(move_id|fen_hash)[^)]*\)", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bmove_id\b\s*[:=]?\s*\d+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bfen_hash\b\s*[:=]?\s*[a-f0-9]{6,}", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(eval|evaluation)\s*[^.]*\b\d", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()


def build_input_hash(
    purpose: str,
    payload: dict[str, Any],
    model: str,
    prompt_version: str,
    schema_version: str,
) -> str:
    raw = json.dumps(
        {
            "purpose": purpose,
            "payload": payload,
            "model": model,
            "prompt_version": prompt_version,
            "schema_version": schema_version,
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_move_commentary_payload(
    db: Session,
    game_id: int,
    analysis_version: Optional[str],
) -> tuple[dict[str, Any], str]:
    game = db.execute(select(models.Game).where(models.Game.id == game_id)).scalars().first()
    if not game:
        raise ValueError("Game not found.")

    resolved_version, rows = get_game_analysis_rows(db, game_id, analysis_version)
    if not resolved_version:
        raise ValueError("Engine analysis not found for game.")

    moves_total = count_game_moves(db, game_id)
    if moves_total == 0:
        raise ValueError("Moves are not parsed for game.")
    if len(rows) < moves_total:
        raise ValueError("Engine analysis is incomplete for this game.")

    metadata = get_engine_metadata(db, resolved_version)

    fen_hashes = {hash_fen(move.fen_before) for _, move in rows}
    positions = (
        db.execute(
            select(models.EnginePosition).where(
                models.EnginePosition.fen_hash.in_(fen_hashes),
                models.EnginePosition.analysis_version == resolved_version,
            )
        )
        .scalars()
        .all()
    )
    pv_lookup = {position.fen_hash: position.pv_uci for position in positions}

    move_items: list[dict[str, Any]] = []
    for analysis, move in rows:
        fen_hash = hash_fen(move.fen_before)
        move_items.append(
            {
                "move_id": move.id,
                "ply": move.ply,
                "color": "white" if move.ply % 2 == 1 else "black",
                "move_san": move.move_san,
                "move_uci": move.move_uci,
                "fen_hash": fen_hash,
                "fen_before": move.fen_before,
                "clock_remaining_ms": move.clock_remaining_ms,
                "time_spent_ms": move.time_spent_ms,
                "classification": analysis.classification,
                "cpl": analysis.cpl,
                "best_move_uci": analysis.best_move_uci,
                "eval_before_cp": analysis.eval_before_cp,
                "eval_before_mate": analysis.eval_before_mate,
                "eval_after_cp": analysis.eval_after_cp,
                "eval_after_mate": analysis.eval_after_mate,
                "pv_uci": pv_lookup.get(fen_hash),
            }
        )

    payload = {
        "game": {
            "id": game.id,
            "white_username": game.white_username,
            "black_username": game.black_username,
            "result_white": game.result_white,
            "result_black": game.result_black,
            "time_control": game.time_control,
            "time_class": game.time_class,
            "rated": game.rated,
            "rules": game.rules,
            "eco_url": game.eco_url,
        },
        "analysis": {
            "analysis_version": resolved_version,
            "engine_name": metadata.name if metadata else "unknown",
            "engine_version": metadata.version if metadata else "unknown",
            "analysis_depth": metadata.depth if metadata else 0,
            "analysis_time_ms": metadata.time_ms if metadata else 0,
            "analysis_multipv": metadata.multipv if metadata else 1,
        },
        "coverage": {
            "moves_total": moves_total,
            "moves_with_analysis": len(rows),
        },
        "moves": move_items,
    }

    return payload, resolved_version


def build_game_recap_payload(
    db: Session,
    game_id: int,
    analysis_version: Optional[str],
    max_moments: int = 6,
) -> tuple[dict[str, Any], str]:
    game = db.execute(select(models.Game).where(models.Game.id == game_id)).scalars().first()
    if not game:
        raise ValueError("Game not found.")

    resolved_version, rows = get_game_analysis_rows(db, game_id, analysis_version)
    if not resolved_version:
        raise ValueError("Engine analysis not found for game.")

    metadata = get_engine_metadata(db, resolved_version)

    cpl_values = [row[0].cpl for row in rows if row[0].cpl is not None]
    avg_cpl = sum(cpl_values) / len(cpl_values) if cpl_values else None

    classification_counts = {}
    for analysis, _ in rows:
        classification_counts[analysis.classification] = (
            classification_counts.get(analysis.classification, 0) + 1
        )

    critical = [row for row in rows if row[0].cpl is not None]
    critical.sort(key=lambda item: item[0].cpl or 0, reverse=True)
    critical = critical[:max_moments]

    moments = []
    for analysis, move in critical:
        moments.append(
            {
                "move_id": move.id,
                "ply": move.ply,
                "move_san": move.move_san,
                "fen_hash": hash_fen(move.fen_before),
                "classification": analysis.classification,
                "cpl": analysis.cpl,
                "best_move_uci": analysis.best_move_uci,
                "eval_before_cp": analysis.eval_before_cp,
                "eval_before_mate": analysis.eval_before_mate,
                "eval_after_cp": analysis.eval_after_cp,
                "eval_after_mate": analysis.eval_after_mate,
            }
        )

    payload = {
        "game": {
            "id": game.id,
            "white_username": game.white_username,
            "black_username": game.black_username,
            "result_white": game.result_white,
            "result_black": game.result_black,
            "time_control": game.time_control,
            "time_class": game.time_class,
            "rated": game.rated,
            "rules": game.rules,
            "eco_url": game.eco_url,
            "end_time": game.end_time.isoformat() if game.end_time else None,
        },
        "analysis": {
            "analysis_version": resolved_version,
            "engine_name": metadata.name if metadata else "unknown",
            "engine_version": metadata.version if metadata else "unknown",
            "analysis_depth": metadata.depth if metadata else 0,
            "analysis_time_ms": metadata.time_ms if metadata else 0,
            "analysis_multipv": metadata.multipv if metadata else 1,
        },
        "summary_stats": {
            "moves_analyzed": len(rows),
            "avg_cpl": avg_cpl,
            "classification_counts": classification_counts,
        },
        "critical_moments": moments,
    }

    return payload, resolved_version


def build_commentary_wizard_payload(
    db: Session,
    game_id: int,
    move_id: int,
    analysis_version: str | None,
    question: str,
    commentary: MoveCommentaryReport,
) -> tuple[dict[str, Any], str]:
    game = db.execute(select(models.Game).where(models.Game.id == game_id)).scalars().first()
    if not game:
        raise ValueError("Game not found.")

    move = (
        db.execute(
            select(models.Move).where(
                models.Move.id == move_id,
                models.Move.game_id == game_id,
            )
        )
        .scalars()
        .first()
    )
    if not move:
        raise ValueError("Move not found for game.")
    if not move.fen_after:
        raise ValueError("Move FEN is missing for this position.")

    resolved_version = analysis_version or commentary.analysis_version
    analysis = (
        db.execute(
            select(models.MoveAnalysis).where(
                models.MoveAnalysis.move_id == move_id,
                models.MoveAnalysis.analysis_version == resolved_version,
            )
        )
        .scalars()
        .first()
    )
    if not analysis:
        raise ValueError("Move analysis not found for this move.")

    current_commentary = next(
        (item for item in commentary.moves if item.move_id == move_id),
        None,
    )
    if not current_commentary:
        current_commentary = next(
            (item for item in commentary.moves if item.ply == move.ply),
            None,
        )
    if not current_commentary:
        raise ValueError("Commentary not found for this move.")

    metadata = get_engine_metadata(db, resolved_version)

    all_commentary = [
        {
            "ply": item.ply,
            "move_san": item.move_san,
            "classification": item.classification,
            "explanation": sanitize_commentary_text(item.explanation),
            "best_move_explanation": sanitize_commentary_text(item.best_move_explanation or "")
            if item.best_move_explanation
            else None,
            "focus_tags": item.focus_tags,
        }
        for item in commentary.moves
    ]

    payload = {
        "question": question.strip(),
        "game": {
            "id": game.id,
            "white_username": game.white_username,
            "black_username": game.black_username,
            "result_white": game.result_white,
            "result_black": game.result_black,
            "time_control": game.time_control,
            "time_class": game.time_class,
            "rated": game.rated,
            "rules": game.rules,
            "eco_url": game.eco_url,
        },
        "analysis": {
            "analysis_version": resolved_version,
            "engine_name": metadata.name if metadata else "unknown",
            "engine_version": metadata.version if metadata else "unknown",
            "analysis_depth": metadata.depth if metadata else 0,
            "analysis_time_ms": metadata.time_ms if metadata else 0,
            "analysis_multipv": metadata.multipv if metadata else 1,
        },
        "current_move": {
            "move_id": move.id,
            "ply": move.ply,
            "move_san": move.move_san,
            "move_uci": move.move_uci,
            "fen_before": move.fen_before,
            "fen_after": move.fen_after,
            "classification": analysis.classification,
            "cpl": analysis.cpl,
            "best_move_uci": analysis.best_move_uci,
            "time_spent_ms": move.time_spent_ms,
        },
        "current_commentary": {
            "explanation": sanitize_commentary_text(current_commentary.explanation),
            "best_move_explanation": sanitize_commentary_text(
                current_commentary.best_move_explanation or ""
            )
            if current_commentary.best_move_explanation
            else None,
            "focus_tags": current_commentary.focus_tags,
        },
        "commentary": all_commentary,
        "current_fen": move.fen_after,
    }

    return payload, resolved_version


def build_prompt(payload: dict[str, Any]) -> str:
    payload_json = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    return f"Payload JSON:\n{payload_json}"
