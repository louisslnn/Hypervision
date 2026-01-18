export type Point2D = {
  x: number;
  y: number;
};

export type HomographyMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
];

export function computeHomography(src: Point2D[], dst: Point2D[]): HomographyMatrix {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error("computeHomography requires 4 source and 4 destination points");
  }

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const srcPoint = src[i];
    const dstPoint = dst[i];
    if (!srcPoint || !dstPoint) {
      throw new Error("Missing homography points");
    }
    const { x, y } = srcPoint;
    const { x: u, y: v } = dstPoint;

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(A, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function applyHomography(matrix: HomographyMatrix, point: Point2D): Point2D {
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = matrix;
  const denom = h31 * point.x + h32 * point.y + h33;
  if (Math.abs(denom) < 1e-10) {
    return { x: 0, y: 0 };
  }
  return {
    x: (h11 * point.x + h12 * point.y + h13) / denom,
    y: (h21 * point.x + h22 * point.y + h23) / denom
  };
}

export function invertHomography(matrix: HomographyMatrix): HomographyMatrix {
  const [a, b, c, d, e, f, g, h, i] = matrix;

  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const D = c * h - b * i;
  const E = a * i - c * g;
  const F = b * g - a * h;
  const G = b * f - c * e;
  const H = c * d - a * f;
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    throw new Error("Homography matrix is not invertible");
  }

  const invDet = 1 / det;
  return [
    A * invDet,
    D * invDet,
    G * invDet,
    B * invDet,
    E * invDet,
    H * invDet,
    C * invDet,
    F * invDet,
    I * invDet
  ];
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, rowIndex) => [...row, b[rowIndex] as number]);

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(M[k]![i]!) > Math.abs(M[maxRow]![i]!)) {
        maxRow = k;
      }
    }

    if (Math.abs(M[maxRow]![i]!) < 1e-12) {
      throw new Error("Linear system is singular");
    }

    const temp = M[i]!;
    M[i] = M[maxRow]!;
    M[maxRow] = temp;

    const pivot = M[i]![i]!;
    for (let j = i; j <= n; j += 1) {
      M[i]![j]! /= pivot;
    }

    for (let k = 0; k < n; k += 1) {
      if (k !== i) {
        const factor = M[k]![i]!;
        for (let j = i; j <= n; j += 1) {
          M[k]![j]! -= factor * M[i]![j]!;
        }
      }
    }
  }

  return M.map((row) => row[n] as number);
}
