import { describe, expect, it } from "vitest";

import { RandomEngineAdapter } from "./mock/randomEngine";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("RandomEngineAdapter", () => {
  it("returns a move", async () => {
    const engine = new RandomEngineAdapter();
    await engine.init();
    const move = await engine.bestMove(START_FEN, { timeMs: 50 });
    expect(move.length).toBeGreaterThanOrEqual(4);
  });
});
