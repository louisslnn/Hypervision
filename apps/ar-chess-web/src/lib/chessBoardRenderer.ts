import { HomographyMatrix } from "@hypervision/ar-core";

import { boardToScreen, squareCenter, squareCorners } from "./boardMapping";

export type RenderHighlight = {
  squares: string[];
  arrow?: { from: string; to: string };
};

export type GhostPiece = {
  piece: string;
  square: string;
  opacity?: number;
};

export type DraggingPiece = {
  piece: string;
  cursor: { x: number; y: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Chess Piece SVG Images (from Chess.com/Lichess standard set)
// ─────────────────────────────────────────────────────────────────────────────

const PIECE_SVG_BASE = "https://images.chesscomfiles.com/chess-themes/pieces/neo/150";

const PIECE_IMAGE_URLS: Record<string, string> = {
  // White pieces
  K: `${PIECE_SVG_BASE}/wk.png`,
  Q: `${PIECE_SVG_BASE}/wq.png`,
  R: `${PIECE_SVG_BASE}/wr.png`,
  B: `${PIECE_SVG_BASE}/wb.png`,
  N: `${PIECE_SVG_BASE}/wn.png`,
  P: `${PIECE_SVG_BASE}/wp.png`,
  // Black pieces
  k: `${PIECE_SVG_BASE}/bk.png`,
  q: `${PIECE_SVG_BASE}/bq.png`,
  r: `${PIECE_SVG_BASE}/br.png`,
  b: `${PIECE_SVG_BASE}/bb.png`,
  n: `${PIECE_SVG_BASE}/bn.png`,
  p: `${PIECE_SVG_BASE}/bp.png`
};

// Cache for loaded images
const pieceImageCache = new Map<string, HTMLImageElement>();
let imagesLoaded = false;
let loadingPromise: Promise<void> | null = null;

/**
 * Preload all piece images for faster rendering
 */
export function preloadPieceImages(): Promise<void> {
  if (imagesLoaded) {
    return Promise.resolve();
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = Promise.all(
    Object.entries(PIECE_IMAGE_URLS).map(([piece, url]) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          pieceImageCache.set(piece, img);
          resolve();
        };
        img.onerror = () => {
          // If image fails to load, we'll fall back to text rendering
          console.warn(`Failed to load piece image: ${piece}`);
          resolve();
        };
        img.src = url;
      });
    })
  ).then(() => {
    imagesLoaded = true;
  });

  return loadingPromise;
}

// Start preloading immediately
if (typeof window !== "undefined") {
  preloadPieceImages();
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  homography: HomographyMatrix,
  fen: string,
  highlight?: RenderHighlight,
  dragging?: DraggingPiece,
  cursor?: { x: number; y: number },
  ghostPieces?: GhostPiece[]
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  drawSquares(ctx, homography, highlight?.squares ?? []);
  if (ghostPieces && ghostPieces.length > 0) {
    drawGhostPieces(ctx, homography, ghostPieces);
  }
  drawPieces(ctx, homography, fen);

  if (highlight?.arrow) {
    drawArrow(ctx, homography, highlight.arrow.from, highlight.arrow.to);
  }

  if (dragging) {
    drawPieceAtScreen(ctx, dragging.piece, dragging.cursor.x, dragging.cursor.y, true);
  }

  if (cursor) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(229, 84, 43, 0.9)";
    ctx.arc(cursor.x, cursor.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSquares(
  ctx: CanvasRenderingContext2D,
  homography: HomographyMatrix,
  highlighted: string[]
): void {
  for (let rank = 8; rank >= 1; rank -= 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = `${String.fromCharCode(97 + file)}${rank}`;
      const corners = squareCorners(square);
      if (!corners) {
        continue;
      }
      const points = corners.map((corner) => boardToScreen(homography, corner));
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.closePath();

      const isDark = (file + rank) % 2 === 0;
      ctx.fillStyle = isDark ? "rgba(118, 150, 86, 0.85)" : "rgba(238, 238, 210, 0.9)";
      ctx.fill();

      if (highlighted.includes(square)) {
        ctx.strokeStyle = "rgba(229, 84, 43, 0.95)";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  // Draw coordinate labels
  drawBoardLabels(ctx, homography);
}

function drawBoardLabels(ctx: CanvasRenderingContext2D, homography: HomographyMatrix): void {
  const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"];

  ctx.save();
  ctx.font = "bold 11px var(--font-display), Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Draw file labels (a-h) on the bottom edge of each file
  for (let file = 0; file < 8; file++) {
    const square = `${FILES[file]}1`;
    const corners = squareCorners(square);
    if (!corners) continue;

    const points = corners.map((corner) => boardToScreen(homography, corner));
    if (points.length < 4 || !points[0] || !points[1] || !points[2] || !points[3]) continue;
    // Bottom center of the square (average of bottom two corners)
    const bottomCenterX = (points[2].x + points[3].x) / 2;
    const bottomCenterY = (points[2].y + points[3].y) / 2;

    // Move slightly outside the square
    const centerX = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
    const centerY = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
    const offsetX = (bottomCenterX - centerX) * 0.4;
    const offsetY = (bottomCenterY - centerY) * 0.4;

    const labelX = bottomCenterX + offsetX;
    const labelY = bottomCenterY + offsetY;

    const isDark = (file + 1) % 2 === 0;
    const textColor = isDark ? "rgba(238, 238, 210, 0.95)" : "rgba(118, 150, 86, 0.95)";

    // Counter the CSS mirror effect
    ctx.save();
    ctx.translate(labelX, labelY);
    ctx.scale(-1, 1);

    // Draw text with outline for visibility
    const fileLabel = FILES[file];
    if (!fileLabel) continue;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 2;
    ctx.strokeText(fileLabel.toUpperCase(), 0, 0);
    ctx.fillStyle = textColor;
    ctx.fillText(fileLabel.toUpperCase(), 0, 0);
    ctx.restore();
  }

  // Draw rank labels (1-8) on the left edge of each rank
  for (let rank = 0; rank < 8; rank++) {
    const square = `a${rank + 1}`;
    const corners = squareCorners(square);
    if (!corners) continue;

    const points = corners.map((corner) => boardToScreen(homography, corner));
    if (points.length < 4 || !points[0] || !points[1] || !points[2] || !points[3]) continue;
    // Left center of the square (average of left two corners)
    const leftCenterX = (points[0].x + points[3].x) / 2;
    const leftCenterY = (points[0].y + points[3].y) / 2;

    // Move slightly outside the square
    const centerX = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
    const centerY = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
    const offsetX = (leftCenterX - centerX) * 0.4;
    const offsetY = (leftCenterY - centerY) * 0.4;

    const labelX = leftCenterX + offsetX;
    const labelY = leftCenterY + offsetY;

    const isDark = (rank + 1) % 2 === 1;
    const textColor = isDark ? "rgba(238, 238, 210, 0.95)" : "rgba(118, 150, 86, 0.95)";

    // Counter the CSS mirror effect
    ctx.save();
    ctx.translate(labelX, labelY);
    ctx.scale(-1, 1);

    // Draw text with outline for visibility
    const rankLabel = RANKS[rank];
    if (!rankLabel) continue;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 2;
    ctx.strokeText(rankLabel, 0, 0);
    ctx.fillStyle = textColor;
    ctx.fillText(rankLabel, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawPieces(
  ctx: CanvasRenderingContext2D,
  homography: HomographyMatrix,
  fen: string
): void {
  const board = parseFenBoard(fen);
  if (!board) {
    return;
  }

  board.forEach((row, rowIndex) => {
    row.forEach((piece, colIndex) => {
      if (!piece) {
        return;
      }
      const square = `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}`;
      const center = squareCenter(square);
      if (!center) {
        return;
      }
      const screen = boardToScreen(homography, center);
      drawPieceAtScreen(ctx, piece, screen.x, screen.y, false);
    });
  });
}

function drawPieceAtScreen(
  ctx: CanvasRenderingContext2D,
  piece: string,
  x: number,
  y: number,
  isDragging: boolean,
  opacity = 1,
  isGhost = false
): void {
  ctx.save();
  ctx.globalAlpha = isGhost ? opacity * 0.5 : opacity;

  const size = isDragging ? 44 : 32;
  const halfSize = size / 2;

  // Try to draw the image
  const img = pieceImageCache.get(piece);
  if (img && img.complete && img.naturalWidth > 0) {
    // Counter the CSS scaleX(-1) mirror effect
    ctx.translate(x, y);
    ctx.scale(-1, 1);

    // Add shadow for better visibility
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Draw the piece image
    ctx.drawImage(img, -halfSize, -halfSize, size, size);

    // Ghost effect with dashed border
    if (isGhost) {
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(229, 84, 43, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(-halfSize, -halfSize, size, size);
      ctx.setLineDash([]);
    }
  } else {
    // Fallback to circle + letter if image not loaded
    const isWhite = piece === piece.toUpperCase();
    ctx.beginPath();
    ctx.fillStyle = isWhite ? "rgba(255, 255, 255, 0.95)" : "rgba(30, 31, 36, 0.95)";
    ctx.strokeStyle = isWhite ? "rgba(30, 31, 36, 0.7)" : "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = isGhost ? 1.5 : 2;
    if (isGhost) {
      ctx.setLineDash([4, 3]);
    }
    const radius = isDragging ? 18 : 14;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (isGhost) {
      ctx.setLineDash([]);
    }

    ctx.fillStyle = isWhite ? "#1e1f24" : "#f4f0e8";
    ctx.font = `${isDragging ? 16 : 13}px var(--font-display)`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(x, y + 1);
    ctx.scale(-1, 1);
    ctx.fillText(piece.toUpperCase(), 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  homography: HomographyMatrix,
  from: string,
  to: string
): void {
  const fromCenter = squareCenter(from);
  const toCenter = squareCenter(to);
  if (!fromCenter || !toCenter) {
    return;
  }
  const start = boardToScreen(homography, fromCenter);
  const end = boardToScreen(homography, toCenter);

  ctx.strokeStyle = "rgba(47, 124, 95, 0.9)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = 10;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 6),
    end.y - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 6),
    end.y - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = "rgba(47, 124, 95, 0.9)";
  ctx.fill();
}

function drawGhostPieces(
  ctx: CanvasRenderingContext2D,
  homography: HomographyMatrix,
  ghostPieces: GhostPiece[]
): void {
  ghostPieces.forEach((ghost) => {
    const center = squareCenter(ghost.square);
    if (!center) {
      return;
    }
    const screen = boardToScreen(homography, center);
    drawPieceAtScreen(ctx, ghost.piece, screen.x, screen.y, false, ghost.opacity ?? 0.35, true);
  });
}

function parseFenBoard(fen: string): (string | null)[][] | null {
  const placement = fen.split(" ")[0];
  if (!placement) {
    return null;
  }
  const rows = placement.split("/");
  if (rows.length !== 8) {
    return null;
  }
  return rows.map((row) => {
    const result: (string | null)[] = [];
    for (const char of row) {
      if (Number.isNaN(Number(char))) {
        result.push(char);
      } else {
        const empty = Number(char);
        for (let i = 0; i < empty; i += 1) {
          result.push(null);
        }
      }
    }
    return result;
  });
}