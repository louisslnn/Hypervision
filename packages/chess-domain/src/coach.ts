import { Chess } from "chess.js";

export type CoachLabel = "great" | "good" | "inaccuracy" | "mistake" | "blunder";

export type CoachFeedback = {
  label: CoachLabel;
  centipawnLoss: number;
  message: string;
};

export type CoachNarrative = {
  detail: string;
  bestLineSan: string[];
  replyLineSan: string[];
  bestMoveSan?: string;
  bestReplySan?: string;
  userMoveSan?: string;
};

export type CoachNarrativeInput = {
  fenBefore: string;
  fenAfter: string;
  userMoveUci: string;
  bestLine?: string[];
  replyLine?: string[];
  centipawnLoss: number;
  evalAfter?: { cp?: number; mate?: number };
};

export function classifyCentipawnLoss(centipawnLoss: number): CoachLabel {
  if (centipawnLoss < 20) {
    return "great";
  }
  if (centipawnLoss < 50) {
    return "good";
  }
  if (centipawnLoss < 120) {
    return "inaccuracy";
  }
  if (centipawnLoss < 250) {
    return "mistake";
  }
  return "blunder";
}

export function buildCoachFeedback(centipawnLoss: number): CoachFeedback {
  const label = classifyCentipawnLoss(centipawnLoss);
  const message = getCoachMessage(label);
  return {
    label,
    centipawnLoss,
    message
  };
}

export function buildCoachNarrative(input: CoachNarrativeInput): CoachNarrative {
  const bestLineSan = toSanLine(input.fenBefore, input.bestLine ?? [], 4);
  const replyLineSan = toSanLine(input.fenAfter, input.replyLine ?? [], 2);
  const bestMoveSan = bestLineSan[0];
  const bestReplySan = replyLineSan[0];
  const userMoveSan = toSanMove(input.fenBefore, input.userMoveUci);

  let detail = "";
  const mate = input.evalAfter?.mate;
  if (mate !== undefined) {
    if (mate > 0) {
      detail = `This allows a forced mate in ${mate}.`;
    } else if (mate < 0) {
      detail = `You have a forced mate in ${Math.abs(mate)}.`;
    }
  }

  if (!detail) {
    const capture = describeReplyCapture(input.fenAfter, input.replyLine?.[0]);
    if (capture) {
      const opener = userMoveSan ? `After ${userMoveSan}, ` : "";
      detail = `${opener}opponent can capture your ${capture.piece} on ${capture.square}.`;
    }
  }

  if (!detail && bestReplySan && bestReplySan.includes("#")) {
    detail = `The reply ${bestReplySan} is checkmate.`;
  }

  if (!detail && bestReplySan && bestReplySan.includes("+")) {
    detail = `It allows a forcing check (${bestReplySan}).`;
  }

  if (!detail && bestMoveSan) {
    if (input.centipawnLoss < 20) {
      detail = `Engine agrees. Best line starts with ${bestMoveSan}.`;
    } else {
      detail = `Stronger was ${bestMoveSan}.`;
    }
  }

  if (!detail) {
    detail = "Keep improving piece coordination and king safety.";
  }

  const base: CoachNarrative = {
    detail,
    bestLineSan,
    replyLineSan
  };

  return {
    ...base,
    ...(bestMoveSan ? { bestMoveSan } : {}),
    ...(bestReplySan ? { bestReplySan } : {}),
    ...(userMoveSan ? { userMoveSan } : {})
  };
}

function getCoachMessage(label: CoachLabel): string {
  switch (label) {
    case "great":
      return "Great move. You kept the position sharp and solid.";
    case "good":
      return "Good move. The idea is sound, but there may be an even stronger follow-up.";
    case "inaccuracy":
      return "Inaccuracy. You gave your opponent extra options to equalize.";
    case "mistake":
      return "Mistake. This concedes a clear advantage to your opponent.";
    case "blunder":
      return "Blunder. This drops significant material or allows a decisive tactic.";
    default:
      return "Move evaluated.";
  }
}

function toSanLine(fen: string, line: string[], maxPlies: number): string[] {
  if (line.length === 0) {
    return [];
  }
  const chess = new Chess(fen);
  const sanMoves: string[] = [];

  for (const uci of line) {
    if (sanMoves.length >= maxPlies) {
      break;
    }
    const move = applyUciMove(chess, uci);
    if (!move) {
      break;
    }
    sanMoves.push(move.san);
  }

  return sanMoves;
}

function toSanMove(fen: string, uci: string): string | undefined {
  const chess = new Chess(fen);
  const move = applyUciMove(chess, uci);
  return move?.san;
}

function applyUciMove(chess: Chess, uci: string) {
  const parsed = parseUciMove(uci);
  if (!parsed) {
    return null;
  }
  try {
    return chess.move(parsed);
  } catch {
    return null;
  }
}

function parseUciMove(uci: string): { from: string; to: string; promotion?: string } | null {
  if (uci.length < 4) {
    return null;
  }
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

function describeReplyCapture(
  fenAfter: string,
  replyUci?: string
): { piece: string; square: string } | null {
  if (!replyUci) {
    return null;
  }
  const chess = new Chess(fenAfter);
  const move = applyUciMove(chess, replyUci);
  if (!move || !move.captured) {
    return null;
  }
  return { piece: pieceName(move.captured), square: move.to };
}

function pieceName(piece: string): string {
  switch (piece.toLowerCase()) {
    case "p":
      return "pawn";
    case "n":
      return "knight";
    case "b":
      return "bishop";
    case "r":
      return "rook";
    case "q":
      return "queen";
    case "k":
      return "king";
    default:
      return "piece";
  }
}
