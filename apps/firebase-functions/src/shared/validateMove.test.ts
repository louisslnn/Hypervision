import { describe, expect, it } from "vitest";

import { validateAndApplyMove } from "./validateMove.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("validateAndApplyMove", () => {
  it("accepts legal move", async () => {
    const result = await validateAndApplyMove(START_FEN, "e2e4");
    expect(result.ok).toBe(true);
  });

  it("rejects illegal move", async () => {
    const result = await validateAndApplyMove(START_FEN, "e2e5");
    expect(result.ok).toBe(false);
  });
});
