import { describe, expect, it } from "vitest";

import { DEFAULT_INTERACTION_CONFIG, reduceInteraction } from "./interactionStateMachine";
import { InteractionState } from "./types";

describe("interactionStateMachine", () => {
  it("produces a commit after dwell and confirm hold", () => {
    let state: InteractionState = { status: "idle" };

    const move = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: 10,
      cursor: { x: 100, y: 100 },
      overSquare: "e2"
    });
    state = move.state;

    const pinch = reduceInteraction(state, {
      type: "PINCH_DOWN",
      timestampMs: 20,
      cursor: { x: 100, y: 100 },
      overSquare: "e2"
    });
    state = pinch.state;

    const drag = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: 40,
      cursor: { x: 120, y: 120 },
      overSquare: "e4"
    });
    state = drag.state;

    const release = reduceInteraction(state, {
      type: "PINCH_UP",
      timestampMs: 60,
      cursor: { x: 120, y: 120 },
      overSquare: "e4"
    });
    state = release.state;

    const dwellReached = 60 + DEFAULT_INTERACTION_CONFIG.dwellHoldMs;
    const confirmStart = reduceInteraction(state, {
      type: "CONFIRM_TICK",
      timestampMs: dwellReached
    });
    state = confirmStart.state;

    const commit = reduceInteraction(state, {
      type: "CONFIRM_TICK",
      timestampMs: dwellReached + DEFAULT_INTERACTION_CONFIG.confirmHoldMs
    });

    expect(commit.proposedMove).toEqual({ from: "e2", to: "e4" });
    expect(commit.state.status).toBe("commit");
  });

  it("locks the square after confirm even if the cursor keeps moving", () => {
    let state: InteractionState = { status: "idle" };

    state = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: 10,
      cursor: { x: 100, y: 100 },
      overSquare: "e2"
    }).state;

    state = reduceInteraction(state, {
      type: "PINCH_DOWN",
      timestampMs: 20,
      cursor: { x: 100, y: 100 },
      overSquare: "e2"
    }).state;

    state = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: 40,
      cursor: { x: 120, y: 120 },
      overSquare: "e4"
    }).state;

    state = reduceInteraction(state, {
      type: "PINCH_UP",
      timestampMs: 60,
      cursor: { x: 120, y: 120 },
      overSquare: "e4"
    }).state;

    const dwellReached = 60 + DEFAULT_INTERACTION_CONFIG.dwellHoldMs;
    state = reduceInteraction(state, {
      type: "CONFIRM_TICK",
      timestampMs: dwellReached
    }).state;

    state = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: dwellReached + 10,
      cursor: { x: 150, y: 150 },
      overSquare: "a1"
    }).state;

    const commit = reduceInteraction(state, {
      type: "CONFIRM_TICK",
      timestampMs: dwellReached + DEFAULT_INTERACTION_CONFIG.confirmHoldMs
    });

    expect(commit.proposedMove).toEqual({ from: "e2", to: "e4" });
    expect(commit.state.status).toBe("commit");
  });

  it("requires a dwell square after off-board release", () => {
    let state: InteractionState = { status: "idle" };

    state = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: 10,
      cursor: { x: 100, y: 100 },
      overSquare: "e2"
    }).state;

    state = reduceInteraction(state, {
      type: "PINCH_DOWN",
      timestampMs: 20,
      cursor: { x: 100, y: 100 },
      overSquare: "e2"
    }).state;

    state = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: 40,
      cursor: { x: 120, y: 120 },
      overSquare: "e4"
    }).state;

    state = reduceInteraction(state, {
      type: "PINCH_UP",
      timestampMs: 60,
      cursor: { x: 140, y: 140 }
    }).state;

    const dwellReached = 60 + DEFAULT_INTERACTION_CONFIG.dwellHoldMs;
    state = reduceInteraction(state, {
      type: "CONFIRM_TICK",
      timestampMs: dwellReached
    }).state;

    state = reduceInteraction(state, {
      type: "CURSOR_MOVE",
      timestampMs: 70,
      cursor: { x: 150, y: 150 },
      overSquare: "h7"
    }).state;

    state = reduceInteraction(state, {
      type: "CONFIRM_TICK",
      timestampMs: 70 + DEFAULT_INTERACTION_CONFIG.dwellHoldMs
    }).state;

    const commit = reduceInteraction(state, {
      type: "CONFIRM_TICK",
      timestampMs:
        70 + DEFAULT_INTERACTION_CONFIG.dwellHoldMs + DEFAULT_INTERACTION_CONFIG.confirmHoldMs
    });

    expect(commit.proposedMove).toEqual({ from: "e2", to: "h7" });
    expect(commit.state.status).toBe("commit");
  });
});
