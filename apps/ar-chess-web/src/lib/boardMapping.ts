import { applyHomography, HomographyMatrix, Point2D } from "@hypervision/ar-core";

export type ScreenPoint = Point2D;

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export function defaultCalibration(width: number, height: number): ScreenPoint[] {
  const marginX = width * 0.18;
  const marginY = height * 0.18;
  return [
    { x: marginX, y: marginY },
    { x: width - marginX, y: marginY },
    { x: width - marginX, y: height - marginY },
    { x: marginX, y: height - marginY }
  ];
}

export function screenToBoard(inverseHomography: HomographyMatrix, point: ScreenPoint): Point2D {
  return applyHomography(inverseHomography, point);
}

export function boardToScreen(homography: HomographyMatrix, point: Point2D): ScreenPoint {
  return applyHomography(homography, point);
}

export function screenToSquare(
  inverseHomography: HomographyMatrix,
  point: ScreenPoint
): string | null {
  const board = screenToBoard(inverseHomography, point);
  if (board.x < 0 || board.x > 1 || board.y < 0 || board.y > 1) {
    return null;
  }

  const fileIndex = Math.min(7, Math.max(0, Math.floor(board.x * 8)));
  const rankIndex = Math.min(7, Math.max(0, Math.floor(board.y * 8)));
  const rank = 8 - rankIndex;
  return `${FILES[fileIndex]}${rank}`;
}

export function squareCenter(square: string): Point2D | null {
  if (square.length !== 2) {
    return null;
  }
  const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  if (fileIndex < 0 || Number.isNaN(rank)) {
    return null;
  }
  const u = (fileIndex + 0.5) / 8;
  const v = (8 - rank + 0.5) / 8;
  return { x: u, y: v };
}

export function squareCorners(square: string): Point2D[] | null {
  if (square.length !== 2) {
    return null;
  }
  const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  if (fileIndex < 0 || Number.isNaN(rank)) {
    return null;
  }
  const u0 = fileIndex / 8;
  const v0 = (8 - rank) / 8;
  const u1 = (fileIndex + 1) / 8;
  const v1 = (8 - rank + 1) / 8;
  return [
    { x: u0, y: v0 },
    { x: u1, y: v0 },
    { x: u1, y: v1 },
    { x: u0, y: v1 }
  ];
}
