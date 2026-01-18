/**
 * Lichess Cloud Evaluation Service
 * Uses Lichess's free cloud eval API for position analysis
 */

export type EngineEvaluation = {
  cp?: number | undefined;
  mate?: number | undefined;
  depth: number;
  pv: string[];
};

export type PositionAnalysis = {
  fen: string;
  evaluations: EngineEvaluation[];
  bestMove: string | null;
};

const LICHESS_API_BASE = "https://lichess.org/api";

/**
 * Analyze a position using Lichess cloud evaluation
 */
export async function analyzePosition(fen: string, multiPv: number = 1): Promise<PositionAnalysis> {
  try {
    const response = await fetch(
      `${LICHESS_API_BASE}/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`,
      {
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      // Return neutral evaluation if not in cloud database
      return {
        fen,
        evaluations: [{ cp: 0, depth: 1, pv: [] }],
        bestMove: null
      };
    }

    const data = (await response.json()) as {
      pvs?: Array<{ cp?: number; mate?: number; moves?: string }>;
      depth?: number;
    };

    if (!data.pvs || data.pvs.length === 0) {
      return {
        fen,
        evaluations: [{ cp: 0, depth: 1, pv: [] }],
        bestMove: null
      };
    }

    const evaluations: EngineEvaluation[] = data.pvs.map((pv) => ({
      cp: pv.cp,
      mate: pv.mate,
      depth: data.depth || 20,
      pv: pv.moves ? pv.moves.split(" ") : []
    }));

    const bestMove = evaluations[0]?.pv[0] || null;

    return {
      fen,
      evaluations,
      bestMove
    };
  } catch (error) {
    console.error("Lichess API error:", error);
    return {
      fen,
      evaluations: [{ cp: 0, depth: 1, pv: [] }],
      bestMove: null
    };
  }
}

/**
 * Get the best move for a position
 */
export async function getBestMove(fen: string): Promise<string | null> {
  const analysis = await analyzePosition(fen, 1);
  return analysis.bestMove;
}
