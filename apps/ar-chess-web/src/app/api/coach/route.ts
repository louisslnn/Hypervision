import { NextResponse } from "next/server";

type CoachRequest = {
  label: string;
  centipawnLoss: number;
  userMoveSan?: string;
  bestLineSan: string[];
  replyLineSan: string[];
  evalAfter?: { cp?: number; mate?: number };
  difficulty: { label: string; skillLevel: number; elo?: number };
};

type OpenAIResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 5000;

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ status: "disabled" });
  }

  let payload: CoachRequest;
  try {
    payload = (await request.json()) as CoachRequest;
  } catch {
    return NextResponse.json({ status: "error", error: "invalid_json" }, { status: 400 });
  }

  if (!payload || !payload.label || !Number.isFinite(payload.centipawnLoss)) {
    return NextResponse.json({ status: "error", error: "invalid_payload" }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const prompt = buildPrompt(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "You are a chess coach. Use only the provided evaluation and lines. Do not invent moves or claims."
          },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return NextResponse.json(
        { status: "error", error: `upstream_${response.status}` },
        { status: 502 }
      );
    }

    const data = (await response.json()) as OpenAIResponse;
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const explanation = parseExplanation(raw);
    if (!explanation) {
      return NextResponse.json({ status: "error", error: "empty_response" }, { status: 502 });
    }

    return NextResponse.json({ status: "ok", explanation });
  } catch {
    return NextResponse.json({ status: "error", error: "request_failed" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(payload: CoachRequest): string {
  const evalLine = payload.evalAfter?.mate
    ? `Mate in ${payload.evalAfter.mate}.`
    : payload.evalAfter?.cp !== undefined
      ? `Eval after move: ${payload.evalAfter.cp} cp.`
      : "Eval after move unavailable.";

  const bestLine = payload.bestLineSan.length > 0 ? payload.bestLineSan.join(" ") : "N/A";
  const replyLine = payload.replyLineSan.length > 0 ? payload.replyLineSan.join(" ") : "N/A";

  return [
    'Return JSON only: {"explanation": "..."}.',
    "Write 2-3 concise sentences. Mention the best line if the move is inaccurate or worse.",
    "If mate info is present, mention it.",
    "",
    `Quality label: ${payload.label}.`,
    `Centipawn loss: ${payload.centipawnLoss}.`,
    `User move SAN: ${payload.userMoveSan ?? "N/A"}.`,
    `Best line SAN: ${bestLine}.`,
    `Reply line SAN: ${replyLine}.`,
    `Difficulty: ${payload.difficulty.label} (skill ${payload.difficulty.skillLevel}${
      payload.difficulty.elo ? `, elo ${payload.difficulty.elo}` : ""
    }).`,
    evalLine
  ].join("\n");
}

function parseExplanation(raw: string): string | null {
  if (!raw) {
    return null;
  }
  const blockMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = blockMatch?.[1] ?? raw;
  try {
    const parsed = JSON.parse(candidate) as { explanation?: string };
    if (parsed.explanation && parsed.explanation.trim()) {
      return parsed.explanation.trim();
    }
  } catch {
    // fall through to raw text
  }

  return raw.length > 0 ? raw.replace(/^"|"$/g, "").trim() : null;
}
