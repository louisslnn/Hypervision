/**
 * Chess helper functions - local implementation to avoid workspace dependency
 */

import { Chess, Move } from "chess.js";

export type Color = "w" | "b";
export type Square = string;

export type GameStateDTO = {
  fen: string;
  moveNumber: number;
  turn: Color;
  version: number;
};

export type MoveDTO = {
  uci: string;
  san: string;
  from: Square;
  to: Square;
  promotion?: string;
};

export type MoveAttemptResult =
  | { ok: true; move: MoveDTO; fen: string; turn: Color; moveNumber: number }
  | { ok: false; reason: string };

export function createInitialGameState(): GameStateDTO {
  const chess = new Chess();
  return {
    fen: chess.fen(),
    moveNumber: chess.moveNumber(),
    turn: chess.turn(),
    version: 0
  };
}

export function tryMove(fen: string, uci: string): MoveAttemptResult {
  const chess = new Chess(fen);
  const move = parseUciMove(uci);

  if (!move) {
    return { ok: false, reason: "Invalid UCI" };
  }

  let result: Move | null = null;
  try {
    result = chess.move(move);
  } catch {
    return { ok: false, reason: "Illegal move" };
  }
  if (!result) {
    return { ok: false, reason: "Illegal move" };
  }

  return {
    ok: true,
    move: toMoveDTO(result),
    fen: chess.fen(),
    turn: chess.turn(),
    moveNumber: chess.moveNumber()
  };
}

function parseUciMove(uci: string): { from: Square; to: Square; promotion?: string } | null {
  if (uci.length < 4) {
    return null;
  }
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length > 4 ? uci[4] : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

function toMoveDTO(move: Move): MoveDTO {
  const promotion = move.promotion ? move.promotion : undefined;
  const base = {
    uci: `${move.from}${move.to}${promotion ?? ""}`,
    san: move.san,
    from: move.from as Square,
    to: move.to as Square
  };
  return promotion ? { ...base, promotion } : base;
}

