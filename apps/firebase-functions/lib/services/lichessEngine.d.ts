/**
 * Lichess Cloud Evaluation Service
 * Uses Lichess's free cloud eval API for position analysis
 */
export type EngineEvaluation = {
    cp?: number | undefined;
    mate?: number | undefined;
    depth: number;
    pv: string[];
};
export type PositionAnalysis = {
    fen: string;
    evaluations: EngineEvaluation[];
    bestMove: string | null;
};
/**
 * Analyze a position using Lichess cloud evaluation
 */
export declare function analyzePosition(fen: string, multiPv?: number): Promise<PositionAnalysis>;
/**
 * Get the best move for a position
 */
export declare function getBestMove(fen: string): Promise<string | null>;
//# sourceMappingURL=lichessEngine.d.ts.map