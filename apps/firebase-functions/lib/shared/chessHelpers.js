/**
 * Chess helper functions - local implementation to avoid workspace dependency
 */
import { Chess } from "chess.js";
export function createInitialGameState() {
    const chess = new Chess();
    return {
        fen: chess.fen(),
        moveNumber: chess.moveNumber(),
        turn: chess.turn(),
        version: 0
    };
}
export function tryMove(fen, uci) {
    const chess = new Chess(fen);
    const move = parseUciMove(uci);
    if (!move) {
        return { ok: false, reason: "Invalid UCI" };
    }
    let result = null;
    try {
        result = chess.move(move);
    }
    catch {
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
function parseUciMove(uci) {
    if (uci.length < 4) {
        return null;
    }
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    return promotion ? { from, to, promotion } : { from, to };
}
function toMoveDTO(move) {
    const promotion = move.promotion ? move.promotion : undefined;
    const base = {
        uci: `${move.from}${move.to}${promotion ?? ""}`,
        san: move.san,
        from: move.from,
        to: move.to
    };
    return promotion ? { ...base, promotion } : base;
}
