/**
 * Chess helper functions - local implementation to avoid workspace dependency
 */
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
export type MoveAttemptResult = {
    ok: true;
    move: MoveDTO;
    fen: string;
    turn: Color;
    moveNumber: number;
} | {
    ok: false;
    reason: string;
};
export declare function createInitialGameState(): GameStateDTO;
export declare function tryMove(fen: string, uci: string): MoveAttemptResult;
//# sourceMappingURL=chessHelpers.d.ts.map