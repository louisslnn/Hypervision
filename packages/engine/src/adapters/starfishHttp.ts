import { ChessEngine, EngineAnalyzeOptions, EngineEval, EngineMoveOptions } from "../ChessEngine";

type StarfishResponse = {
  bestMove: string;
  eval?: EngineEval;
};

export class StarfishHttpAdapter implements ChessEngine {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async init(): Promise<void> {
    return;
  }

  async analyze(fen: string, opts: EngineAnalyzeOptions): Promise<EngineEval[]> {
    const response = await fetch(`${this.baseUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fen,
        timeMs: opts.timeMs,
        multipv: opts.multipv ?? 1,
        skillLevel: opts.skillLevel,
        limitStrength: opts.limitStrength,
        elo: opts.elo
      })
    });

    if (!response.ok) {
      throw new Error(`Starfish analyze failed: ${response.status}`);
    }

    const data = (await response.json()) as { evals: EngineEval[] };
    return data.evals;
  }

  async bestMove(fen: string, opts: EngineMoveOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/best-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fen,
        timeMs: opts.timeMs,
        skillLevel: opts.skillLevel,
        limitStrength: opts.limitStrength,
        elo: opts.elo
      })
    });

    if (!response.ok) {
      throw new Error(`Starfish best-move failed: ${response.status}`);
    }

    const data = (await response.json()) as StarfishResponse;
    return data.bestMove;
  }

  async terminate(): Promise<void> {
    return;
  }
}
