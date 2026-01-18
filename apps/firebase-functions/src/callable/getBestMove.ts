/**
 * Get Best Move - Firebase Callable Function
 * Returns the best move for a position using Lichess cloud eval
 */

import { Chess } from "chess.js";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { analyzePosition } from "../services/lichessEngine.js";

type GetBestMoveRequest = {
  fen: string;
  skillLevel?: number; // 0-20, affects move selection
};

type GetBestMoveResponse = {
  bestMove: string;
  evaluation: {
    cp?: number | undefined;
    mate?: number | undefined;
    depth: number;
  };
  pv: string[];
};

export const getBestMove = onCall<GetBestMoveRequest, Promise<GetBestMoveResponse>>(
  {
    memory: "256MiB",
    timeoutSeconds: 15,
    // Allow unauthenticated access for practice mode
    invoker: "public"
  },
  async (request) => {
    const { fen, skillLevel = 20 } = request.data;

    if (!fen) {
      throw new HttpsError("invalid-argument", "FEN is required");
    }

    // Validate FEN
    try {
      new Chess(fen);
    } catch {
      throw new HttpsError("invalid-argument", "Invalid FEN string");
    }

    // Get analysis from Lichess
    const analysis = await analyzePosition(fen, 3);
    const topLine = analysis.evaluations[0];

    // For lower skill levels, sometimes pick a non-optimal move
    let selectedMove = analysis.bestMove;

    if (skillLevel < 20 && analysis.evaluations.length > 1) {
      // Lower skill = higher chance of picking a suboptimal move
      const mistakeChance = (20 - skillLevel) / 40; // 0-50% chance based on skill

      if (Math.random() < mistakeChance && analysis.evaluations.length > 1) {
        // Pick the second or third best move
        const altIndex = Math.min(
          Math.floor(Math.random() * 2) + 1,
          analysis.evaluations.length - 1
        );
        const altMove = analysis.evaluations[altIndex]?.pv[0];
        if (altMove) {
          selectedMove = altMove;
        }
      }
    }

    // If no move found from analysis, get a random legal move
    if (!selectedMove) {
      const chess = new Chess(fen);
      const moves = chess.moves({ verbose: true });
      if (moves.length === 0) {
        throw new HttpsError("failed-precondition", "No legal moves in position");
      }
      const randomMove = moves[Math.floor(Math.random() * moves.length)];
      if (randomMove) {
        selectedMove = `${randomMove.from}${randomMove.to}${randomMove.promotion || ""}`;
      } else {
        throw new HttpsError("failed-precondition", "No legal moves in position");
      }
    }

    return {
      bestMove: selectedMove,
      evaluation: {
        cp: topLine?.cp,
        mate: topLine?.mate,
        depth: topLine?.depth || 1
      },
      pv: topLine?.pv || []
    };
  }
);
