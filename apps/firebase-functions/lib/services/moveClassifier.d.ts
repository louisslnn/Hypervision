/**
 * Move Classification Service
 * Classifies moves based on centipawn loss (CPL)
 * Uses same thresholds as Magnus AI
 */
export type MoveClassification = "best" | "excellent" | "good" | "book" | "inaccuracy" | "mistake" | "blunder";
/**
 * Convert mate score to centipawn equivalent
 */
export declare function mateToCP(mate: number): number;
/**
 * Get evaluation in centipawns (handling mate scores)
 */
export declare function evalToCP(cp?: number, mate?: number): number;
/**
 * Calculate centipawn loss for a move
 * @param evalBefore Evaluation before the move (from mover's perspective)
 * @param evalAfter Evaluation after the move (from opponent's perspective)
 * @param isWhiteToMove Whether it's white's turn to move
 */
export declare function calculateCPL(evalBeforeCP: number | undefined, evalBeforeMate: number | undefined, evalAfterCP: number | undefined, evalAfterMate: number | undefined, isWhiteToMove: boolean): number;
/**
 * Classify a move based on centipawn loss
 */
export declare function classifyMove(cpl: number, ply: number): MoveClassification;
/**
 * Get human-readable label for classification
 */
export declare function getClassificationLabel(classification: MoveClassification): string;
/**
 * Get classification color for UI
 */
export declare function getClassificationColor(classification: MoveClassification): string;
export type MoveAnalysis = {
    ply: number;
    san: string;
    uci: string;
    fenBefore: string;
    fenAfter: string;
    evalBeforeCP?: number;
    evalBeforeMate?: number;
    evalAfterCP?: number;
    evalAfterMate?: number;
    bestMoveUci?: string;
    cpl: number;
    classification: MoveClassification;
};
//# sourceMappingURL=moveClassifier.d.ts.map