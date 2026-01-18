export type Color = "w" | "b";

export type File = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type Rank = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type Square = `${File}${Rank}`;

export type MoveDTO = {
  uci: string;
  san: string;
  from: Square;
  to: Square;
  promotion?: string;
};

export type GameStateDTO = {
  fen: string;
  moveNumber: number;
  turn: Color;
  version: number;
};

export type GameEventDTO =
  | { type: "MOVE"; move: MoveDTO; expectedVersion: number }
  | { type: "JOIN"; playerId: string }
  | { type: "RESIGN"; playerId: string }
  | { type: "SYNC"; state: GameStateDTO };
