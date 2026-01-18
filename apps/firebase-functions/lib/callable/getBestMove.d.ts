/**
 * Get Best Move - Firebase Callable Function
 * Returns the best move for a position using Lichess cloud eval
 */
type GetBestMoveRequest = {
    fen: string;
    skillLevel?: number;
};
type GetBestMoveResponse = {
    bestMove: string;
    evaluation: {
        cp?: number | undefined;
        mate?: number | undefined;
        depth: number;
    };
    pv: string[];
};
export declare const getBestMove: import("firebase-functions/https").CallableFunction<GetBestMoveRequest, Promise<GetBestMoveResponse>, unknown>;
export {};
//# sourceMappingURL=getBestMove.d.ts.map