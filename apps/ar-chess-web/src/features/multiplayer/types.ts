export type GameDoc = {
  createdAt: number;
  updatedAt: number;
  status: "waiting" | "active" | "ended";
  variant: "standard";
  whiteUid: string | null;
  blackUid: string | null;
  fen: string;
  moveNumber: number;
  turn: "w" | "b";
  version: number;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  endReason?: "checkmate" | "resign" | "timeout" | "draw";
};

export type SyncAdapter = {
  createGame: () => Promise<{ gameId: string }>;
  joinGame: (gameId: string) => Promise<void>;
  submitMove: (gameId: string, uci: string, expectedVersion: number) => Promise<void>;
  subscribeToGame: (gameId: string, onUpdate: (game: GameDoc) => void) => () => void;
};
