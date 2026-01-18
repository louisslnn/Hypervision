export type CursorPoint = {
  x: number;
  y: number;
};

export type GestureEventDTO =
  | {
      type: "CURSOR_MOVE";
      timestampMs: number;
      cursor: CursorPoint;
      overSquare?: string;
    }
  | {
      type: "PINCH_DOWN";
      timestampMs: number;
      cursor: CursorPoint;
      overSquare?: string;
    }
  | {
      type: "PINCH_UP";
      timestampMs: number;
      cursor: CursorPoint;
      overSquare?: string;
    }
  | {
      type: "CONFIRM_TICK";
      timestampMs: number;
    }
  | {
      type: "RESET";
      timestampMs: number;
    };

export type InteractionState =
  | {
      status: "idle";
      cursor?: CursorPoint;
      overSquare?: string;
    }
  | {
      status: "hover";
      cursor: CursorPoint;
      overSquare: string;
    }
  | {
      status: "pinch-start";
      cursor: CursorPoint;
      fromSquare: string;
    }
  | {
      status: "dragging";
      cursor: CursorPoint;
      fromSquare: string;
      overSquare?: string;
    }
  | {
      status: "release";
      cursor: CursorPoint;
      fromSquare: string;
      toSquare?: string;
      dwellStartMs?: number;
    }
  | {
      status: "confirm";
      cursor: CursorPoint;
      fromSquare: string;
      toSquare: string;
      confirmStartMs: number;
    }
  | {
      status: "commit";
      cursor: CursorPoint;
      fromSquare: string;
      toSquare: string;
    };

export type InteractionConfig = {
  dwellHoldMs: number;
  confirmHoldMs: number;
};

export type InteractionOutput = {
  state: InteractionState;
  proposedMove?: {
    from: string;
    to: string;
  };
};
