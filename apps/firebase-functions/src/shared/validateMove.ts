import { tryMove } from "./chessHelpers.js";

export function validateAndApplyMove(fen: string, uci: string) {
  return tryMove(fen, uci);
}
