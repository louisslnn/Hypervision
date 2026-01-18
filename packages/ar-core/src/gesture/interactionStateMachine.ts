import { GestureEventDTO, InteractionConfig, InteractionOutput, InteractionState } from "./types";

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  dwellHoldMs: 400,
  confirmHoldMs: 200
};

const idleState: InteractionState = { status: "idle" };

export function reduceInteraction(
  state: InteractionState,
  event: GestureEventDTO,
  config: InteractionConfig = DEFAULT_INTERACTION_CONFIG
): InteractionOutput {
  if (event.type === "RESET") {
    return { state: idleState };
  }

  if (event.type === "CURSOR_MOVE") {
    if (state.status === "idle") {
      if (event.overSquare) {
        return {
          state: { status: "hover", cursor: event.cursor, overSquare: event.overSquare }
        };
      }
      return { state: { status: "idle", cursor: event.cursor } };
    }

    if (state.status === "hover") {
      if (event.overSquare) {
        return {
          state: { status: "hover", cursor: event.cursor, overSquare: event.overSquare }
        };
      }
      return { state: { status: "idle", cursor: event.cursor } };
    }

    if (state.status === "pinch-start" || state.status === "dragging") {
      const nextState = event.overSquare
        ? {
            status: "dragging" as const,
            cursor: event.cursor,
            fromSquare: state.fromSquare,
            overSquare: event.overSquare
          }
        : {
            status: "dragging" as const,
            cursor: event.cursor,
            fromSquare: state.fromSquare
          };
      return { state: nextState };
    }

    if (state.status === "release") {
      const nextSquare = event.overSquare;
      if (!nextSquare) {
        return {
          state: {
            status: "release",
            cursor: event.cursor,
            fromSquare: state.fromSquare
          }
        };
      }
      const dwellStartMs =
        state.toSquare === nextSquare
          ? (state.dwellStartMs ?? event.timestampMs)
          : event.timestampMs;
      return {
        state: {
          status: "release",
          cursor: event.cursor,
          fromSquare: state.fromSquare,
          toSquare: nextSquare,
          dwellStartMs
        }
      };
    }

    if (state.status === "confirm") {
      return {
        state: {
          ...state,
          cursor: event.cursor
        }
      };
    }

    if (state.status === "commit") {
      return {
        state: {
          ...state,
          cursor: event.cursor
        }
      };
    }
  }

  if (event.type === "PINCH_DOWN") {
    if ((state.status === "idle" || state.status === "hover") && event.overSquare) {
      return {
        state: { status: "pinch-start", cursor: event.cursor, fromSquare: event.overSquare }
      };
    }
  }

  if (event.type === "PINCH_UP") {
    if (state.status === "pinch-start" || state.status === "dragging") {
      const targetSquare = event.overSquare;
      const nextState = targetSquare
        ? {
            status: "release" as const,
            cursor: event.cursor,
            fromSquare: state.fromSquare,
            toSquare: targetSquare,
            dwellStartMs: event.timestampMs
          }
        : {
            status: "release" as const,
            cursor: event.cursor,
            fromSquare: state.fromSquare
          };
      return { state: nextState };
    }
    if (state.status === "confirm") {
      return { state: idleState };
    }
  }

  if (event.type === "CONFIRM_TICK") {
    if (state.status === "release") {
      if (!state.toSquare || state.dwellStartMs === undefined) {
        return { state };
      }
      const dwellFor = event.timestampMs - state.dwellStartMs;
      if (dwellFor < config.dwellHoldMs) {
        return { state };
      }
      return {
        state: {
          status: "confirm",
          cursor: state.cursor,
          fromSquare: state.fromSquare,
          toSquare: state.toSquare,
          confirmStartMs: event.timestampMs
        }
      };
    }

    if (state.status === "confirm") {
      const heldFor = event.timestampMs - state.confirmStartMs;
      if (heldFor >= config.confirmHoldMs) {
        return {
          state: {
            status: "commit",
            cursor: state.cursor,
            fromSquare: state.fromSquare,
            toSquare: state.toSquare
          },
          proposedMove: { from: state.fromSquare, to: state.toSquare }
        };
      }
    }
  }

  return { state };
}
