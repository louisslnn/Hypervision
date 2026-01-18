export type CoachExplanationRequest = {
  label: string;
  centipawnLoss: number;
  userMoveSan?: string;
  bestLineSan: string[];
  replyLineSan: string[];
  evalAfter?: { cp?: number; mate?: number };
  difficulty: { label: string; skillLevel: number; elo?: number };
};

type CoachExplanationResponse =
  | { status: "ok"; explanation: string }
  | { status: "disabled" }
  | { status: "error"; error: string };

const DEFAULT_TIMEOUT_MS = 4000;

export async function requestCoachExplanation(
  payload: CoachExplanationRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as CoachExplanationResponse;
    if (data.status === "ok" && data.explanation) {
      return data.explanation;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
