import type {
  ChessEngine,
  EngineAnalyzeOptions,
  EngineEval,
  EngineMoveOptions
} from "@hypervision/engine";
import { useEffect, useMemo, useState } from "react";

import { analyzeMove, getBestMove, MoveAnalysisResult } from "./coachService";

/**
 * Client-side Chess Engine
 * Uses Lichess API for analysis + OpenAI for coach feedback
 */
class ClientEngineAdapter implements ChessEngine {
  private openaiApiKey: string | undefined;

  constructor(openaiApiKey?: string) {
    this.openaiApiKey = openaiApiKey;
  }

  async init(): Promise<void> {
    console.info(
      `✅ Client engine initialized (OpenAI: ${this.openaiApiKey ? "enabled" : "disabled"})`
    );
  }

  async analyze(fen: string, opts: EngineAnalyzeOptions): Promise<EngineEval[]> {
    // Use Lichess cloud eval
    try {
      const response = await fetch(
        `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${opts.multipv || 1}`
      );

      if (!response.ok) {
        return [{ timeMs: opts.timeMs, cp: 0, pv: [] }];
      }

      const data = await response.json();

      if (!data.pvs || data.pvs.length === 0) {
        return [{ timeMs: opts.timeMs, cp: 0, pv: [] }];
      }

      return data.pvs.map((pv: { cp?: number; mate?: number; moves?: string }) => ({
        timeMs: opts.timeMs,
        cp: pv.cp,
        mate: pv.mate,
        depth: data.depth || 20,
        pv: pv.moves ? pv.moves.split(" ") : []
      }));
    } catch (error) {
      console.error("Lichess analyze error:", error);
      return [{ timeMs: opts.timeMs, cp: 0, pv: [] }];
    }
  }

  async bestMove(fen: string, opts: EngineMoveOptions): Promise<string> {
    return getBestMove(fen, opts.skillLevel ?? 20);
  }

  async terminate(): Promise<void> {
    return;
  }

  /**
   * Analyze a specific move with coach feedback
   */
  async analyzeMoveWithCoach(
    fenBefore: string,
    fenAfter: string,
    san: string,
    uci: string,
    ply: number
  ): Promise<MoveAnalysisResult> {
    return analyzeMove(fenBefore, fenAfter, san, uci, ply, this.openaiApiKey);
  }
}

// Extended engine state with coach support
export type EngineState = {
  engine:
    | (ChessEngine & {
        analyzeMoveWithCoach?: (
          fenBefore: string,
          fenAfter: string,
          san: string,
          uci: string,
          ply: number
        ) => Promise<MoveAnalysisResult>;
      })
    | null;
  ready: boolean;
  error?: string;
  engineType?: "client" | "mock";
};

export function useEngine(enabled: boolean) {
  const [state, setState] = useState<EngineState>({ engine: null, ready: false });
  const engineRef = useMemo(() => ({ current: null as EngineState["engine"] }), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;

    const boot = async () => {
      const engineType = process.env.NEXT_PUBLIC_ENGINE;

      // If explicitly set to mock, use mock engine
      if (engineType === "mock") {
        const { RandomEngineAdapter } = await import("@hypervision/engine");
        const engine = new RandomEngineAdapter();
        engineRef.current = engine;
        await engine.init();
        if (!active) return;
        setState({ engine, ready: true, engineType: "mock" });
        console.info("⚠️ Using Mock engine (no analysis)");
        return;
      }

      // Default: Use client-side engine with Lichess + OpenAI
      const openaiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      const engine = new ClientEngineAdapter(openaiKey);
      engineRef.current = engine;
      await engine.init();
      if (!active) return;
      setState({ engine, ready: true, engineType: "client" });
    };

    boot().catch((error) => {
      setState({
        engine: null,
        ready: false,
        error: error instanceof Error ? error.message : "Engine error"
      });
    });

    return () => {
      active = false;
      engineRef.current?.terminate().catch(() => undefined);
    };
  }, [enabled, engineRef]);

  return state;
}

// Export types
export type { MoveAnalysisResult as AnalyzeMoveResponse };
