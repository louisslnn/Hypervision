/**
 * OpenAI Coach Service
 * Generates move-by-move commentary using GPT
 * Based on Magnus AI prompts
 */
import { MoveClassification } from "./moveClassifier.js";
export declare const OPENAI_API_KEY: import("node_modules/firebase-functions/lib/params/types.js").SecretParam;
export type CoachFeedback = {
    explanation: string;
    bestMoveExplanation?: string;
    tips: string[];
    encouragement: string;
};
export type MoveContext = {
    san: string;
    uci: string;
    classification: MoveClassification;
    cpl: number;
    bestMoveUci?: string | undefined;
    evalBeforeCP?: number | undefined;
    evalAfterCP?: number | undefined;
    isWhiteMove: boolean;
    ply: number;
};
/**
 * Generate coach feedback for a move using OpenAI
 */
export declare function generateMoveCoachFeedback(apiKey: string, moveContext: MoveContext): Promise<CoachFeedback>;
/**
 * Generate quick feedback without calling OpenAI (for real-time use)
 */
export declare function generateQuickFeedback(ctx: MoveContext): CoachFeedback;
//# sourceMappingURL=openaiCoach.d.ts.map