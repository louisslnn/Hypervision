"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  computeReIdEmbedding,
  DEFAULT_REID_CONFIG,
  ReIdEmbedding
} from "../medsyncVision/reidEmbedding";
import {
  AnchorSet
} from "../shared/anchorTracking";

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

type TrackerState = "tracking" | "lost" | "occluded" | "searching";
type LabelStatus = "idle" | "thinking" | "labeled" | "error";

interface Point {
  x: number;
  y: number;
}

interface TrackerHistory {
  x: number;
  y: number;
  timestamp: number;
}

interface AITrackable {
  id: string;
  x: number;
  y: number;
  label: string;
  objectDescription?: string | undefined;
  visualFeatures?: string | undefined;
  referenceImage?: string | undefined;
  lastGoodPosition?: Point | undefined;
}

interface Tracker {
  id: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  velocityX: number;
  velocityY: number;
  label: string;
  color: string;
  state: TrackerState;
  confidence: number;
  createdAt: number;
  history: TrackerHistory[];
  colorSignature: number[] | null;
  kalmanX: number;
  kalmanY: number;
  kalmanVx: number;
  kalmanVy: number;
  labelStatus: LabelStatus;
  framesLost: number;
  framesOccluded: number;
  lastGoodPosition: Point;
  reidEmbedding?: ReIdEmbedding | null | undefined;
  lastEmbeddingUpdate?: number | undefined;
  template?: Uint8Array | null | undefined;
  templateMean?: number | undefined;
  templateStd?: number | undefined;
  objectDescription?: string | undefined;
  visualFeatures?: string | undefined;
  referenceImage?: string | undefined;
  lastAIValidation?: number | undefined;
  aiConfidence?: number | undefined;
  pendingAIValidation?: boolean | undefined;
  pendingAIReacquisition?: boolean | undefined;
  aiValidationStrikes?: number | undefined;
  anchorSet?: AnchorSet | undefined;
  useAnchors?: boolean | undefined;
  bboxWidth?: number | undefined;
  bboxHeight?: number | undefined;
  bboxConfidence?: number | undefined;
}

interface DrawingStroke {
  id: string;
  points: Point[];
  localPoints: Point[];
  color: string;
  trackerId: string | null;
  closed: boolean;
  label: string;
  visible: boolean;
  opacity: number;
  state?: TrackerState;
  framesLost?: number;
  confidence?: number;
  labelStatus?: LabelStatus;
  objectDescription?: string;
  visualFeatures?: string;
  referenceImage?: string;
  lastAIValidation?: number;
  aiConfidence?: number;
  pendingAIValidation?: boolean;
  pendingAIReacquisition?: boolean;
  anchorSet?: AnchorSet | undefined;
  useAnchors?: boolean | undefined;
  centroidX?: number | undefined;
  centroidY?: number | undefined;
  prevCentroidX?: number | undefined;
  prevCentroidY?: number | undefined;
  velocityX?: number;
  velocityY?: number;
}

const CONFIG = {
  SEARCH_RADIUS: 58,
  SAMPLE_RADIUS: 20,
  SAMPLE_STEP: 2,
  MIN_FLOW_CONFIDENCE: 0.20,
  FORWARD_BACKWARD_THRESHOLD: 6.5,
  MULTI_SCALE_FACTORS: [0.85, 1.0, 1.15],
  OCCLUSION_SCORE_THRESHOLD: 4500,
  LOST_SCORE_THRESHOLD: 13000,
  OCCLUSION_TIMEOUT: 18,
  LOST_TIMEOUT: 200,
  KALMAN_PROCESS_NOISE: 0.6,
  KALMAN_MEASUREMENT_NOISE: 0.15,
  SMOOTHING_FACTOR: 0.35,
  EDGE_WEIGHT: 0.55,
  GRADIENT_SAMPLE_RADIUS: 24,
  COLOR_SAMPLE_SIZE: 25,
  COLOR_MATCH_THRESHOLD: 0.65,
  TRAIL_LENGTH: 50,
  BOUNDARY_GUARD: 15
};

const AI_CONFIG = {
  AUTO_IDENTIFY_ON_PLACEMENT: true,
  VALIDATION_CONFIDENCE_THRESHOLD: 0.4,
  VALIDATION_COOLDOWN_MS: 1200,
  VALIDATION_ON_OCCLUSION: true,
  PERIODIC_VALIDATION_MS: 3500,
  VALIDATE_WITH_ANCHORS: true,
  REACQUISITION_START_FRAME: 3,
  REACQUISITION_INTERVAL_FRAMES: 8,
  REACQUISITION_MIN_CONFIDENCE: 0.38,
  IDENTIFICATION_CROP_SIZE: 300,
  VALIDATION_CROP_SIZE: 200,
  MAX_CONCURRENT_AI_CALLS: 4
};

const PRIMARY_VISION_MODEL = "gpt-4.1-mini";
const FALLBACK_VISION_MODEL = "gpt-4o-mini";

const TRACKER_COLORS = [
  "#22d3ee", "#f472b6", "#a78bfa", "#34d399",
  "#fbbf24", "#fb7185", "#60a5fa", "#c084fc"
];

type FlowConfig = {
  SEARCH_RADIUS: number;
  SAMPLE_RADIUS: number;
  SAMPLE_STEP: number;
  MIN_FLOW_CONFIDENCE: number;
  FORWARD_BACKWARD_THRESHOLD: number;
  BOUNDARY_GUARD: number;
  GRADIENT_SAMPLE_RADIUS: number;
  EDGE_WEIGHT: number;
  LOST_SCORE_THRESHOLD: number;
};

type GlobalMotion = { dx: number; dy: number; confidence: number };

type GlobalMotionConfig = {
  GRID_X: number;
  GRID_Y: number;
  PATCH_SIZE: number;
  SEARCH_RADIUS: number;
  STEP: number;
  MIN_CONFIDENCE: number;
};

const GLOBAL_MOTION_CONFIG: GlobalMotionConfig = {
  GRID_X: 4,
  GRID_Y: 3,
  PATCH_SIZE: 15,
  SEARCH_RADIUS: 16,
  STEP: 2,
  MIN_CONFIDENCE: 0.35
};

const TEMPLATE_CONFIG = {
  SIZE: 21,
  SEARCH_RADIUS: 35,
  STEP: 2,
  MIN_NCC: 0.55,
  REFINE_RADIUS: 3
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function getScaledFlowConfig(scale: number): FlowConfig {
  const radiusScale = Math.max(0.4, Math.min(1.2, scale));
  return {
    SEARCH_RADIUS: Math.max(12, Math.round(CONFIG.SEARCH_RADIUS * radiusScale)),
    SAMPLE_RADIUS: Math.max(6, Math.round(CONFIG.SAMPLE_RADIUS * radiusScale)),
    SAMPLE_STEP: CONFIG.SAMPLE_STEP,
    MIN_FLOW_CONFIDENCE: CONFIG.MIN_FLOW_CONFIDENCE,
    FORWARD_BACKWARD_THRESHOLD: CONFIG.FORWARD_BACKWARD_THRESHOLD,
    BOUNDARY_GUARD: Math.max(4, Math.round(CONFIG.BOUNDARY_GUARD * radiusScale)),
    GRADIENT_SAMPLE_RADIUS: Math.max(6, Math.round(CONFIG.GRADIENT_SAMPLE_RADIUS * radiusScale)),
    EDGE_WEIGHT: CONFIG.EDGE_WEIGHT,
    LOST_SCORE_THRESHOLD: CONFIG.LOST_SCORE_THRESHOLD
  };
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

let activeAICalls = 0;

async function fetchOpenAIChatCompletion(
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (
      response.status === 404 ||
      response.status === 400 ||
      errorText.includes("model_not_found")
    ) {
      const fallbackBody = { ...body, model: FALLBACK_VISION_MODEL };
      const fallbackResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(fallbackBody)
      });
      if (!fallbackResponse.ok) {
        throw new Error(`OpenAI API error: ${fallbackResponse.status}`);
      }
      return fallbackResponse;
    }
    throw new Error(`OpenAI API error: ${response.status}`);
  }
  return response;
}

// ============================================================================
// TEMPLATE MATCHING
// ============================================================================

function captureTemplate(frame: ImageData, x: number, y: number, size: number): Uint8Array | null {
  const half = Math.floor(size / 2);
  if (x < half || x >= frame.width - half || y < half || y >= frame.height - half) return null;
  const template = new Uint8Array(size * size);
  const data = frame.data;
  let idx = 0;
  for (let py = -half; py <= half; py++) {
    for (let px = -half; px <= half; px++) {
      const offset = ((y + py) * frame.width + (x + px)) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      template[idx++] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return template;
}

function computeTemplateStats(template: Uint8Array): { mean: number; std: number } {
  const n = template.length;
  if (n === 0) return { mean: 0, std: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = template[i] ?? 0;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, std: Math.sqrt(variance) };
}

function computeNccAt(
  frame: ImageData,
  centerX: number,
  centerY: number,
  size: number,
  template: Uint8Array,
  templateStats: { mean: number; std: number }
): number | null {
  const half = Math.floor(size / 2);
  if (centerX < half || centerX >= frame.width - half || centerY < half || centerY >= frame.height - half) {
    return null;
  }
  const data = frame.data;
  const frameWidth = frame.width;
  const count = size * size;
  let sum = 0;
  let sumSq = 0;
  const baseY = centerY - half;
  const baseX = centerX - half;
  for (let y = 0; y < size; y++) {
    const rowOffset = (baseY + y) * frameWidth + baseX;
    for (let x = 0; x < size; x++) {
      const offset = (rowOffset + x) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const v = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += v;
      sumSq += v * v;
    }
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const std = Math.sqrt(variance);
  if (std < 1e-3 || templateStats.std < 1e-3) return null;
  let dot = 0;
  let idx = 0;
  for (let y = 0; y < size; y++) {
    const rowOffset = (baseY + y) * frameWidth + baseX;
    for (let x = 0; x < size; x++) {
      const offset = (rowOffset + x) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const v = 0.299 * r + 0.587 * g + 0.114 * b;
      dot += (v - mean) * ((template[idx++] ?? 0) - templateStats.mean);
    }
  }
  return dot / (count * std * templateStats.std);
}

function matchTemplate(
  frame: ImageData,
  template: Uint8Array,
  templateStats: { mean: number; std: number },
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  searchRadius: number,
  step: number,
  minScore: number
): { x: number; y: number; score: number; confidence: number } | null {
  const size = Math.round(Math.sqrt(template.length));
  if (!size) return null;
  const half = Math.floor(size / 2);
  const boundedRadius = Math.max(2, Math.round(searchRadius));
  const stride = Math.max(1, Math.round(step));
  let bestScore = -Infinity;
  let bestX = centerX;
  let bestY = centerY;
  const startX = Math.max(half, Math.round(centerX - boundedRadius));
  const endX = Math.min(width - half - 1, Math.round(centerX + boundedRadius));
  const startY = Math.max(half, Math.round(centerY - boundedRadius));
  const endY = Math.min(height - half - 1, Math.round(centerY + boundedRadius));
  for (let y = startY; y <= endY; y += stride) {
    for (let x = startX; x <= endX; x += stride) {
      const ncc = computeNccAt(frame, x, y, size, template, templateStats);
      if (ncc === null) continue;
      if (ncc > bestScore) {
        bestScore = ncc;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestScore < minScore) return null;
  if (stride > 1) {
    const refineRadius = Math.min(TEMPLATE_CONFIG.REFINE_RADIUS, stride + 1);
    for (let y = bestY - refineRadius; y <= bestY + refineRadius; y++) {
      for (let x = bestX - refineRadius; x <= bestX + refineRadius; x++) {
        if (x < half || x >= width - half || y < half || y >= height - half) continue;
        const ncc = computeNccAt(frame, x, y, size, template, templateStats);
        if (ncc === null) continue;
        if (ncc > bestScore) {
          bestScore = ncc;
          bestX = x;
          bestY = y;
        }
      }
    }
  }
  const confidence = clamp((bestScore + 1) / 2, 0, 1);
  return { x: bestX, y: bestY, score: bestScore, confidence };
}

// ============================================================================
// GRADIENT COMPUTATION
// ============================================================================

function computeGradientMagnitude(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const data = imageData.data;
  const size = radius * 2 + 1;
  const gradients = new Float32Array(size * size);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) continue;
      const idxLeft = (py * width + px - 1) * 4;
      const idxRight = (py * width + px + 1) * 4;
      const idxTop = ((py - 1) * width + px) * 4;
      const idxBottom = ((py + 1) * width + px) * 4;
      const left = 0.299 * (data[idxLeft] ?? 0) + 0.587 * (data[idxLeft + 1] ?? 0) + 0.114 * (data[idxLeft + 2] ?? 0);
      const right = 0.299 * (data[idxRight] ?? 0) + 0.587 * (data[idxRight + 1] ?? 0) + 0.114 * (data[idxRight + 2] ?? 0);
      const top = 0.299 * (data[idxTop] ?? 0) + 0.587 * (data[idxTop + 1] ?? 0) + 0.114 * (data[idxTop + 2] ?? 0);
      const bottom = 0.299 * (data[idxBottom] ?? 0) + 0.587 * (data[idxBottom + 1] ?? 0) + 0.114 * (data[idxBottom + 2] ?? 0);
      const gx = right - left;
      const gy = bottom - top;
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      const arrayIdx = (dy + radius) * size + (dx + radius);
      gradients[arrayIdx] = magnitude;
    }
  }
  return gradients;
}

function compareGradients(grad1: Float32Array, grad2: Float32Array): number {
  if (grad1.length !== grad2.length || grad1.length === 0) return Infinity;
  let sum = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < grad1.length; i++) {
    const v1 = grad1[i] ?? 0;
    const v2 = grad2[i] ?? 0;
    const diff = v1 - v2;
    sum += diff * diff;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }
  if (norm1 < 1e-6 || norm2 < 1e-6) return 1;
  return 1 - Math.max(0, 1 - Math.sqrt(sum / Math.max(norm1, norm2)));
}

// ============================================================================
// COLOR SIGNATURE
// ============================================================================

function captureColorSignature(
  frame: ImageData,
  x: number,
  y: number,
  width: number,
  radius: number
): number[] {
  const histSize = 16;
  const hHist = new Array(histSize).fill(0);
  const sHist = new Array(histSize).fill(0);
  const vHist = new Array(histSize).fill(0);
  const data = frame.data;
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || px >= width || py < 0 || py >= frame.height) continue;
      const idx = (py * width + px) * 4;
      const r = (data[idx] ?? 0) / 255;
      const g = (data[idx + 1] ?? 0) / 255;
      const b = (data[idx + 2] ?? 0) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let h = 0;
      if (delta > 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = ((h * 60) + 360) % 360;
      }
      const s = max > 0 ? delta / max : 0;
      const v = max;
      const hBin = Math.min(histSize - 1, Math.floor((h / 360) * histSize));
      const sBin = Math.min(histSize - 1, Math.floor(s * histSize));
      const vBin = Math.min(histSize - 1, Math.floor(v * histSize));
      hHist[hBin]++;
      sHist[sBin]++;
      vHist[vBin]++;
      count++;
    }
  }
  if (count > 0) {
    for (let i = 0; i < histSize; i++) {
      hHist[i] /= count;
      sHist[i] /= count;
      vHist[i] /= count;
    }
  }
  return [...hHist, ...sHist, ...vHist];
}

// ============================================================================
// GLOBAL MOTION ESTIMATION
// ============================================================================

function estimateGlobalMotion(
  prevFrame: ImageData,
  currFrame: ImageData,
  width: number,
  height: number,
  config: GlobalMotionConfig
): GlobalMotion | null {
  const half = Math.floor(config.PATCH_SIZE / 2);
  const dxs: number[] = [];
  const dys: number[] = [];
  const confidences: number[] = [];
  const gridX = Math.max(1, config.GRID_X);
  const gridY = Math.max(1, config.GRID_Y);
  const minScore = Math.max(0.35, TEMPLATE_CONFIG.MIN_NCC - 0.15);
  const searchStep = Math.max(2, config.STEP);
  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const cx = Math.round(((gx + 0.5) * width) / gridX);
      const cy = Math.round(((gy + 0.5) * height) / gridY);
      if (cx < half + config.SEARCH_RADIUS || cx >= width - half - config.SEARCH_RADIUS ||
          cy < half + config.SEARCH_RADIUS || cy >= height - half - config.SEARCH_RADIUS) {
        continue;
      }
      const template = captureTemplate(prevFrame, cx, cy, config.PATCH_SIZE);
      if (!template) continue;
      const stats = computeTemplateStats(template);
      if (stats.std < 1e-3) continue;
      const match = matchTemplate(currFrame, template, stats, cx, cy, width, height, config.SEARCH_RADIUS, searchStep, minScore);
      if (match && match.confidence >= config.MIN_CONFIDENCE) {
        dxs.push(match.x - cx);
        dys.push(match.y - cy);
        confidences.push(match.confidence);
      }
    }
  }
  if (dxs.length < 3) return null;
  const dx = median(dxs);
  const dy = median(dys);
  const avgConfidence = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  const density = confidences.length / (gridX * gridY);
  return { dx, dy, confidence: clamp(avgConfidence * density, 0, 1) };
}

// ============================================================================
// KALMAN FILTER
// ============================================================================

function kalmanUpdate(
  tracker: Tracker,
  measuredX: number,
  measuredY: number
): { x: number; y: number; vx: number; vy: number } {
  const pNoise = CONFIG.KALMAN_PROCESS_NOISE;
  const mNoise = CONFIG.KALMAN_MEASUREMENT_NOISE;
  const predX = tracker.kalmanX + tracker.kalmanVx;
  const predY = tracker.kalmanY + tracker.kalmanVy;
  const errorX = measuredX - predX;
  const errorY = measuredY - predY;
  const gainX = pNoise / (pNoise + mNoise);
  const gainY = pNoise / (pNoise + mNoise);
  const newX = predX + gainX * errorX;
  const newY = predY + gainY * errorY;
  const newVx = tracker.kalmanVx + gainX * errorX * 0.5;
  const newVy = tracker.kalmanVy + gainY * errorY * 0.5;
  return { x: newX, y: newY, vx: newVx, vy: newVy };
}

// ============================================================================
// OPTICAL FLOW
// ============================================================================

function getMotionPrediction(
  tracker: Tracker,
  globalMotion?: GlobalMotion | null
): { x: number; y: number; velocityScale: number; globalDx: number; globalDy: number } {
  const velocity = Math.sqrt(tracker.velocityX * tracker.velocityX + tracker.velocityY * tracker.velocityY);
  const velocityScale = Math.min(2.2, 1 + velocity * 0.12);
  const globalConfidence = globalMotion?.confidence ?? 0;
  const globalScale = clamp(globalConfidence * 1.2, 0, 1);
  const globalDx = (globalMotion?.dx ?? 0) * globalScale;
  const globalDy = (globalMotion?.dy ?? 0) * globalScale;
  return {
    x: tracker.x + tracker.velocityX * velocityScale + globalDx,
    y: tracker.y + tracker.velocityY * velocityScale + globalDy,
    velocityScale,
    globalDx,
    globalDy
  };
}

function computeOpticalFlow(
  prevFrame: ImageData,
  currFrame: ImageData,
  tracker: Tracker,
  width: number,
  height: number,
  flowConfig: FlowConfig,
  globalMotion?: GlobalMotion | null
): { x: number; y: number; confidence: number; valid: boolean; atBoundary: boolean } {
  const cfg = flowConfig;
  const prediction = getMotionPrediction(tracker, globalMotion);
  const velocity = Math.sqrt(tracker.velocityX * tracker.velocityX + tracker.velocityY * tracker.velocityY);
  const velocityScale = prediction.velocityScale;
  const startX = prediction.x;
  const startY = prediction.y;
  const margin = cfg.BOUNDARY_GUARD + cfg.SAMPLE_RADIUS;
  const atBoundary = startX < margin || startX > width - margin || startY < margin || startY > height - margin;
  if (atBoundary) {
    return { x: tracker.x, y: tracker.y, confidence: 0, valid: false, atBoundary: true };
  }

  const prevData = prevFrame.data;
  const currData = currFrame.data;
  const dataLen = prevData.length;
  const trackerXInt = Math.round(tracker.x);
  const trackerYInt = Math.round(tracker.y);
  const expectedDx = tracker.velocityX * velocityScale + prediction.globalDx;
  const expectedDy = tracker.velocityY * velocityScale + prediction.globalDy;

  const refGradient = computeGradientMagnitude(prevFrame, trackerXInt, trackerYInt, width, height, cfg.GRADIENT_SAMPLE_RADIUS);

  let bestX = startX;
  let bestY = startY;
  let bestScore = Infinity;
  const topCandidates: Array<{x: number; y: number; score: number}> = [];
  const MAX_CANDIDATES = 8;
  const globalMagnitude = Math.hypot(prediction.globalDx, prediction.globalDy);
  const adaptiveRadius = Math.min(cfg.SEARCH_RADIUS * 1.8, cfg.SEARCH_RADIUS + velocity * 2 + globalMagnitude * 1.5);
  const coarseStep = 3;
  const sampleStep = cfg.SAMPLE_STEP;
  const sampleRadius = cfg.SAMPLE_RADIUS;

  for (let dy = -adaptiveRadius; dy <= adaptiveRadius; dy += coarseStep) {
    for (let dx = -adaptiveRadius; dx <= adaptiveRadius; dx += coarseStep) {
      const testX = Math.round(startX + dx);
      const testY = Math.round(startY + dy);
      if (testX < sampleRadius || testX >= width - sampleRadius || testY < sampleRadius || testY >= height - sampleRadius) continue;
      let colorScore = 0;
      let samples = 0;
      for (let py = -sampleRadius; py <= sampleRadius; py += sampleStep) {
        const prevRowBase = (trackerYInt + py) * width;
        const currRowBase = (testY + py) * width;
        for (let px = -sampleRadius; px <= sampleRadius; px += sampleStep) {
          const prevIdx = (prevRowBase + trackerXInt + px) * 4;
          const currIdx = (currRowBase + testX + px) * 4;
          if (prevIdx >= 0 && prevIdx < dataLen - 3 && currIdx >= 0 && currIdx < dataLen - 3) {
            const dr = (prevData[prevIdx] ?? 0) - (currData[currIdx] ?? 0);
            const dg = (prevData[prevIdx + 1] ?? 0) - (currData[currIdx + 1] ?? 0);
            const db = (prevData[prevIdx + 2] ?? 0) - (currData[currIdx + 2] ?? 0);
            colorScore += 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
            samples++;
          }
        }
      }
      if (samples === 0) continue;
      colorScore /= samples;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const distPenalty = dist * 0.15;
      const velocityError = Math.sqrt((dx - expectedDx) ** 2 + (dy - expectedDy) ** 2);
      const velocityPenalty = velocityError * 0.08;
      const totalScore = colorScore + distPenalty + velocityPenalty;
      const lastCandidate = topCandidates[topCandidates.length - 1];
      if (topCandidates.length < MAX_CANDIDATES || (lastCandidate && totalScore < lastCandidate.score)) {
        topCandidates.push({ x: testX, y: testY, score: totalScore });
        topCandidates.sort((a, b) => a.score - b.score);
        if (topCandidates.length > MAX_CANDIDATES) topCandidates.pop();
      }
      if (totalScore < bestScore) {
        bestScore = totalScore;
        bestX = testX;
        bestY = testY;
      }
    }
  }

  let gradientBestX = bestX;
  let gradientBestY = bestY;
  let gradientBestScore = bestScore;
  for (const candidate of topCandidates) {
    const testGradient = computeGradientMagnitude(currFrame, candidate.x, candidate.y, width, height, cfg.GRADIENT_SAMPLE_RADIUS);
    const edgeScore = compareGradients(refGradient, testGradient) * 600;
    const combinedScore = candidate.score * (1 - cfg.EDGE_WEIGHT * 1.2) + edgeScore * cfg.EDGE_WEIGHT * 1.2;
    if (combinedScore < gradientBestScore) {
      gradientBestScore = combinedScore;
      gradientBestX = candidate.x;
      gradientBestY = candidate.y;
    }
  }
  if (gradientBestScore < bestScore * 1.1) {
    bestX = gradientBestX;
    bestY = gradientBestY;
    bestScore = gradientBestScore;
  }

  const refineRadius = 4;
  const refineX = bestX;
  const refineY = bestY;
  for (let dy = -refineRadius; dy <= refineRadius; dy++) {
    for (let dx = -refineRadius; dx <= refineRadius; dx++) {
      const testX = refineX + dx;
      const testY = refineY + dy;
      if (testX < sampleRadius || testX >= width - sampleRadius || testY < sampleRadius || testY >= height - sampleRadius) continue;
      let score = 0;
      let samples = 0;
      for (let py = -sampleRadius; py <= sampleRadius; py += 2) {
        const prevRowBase = (trackerYInt + py) * width;
        const currRowBase = (testY + py) * width;
        for (let px = -sampleRadius; px <= sampleRadius; px += 2) {
          const prevIdx = (prevRowBase + trackerXInt + px) * 4;
          const currIdx = (currRowBase + testX + px) * 4;
          if (prevIdx >= 0 && prevIdx < dataLen - 3 && currIdx >= 0 && currIdx < dataLen - 3) {
            const dr = (prevData[prevIdx] ?? 0) - (currData[currIdx] ?? 0);
            const dg = (prevData[prevIdx + 1] ?? 0) - (currData[currIdx + 1] ?? 0);
            const db = (prevData[prevIdx + 2] ?? 0) - (currData[currIdx + 2] ?? 0);
            score += 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
            samples++;
          }
        }
      }
      if (samples > 0) {
        score /= samples;
        if (score < bestScore) {
          bestScore = score;
          bestX = testX;
          bestY = testY;
        }
      }
    }
  }

  const bestXInt = Math.round(bestX);
  const bestYInt = Math.round(bestY);
  let backX = bestXInt;
  let backY = bestYInt;
  let backBestScore = Infinity;
  const backRadius = cfg.SEARCH_RADIUS / 2;
  const backStep = 2;
  for (let dy = -backRadius; dy <= backRadius; dy += backStep) {
    for (let dx = -backRadius; dx <= backRadius; dx += backStep) {
      const testX = Math.round(bestXInt + dx);
      const testY = Math.round(bestYInt + dy);
      if (testX < sampleRadius || testX >= width - sampleRadius || testY < sampleRadius || testY >= height - sampleRadius) continue;
      let score = 0;
      let samples = 0;
      for (let py = -sampleRadius; py <= sampleRadius; py += sampleStep) {
        const currRowBase = (bestYInt + py) * width;
        const prevRowBase = (testY + py) * width;
        for (let px = -sampleRadius; px <= sampleRadius; px += sampleStep) {
          const currIdx = (currRowBase + bestXInt + px) * 4;
          const prevIdx = (prevRowBase + testX + px) * 4;
          if (currIdx >= 0 && currIdx < dataLen - 3 && prevIdx >= 0 && prevIdx < dataLen - 3) {
            const dr = (currData[currIdx] ?? 0) - (prevData[prevIdx] ?? 0);
            const dg = (currData[currIdx + 1] ?? 0) - (prevData[prevIdx + 1] ?? 0);
            const db = (currData[currIdx + 2] ?? 0) - (prevData[prevIdx + 2] ?? 0);
            score += 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
            samples++;
          }
        }
      }
      if (samples > 0) {
        score /= samples;
        if (score < backBestScore) {
          backBestScore = score;
          backX = testX;
          backY = testY;
        }
      }
    }
  }

  const fbError = Math.sqrt((backX - tracker.x) ** 2 + (backY - tracker.y) ** 2);
  const passesFb = fbError < cfg.FORWARD_BACKWARD_THRESHOLD;
  const motionConsistency = 1 - Math.min(1, fbError / cfg.FORWARD_BACKWARD_THRESHOLD);
  const matchQuality = Math.max(0, 1 - bestScore / cfg.LOST_SCORE_THRESHOLD);
  const confidence = passesFb ? matchQuality * 0.7 + motionConsistency * 0.3 : 0;
  const valid = passesFb && confidence >= cfg.MIN_FLOW_CONFIDENCE;
  return { x: bestX, y: bestY, confidence, valid, atBoundary: false };
}

// ============================================================================
// AI IDENTIFICATION & VALIDATION
// ============================================================================

interface ObjectIdentification {
  label: string;
  description: string;
  features: string;
}

interface ValidationResult {
  isValid: boolean;
  confidence: number;
}

interface ReacquisitionResult {
  found: boolean;
  x: number;
  y: number;
  confidence: number;
}

async function identifyObjectWithFeatures(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  apiKey: string
): Promise<ObjectIdentification> {
  const cropSize = AI_CONFIG.IDENTIFICATION_CROP_SIZE;
  const half = cropSize / 2;
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropSize;
  cropCanvas.height = cropSize;
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) throw new Error("Canvas context unavailable");
  const sourceX = Math.max(0, Math.min(canvas.width - cropSize, x - half));
  const sourceY = Math.max(0, Math.min(canvas.height - cropSize, y - half));
  const sourceW = Math.min(cropSize, canvas.width - sourceX);
  const sourceH = Math.min(cropSize, canvas.height - sourceY);
  cropCtx.fillStyle = "#000";
  cropCtx.fillRect(0, 0, cropSize, cropSize);
  cropCtx.drawImage(canvas, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
  const localX = x - sourceX;
  const localY = y - sourceY;
  cropCtx.strokeStyle = "#00ff00";
  cropCtx.lineWidth = 2;
  cropCtx.beginPath();
  cropCtx.moveTo(localX - 20, localY);
  cropCtx.lineTo(localX + 20, localY);
  cropCtx.moveTo(localX, localY - 20);
  cropCtx.lineTo(localX, localY + 20);
  cropCtx.stroke();
  cropCtx.beginPath();
  cropCtx.arc(localX, localY, 15, 0, Math.PI * 2);
  cropCtx.stroke();
  const imageBase64 = cropCanvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  activeAICalls++;
  try {
    const response = await fetchOpenAIChatCompletion(apiKey, {
      model: PRIMARY_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a visual object identifier. The green crosshair marks the exact object to identify.
Respond ONLY in JSON format (no markdown):
{"label":"Short name (2-4 words)","description":"What is this specific object","features":"Visual features: color, shape, texture, edges"}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify the object at the green crosshair marker:" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" } }
          ]
        }
      ],
      max_tokens: 300,
      temperature: 0.1
    });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    return {
      label: parsed.label ?? "Object",
      description: parsed.description ?? "",
      features: parsed.features ?? ""
    };
  } finally {
    activeAICalls--;
  }
}

async function validateTrackedObject(
  canvas: HTMLCanvasElement,
  tracker: AITrackable,
  apiKey: string
): Promise<ValidationResult> {
  if (!tracker.objectDescription && !tracker.visualFeatures) {
    return { isValid: true, confidence: 0.5 };
  }
  if (activeAICalls >= AI_CONFIG.MAX_CONCURRENT_AI_CALLS) {
    return { isValid: true, confidence: 0.5 };
  }
  activeAICalls++;
  try {
    const cropSize = AI_CONFIG.VALIDATION_CROP_SIZE;
    const half = cropSize / 2;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropSize;
    cropCanvas.height = cropSize;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return { isValid: true, confidence: 0.5 };
    const sourceX = Math.max(0, Math.min(canvas.width - cropSize, tracker.x - half));
    const sourceY = Math.max(0, Math.min(canvas.height - cropSize, tracker.y - half));
    cropCtx.drawImage(canvas, sourceX, sourceY, cropSize, cropSize, 0, 0, cropSize, cropSize);
    const localX = tracker.x - sourceX;
    const localY = tracker.y - sourceY;
    cropCtx.strokeStyle = "#00ff00";
    cropCtx.lineWidth = 2;
    cropCtx.beginPath();
    cropCtx.arc(localX, localY, 12, 0, Math.PI * 2);
    cropCtx.stroke();
    const imageBase64 = cropCanvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    const response = await fetchOpenAIChatCompletion(apiKey, {
      model: PRIMARY_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `Verify if the green circle marks the same object.
Object: "${tracker.label}"
${tracker.objectDescription ? `Description: ${tracker.objectDescription}` : ""}
${tracker.visualFeatures ? `Features: ${tracker.visualFeatures}` : ""}
Respond ONLY in JSON: {"isValid":true/false,"confidence":0.0-1.0}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Is the green circle still on this object?" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 100,
      temperature: 0.1
    });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    return {
      isValid: parsed.isValid ?? true,
      confidence: parsed.confidence ?? 0.5
    };
  } catch {
    return { isValid: true, confidence: 0.5 };
  } finally {
    activeAICalls--;
  }
}

async function findObjectInFrame(
  canvas: HTMLCanvasElement,
  tracker: AITrackable,
  apiKey: string
): Promise<ReacquisitionResult | null> {
  if (!tracker.label || tracker.label.startsWith("Region")) {
    return null;
  }
  if (activeAICalls >= AI_CONFIG.MAX_CONCURRENT_AI_CALLS) {
    return null;
  }
  activeAICalls++;
  try {
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    const response = await fetchOpenAIChatCompletion(apiKey, {
      model: PRIMARY_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `Find a specific object in the frame.
Image dimensions: ${canvas.width}x${canvas.height} pixels.
Object to find: "${tracker.label}"
${tracker.objectDescription ? `Description: ${tracker.objectDescription}` : ""}
${tracker.visualFeatures ? `Visual features: ${tracker.visualFeatures}` : ""}
Last known position: approximately (${Math.round(tracker.lastGoodPosition?.x ?? tracker.x)}, ${Math.round(tracker.lastGoodPosition?.y ?? tracker.y)})
Respond ONLY in JSON: {"found":true/false,"x":number,"y":number,"confidence":0.0-1.0}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Find "${tracker.label}" in this frame` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 100,
      temperature: 0.1
    });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    return {
      found: parsed.found ?? false,
      x: parsed.x ?? tracker.x,
      y: parsed.y ?? tracker.y,
      confidence: parsed.confidence ?? 0
    };
  } catch {
    return null;
  } finally {
    activeAICalls--;
  }
}

// ============================================================================
// COMPONENT PROPS & STYLES
// ============================================================================

export interface HoloRayFollowProps {
  openaiApiKey?: string;
}

const styles = {
  container: {
    background: "#0a0f1a",
    borderRadius: "16px",
    overflow: "hidden",
    fontFamily: "'Inter', -apple-system, sans-serif"
  } as React.CSSProperties,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 20px",
    background: "linear-gradient(135deg, #1a1f2e 0%, #0d1117 100%)",
    borderBottom: "1px solid rgba(59, 130, 246, 0.2)",
    flexWrap: "wrap" as const,
    gap: "12px"
  } as React.CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px"
  } as React.CSSProperties,
  logo: {
    fontSize: "1.5rem"
  } as React.CSSProperties,
  title: {
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "white",
    margin: 0
  } as React.CSSProperties,
  modeBadge: {
    fontSize: "0.65rem",
    padding: "3px 8px",
    borderRadius: "6px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em"
  } as React.CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  fpsDisplay: {
    fontFamily: "monospace",
    fontSize: "0.8rem",
    color: "#60a5fa"
  } as React.CSSProperties,
  statusBadge: {
    fontSize: "0.65rem",
    padding: "3px 8px",
    borderRadius: "6px",
    fontWeight: 500
  } as React.CSSProperties,
  body: {
    position: "relative" as const
  } as React.CSSProperties,
  videoContainer: {
    position: "relative" as const,
    background: "#000",
    aspectRatio: "16/9"
  } as React.CSSProperties,
  video: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    opacity: 0
  } as React.CSSProperties,
  canvas: {
    width: "100%",
    height: "100%",
    cursor: "crosshair"
  } as React.CSSProperties,
  placeholder: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "400px",
    gap: "16px",
    color: "#94a3b8"
  } as React.CSSProperties,
  ctrlBtn: {
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    background: "rgba(255, 255, 255, 0.1)",
    color: "white",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 500,
    transition: "all 0.2s"
  } as React.CSSProperties,
  ctrlBtnPrimary: {
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    border: "1px solid #3b82f6"
  } as React.CSSProperties,
  ctrlBtnDanger: {
    background: "rgba(239, 68, 68, 0.2)",
    borderColor: "#ef4444",
    color: "#fca5a5"
  } as React.CSSProperties,
  controlsPanel: {
    padding: "12px 16px",
    background: "rgba(0, 0, 0, 0.4)",
    borderTop: "1px solid rgba(255, 255, 255, 0.1)"
  } as React.CSSProperties,
  controlsRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
    alignItems: "center"
  } as React.CSSProperties,
  hudOverlay: {
    position: "absolute" as const,
    top: "12px",
    left: "12px",
    display: "flex",
    gap: "8px",
    pointerEvents: "none" as const
  } as React.CSSProperties,
  hudBadge: {
    background: "rgba(0, 0, 0, 0.6)",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "0.75rem",
    color: "#60a5fa",
    fontWeight: 500,
    backdropFilter: "blur(4px)"
  } as React.CSSProperties,
  drawIndicator: {
    background: "rgba(234, 179, 8, 0.3)",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "0.75rem",
    color: "#fbbf24",
    fontWeight: 500
  } as React.CSSProperties,
  instructions: {
    padding: "12px 16px",
    background: "rgba(59, 130, 246, 0.1)",
    borderTop: "1px solid rgba(59, 130, 246, 0.2)",
    fontSize: "0.8rem",
    color: "#94a3b8"
  } as React.CSSProperties
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function HoloRayFollow({ openaiApiKey }: HoloRayFollowProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [drawings, setDrawings] = useState<DrawingStroke[]>([]);
  const [selectedTracker, setSelectedTracker] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<DrawingStroke | null>(null);
  const [fps, setFps] = useState(0);
  const [processingFps, setProcessingFps] = useState(0);
  const [useAnchorTracking, setUseAnchorTracking] = useState(false);

  const trackersRef = useRef<Tracker[]>([]);
  const drawingsRef = useRef<DrawingStroke[]>([]);
  const prevFrameRef = useRef<ImageData | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const processingFrameCountRef = useRef(0);
  const lastProcessTimeRef = useRef(0);
  const globalMotionRef = useRef<GlobalMotion | null>(null);
  const flowConfigRef = useRef<FlowConfig>(getScaledFlowConfig(1));
  const aiValidationGuardRef = useRef<Set<string>>(new Set());
  const aiReacqGuardRef = useRef<Set<string>>(new Set());

  const openaiKey = openaiApiKey;

  useEffect(() => {
    trackersRef.current = trackers;
  }, [trackers]);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Failed to access camera");
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setIsTracking(false);
    setTrackers([]);
    setDrawings([]);
    prevFrameRef.current = null;
  }, []);

  // Add tracker
  const addTracker = useCallback(async (x: number, y: number) => {
    const id = `tracker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const color = TRACKER_COLORS[trackers.length % TRACKER_COLORS.length] ?? "#22d3ee";
    
    const ctx = processingCanvasRef.current?.getContext("2d", { willReadFrequently: true });
    let colorSignature: number[] | null = null;
    let template: Uint8Array | null = null;
    let templateMean: number | undefined;
    let templateStd: number | undefined;
    let reidEmbedding: ReIdEmbedding | null = null;
    
    if (ctx && processingCanvasRef.current) {
      const imageData = ctx.getImageData(0, 0, processingCanvasRef.current.width, processingCanvasRef.current.height);
      colorSignature = captureColorSignature(imageData, Math.round(x), Math.round(y), processingCanvasRef.current.width, CONFIG.COLOR_SAMPLE_SIZE);
      template = captureTemplate(imageData, Math.round(x), Math.round(y), TEMPLATE_CONFIG.SIZE);
      if (template) {
        const stats = computeTemplateStats(template);
        templateMean = stats.mean;
        templateStd = stats.std;
      }
      reidEmbedding = computeReIdEmbedding(imageData, Math.round(x), Math.round(y), processingCanvasRef.current.width, processingCanvasRef.current.height, DEFAULT_REID_CONFIG);
    }

    const newTracker: Tracker = {
      id,
      x,
      y,
      prevX: x,
      prevY: y,
      velocityX: 0,
      velocityY: 0,
      label: `Point ${trackers.length + 1}`,
      color,
      state: "tracking",
      confidence: 1,
      createdAt: Date.now(),
      history: [{ x, y, timestamp: Date.now() }],
      colorSignature,
      kalmanX: x,
      kalmanY: y,
      kalmanVx: 0,
      kalmanVy: 0,
      labelStatus: "idle",
      framesLost: 0,
      framesOccluded: 0,
      lastGoodPosition: { x, y },
      reidEmbedding,
      lastEmbeddingUpdate: Date.now(),
      template,
      templateMean,
      templateStd,
      useAnchors: useAnchorTracking
    };

    setTrackers(prev => [...prev, newTracker]);
    setSelectedTracker(id);

    // AI identification
    if (AI_CONFIG.AUTO_IDENTIFY_ON_PLACEMENT && openaiKey && canvasRef.current) {
      setTrackers(prev => prev.map(t => t.id === id ? { ...t, labelStatus: "thinking" as LabelStatus, label: "Identifying..." } : t));
      try {
        const result = await identifyObjectWithFeatures(canvasRef.current, x, y, openaiKey);
        setTrackers(prev => prev.map(t => t.id === id ? {
          ...t,
          label: result.label,
          objectDescription: result.description,
          visualFeatures: result.features,
          labelStatus: "labeled" as LabelStatus,
          lastAIValidation: Date.now(),
          aiConfidence: 1.0
        } : t));
      } catch (err) {
        console.error("AI identification failed:", err);
        setTrackers(prev => prev.map(t => t.id === id ? { ...t, labelStatus: "error" as LabelStatus } : t));
      }
    }
  }, [trackers.length, openaiKey, useAnchorTracking]);

  // Canvas click handler
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !isTracking || drawMode) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    addTracker(x, y);
  }, [isTracking, drawMode, addTracker]);

  // Drawing handlers
  const handleDrawStart = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !drawMode) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const attachedTracker = trackers.find(t => Math.hypot(t.x - x, t.y - y) < 50);
    setCurrentDrawing({
      id: `draw-${Date.now()}`,
      points: [{ x, y }],
      localPoints: [],
      color: attachedTracker?.color ?? "#fbbf24",
      trackerId: attachedTracker?.id ?? null,
      closed: false,
      label: "Drawing",
      visible: true,
      opacity: 1
    });
  }, [drawMode, trackers]);

  const handleDrawMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentDrawing || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setCurrentDrawing(prev => prev ? { ...prev, points: [...prev.points, { x, y }] } : null);
  }, [currentDrawing]);

  const handleDrawEnd = useCallback(async () => {
    if (!currentDrawing || currentDrawing.points.length < 3) {
      setCurrentDrawing(null);
      return;
    }
    const stroke: DrawingStroke = { ...currentDrawing };
    const centroidX = stroke.points.reduce((sum, p) => sum + p.x, 0) / stroke.points.length;
    const centroidY = stroke.points.reduce((sum, p) => sum + p.y, 0) / stroke.points.length;
    stroke.centroidX = centroidX;
    stroke.centroidY = centroidY;
    stroke.prevCentroidX = centroidX;
    stroke.prevCentroidY = centroidY;

    if (stroke.trackerId) {
      const tracker = trackers.find(t => t.id === stroke.trackerId);
      if (tracker) {
        stroke.localPoints = stroke.points.map(p => ({ x: p.x - tracker.x, y: p.y - tracker.y }));
      }
    }

    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    if (first && last) {
      const closeDist = Math.hypot(first.x - last.x, first.y - last.y);
      stroke.closed = closeDist < 20;
    }

    stroke.labelStatus = "idle";
    if (!stroke.trackerId) {
      stroke.state = "tracking";
      stroke.framesLost = 0;
      stroke.confidence = 1.0;
      stroke.velocityX = 0;
      stroke.velocityY = 0;
    }

    setDrawings(prev => [...prev, stroke]);
    setCurrentDrawing(null);

    // AI identification for drawing
    if (AI_CONFIG.AUTO_IDENTIFY_ON_PLACEMENT && openaiKey && canvasRef.current && !stroke.trackerId) {
      setDrawings(prev => prev.map(d => d.id === stroke.id ? { ...d, labelStatus: "thinking" as LabelStatus, label: "Identifying..." } : d));
      try {
        const result = await identifyObjectWithFeatures(canvasRef.current, centroidX, centroidY, openaiKey);
        setDrawings(prev => prev.map(d => d.id === stroke.id ? {
          ...d,
          label: result.label,
          objectDescription: result.description,
          visualFeatures: result.features,
          labelStatus: "labeled" as LabelStatus,
          lastAIValidation: Date.now(),
          aiConfidence: 1.0
        } : d));
      } catch (err) {
        console.error("Drawing AI identification failed:", err);
        setDrawings(prev => prev.map(d => d.id === stroke.id ? { ...d, labelStatus: "error" as LabelStatus } : d));
      }
    }
  }, [currentDrawing, trackers, openaiKey]);

  // Delete tracker
  const deleteTracker = useCallback((id: string) => {
    setTrackers(prev => prev.filter(t => t.id !== id));
    setDrawings(prev => prev.filter(d => d.trackerId !== id));
    if (selectedTracker === id) setSelectedTracker(null);
  }, [selectedTracker]);

  // Reset
  const resetDemo = useCallback(() => {
    setTrackers([]);
    setDrawings([]);
    setSelectedTracker(null);
    prevFrameRef.current = null;
  }, []);

  // Main render loop
  useEffect(() => {
    if (!cameraActive || !videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    // Create processing canvas
    if (!processingCanvasRef.current) {
      processingCanvasRef.current = document.createElement("canvas");
    }
    const processingCanvas = processingCanvasRef.current;

    let rafId: number;
    const render = () => {
      rafId = requestAnimationFrame(render);
      if (video.readyState < 2) return;

      // Set canvas size
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        processingCanvas.width = video.videoWidth;
        processingCanvas.height = video.videoHeight;
      }

      const width = canvas.width;
      const height = canvas.height;

      // Draw video to canvases
      ctx.drawImage(video, 0, 0, width, height);
      const processingCtx = processingCanvas.getContext("2d", { willReadFrequently: true });
      if (!processingCtx) return;
      processingCtx.drawImage(video, 0, 0, width, height);

      if (isTracking && trackersRef.current.length > 0) {
        const currentFrame = processingCtx.getImageData(0, 0, width, height);
        const prevFrame = prevFrameRef.current;

        if (prevFrame && prevFrame.width === width && prevFrame.height === height) {
          const now = performance.now();
          const minInterval = 1000 / 30;
          
          if (now - lastProcessTimeRef.current >= minInterval) {
            lastProcessTimeRef.current = now;
            processingFrameCountRef.current++;

            // Estimate global motion
            const frameCount = processingFrameCountRef.current;
            let globalMotion = globalMotionRef.current;
            if (frameCount % 2 === 0 || !globalMotion) {
              globalMotion = estimateGlobalMotion(prevFrame, currentFrame, width, height, GLOBAL_MOTION_CONFIG);
              globalMotionRef.current = globalMotion;
            }
            const frameGlobalMotion = globalMotion ?? { dx: 0, dy: 0, confidence: 0 };
            const flowConfig = flowConfigRef.current;

            // Update trackers
            setTrackers(prevTrackers => prevTrackers.map(tracker => {
              if (tracker.state === "lost" && tracker.framesLost > CONFIG.LOST_TIMEOUT) return tracker;

              const margin = flowConfig.BOUNDARY_GUARD;
              if (tracker.x < margin || tracker.x > width - margin || tracker.y < margin || tracker.y > height - margin) {
                return { ...tracker, state: "lost" as TrackerState, framesLost: 0, confidence: 0 };
              }

              const flow = computeOpticalFlow(prevFrame, currentFrame, tracker, width, height, flowConfig, frameGlobalMotion);
              
              if (flow.atBoundary) {
                return { ...tracker, state: "lost" as TrackerState, framesLost: tracker.framesLost + 1 };
              }

              if (!flow.valid) {
                const newFramesOccluded = tracker.framesOccluded + 1;
                if (newFramesOccluded > CONFIG.OCCLUSION_TIMEOUT) {
                  return { ...tracker, state: "lost" as TrackerState, framesLost: 0, framesOccluded: 0, confidence: 0 };
                }
                return { ...tracker, state: "occluded" as TrackerState, framesOccluded: newFramesOccluded, confidence: flow.confidence };
              }

              const kalman = kalmanUpdate(tracker, flow.x, flow.y);
              const speed = Math.hypot(kalman.vx, kalman.vy);
              const motionFactor = clamp(speed / 20, 0, 1);
              const smoothingFactor = lerp(CONFIG.SMOOTHING_FACTOR, 0.85, motionFactor);
              const smoothX = tracker.x + (kalman.x - tracker.x) * smoothingFactor;
              const smoothY = tracker.y + (kalman.y - tracker.y) * smoothingFactor;

              const newVelocityX = smoothX - tracker.x;
              const newVelocityY = smoothY - tracker.y;

              return {
                ...tracker,
                prevX: tracker.x,
                prevY: tracker.y,
                x: smoothX,
                y: smoothY,
                velocityX: newVelocityX * 0.7 + tracker.velocityX * 0.3,
                velocityY: newVelocityY * 0.7 + tracker.velocityY * 0.3,
                kalmanX: kalman.x,
                kalmanY: kalman.y,
                kalmanVx: kalman.vx,
                kalmanVy: kalman.vy,
                state: "tracking" as TrackerState,
                confidence: flow.confidence,
                framesLost: 0,
                framesOccluded: 0,
                lastGoodPosition: { x: smoothX, y: smoothY },
                history: [...tracker.history.slice(-CONFIG.TRAIL_LENGTH), { x: smoothX, y: smoothY, timestamp: Date.now() }]
              };
            }));

            // Update drawings
            setDrawings(prevDrawings => prevDrawings.map(drawing => {
              if (drawing.trackerId) {
                const tracker = trackersRef.current.find(t => t.id === drawing.trackerId);
                if (!tracker) return drawing;
                const visible = tracker.state === "tracking" || tracker.state === "occluded";
                const opacity = tracker.state === "tracking" ? 1.0 : tracker.state === "occluded" ? 0.5 : 0;
                if (drawing.localPoints.length > 0) {
                  const newPoints = drawing.localPoints.map(lp => ({ x: tracker.x + lp.x, y: tracker.y + lp.y }));
                  const newCentroidX = newPoints.reduce((sum, p) => sum + p.x, 0) / newPoints.length;
                  const newCentroidY = newPoints.reduce((sum, p) => sum + p.y, 0) / newPoints.length;
                  return { ...drawing, points: newPoints, prevCentroidX: drawing.centroidX, prevCentroidY: drawing.centroidY, centroidX: newCentroidX, centroidY: newCentroidY, visible, opacity };
                }
                return { ...drawing, visible, opacity };
              }
              
              // Independent drawing - apply global motion
              if (frameGlobalMotion.confidence > 0.3) {
                const dx = frameGlobalMotion.dx;
                const dy = frameGlobalMotion.dy;
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                  const newPoints = drawing.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                  return {
                    ...drawing,
                    points: newPoints,
                    prevCentroidX: drawing.centroidX,
                    prevCentroidY: drawing.centroidY,
                    centroidX: (drawing.centroidX ?? 0) + dx,
                    centroidY: (drawing.centroidY ?? 0) + dy
                  };
                }
              }
              return drawing;
            }));
          }
        }

        prevFrameRef.current = currentFrame;
      }

      // Render annotations
      trackers.forEach(tracker => {
        if (tracker.state === "lost") return;
        const opacity = tracker.state === "tracking" ? 1 : 0.5;
        ctx.globalAlpha = opacity;
        
        // Draw marker
        ctx.beginPath();
        ctx.arc(tracker.x, tracker.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = tracker.color;
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Draw crosshair
        ctx.beginPath();
        ctx.moveTo(tracker.x - 20, tracker.y);
        ctx.lineTo(tracker.x + 20, tracker.y);
        ctx.moveTo(tracker.x, tracker.y - 20);
        ctx.lineTo(tracker.x, tracker.y + 20);
        ctx.strokeStyle = tracker.color;
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw label
        ctx.font = "bold 12px Inter, sans-serif";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText(tracker.label, tracker.x, tracker.y - 25);
        
        ctx.globalAlpha = 1;
      });

      // Render drawings
      [...drawings, currentDrawing].filter(Boolean).forEach(drawing => {
        if (!drawing || !drawing.visible) return;
        if (drawing.points.length < 2) return;
        ctx.globalAlpha = drawing.opacity;
        ctx.beginPath();
        ctx.moveTo(drawing.points[0]?.x ?? 0, drawing.points[0]?.y ?? 0);
        for (let i = 1; i < drawing.points.length; i++) {
          ctx.lineTo(drawing.points[i]?.x ?? 0, drawing.points[i]?.y ?? 0);
        }
        if (drawing.closed) ctx.closePath();
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Update FPS
      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsUpdateRef.current > 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsUpdateRef.current)));
        setProcessingFps(Math.round((processingFrameCountRef.current * 1000) / (now - lastFpsUpdateRef.current)));
        frameCountRef.current = 0;
        processingFrameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [cameraActive, isTracking, trackers, drawings, currentDrawing]);

  // AI tracking checks
  useEffect(() => {
    if (!openaiKey || !canvasRef.current || !isTracking) return;
    const canvas = canvasRef.current;
    const interval = setInterval(() => {
      trackersRef.current.forEach(tracker => {
        const now = Date.now();
        const timeSinceLastValidation = now - (tracker.lastAIValidation ?? 0);
        
        // Validation
        const needsValidation = tracker.confidence < AI_CONFIG.VALIDATION_CONFIDENCE_THRESHOLD && timeSinceLastValidation > AI_CONFIG.VALIDATION_COOLDOWN_MS;
        const needsPeriodic = timeSinceLastValidation > AI_CONFIG.PERIODIC_VALIDATION_MS;
        
        if ((tracker.state === "tracking" || tracker.state === "occluded") && (needsValidation || needsPeriodic) && !tracker.pendingAIValidation && !aiValidationGuardRef.current.has(tracker.id)) {
          aiValidationGuardRef.current.add(tracker.id);
          setTrackers(prev => prev.map(t => t.id === tracker.id ? { ...t, pendingAIValidation: true } : t));
          
          validateTrackedObject(canvas, tracker, openaiKey)
            .then(result => {
              setTrackers(prev => prev.map(t => {
                if (t.id !== tracker.id) return t;
                const updated = { ...t, pendingAIValidation: false, lastAIValidation: Date.now() };
                if (!result.isValid) {
                  return { ...updated, state: "lost" as TrackerState, framesLost: 0, confidence: 0.2 };
                }
                return { ...updated, aiConfidence: result.confidence };
              }));
            })
            .finally(() => aiValidationGuardRef.current.delete(tracker.id));
        }
        
        // Re-acquisition
        const framesSinceStart = tracker.framesLost - AI_CONFIG.REACQUISITION_START_FRAME;
        const shouldReacquire = tracker.framesLost === AI_CONFIG.REACQUISITION_START_FRAME || (framesSinceStart > 0 && framesSinceStart % AI_CONFIG.REACQUISITION_INTERVAL_FRAMES === 0);
        
        if ((tracker.state === "lost" || tracker.state === "searching") && shouldReacquire && !tracker.pendingAIReacquisition && !aiReacqGuardRef.current.has(tracker.id)) {
          aiReacqGuardRef.current.add(tracker.id);
          setTrackers(prev => prev.map(t => t.id === tracker.id ? { ...t, pendingAIReacquisition: true } : t));
          
          findObjectInFrame(canvas, tracker, openaiKey)
            .then(result => {
              setTrackers(prev => prev.map(t => {
                if (t.id !== tracker.id) return t;
                const updated = { ...t, pendingAIReacquisition: false };
                if (result && result.found && result.confidence >= AI_CONFIG.REACQUISITION_MIN_CONFIDENCE) {
                  return {
                    ...updated,
                    x: result.x,
                    y: result.y,
                    prevX: result.x,
                    prevY: result.y,
                    kalmanX: result.x,
                    kalmanY: result.y,
                    kalmanVx: 0,
                    kalmanVy: 0,
                    state: "tracking" as TrackerState,
                    confidence: result.confidence,
                    framesLost: 0,
                    lastGoodPosition: { x: result.x, y: result.y },
                    lastAIValidation: Date.now(),
                    aiConfidence: result.confidence
                  };
                }
                return updated;
              }));
            })
            .finally(() => aiReacqGuardRef.current.delete(tracker.id));
        }
      });
    }, 500);
    
    return () => clearInterval(interval);
  }, [openaiKey, isTracking]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>🎯</span>
          <h2 style={styles.title}>HoloRay Follow</h2>
          <span style={{ ...styles.modeBadge, background: cameraActive ? "rgba(16, 185, 129, 0.2)" : "rgba(148, 163, 184, 0.2)", color: cameraActive ? "#34d399" : "#94a3b8" }}>
            {cameraActive ? (isTracking ? "Live" : "Camera Ready") : "Offline"}
          </span>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.fpsDisplay}>{fps} UI FPS | {processingFps} PROC FPS</span>
          {openaiKey && <span style={{ ...styles.statusBadge, color: "#10b981", background: "rgba(16, 185, 129, 0.15)" }}>AI Ready</span>}
        </div>
      </div>

      <div style={styles.body}>
        {!cameraActive ? (
          <div style={styles.placeholder}>
            <span style={{ fontSize: "3rem" }}>📷</span>
            <p>Click Start Camera to begin live tracking</p>
            <button style={{ ...styles.ctrlBtn, ...styles.ctrlBtnPrimary }} onClick={startCamera}>
              🎥 Start Camera
            </button>
            {cameraError && <p style={{ color: "#ef4444" }}>{cameraError}</p>}
          </div>
        ) : (
          <div style={styles.videoContainer}>
            <video ref={videoRef} style={styles.video} playsInline muted />
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onMouseDown={drawMode ? handleDrawStart : undefined}
              onMouseMove={drawMode ? handleDrawMove : undefined}
              onMouseUp={drawMode ? handleDrawEnd : undefined}
              onMouseLeave={drawMode ? handleDrawEnd : undefined}
              style={styles.canvas}
            />
            <div style={styles.hudOverlay}>
              <span style={styles.hudBadge}>{trackers.filter(t => t.state === "tracking").length}/{trackers.length} Active</span>
              {drawings.length > 0 && <span style={styles.hudBadge}>{drawings.length} Drawing{drawings.length !== 1 ? "s" : ""}</span>}
              {drawMode && <span style={styles.drawIndicator}>✏️ Draw Mode</span>}
            </div>
          </div>
        )}
      </div>

      {cameraActive && (
        <div style={styles.controlsPanel}>
          <div style={styles.controlsRow}>
            {!isTracking ? (
              <button style={{ ...styles.ctrlBtn, ...styles.ctrlBtnPrimary }} onClick={() => setIsTracking(true)}>
                ▶️ Start Tracking
              </button>
            ) : (
              <button style={styles.ctrlBtn} onClick={() => setIsTracking(false)}>
                ⏸️ Pause
              </button>
            )}
            <button style={{ ...styles.ctrlBtn, background: drawMode ? "rgba(251, 191, 36, 0.3)" : undefined }} onClick={() => setDrawMode(!drawMode)}>
              {drawMode ? "✏️ Drawing ON" : "✏️ Draw"}
            </button>
            <button style={{ ...styles.ctrlBtn, background: useAnchorTracking ? "rgba(167, 139, 250, 0.3)" : undefined }} onClick={() => setUseAnchorTracking(!useAnchorTracking)}>
              {useAnchorTracking ? "🔗 Anchors ON" : "🔗 Anchors"}
            </button>
            <button style={styles.ctrlBtn} onClick={resetDemo}>↺ Reset</button>
            {selectedTracker && (
              <button style={{ ...styles.ctrlBtn, ...styles.ctrlBtnDanger }} onClick={() => deleteTracker(selectedTracker)}>
                🗑️ Delete Selected
              </button>
            )}
            <button style={{ ...styles.ctrlBtn, ...styles.ctrlBtnDanger }} onClick={stopCamera}>⏹️ Stop Camera</button>
          </div>
        </div>
      )}

      {cameraActive && isTracking && (
        <div style={styles.instructions}>
          <strong>Instructions:</strong> Click on objects to track them. Use Draw mode to annotate areas. AI will identify objects automatically.
        </div>
      )}
    </div>
  );
}

export default HoloRayFollow;

