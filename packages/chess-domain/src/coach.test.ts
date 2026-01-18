import { describe, expect, it } from "vitest";

import { tryMove } from "./chessRules";
import { buildCoachFeedback, buildCoachNarrative, classifyCentipawnLoss } from "./coach";

describe("coach", () => {
  it("classifies centipawn loss thresholds", () => {
    expect(classifyCentipawnLoss(5)).toBe("great");
    expect(classifyCentipawnLoss(40)).toBe("good");
    expect(classifyCentipawnLoss(80)).toBe("inaccuracy");
    expect(classifyCentipawnLoss(180)).toBe("mistake");
    expect(classifyCentipawnLoss(400)).toBe("blunder");
  });

  it("builds feedback message", () => {
    const feedback = buildCoachFeedback(120);
    expect(feedback.message.length).toBeGreaterThan(5);
  });

  it("converts PV lines to SAN", () => {
    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const userMove = "e2e4";
    const result = tryMove(startFen, userMove);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const narrative = buildCoachNarrative({
      fenBefore: startFen,
      fenAfter: result.fen,
      userMoveUci: userMove,
      bestLine: ["e2e4", "e7e5"],
      replyLine: ["e7e5"],
      centipawnLoss: 0
    });

    expect(narrative.bestLineSan[0]).toBe("e4");
  });

  it("detects reply captures for explanations", () => {
    const fenBefore = "4k3/8/8/8/3q4/8/8/4KQ2 w - - 0 1";
    const userMove = "f1f2";
    const result = tryMove(fenBefore, userMove);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const narrative = buildCoachNarrative({
      fenBefore,
      fenAfter: result.fen,
      userMoveUci: userMove,
      replyLine: ["d4f2"],
      centipawnLoss: 300
    });

    expect(narrative.detail).toContain("queen");
  });

  it("mentions forced mate when available", () => {
    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const result = tryMove(startFen, "e2e4");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const narrative = buildCoachNarrative({
      fenBefore: startFen,
      fenAfter: result.fen,
      userMoveUci: "e2e4",
      centipawnLoss: 400,
      evalAfter: { mate: 2 }
    });

    expect(narrative.detail).toContain("mate in 2");
  });
});
