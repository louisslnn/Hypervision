import { describe, expect, it } from "vitest";

import { createInitialGameState, listLegalMoves, tryMove } from "./chessRules";

describe("chessRules", () => {
  it("initial state has legal moves", () => {
    const state = createInitialGameState();
    const moves = listLegalMoves(state.fen);
    expect(moves.length).toBeGreaterThan(0);
  });

  it("rejects illegal moves", () => {
    const state = createInitialGameState();
    const result = tryMove(state.fen, "e2e5");
    expect(result.ok).toBe(false);
  });

  it("accepts legal moves", () => {
    const state = createInitialGameState();
    const result = tryMove(state.fen, "e2e4");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fen).toContain(" ");
    }
  });
});
