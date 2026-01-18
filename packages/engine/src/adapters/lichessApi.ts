import { ChessEngine, EngineAnalyzeOptions, EngineEval, EngineMoveOptions } from "../ChessEngine";

/**
 * Lichess Cloud Evaluation API adapter
 * Uses Lichess's free cloud evaluation service
 * https://lichess.org/api#tag/Analysis
 */
export class LichessApiAdapter implements ChessEngine {
  private baseUrl = "https://lichess.org/api";

  async init(): Promise<void> {
    // No initialization needed for API
    return;
  }

  async analyze(fen: string, opts: EngineAnalyzeOptions): Promise<EngineEval[]> {
    const multipv = opts.multipv ?? 1;

    try {
      // Use Lichess cloud eval API
      const response = await fetch(
        `${this.baseUrl}/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multipv}`,
        {
          headers: {
            Accept: "application/json"
          }
        }
      );

      if (!response.ok) {
        // If cloud eval not available, return a basic eval
        return this.fallbackAnalysis(opts);
      }

      const data = await response.json();

      if (!data.pvs || data.pvs.length === 0) {
        return this.fallbackAnalysis(opts);
      }

      return data.pvs.map((pv: { cp?: number; mate?: number; moves: string }) => {
        const evalResult: EngineEval = {
          timeMs: opts.timeMs,
          pv: pv.moves ? pv.moves.split(" ") : [],
          depth: data.depth
        };

        if (pv.cp !== undefined) {
          evalResult.cp = pv.cp;
        }
        if (pv.mate !== undefined) {
          evalResult.mate = pv.mate;
        }

        return evalResult;
      });
    } catch (error) {
      console.warn("Lichess API failed, using fallback:", error);
      return this.fallbackAnalysis(opts);
    }
  }

  async bestMove(fen: string, opts: EngineMoveOptions): Promise<string> {
    const evals = await this.analyze(fen, { ...opts, multipv: 1 });

    if (evals.length > 0) {
      const primary = evals[0];
      const move = primary?.pv?.[0];
      if (move) {
        return move;
      }
    }

    // Fallback to a random legal move using chess.js
    return this.getRandomMove(fen);
  }

  async terminate(): Promise<void> {
    return;
  }

  private async fallbackAnalysis(opts: EngineAnalyzeOptions): Promise<EngineEval[]> {
    // Return a neutral evaluation when API fails
    return [
      {
        timeMs: opts.timeMs,
        cp: 0,
        pv: [],
        depth: 1
      }
    ];
  }

  private async getRandomMove(fen: string): Promise<string> {
    try {
      const { Chess } = await import("chess.js");
      const chess = new Chess(fen);
      const moves = chess.moves({ verbose: true });

      if (moves.length === 0) {
        return "0000";
      }

      const move = moves[Math.floor(Math.random() * moves.length)];
      if (!move) {
        return "0000";
      }
      return `${move.from}${move.to}${move.promotion ?? ""}`;
    } catch {
      return "0000";
    }
  }
}

