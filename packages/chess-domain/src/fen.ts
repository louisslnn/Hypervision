export type FenParts = {
  placement: string;
  turn: "w" | "b";
  castling: string;
  enPassant: string;
  halfmoveClock: number;
  fullmoveNumber: number;
};

export function parseFen(fen: string): FenParts {
  const [placement, turn, castling, enPassant, halfmoveClock, fullmoveNumber] = fen.split(" ");
  if (!placement || (turn !== "w" && turn !== "b")) {
    throw new Error("Invalid FEN");
  }
  return {
    placement,
    turn,
    castling: castling ?? "-",
    enPassant: enPassant ?? "-",
    halfmoveClock: Number(halfmoveClock ?? 0),
    fullmoveNumber: Number(fullmoveNumber ?? 1)
  };
}
