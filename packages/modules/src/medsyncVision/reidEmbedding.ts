export type ReIdConfig = {
  cropSize: number;
  downsampleSize: number;
  gridSize: number;
  hueBins: number;
  satBins: number;
  updateAlpha: number;
  matchThreshold: number;
  maxCandidates: number;
};

export const DEFAULT_REID_CONFIG: ReIdConfig = {
  cropSize: 120,
  downsampleSize: 32,
  gridSize: 8,
  hueBins: 12,
  satBins: 4,
  updateAlpha: 0.18,
  matchThreshold: 0.78,
  maxCandidates: 6
};

export type ReIdEmbedding = number[];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeVector = (vec: number[]): number[] => {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  if (sumSq === 0) return vec;
  const inv = 1 / Math.sqrt(sumSq);
  return vec.map((v) => v * inv);
};

const rgbToHsv = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  const v = max / 255;
  return { h, s, v };
};

export const computeReIdEmbedding = (
  imageData: ImageData,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  overrides?: Partial<ReIdConfig>
): ReIdEmbedding | null => {
  const config = { ...DEFAULT_REID_CONFIG, ...(overrides ?? {}) };
  const maxCrop = Math.min(width, height);
  const targetCrop = Math.max(8, Math.round(config.cropSize));
  const cropSize = Math.min(maxCrop, targetCrop);
  const half = cropSize / 2;
  const downsampleSize = Math.max(16, Math.round(config.downsampleSize));
  const gridSize = Math.max(4, Math.round(config.gridSize));

  const srcX = clamp(Math.round(centerX - half), 0, width - cropSize);
  const srcY = clamp(Math.round(centerY - half), 0, height - cropSize);

  if (cropSize <= 0 || downsampleSize <= 0) {
    return null;
  }

  const grayscale = new Float32Array(downsampleSize * downsampleSize);
  const hueBins = config.hueBins;
  const satBins = config.satBins;
  const colorHist = new Array(hueBins * satBins).fill(0);

  for (let y = 0; y < downsampleSize; y++) {
    const srcYPos = srcY + (y + 0.5) * (cropSize / downsampleSize);
    const sy = clamp(Math.round(srcYPos), 0, height - 1);
    for (let x = 0; x < downsampleSize; x++) {
      const srcXPos = srcX + (x + 0.5) * (cropSize / downsampleSize);
      const sx = clamp(Math.round(srcXPos), 0, width - 1);
      const idx = (sy * width + sx) * 4;
      const r = imageData.data[idx] ?? 0;
      const g = imageData.data[idx + 1] ?? 0;
      const b = imageData.data[idx + 2] ?? 0;

      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      grayscale[y * downsampleSize + x] = gray;

      const hsv = rgbToHsv(r, g, b);
      const hBin = Math.min(hueBins - 1, Math.floor((hsv.h / 360) * hueBins));
      const sBin = Math.min(satBins - 1, Math.floor(hsv.s * satBins));
      colorHist[sBin * hueBins + hBin] += 1;
    }
  }

  const cellSize = Math.floor(downsampleSize / gridSize);
  if (cellSize < 1) return null;

  const grayBlocks = new Array(gridSize * gridSize).fill(0);
  const edgeBlocks = new Array(gridSize * gridSize).fill(0);

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      let graySum = 0;
      let edgeSum = 0;
      let count = 0;
      const startX = gx * cellSize;
      const startY = gy * cellSize;

      for (let y = 0; y < cellSize; y++) {
        const py = startY + y;
        if (py <= 0 || py >= downsampleSize - 1) continue;
        for (let x = 0; x < cellSize; x++) {
          const px = startX + x;
          if (px <= 0 || px >= downsampleSize - 1) continue;
          const idx = py * downsampleSize + px;
          const gxVal =
            (grayscale[idx + 1] ?? 0) - (grayscale[idx - 1] ?? 0);
          const gyVal =
            (grayscale[idx + downsampleSize] ?? 0) -
            (grayscale[idx - downsampleSize] ?? 0);
          const edgeMag = Math.sqrt(gxVal * gxVal + gyVal * gyVal);
          graySum += grayscale[idx] ?? 0;
          edgeSum += edgeMag;
          count++;
        }
      }

      const blockIdx = gy * gridSize + gx;
      if (count > 0) {
        grayBlocks[blockIdx] = graySum / count;
        edgeBlocks[blockIdx] = edgeSum / count;
      }
    }
  }

  const totalSamples = downsampleSize * downsampleSize;
  if (totalSamples > 0) {
    for (let i = 0; i < colorHist.length; i++) {
      colorHist[i] = colorHist[i] / totalSamples;
    }
  }

  const embedding = normalizeVector([...grayBlocks, ...edgeBlocks, ...colorHist]);
  return embedding;
};

export const compareEmbeddings = (a: ReIdEmbedding | null, b: ReIdEmbedding | null): number => {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
};

export const blendEmbeddings = (
  base: ReIdEmbedding | null,
  next: ReIdEmbedding | null,
  alpha: number
): ReIdEmbedding | null => {
  if (!base) return next;
  if (!next || base.length !== next.length) return base;
  const clampedAlpha = clamp(alpha, 0, 1);
  const blended = base.map((val, idx) => val * (1 - clampedAlpha) + (next[idx] ?? 0) * clampedAlpha);
  return normalizeVector(blended);
};
