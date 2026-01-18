/**
 * Client-side Chess Coach Service
 * Uses Lichess API for evaluation + OpenAI for coach feedback
 */

// Move classification thresholds (Magnus AI style)
const BOOK_PLY_LIMIT = 10;
const BOOK_CPL_THRESHOLD = 15;

type MoveClassification =
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "blunder";

type LichessEval = {
  cp?: number;
  mate?: number;
  depth: number;
  pv: string[];
};

type PositionAnalysis = {
  evaluations: LichessEval[];
  bestMove: string | null;
};

export type CoachFeedback = {
  explanation: string;
  bestMoveExplanation?: string;
  tips: string[];
  encouragement: string;
};

export type MoveAnalysisResult = {
  analysis: {
    cpl: number;
    classification: MoveClassification;
    classificationLabel: string;
    evalBeforeCP?: number;
    evalAfterCP?: number;
    bestMoveUci?: string;
    pv: string[];
  };
  coach: CoachFeedback;
};

// ============= Lichess API =============

async function analyzeLichessPosition(fen: string, multiPv = 1): Promise<PositionAnalysis> {
  try {
    const response = await fetch(
      `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      return { evaluations: [{ cp: 0, depth: 1, pv: [] }], bestMove: null };
    }

    const data = await response.json();

    if (!data.pvs || data.pvs.length === 0) {
      return { evaluations: [{ cp: 0, depth: 1, pv: [] }], bestMove: null };
    }

    const evaluations: LichessEval[] = data.pvs.map(
      (pv: { cp?: number; mate?: number; moves?: string }) => ({
        cp: pv.cp,
        mate: pv.mate,
        depth: data.depth || 20,
        pv: pv.moves ? pv.moves.split(" ") : []
      })
    );

    return {
      evaluations,
      bestMove: evaluations[0]?.pv[0] || null
    };
  } catch (error) {
    console.error("Lichess API error:", error);
    return { evaluations: [{ cp: 0, depth: 1, pv: [] }], bestMove: null };
  }
}

// ============= Move Classification =============

function mateToCP(mate: number): number {
  const MATE_SCORE = 100000;
  return mate > 0 ? MATE_SCORE - mate * 100 : -MATE_SCORE - mate * 100;
}

function evalToCP(cp?: number, mate?: number): number {
  if (mate !== undefined && mate !== null) return mateToCP(mate);
  return cp ?? 0;
}

function calculateCPL(
  evalBeforeCP: number | undefined,
  evalBeforeMate: number | undefined,
  evalAfterCP: number | undefined,
  evalAfterMate: number | undefined,
  isWhiteMove: boolean
): number {
  const before = evalToCP(evalBeforeCP, evalBeforeMate);
  const after = evalToCP(evalAfterCP, evalAfterMate);
  const sign = isWhiteMove ? 1 : -1;
  return Math.max(0, sign * (before - after));
}

function classifyMove(cpl: number, ply: number): MoveClassification {
  if (ply <= BOOK_PLY_LIMIT && cpl <= BOOK_CPL_THRESHOLD) return "book";
  if (cpl <= 0) return "best";
  if (cpl <= 10) return "excellent";
  if (cpl <= 50) return "good";
  if (cpl <= 100) return "inaccuracy";
  if (cpl <= 300) return "mistake";
  return "blunder";
}

function getClassificationLabel(classification: MoveClassification): string {
  const labels: Record<MoveClassification, string> = {
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

// ============= OpenAI Coach =============

const COACH_SYSTEM_PROMPT = `You are a friendly chess coach providing feedback on moves.
Given move info, provide a JSON response with:
- explanation: 2-3 sentences explaining why the move was good/bad
- bestMoveExplanation: (if not best move) 1 sentence on what's better
- tips: array of 1-2 short improvement tips
- encouragement: one encouraging sentence

Rules:
- Don't mention specific centipawn values
- Be conversational and educational
- Use qualitative terms (improving, weakening position)
- Keep it beginner-friendly`;

async function generateOpenAIFeedback(
  apiKey: string,
  san: string,
  classification: MoveClassification,
  cpl: number,
  bestMoveUci: string | undefined,
  isWhiteMove: boolean,
  ply: number
): Promise<CoachFeedback> {
  const color = isWhiteMove ? "White" : "Black";
  const moveNum = Math.ceil(ply / 2);
  const classLabel = getClassificationLabel(classification);

  const userPrompt = `${color} played ${san} (move ${moveNum}).
Classification: ${classLabel}
CPL: ${cpl}${bestMoveUci && classification !== "best" ? `\nBest move was: ${bestMoveUci}` : ""}

Respond with JSON only.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: COACH_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      console.error("OpenAI API error:", await response.text());
      return getFallbackFeedback(san, classification, isWhiteMove);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return getFallbackFeedback(san, classification, isWhiteMove);
    }

    // Try to parse JSON from the response
    try {
      // Handle markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1] || content;
      const parsed = JSON.parse(jsonStr.trim());

      return {
        explanation: parsed.explanation || getFallbackExplanation(san, classification, isWhiteMove),
        bestMoveExplanation: parsed.bestMoveExplanation,
        tips: parsed.tips || [],
        encouragement: parsed.encouragement || getEncouragement(classification)
      };
    } catch {
      // If JSON parsing fails, use the raw content
      return {
        explanation: content.slice(0, 300),
        tips: [],
        encouragement: getEncouragement(classification)
      };
    }
  } catch (error) {
    console.error("OpenAI request failed:", error);
    return getFallbackFeedback(san, classification, isWhiteMove);
  }
}

function getFallbackFeedback(
  san: string,
  classification: MoveClassification,
  isWhiteMove: boolean
): CoachFeedback {
  return {
    explanation: getFallbackExplanation(san, classification, isWhiteMove),
    tips: getFallbackTips(classification),
    encouragement: getEncouragement(classification)
  };
}

function getFallbackExplanation(
  san: string,
  classification: MoveClassification,
  isWhiteMove: boolean
): string {
  const color = isWhiteMove ? "White" : "Black";

  switch (classification) {
    case "best":
      return `${san} is the best move! ${color} found the strongest continuation.`;
    case "excellent":
      return `${san} is excellent. ${color} maintained a strong position.`;
    case "good":
      return `${san} is solid. While not the absolute best, it keeps the position healthy.`;
    case "book":
      return `${san} is standard opening theory. Good knowledge!`;
    case "inaccuracy":
      return `${san} is a slight inaccuracy. There was a more precise option available.`;
    case "mistake":
      return `${san} is a mistake that gives away some advantage.`;
    case "blunder":
      return `${san} is a serious blunder that significantly worsens the position.`;
  }
}

function getFallbackTips(classification: MoveClassification): string[] {
  switch (classification) {
    case "best":
    case "excellent":
      return ["Great calculation!", "Keep finding strong moves."];
    case "good":
      return ["Look for more active moves", "Consider forcing moves first"];
    case "book":
      return ["Study this opening further", "Understand the ideas behind moves"];
    case "inaccuracy":
      return ["Take more time on key positions", "Look for better alternatives"];
    case "mistake":
      return ["Check for tactical threats", "Consider opponent's plans"];
    case "blunder":
      return ["Check for hanging pieces", "Look for checks and captures first"];
  }
}

function getEncouragement(classification: MoveClassification): string {
  switch (classification) {
    case "best":
      return "Excellent calculation! 🌟";
    case "excellent":
      return "Great move! Keep it up! 👏";
    case "good":
      return "Solid play. You're on track!";
    case "book":
      return "Good opening knowledge! 📚";
    case "inaccuracy":
      return "Small slip, stay focused!";
    case "mistake":
      return "Learn from this one!";
    case "blunder":
      return "Don't give up! Every game teaches something.";
  }
}

// ============= Main Analysis Function =============

export async function analyzeMove(
  fenBefore: string,
  fenAfter: string,
  san: string,
  _uci: string,
  ply: number,
  openaiApiKey?: string
): Promise<MoveAnalysisResult> {
  const isWhiteMove = ply % 2 === 1;

  // Get position evaluations from Lichess
  const [beforeAnalysis, afterAnalysis] = await Promise.all([
    analyzeLichessPosition(fenBefore, 1),
    analyzeLichessPosition(fenAfter, 1)
  ]);

  const evalBefore = beforeAnalysis.evaluations[0];
  const evalAfter = afterAnalysis.evaluations[0];

  // Calculate centipawn loss
  const cpl = calculateCPL(
    evalBefore?.cp,
    evalBefore?.mate,
    evalAfter?.cp,
    evalAfter?.mate,
    isWhiteMove
  );

  // Classify the move
  const classification = classifyMove(cpl, ply);

  // Generate coach feedback
  let coachFeedback: CoachFeedback;

  if (openaiApiKey) {
    coachFeedback = await generateOpenAIFeedback(
      openaiApiKey,
      san,
      classification,
      cpl,
      beforeAnalysis.bestMove || undefined,
      isWhiteMove,
      ply
    );
  } else {
    coachFeedback = getFallbackFeedback(san, classification, isWhiteMove);
  }

  return {
    analysis: {
      cpl,
      classification,
      classificationLabel: getClassificationLabel(classification),
      ...(evalBefore?.cp !== undefined && { evalBeforeCP: evalBefore.cp }),
      ...(evalAfter?.cp !== undefined && { evalAfterCP: evalAfter.cp }),
      ...(beforeAnalysis.bestMove && { bestMoveUci: beforeAnalysis.bestMove }),
      pv: evalBefore?.pv || []
    },
    coach: coachFeedback
  };
}

// ============= Best Move Function =============

export async function getBestMove(fen: string, skillLevel = 20): Promise<string> {
  const analysis = await analyzeLichessPosition(fen, 3);

  let selectedMove = analysis.bestMove;

  // For lower skill levels, sometimes pick a suboptimal move
  if (skillLevel < 20 && analysis.evaluations.length > 1) {
    const mistakeChance = (20 - skillLevel) / 40;

    if (Math.random() < mistakeChance) {
      const altIndex = Math.min(Math.floor(Math.random() * 2) + 1, analysis.evaluations.length - 1);
      const altMove = analysis.evaluations[altIndex]?.pv[0];
      if (altMove) selectedMove = altMove;
    }
  }

  // Fallback to random legal move
  if (!selectedMove) {
    const { Chess } = await import("chess.js");
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true });
    const move = moves[Math.floor(Math.random() * moves.length)];
    if (move) {
      selectedMove = `${move.from}${move.to}${move.promotion || ""}`;
    } else {
      selectedMove = "0000";
    }
  }

  return selectedMove;
}