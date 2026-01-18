import { Chess } from "chess.js";

import { ChessEngine, EngineAnalyzeOptions, EngineEval, EngineMoveOptions } from "../ChessEngine";

export class RandomEngineAdapter implements ChessEngine {
  async init(): Promise<void> {
    return;
  }

  async analyze(fen: string, opts: EngineAnalyzeOptions): Promise<EngineEval[]> {
    void fen;
    const evals: EngineEval[] = [
      {
        timeMs: opts.timeMs,
        cp: 0,
        pv: []
      }
    ];
    return evals;
  }

  async bestMove(fen: string, opts: EngineMoveOptions): Promise<string> {
    void opts;
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
  }

  async terminate(): Promise<void> {
    return;
  }
}
