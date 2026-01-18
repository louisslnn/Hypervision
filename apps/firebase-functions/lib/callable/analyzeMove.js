/**
 * Analyze Move - Firebase Callable Function
 * Analyzes a chess move and provides coach feedback
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { analyzePosition } from "../services/lichessEngine.js";
import { calculateCPL, classifyMove, getClassificationLabel } from "../services/moveClassifier.js";
import { generateMoveCoachFeedback, generateQuickFeedback, OPENAI_API_KEY } from "../services/openaiCoach.js";
export const analyzeMove = onCall({
    secrets: [OPENAI_API_KEY],
    memory: "256MiB",
    timeoutSeconds: 30,
    // Allow unauthenticated access for practice mode
    invoker: "public"
}, async (request) => {
    const { fenBefore, fenAfter, san, uci, ply, useOpenAI } = request.data;
    if (!fenBefore || !fenAfter || !san || !uci) {
        throw new HttpsError("invalid-argument", "Missing required fields");
    }
    // Determine if white just moved (ply is odd for white's moves: 1, 3, 5...)
    const isWhiteMove = ply % 2 === 1;
    // Analyze positions before and after the move
    const [beforeAnalysis, afterAnalysis] = await Promise.all([
        analyzePosition(fenBefore, 1),
        analyzePosition(fenAfter, 1)
    ]);
    const evalBefore = beforeAnalysis.evaluations[0];
    const evalAfter = afterAnalysis.evaluations[0];
    // Calculate centipawn loss
    const cpl = calculateCPL(evalBefore?.cp, evalBefore?.mate, evalAfter?.cp, evalAfter?.mate, isWhiteMove);
    // Classify the move
    const classification = classifyMove(cpl, ply);
    // Build move context for coach
    const moveContext = {
        san,
        uci,
        classification,
        cpl,
        bestMoveUci: beforeAnalysis.bestMove || undefined,
        evalBeforeCP: evalBefore?.cp,
        evalAfterCP: evalAfter?.cp,
        isWhiteMove,
        ply
    };
    // Generate coach feedback
    let coachFeedback;
    if (useOpenAI && OPENAI_API_KEY.value()) {
        coachFeedback = await generateMoveCoachFeedback(OPENAI_API_KEY.value(), moveContext);
    }
    else {
        coachFeedback = generateQuickFeedback(moveContext);
    }
    return {
        analysis: {
            cpl,
            classification,
            classificationLabel: getClassificationLabel(classification),
            evalBeforeCP: evalBefore?.cp,
            evalAfterCP: evalAfter?.cp,
            evalBeforeMate: evalBefore?.mate,
            evalAfterMate: evalAfter?.mate,
            bestMoveUci: beforeAnalysis.bestMove || undefined,
            pv: evalBefore?.pv || []
        },
        coach: coachFeedback
    };
});
