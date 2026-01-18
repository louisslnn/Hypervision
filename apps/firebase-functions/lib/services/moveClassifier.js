/**
 * Move Classification Service
 * Classifies moves based on centipawn loss (CPL)
 * Uses same thresholds as Magnus AI
 */
// CPL thresholds from Magnus AI
const BOOK_PLY_LIMIT = 10;
const BOOK_CPL_THRESHOLD = 15;
const BEST_CPL_THRESHOLD = 0;
const EXCELLENT_CPL_THRESHOLD = 10;
const GOOD_CPL_THRESHOLD = 50;
const INACCURACY_CPL_THRESHOLD = 100;
const MISTAKE_CPL_THRESHOLD = 300;
const MATE_SCORE_CP = 100000;
/**
 * Convert mate score to centipawn equivalent
 */
export function mateToCP(mate) {
    if (mate > 0) {
        return MATE_SCORE_CP - mate * 100;
    }
    return -MATE_SCORE_CP - mate * 100;
}
/**
 * Get evaluation in centipawns (handling mate scores)
 */
export function evalToCP(cp, mate) {
    if (mate !== undefined && mate !== null) {
        return mateToCP(mate);
    }
    return cp ?? 0;
}
/**
 * Calculate centipawn loss for a move
 * @param evalBefore Evaluation before the move (from mover's perspective)
 * @param evalAfter Evaluation after the move (from opponent's perspective)
 * @param isWhiteToMove Whether it's white's turn to move
 */
export function calculateCPL(evalBeforeCP, evalBeforeMate, evalAfterCP, evalAfterMate, isWhiteToMove) {
    const before = evalToCP(evalBeforeCP, evalBeforeMate);
    const after = evalToCP(evalAfterCP, evalAfterMate);
    // For white, losing centipawns means eval went down
    // For black, losing centipawns means eval went up (from white's perspective)
    const sign = isWhiteToMove ? 1 : -1;
    const cpl = sign * (before - after);
    return Math.max(0, cpl);
}
/**
 * Classify a move based on centipawn loss
 */
export function classifyMove(cpl, ply) {
    // Opening book moves (first 10 plies with low CPL)
    if (ply <= BOOK_PLY_LIMIT && cpl <= BOOK_CPL_THRESHOLD) {
        return "book";
    }
    if (cpl <= BEST_CPL_THRESHOLD) {
        return "best";
    }
    if (cpl <= EXCELLENT_CPL_THRESHOLD) {
        return "excellent";
    }
    if (cpl <= GOOD_CPL_THRESHOLD) {
        return "good";
    }
    if (cpl <= INACCURACY_CPL_THRESHOLD) {
        return "inaccuracy";
    }
    if (cpl <= MISTAKE_CPL_THRESHOLD) {
        return "mistake";
    }
    return "blunder";
}
/**
 * Get human-readable label for classification
 */
export function getClassificationLabel(classification) {
    const labels = {
        best: "Best Move",
        excellent: "Excellent",
        good: "Good",
        book: "Book Move",
        inaccuracy: "Inaccuracy",
        mistake: "Mistake",
        blunder: "Blunder"
    };
    return labels[classification];
}
/**
 * Get classification color for UI
 */
export function getClassificationColor(classification) {
    const colors = {
        best: "#96bc4b", // Green
        excellent: "#96bc4b", // Green
        good: "#8bc34a", // Light green
        book: "#9e9e9e", // Gray
        inaccuracy: "#f0ad4e", // Yellow/Orange
        mistake: "#e67e22", // Orange
        blunder: "#e74c3c" // Red
    };
    return colors[classification];
}
