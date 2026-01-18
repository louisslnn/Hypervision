/**
 * OpenAI Coach Service
 * Generates move-by-move commentary using GPT
 * Based on Magnus AI prompts
 */

import { defineSecret } from "firebase-functions/params";

import { MoveClassification, getClassificationLabel } from "./moveClassifier.js";

// Define the secret for OpenAI API key
export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4.1-mini";

// System prompt based on Magnus AI
const MOVE_COACH_SYSTEM_PROMPT = `You are a chess coach providing feedback on moves. 
You will receive information about a chess move including:
- The move played (in SAN notation)
- The classification (best, good, inaccuracy, mistake, blunder)
- The centipawn loss (CPL)
- The best move suggested by the engine
- Position evaluations before and after

Provide a concise, helpful explanation (2-3 sentences) that:
1. Explains why the move was strong or weak
2. If it wasn't the best move, briefly explain what the best move achieves
3. Use qualitative terms (improving, weakening) rather than specific numbers
4. Be encouraging but honest

Do NOT mention specific centipawn values or evaluation numbers.
Do NOT use technical jargon that beginners wouldn't understand.
Keep it conversational and educational.`;

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
export async function generateMoveCoachFeedback(
  apiKey: string,
  moveContext: MoveContext
): Promise<CoachFeedback> {
  const userPrompt = buildMovePrompt(moveContext);

  try {
    const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: MOVE_COACH_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 300,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenAI API error:", error);
      return getFallbackFeedback(moveContext);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return getFallbackFeedback(moveContext);
    }

    try {
      const parsed = JSON.parse(content);
      return {
        explanation: parsed.explanation || getFallbackExplanation(moveContext),
        bestMoveExplanation: parsed.bestMoveExplanation,
        tips: parsed.tips || [],
        encouragement: parsed.encouragement || getEncouragement(moveContext.classification)
      };
    } catch {
      // If JSON parsing fails, use the raw content as explanation
      return {
        explanation: content.slice(0, 500),
        tips: [],
        encouragement: getEncouragement(moveContext.classification)
      };
    }
  } catch (error) {
    console.error("OpenAI request failed:", error);
    return getFallbackFeedback(moveContext);
  }
}

function buildMovePrompt(ctx: MoveContext): string {
  const color = ctx.isWhiteMove ? "White" : "Black";
  const classLabel = getClassificationLabel(ctx.classification);

  let prompt = `${color} played ${ctx.san} (move ${Math.ceil(ctx.ply / 2)}).
Classification: ${classLabel}
Centipawn loss: ${ctx.cpl}`;

  if (ctx.bestMoveUci && ctx.classification !== "best" && ctx.classification !== "excellent") {
    prompt += `\nEngine's best move was: ${ctx.bestMoveUci}`;
  }

  prompt += `\n\nProvide feedback as JSON with these fields:
- explanation: 2-3 sentence explanation of the move
- bestMoveExplanation: (optional) why the best move is better
- tips: array of 1-2 short tips for improvement
- encouragement: one encouraging sentence`;

  return prompt;
}

/**
 * Get fallback feedback when OpenAI is unavailable
 */
function getFallbackFeedback(ctx: MoveContext): CoachFeedback {
  return {
    explanation: getFallbackExplanation(ctx),
    tips: getFallbackTips(ctx.classification),
    encouragement: getEncouragement(ctx.classification)
  };
}

function getFallbackExplanation(ctx: MoveContext): string {
  const color = ctx.isWhiteMove ? "White" : "Black";

  switch (ctx.classification) {
    case "best":
      return `${ctx.san} is the best move in this position. ${color} found the strongest continuation.`;
    case "excellent":
      return `${ctx.san} is an excellent move. ${color} maintained a strong position.`;
    case "good":
      return `${ctx.san} is a solid move. While not the absolute best, it keeps ${color}'s position healthy.`;
    case "book":
      return `${ctx.san} is a standard opening move. This is well-known theory.`;
    case "inaccuracy":
      return `${ctx.san} is a slight inaccuracy. There was a more precise move available that would have given ${color} a better position.`;
    case "mistake":
      return `${ctx.san} is a mistake that gives away some advantage. ${color} missed a stronger continuation.`;
    case "blunder":
      return `${ctx.san} is a serious blunder. This move significantly worsens ${color}'s position.`;
  }
}

function getFallbackTips(classification: MoveClassification): string[] {
  switch (classification) {
    case "best":
    case "excellent":
      return ["Keep up the good calculation!", "You're finding the best moves."];
    case "good":
      return ["Look for more active moves", "Consider all forcing moves first"];
    case "book":
      return ["Study this opening line further", "Understand the ideas behind the moves"];
    case "inaccuracy":
      return ["Take more time on critical positions", "Check for better alternatives"];
    case "mistake":
      return ["Look for tactical threats", "Consider what your opponent wants to do"];
    case "blunder":
      return ["Always check for hanging pieces", "Look for checks and captures first"];
  }
}

function getEncouragement(classification: MoveClassification): string {
  switch (classification) {
    case "best":
      return "Excellent calculation! 🌟";
    case "excellent":
      return "Great move! Keep it up! 👏";
    case "good":
      return "Solid play. You're on the right track.";
    case "book":
      return "Good opening knowledge! 📚";
    case "inaccuracy":
      return "Small slip, but you can recover. Stay focused!";
    case "mistake":
      return "Everyone makes mistakes. Learn from this one!";
    case "blunder":
      return "Tough moment, but don't give up! Every game is a learning opportunity.";
  }
}

/**
 * Generate quick feedback without calling OpenAI (for real-time use)
 */
export function generateQuickFeedback(ctx: MoveContext): CoachFeedback {
  return getFallbackFeedback(ctx);
}
