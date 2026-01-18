import { tryMove } from "./chessHelpers.js";
export function validateAndApplyMove(fen, uci) {
    return tryMove(fen, uci);
}
