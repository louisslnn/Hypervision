import { NextResponse } from "next/server";

type DetectedObject = {
  label: string;
  confidence: number;
  position: "left" | "center" | "right";
  size: "large" | "medium" | "small";
};

type GuidanceRequest = {
  instruction: string;
  distanceMeters: number;
  turnDegrees: number | null;
  destinationLabel: string;
  hazards?: Array<{ label: string; count: number }>;
  detectedObjects?: DetectedObject[];
  routeDistanceMeters?: number | null;
  routeDurationSeconds?: number | null;
};

type OpenAIResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 6000;

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ status: "disabled" });
  }

  let payload: GuidanceRequest;
  try {
    payload = (await request.json()) as GuidanceRequest;
  } catch {
    return NextResponse.json({ status: "error", error: "invalid_json" }, { status: 400 });
  }

  if (!payload?.instruction || !Number.isFinite(payload.distanceMeters)) {
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
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content:
              "You are a friendly outdoor navigation assistant helping a visually impaired person walk safely. Describe what you see around them - people, vehicles, obstacles. Mention positions (left, right, ahead). Give clear, calm directions. Be conversational but brief. Never say 'I see' - just describe directly."
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
    const message = parseMessage(raw);
    if (!message) {
      return NextResponse.json({ status: "error", error: "empty_response" }, { status: 502 });
    }

    return NextResponse.json({ status: "ok", message });
  } catch {
    return NextResponse.json({ status: "error", error: "request_failed" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(payload: GuidanceRequest): string {
  const hazardSummary =
    payload.hazards && payload.hazards.length > 0
      ? payload.hazards.map((item) => `${item.label} x${item.count}`).join(", ")
      : "none";
  const turnLine =
    payload.turnDegrees === null
      ? "Turn degrees: unknown."
      : `Turn degrees: ${Math.round(payload.turnDegrees)}.`;
  const routeLine =
    payload.routeDistanceMeters && payload.routeDurationSeconds
      ? `Route distance: ${Math.round(payload.routeDistanceMeters)}m. Route duration: ${Math.round(payload.routeDurationSeconds / 60)} min.`
      : "Route distance unavailable.";

  // Build detailed object description
  let objectDescription = "No objects detected.";
  if (payload.detectedObjects && payload.detectedObjects.length > 0) {
    const descriptions = payload.detectedObjects.map((obj) => {
      const sizeWord =
        obj.size === "large" ? "close" : obj.size === "medium" ? "nearby" : "in distance";
      return `${obj.label} (${obj.position}, ${sizeWord}, ${obj.confidence}% confidence)`;
    });
    objectDescription = `Detected objects: ${descriptions.join("; ")}.`;
  }

  return [
    'Return JSON only: {"message": "..."}.',
    "Write 1-3 short sentences. Be a helpful navigation assistant. Mention interesting or important objects you see. If there are vehicles or people, describe their position (left/center/right).",
    "",
    `Instruction: ${payload.instruction}`,
    `Distance to destination: ${Math.round(payload.distanceMeters)}m.`,
    `Destination: ${payload.destinationLabel || "destination"}.`,
    turnLine,
    `Hazard counts: ${hazardSummary}.`,
    objectDescription,
    routeLine
  ].join("\n");
}

function parseMessage(raw: string): string | null {
  if (!raw) {
    return null;
  }
  const blockMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = blockMatch?.[1] ?? raw;
  try {
    const parsed = JSON.parse(candidate) as { message?: string };
    if (parsed.message && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // fall through to raw text
  }

  return raw.length > 0 ? raw.replace(/^"|"$/g, "").trim() : null;
}
