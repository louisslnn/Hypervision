/**
 * Analyze Move - Firebase Callable Function
 * Analyzes a chess move and provides coach feedback
 */
import { CoachFeedback } from "../services/openaiCoach.js";
type AnalyzeMoveRequest = {
    fenBefore: string;
    fenAfter: string;
    san: string;
    uci: string;
    ply: number;
    useOpenAI?: boolean;
};
type AnalyzeMoveResponse = {
    analysis: {
        cpl: number;
        classification: string;
        classificationLabel: string;
        evalBeforeCP?: number | undefined;
        evalAfterCP?: number | undefined;
        evalBeforeMate?: number | undefined;
        evalAfterMate?: number | undefined;
        bestMoveUci?: string | undefined;
        pv: string[];
    };
    coach: CoachFeedback;
};
export declare const analyzeMove: import("firebase-functions/https").CallableFunction<AnalyzeMoveRequest, Promise<AnalyzeMoveResponse>, unknown>;
export {};
//# sourceMappingURL=analyzeMove.d.ts.map