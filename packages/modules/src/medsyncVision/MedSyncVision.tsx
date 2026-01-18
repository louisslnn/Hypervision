"use client";

import { syncCanvasToVideo } from "@hypervision/ar-core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AnchorConfig,
  AnchorSet,
  detectAnchorsOnObject,
  createAnchorSet,
  trackAnchors,
  estimatePositionFromAnchors,
  blendPositions,
  // renderAnchors - not used since anchors are internal only
  ANCHOR_CONFIG
} from "../shared/anchorTracking";
import {
  useDetectionClient,
  drawDetections,
  DetectionMode,
  Detection
} from "../shared/detectionClient";

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

// Server detection configuration
const DETECTION_SERVER_URL =
  typeof window !== "undefined"
    ? ((window as { ENV_DETECTION_SERVER?: string }).ENV_DETECTION_SERVER ??
      "ws://localhost:8765/ws/detect")
    : "ws://localhost:8765/ws/detect";

type TrackerState = "tracking" | "lost" | "occluded" | "searching";
type LabelStatus = "idle" | "thinking" | "labeled" | "error";
type AnnotationStyle = "minimal" | "standard" | "detailed" | "gaming";

interface Point {
  x: number;
  y: number;
}

interface TrackerHistory {
  x: number;
  y: number;
  timestamp: number;
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
  // Visual DNA - color histogram signature
  colorSignature: number[] | null;
  // Kalman filter state
  kalmanX: number;
  kalmanY: number;
  kalmanVx: number;
  kalmanVy: number;
  // AI labeling
  labelStatus: LabelStatus;
  framesLost: number;
  framesOccluded: number;
  lastGoodPosition: Point;
  // YOLO box memory (optional, helps matching)
  bboxWidth?: number;
  bboxHeight?: number;
  bboxConfidence?: number;
  // Object-aware tracking (AI-powered)
  objectDescription?: string; // Detailed description of the object
  visualFeatures?: string; // Key visual features for re-identification
  lastAIValidation?: number; // Timestamp of last AI validation check
  aiConfidence?: number; // AI's confidence we're still on the object
  referenceImage?: string; // Base64 of original object crop for comparison
  pendingAIValidation?: boolean; // Flag to prevent duplicate AI calls
  pendingAIReacquisition?: boolean; // Flag to prevent duplicate re-acquisition calls
  // Anchor-based tracking (hybrid approach)
  anchorSet?: AnchorSet | undefined; // Set of keypoint anchors on the object
  useAnchors?: boolean | undefined; // Whether to use anchor-assisted tracking
}

interface DrawingStroke {
  id: string;
  points: Point[];
  localPoints: Point[]; // Points relative to tracker center
  color: string;
  trackerId: string | null;
  closed: boolean;
  label: string;
  visible: boolean;
  opacity: number;
  // AI Object-Aware Drawing (same as markers)
  labelStatus?: LabelStatus;
  objectDescription?: string;
  visualFeatures?: string;
  referenceImage?: string;
  lastAIValidation?: number;
  aiConfidence?: number;
  // Anchor-based tracking for drawings
  anchorSet?: AnchorSet | undefined;
  useAnchors?: boolean | undefined;
  // Centroid for tracking when not attached to a tracker
  centroidX?: number | undefined;
  centroidY?: number | undefined;
  prevCentroidX?: number | undefined;
  prevCentroidY?: number | undefined;
}

// Configuration - Optimized for surgical tool tracking
const CONFIG = {
  // Multi-scale optical flow for better tool tracking
  SEARCH_RADIUS: 40, // Larger search for fast-moving tools
  SAMPLE_RADIUS: 18, // Larger sample for better context
  SAMPLE_STEP: 2,
  MIN_FLOW_CONFIDENCE: 0.35, // Slightly more permissive
  FORWARD_BACKWARD_THRESHOLD: 4.0, // Allow more movement

  // Additional scales for multi-scale matching
  MULTI_SCALE_FACTORS: [0.8, 1.0, 1.2], // Search at different scales

  // State transitions - more tolerant for surgical scenarios
  OCCLUSION_SCORE_THRESHOLD: 4000, // Higher threshold for metallic reflections
  LOST_SCORE_THRESHOLD: 8000,
  OCCLUSION_TIMEOUT: 12, // More frames before declaring occluded
  LOST_TIMEOUT: 150, // More frames before declaring lost
  BOUNDARY_GUARD: 15,

  // Kalman filter - tuned for smooth tool tracking
  KALMAN_PROCESS_NOISE: 0.4, // Lower = smoother
  KALMAN_MEASUREMENT_NOISE: 0.15,
  SMOOTHING_FACTOR: 0.5, // Lower = smoother tracking

  // Visual DNA - larger sample for better tool identification
  COLOR_SAMPLE_SIZE: 40,
  COLOR_MATCH_THRESHOLD: 0.5, // More permissive for re-ID

  // Edge tracking for metallic surfaces
  EDGE_WEIGHT: 0.4, // How much to weight edge matching
  GRADIENT_SAMPLE_RADIUS: 20,

  // Rendering
  TRAIL_LENGTH: 80,
  MARKER_SIZE_MINIMAL: 6,
  MARKER_SIZE_STANDARD: 10,
  MARKER_SIZE_GAMING: 14
};

const PROCESSING_CONFIG = {
  MAX_WIDTH: 960,
  MAX_HEIGHT: 540,
  TARGET_FPS: 30
};

const COLORS = [
  "#10b981",
  "#f59e0b",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316"
];
const STYLE_NAMES: AnnotationStyle[] = ["minimal", "standard", "detailed", "gaming"];

// AI Object-Aware Tracking Configuration - Optimized for surgical precision
const AI_CONFIG = {
  // Auto-identification on marker placement
  AUTO_IDENTIFY_ON_PLACEMENT: true,

  // Validation triggers - more frequent for better accuracy
  VALIDATION_CONFIDENCE_THRESHOLD: 0.5, // Validate when confidence drops below this (raised)
  VALIDATION_COOLDOWN_MS: 1200, // Faster validation checks (1.2s instead of 2s)
  VALIDATION_ON_OCCLUSION: true, // Validate when tracker becomes occluded
  
  // IMPORTANT: Periodic validation even with anchors
  // Anchors can boost confidence but don't verify we're on the RIGHT object
  PERIODIC_VALIDATION_MS: 3000, // Run AI validation every 3 seconds regardless of confidence
  VALIDATE_WITH_ANCHORS: true, // Still validate even when anchors provide good tracking

  // Re-acquisition settings - more aggressive search
  REACQUISITION_START_FRAME: 6, // Start AI search earlier (was 10)
  REACQUISITION_INTERVAL_FRAMES: 15, // More frequent search (was 30)
  REACQUISITION_MIN_CONFIDENCE: 0.45, // Accept slightly lower confidence (was 0.5)

  // Crop sizes for AI analysis
  IDENTIFICATION_CROP_SIZE: 300, // Larger crop for initial identification
  VALIDATION_CROP_SIZE: 200, // Smaller crop for validation checks

  // API settings
  MAX_CONCURRENT_AI_CALLS: 3 // Allow more concurrent calls (was 2)
};

// OpenAI model selection with safe fallback
const PRIMARY_VISION_MODEL = "gpt-4.1-mini";
const FALLBACK_VISION_MODEL = "gpt-4o-mini";

type ProcessingScale = {
  x: number;
  y: number;
  scalar: number;
};

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

function getProcessingDimensions(
  displayWidth: number,
  displayHeight: number
): { width: number; height: number; scale: ProcessingScale } {
  const scale = Math.min(
    1,
    PROCESSING_CONFIG.MAX_WIDTH / displayWidth,
    PROCESSING_CONFIG.MAX_HEIGHT / displayHeight
  );
  const width = Math.max(1, Math.round(displayWidth * scale));
  const height = Math.max(1, Math.round(displayHeight * scale));
  return {
    width,
    height,
    scale: {
      x: width / displayWidth,
      y: height / displayHeight,
      scalar: Math.min(width / displayWidth, height / displayHeight)
    }
  };
}

function getScaledFlowConfig(scale: number): FlowConfig {
  const radiusScale = Math.max(0.35, Math.min(1, scale));
  return {
    SEARCH_RADIUS: Math.max(6, Math.round(CONFIG.SEARCH_RADIUS * radiusScale)),
    SAMPLE_RADIUS: Math.max(4, Math.round(CONFIG.SAMPLE_RADIUS * radiusScale)),
    SAMPLE_STEP: Math.max(1, Math.round(CONFIG.SAMPLE_STEP * radiusScale)),
    MIN_FLOW_CONFIDENCE: CONFIG.MIN_FLOW_CONFIDENCE,
    FORWARD_BACKWARD_THRESHOLD: Math.max(1, CONFIG.FORWARD_BACKWARD_THRESHOLD * radiusScale),
    BOUNDARY_GUARD: Math.max(4, Math.round(CONFIG.BOUNDARY_GUARD * radiusScale)),
    GRADIENT_SAMPLE_RADIUS: Math.max(4, Math.round(CONFIG.GRADIENT_SAMPLE_RADIUS * radiusScale)),
    EDGE_WEIGHT: CONFIG.EDGE_WEIGHT,
    LOST_SCORE_THRESHOLD: CONFIG.LOST_SCORE_THRESHOLD
  };
}

function getScaledAnchorConfig(scale: number): AnchorConfig {
  const radiusScale = Math.max(0.35, Math.min(1, scale));
  const templateSize = Math.max(
    7,
    Math.round(ANCHOR_CONFIG.ANCHOR_TEMPLATE_SIZE * radiusScale)
  );
  const oddTemplateSize = templateSize % 2 === 0 ? templateSize + 1 : templateSize;

  return {
    ...ANCHOR_CONFIG,
    DETECTION_RADIUS: Math.max(20, Math.round(ANCHOR_CONFIG.DETECTION_RADIUS * radiusScale)),
    MIN_ANCHOR_SPACING: Math.max(8, Math.round(ANCHOR_CONFIG.MIN_ANCHOR_SPACING * radiusScale)),
    ANCHOR_TEMPLATE_SIZE: oddTemplateSize,
    ANCHOR_SEARCH_RADIUS: Math.max(
      10,
      Math.round(ANCHOR_CONFIG.ANCHOR_SEARCH_RADIUS * radiusScale)
    )
  };
}

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

  if (response.ok) {
    return response;
  }

  if (body.model === PRIMARY_VISION_MODEL) {
    try {
      const errorPayload = await response.clone().json().catch(() => null);
      const errorCode = errorPayload?.error?.code;
      if (response.status === 404 || response.status === 400 || errorCode === "model_not_found") {
        const fallbackBody = { ...body, model: FALLBACK_VISION_MODEL };
        return await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(fallbackBody)
        });
      }
    } catch {
      // fall through
    }
  }

  return response;
}

// ============================================================================
// HYBRID TRACKING - YOLO + Optical Flow Integration
// ============================================================================

interface YoloTrackerMatch {
  trackerId: string;
  detection: Detection;
  iou: number;
  centerDistance: number;
}

/**
 * Calculate IoU (Intersection over Union) between a tracker position and a detection box
 * Detection bbox coords are normalized (0-1), so we need to scale them
 */
function calculateTrackerDetectionIoU(
  trackerX: number,
  trackerY: number,
  detection: Detection,
  canvasWidth: number,
  canvasHeight: number,
  trackerSize?: { width: number; height: number },
  trackerRadius: number = 40
): number {
  const trackerWidth = trackerSize?.width ?? trackerRadius * 2;
  const trackerHeight = trackerSize?.height ?? trackerRadius * 2;
  const t_x1 = trackerX - trackerWidth / 2;
  const t_y1 = trackerY - trackerHeight / 2;
  const t_x2 = trackerX + trackerWidth / 2;
  const t_y2 = trackerY + trackerHeight / 2;

  // Scale detection bbox from normalized to pixel coords
  const d_x1 = detection.bbox.x1 * canvasWidth;
  const d_y1 = detection.bbox.y1 * canvasHeight;
  const d_x2 = detection.bbox.x2 * canvasWidth;
  const d_y2 = detection.bbox.y2 * canvasHeight;

  // Calculate intersection
  const inter_x1 = Math.max(t_x1, d_x1);
  const inter_y1 = Math.max(t_y1, d_y1);
  const inter_x2 = Math.min(t_x2, d_x2);
  const inter_y2 = Math.min(t_y2, d_y2);

  const inter_w = Math.max(0, inter_x2 - inter_x1);
  const inter_h = Math.max(0, inter_y2 - inter_y1);
  const inter_area = inter_w * inter_h;

  // Calculate union
  const tracker_area = trackerRadius * 2 * trackerRadius * 2;
  const detection_area = (d_x2 - d_x1) * (d_y2 - d_y1);
  const union_area = tracker_area + detection_area - inter_area;

  return union_area > 0 ? inter_area / union_area : 0;
}

/**
 * Get center point of a detection box in pixel coordinates
 */
function getDetectionCenter(
  detection: Detection,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  return {
    x: detection.bbox.centerX * canvasWidth,
    y: detection.bbox.centerY * canvasHeight
  };
}

/**
 * Match YOLO detections with existing trackers
 * Returns matches sorted by quality (IoU * confidence)
 */
function matchDetectionsToTrackers(
  trackers: Tracker[],
  detections: Detection[],
  canvasWidth: number,
  canvasHeight: number,
  iouThreshold: number = 0.1,
  searchRadius: number = CONFIG.SEARCH_RADIUS
): YoloTrackerMatch[] {
  const matches: YoloTrackerMatch[] = [];
  const usedDetections = new Set<number>();

  // For each tracker, find the best matching detection
  for (const tracker of trackers) {
    let bestMatch: { detection: Detection; iou: number; idx: number; centerDist: number } | null =
      null;

    for (let i = 0; i < detections.length; i++) {
      if (usedDetections.has(i)) continue;

      const detection = detections[i];
      if (!detection) continue;

      const iou = calculateTrackerDetectionIoU(
        tracker.x,
        tracker.y,
        detection,
        canvasWidth,
        canvasHeight,
        tracker.bboxWidth && tracker.bboxHeight
          ? { width: tracker.bboxWidth, height: tracker.bboxHeight }
          : undefined,
        searchRadius
      );
      const center = getDetectionCenter(detection, canvasWidth, canvasHeight);
      const centerDist = Math.hypot(tracker.x - center.x, tracker.y - center.y);

      // Consider matches based on IoU or proximity (within search radius)
      if (iou > iouThreshold || centerDist < searchRadius * 2) {
        const score = iou > 0 ? iou : 1 / (1 + centerDist / 100);

        if (
          !bestMatch ||
          score > (bestMatch.iou > 0 ? bestMatch.iou : 1 / (1 + bestMatch.centerDist / 100))
        ) {
          bestMatch = { detection, iou, idx: i, centerDist: centerDist };
        }
      }
    }

    if (bestMatch) {
      usedDetections.add(bestMatch.idx);
      matches.push({
        trackerId: tracker.id,
        detection: bestMatch.detection,
        iou: bestMatch.iou,
        centerDistance: bestMatch.centerDist
      });
    }
  }

  return matches;
}

/**
 * Find unmatched detections (potential new objects)
 */
function getUnmatchedDetections(detections: Detection[], matches: YoloTrackerMatch[]): Detection[] {
  const matchedDetectionIds = new Set(matches.map((m) => m.detection.id));
  return detections.filter((d) => !matchedDetectionIds.has(d.id));
}

// ============================================================================
// VISUAL DNA - Color Signature Capture & Matching
// ============================================================================

function captureColorSignature(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  sampleRadius: number = CONFIG.COLOR_SAMPLE_SIZE
): number[] {
  const signature: number[] = new Array(48).fill(0); // 16 hue + 16 sat + 16 val buckets
  const radius = sampleRadius;
  let samples = 0;

  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);

      if (px < 0 || px >= width || py < 0 || py >= imageData.height) continue;

      const idx = (py * width + px) * 4;
      const r = imageData.data[idx] ?? 0;
      const g = imageData.data[idx + 1] ?? 0;
      const b = imageData.data[idx + 2] ?? 0;

      // Convert RGB to HSV
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;

      let h = 0;
      if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = h * 60;
        if (h < 0) h += 360;
      }

      const s = max === 0 ? 0 : d / max;
      const v = max / 255;

      // Bucket into histogram
      const hBucket = Math.min(15, Math.floor(h / 22.5));
      const sBucket = Math.min(15, Math.floor(s * 16));
      const vBucket = Math.min(15, Math.floor(v * 16));

      const hIdx = hBucket;
      const sIdx = 16 + sBucket;
      const vIdx = 32 + vBucket;
      if (signature[hIdx] !== undefined) signature[hIdx]++;
      if (signature[sIdx] !== undefined) signature[sIdx]++;
      if (signature[vIdx] !== undefined) signature[vIdx]++;
      samples++;
    }
  }

  // Normalize
  if (samples > 0) {
    for (let i = 0; i < signature.length; i++) {
      const val = signature[i];
      if (val !== undefined) {
        signature[i] = val / samples;
      }
    }
  }

  return signature;
}

function compareColorSignatures(sig1: number[], sig2: number[]): number {
  if (sig1.length !== sig2.length) return 0;

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < sig1.length; i++) {
    const v1 = sig1[i] ?? 0;
    const v2 = sig2[i] ?? 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ============================================================================
// EDGE DETECTION - For metallic surgical tool tracking
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

      if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) {
        continue;
      }

      // Sobel gradient approximation
      const idxLeft = (py * width + px - 1) * 4;
      const idxRight = (py * width + px + 1) * 4;
      const idxTop = ((py - 1) * width + px) * 4;
      const idxBottom = ((py + 1) * width + px) * 4;

      // Get luminance values
      const left =
        0.299 * (data[idxLeft] ?? 0) +
        0.587 * (data[idxLeft + 1] ?? 0) +
        0.114 * (data[idxLeft + 2] ?? 0);
      const right =
        0.299 * (data[idxRight] ?? 0) +
        0.587 * (data[idxRight + 1] ?? 0) +
        0.114 * (data[idxRight + 2] ?? 0);
      const top =
        0.299 * (data[idxTop] ?? 0) +
        0.587 * (data[idxTop + 1] ?? 0) +
        0.114 * (data[idxTop + 2] ?? 0);
      const bottom =
        0.299 * (data[idxBottom] ?? 0) +
        0.587 * (data[idxBottom + 1] ?? 0) +
        0.114 * (data[idxBottom + 2] ?? 0);

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

  // Normalized cross-correlation for edge similarity
  if (norm1 === 0 || norm2 === 0) return sum / grad1.length;
  return sum / Math.sqrt(norm1 * norm2);
}

// ============================================================================
// OPTICAL FLOW ENGINE - Enhanced with Edge Detection for Tool Tracking
// ============================================================================

function computeOpticalFlow(
  prevFrame: ImageData,
  currFrame: ImageData,
  tracker: Tracker,
  width: number,
  height: number,
  flowConfig: FlowConfig = getScaledFlowConfig(1)
): { x: number; y: number; confidence: number; valid: boolean; atBoundary: boolean } {
  const cfg = flowConfig;

  // Predict position based on velocity (with momentum for fast-moving tools)
  const velocity = Math.sqrt(
    tracker.velocityX * tracker.velocityX + tracker.velocityY * tracker.velocityY
  );
  const velocityScale = Math.min(2.0, 1.0 + velocity * 0.1);
  const predictedX = tracker.x + tracker.velocityX * velocityScale;
  const predictedY = tracker.y + tracker.velocityY * velocityScale;

  // Use predicted position as starting point
  const startX = predictedX;
  const startY = predictedY;

  // Boundary check with margin for sample radius
  const margin = cfg.BOUNDARY_GUARD + cfg.SAMPLE_RADIUS;
  const atBoundary =
    startX < margin || startX > width - margin || startY < margin || startY > height - margin;

  if (atBoundary) {
    return { x: tracker.x, y: tracker.y, confidence: 0, valid: false, atBoundary: true };
  }

  const prevData = prevFrame.data;
  const currData = currFrame.data;

  // Compute reference gradient for edge matching (important for metallic tools)
  const refGradient = computeGradientMagnitude(
    prevFrame,
    Math.round(tracker.x),
    Math.round(tracker.y),
    width,
    height,
    cfg.GRADIENT_SAMPLE_RADIUS
  );

  // === COARSE SEARCH with adaptive radius ===
  let bestX = startX;
  let bestY = startY;
  let bestScore = Infinity;

  // Adaptive search radius based on velocity
  const adaptiveRadius = Math.min(cfg.SEARCH_RADIUS * 1.5, cfg.SEARCH_RADIUS + velocity * 2);

  for (let dy = -adaptiveRadius; dy <= adaptiveRadius; dy += 3) {
    for (let dx = -adaptiveRadius; dx <= adaptiveRadius; dx += 3) {
      const testX = Math.round(startX + dx);
      const testY = Math.round(startY + dy);

      if (
        testX < cfg.SAMPLE_RADIUS ||
        testX >= width - cfg.SAMPLE_RADIUS ||
        testY < cfg.SAMPLE_RADIUS ||
        testY >= height - cfg.SAMPLE_RADIUS
      ) {
        continue;
      }

      let colorScore = 0;
      let samples = 0;

      // Color/intensity matching
      for (let py = -cfg.SAMPLE_RADIUS; py <= cfg.SAMPLE_RADIUS; py += cfg.SAMPLE_STEP) {
        for (let px = -cfg.SAMPLE_RADIUS; px <= cfg.SAMPLE_RADIUS; px += cfg.SAMPLE_STEP) {
          const prevIdx = ((Math.round(tracker.y) + py) * width + (Math.round(tracker.x) + px)) * 4;
          const currIdx = ((testY + py) * width + (testX + px)) * 4;

          if (
            prevIdx >= 0 &&
            prevIdx < prevData.length - 3 &&
            currIdx >= 0 &&
            currIdx < currData.length - 3
          ) {
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

      // Edge matching for metallic surfaces (surgical tools have strong edges)
      const testGradient = computeGradientMagnitude(
        currFrame,
        testX,
        testY,
        width,
        height,
        cfg.GRADIENT_SAMPLE_RADIUS
      );
      const edgeScore = compareGradients(refGradient, testGradient) * 1000;

      // Combined score: color + edge
      const combinedScore = colorScore * (1 - cfg.EDGE_WEIGHT) + edgeScore * cfg.EDGE_WEIGHT;

      // Distance penalty for motion smoothness
      const dist = Math.sqrt(dx * dx + dy * dy);
      const distPenalty = dist * 0.3;

      // Velocity consistency bonus (reward positions consistent with motion)
      const expectedDx = tracker.velocityX * velocityScale;
      const expectedDy = tracker.velocityY * velocityScale;
      const velocityError = Math.sqrt((dx - expectedDx) ** 2 + (dy - expectedDy) ** 2);
      const velocityPenalty = velocityError * 0.1;

      const totalScore = combinedScore + distPenalty + velocityPenalty;

      if (totalScore < bestScore) {
        bestScore = totalScore;
        bestX = testX;
        bestY = testY;
      }
    }
  }

  // === FINE REFINEMENT around best match ===
  const refineX = bestX;
  const refineY = bestY;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const testX = Math.round(refineX + dx);
      const testY = Math.round(refineY + dy);

      if (
        testX < cfg.SAMPLE_RADIUS ||
        testX >= width - cfg.SAMPLE_RADIUS ||
        testY < cfg.SAMPLE_RADIUS ||
        testY >= height - cfg.SAMPLE_RADIUS
      ) {
        continue;
      }

      let score = 0;
      let samples = 0;

      for (let py = -cfg.SAMPLE_RADIUS; py <= cfg.SAMPLE_RADIUS; py += 2) {
        for (let px = -cfg.SAMPLE_RADIUS; px <= cfg.SAMPLE_RADIUS; px += 2) {
          const prevIdx = ((Math.round(tracker.y) + py) * width + (Math.round(tracker.x) + px)) * 4;
          const currIdx = ((testY + py) * width + (testX + px)) * 4;

          if (
            prevIdx >= 0 &&
            prevIdx < prevData.length - 3 &&
            currIdx >= 0 &&
            currIdx < currData.length - 3
          ) {
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

  // === BACKWARD FLOW VALIDATION ===
  let backX = bestX;
  let backY = bestY;
  let backScore = Infinity;

  const backRadius = cfg.SEARCH_RADIUS / 2;
  for (let dy = -backRadius; dy <= backRadius; dy += 2) {
    for (let dx = -backRadius; dx <= backRadius; dx += 2) {
      const testX = Math.round(bestX + dx);
      const testY = Math.round(bestY + dy);

      if (
        testX < cfg.SAMPLE_RADIUS ||
        testX >= width - cfg.SAMPLE_RADIUS ||
        testY < cfg.SAMPLE_RADIUS ||
        testY >= height - cfg.SAMPLE_RADIUS
      ) {
        continue;
      }

      let score = 0;
      let samples = 0;

      for (let py = -cfg.SAMPLE_RADIUS; py <= cfg.SAMPLE_RADIUS; py += cfg.SAMPLE_STEP) {
        for (let px = -cfg.SAMPLE_RADIUS; px <= cfg.SAMPLE_RADIUS; px += cfg.SAMPLE_STEP) {
          const currIdx = ((Math.round(bestY) + py) * width + (Math.round(bestX) + px)) * 4;
          const prevIdx = ((testY + py) * width + (testX + px)) * 4;

          if (
            currIdx >= 0 &&
            currIdx < currData.length - 3 &&
            prevIdx >= 0 &&
            prevIdx < prevData.length - 3
          ) {
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
        if (score < backScore) {
          backScore = score;
          backX = testX;
          backY = testY;
        }
      }
    }
  }

  // === FORWARD-BACKWARD ERROR CHECK ===
  const fbError = Math.sqrt(
    (backX - tracker.x) * (backX - tracker.x) + (backY - tracker.y) * (backY - tracker.y)
  );

  const passesFb = fbError < cfg.FORWARD_BACKWARD_THRESHOLD;
  const confidence = passesFb ? Math.max(0, 1 - bestScore / cfg.LOST_SCORE_THRESHOLD) : 0;
  const valid = passesFb && confidence >= cfg.MIN_FLOW_CONFIDENCE;

  return {
    x: bestX,
    y: bestY,
    confidence,
    valid,
    atBoundary: false
  };
}

// ============================================================================
// KALMAN FILTER - Smooth Position Updates
// ============================================================================

function kalmanUpdate(
  tracker: Tracker,
  measuredX: number,
  measuredY: number
): { x: number; y: number; vx: number; vy: number } {
  const pNoise = CONFIG.KALMAN_PROCESS_NOISE;
  const mNoise = CONFIG.KALMAN_MEASUREMENT_NOISE;

  // Predict
  const predX = tracker.kalmanX + tracker.kalmanVx;
  const predY = tracker.kalmanY + tracker.kalmanVy;

  // Update (simplified Kalman gain)
  const gain = pNoise / (pNoise + mNoise);

  const newX = predX + gain * (measuredX - predX);
  const newY = predY + gain * (measuredY - predY);
  const newVx = tracker.kalmanVx + gain * (measuredX - predX) * 0.5;
  const newVy = tracker.kalmanVy + gain * (measuredY - predY) * 0.5;

  return { x: newX, y: newY, vx: newVx, vy: newVy };
}

// ============================================================================
// GLOBAL SEARCH - Re-identification using Color Signature
// ============================================================================

function searchForTracker(
  frame: ImageData,
  tracker: Tracker,
  width: number,
  height: number,
  options?: {
    gridStep?: number;
    sampleRadius?: number;
    boundaryGuard?: number;
    roi?: { x: number; y: number; width: number; height: number };
  }
): Point | null {
  if (!tracker.colorSignature) return null;

  const gridStep = options?.gridStep ?? 30;
  const sampleRadius = options?.sampleRadius ?? CONFIG.COLOR_SAMPLE_SIZE;
  const boundaryGuard = options?.boundaryGuard ?? CONFIG.BOUNDARY_GUARD;
  const roi = options?.roi;
  const startX = Math.max(
    gridStep,
    roi ? Math.max(gridStep, Math.floor(roi.x)) : gridStep
  );
  const startY = Math.max(
    gridStep,
    roi ? Math.max(gridStep, Math.floor(roi.y)) : gridStep
  );
  const endX = Math.min(
    width - gridStep,
    roi ? Math.min(width - gridStep, Math.ceil(roi.x + roi.width)) : width - gridStep
  );
  const endY = Math.min(
    height - gridStep,
    roi ? Math.min(height - gridStep, Math.ceil(roi.y + roi.height)) : height - gridStep
  );
  let bestMatch: Point | null = null;
  let bestSimilarity = 0;

  for (let y = startY; y < endY; y += gridStep) {
    for (let x = startX; x < endX; x += gridStep) {
      const signature = captureColorSignature(frame, x, y, width, sampleRadius);
      const similarity = compareColorSignatures(tracker.colorSignature, signature);

      if (similarity > CONFIG.COLOR_MATCH_THRESHOLD && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { x, y };
      }
    }
  }

  // Refine around best match
  if (bestMatch) {
    const refineStep = 5;
    const bx = bestMatch.x;
    const by = bestMatch.y;
    for (let dy = -gridStep / 2; dy <= gridStep / 2; dy += refineStep) {
      for (let dx = -gridStep / 2; dx <= gridStep / 2; dx += refineStep) {
        const rx: number = bx + dx;
        const ry: number = by + dy;

        if (
          rx < boundaryGuard ||
          rx > width - boundaryGuard ||
          ry < boundaryGuard ||
          ry > height - boundaryGuard
        ) {
          continue;
        }

        const signature = captureColorSignature(frame, rx, ry, width, sampleRadius);
        const similarity = compareColorSignatures(tracker.colorSignature, signature);

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = { x: rx, y: ry };
        }
      }
    }
  }

  return bestMatch;
}

// ============================================================================
// AI LABELING - OpenAI Integration (Enhanced for Medical/Surgical Context)
// ============================================================================

type SceneContext = "surgical" | "medical" | "laboratory" | "general";

function detectSceneContext(canvas: HTMLCanvasElement): SceneContext {
  // Simple heuristic: surgical scenes often have blue/green drapes, bright lights
  const ctx = canvas.getContext("2d");
  if (!ctx) return "general";

  const sampleSize = 100;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const imageData = ctx.getImageData(
    Math.max(0, centerX - sampleSize),
    Math.max(0, centerY - sampleSize),
    Math.min(sampleSize * 2, canvas.width),
    Math.min(sampleSize * 2, canvas.height)
  );

  let blueGreenCount = 0;
  let brightCount = 0;
  const totalPixels = imageData.data.length / 4;

  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i] ?? 0;
    const g = imageData.data[i + 1] ?? 0;
    const b = imageData.data[i + 2] ?? 0;

    // Detect surgical blue/green colors
    if ((b > r && b > 100) || (g > r && g > 100 && b > 80)) {
      blueGreenCount++;
    }
    // Detect bright surgical lighting
    if (r > 200 && g > 200 && b > 200) {
      brightCount++;
    }
  }

  const blueGreenRatio = blueGreenCount / totalPixels;
  const brightRatio = brightCount / totalPixels;

  if (blueGreenRatio > 0.15 || brightRatio > 0.25) {
    return "surgical";
  }
  if (blueGreenRatio > 0.08) {
    return "medical";
  }
  return "general";
}

// ============================================================================
// AI OBJECT-AWARE TRACKING FUNCTIONS
// ============================================================================

interface ObjectIdentification {
  label: string;
  description: string;
  features: string;
  referenceImage: string;
}

interface ValidationResult {
  isValid: boolean;
  confidence: number;
  observation?: string;
}

interface ReacquisitionResult {
  found: boolean;
  x: number;
  y: number;
  confidence: number;
}

// Counter to limit concurrent AI calls
let activeAICalls = 0;

/**
 * Enhanced AI identification that captures object details for tracking
 * Returns label + description + visual features + reference image
 */
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

  // Add crosshair at target point
  cropCtx.strokeStyle = "rgba(255, 0, 0, 0.7)";
  cropCtx.lineWidth = 2;
  const centerX = x - sourceX;
  const centerY = y - sourceY;

  cropCtx.beginPath();
  cropCtx.moveTo(centerX - 20, centerY);
  cropCtx.lineTo(centerX + 20, centerY);
  cropCtx.moveTo(centerX, centerY - 20);
  cropCtx.lineTo(centerX, centerY + 20);
  cropCtx.stroke();

  cropCtx.beginPath();
  cropCtx.arc(centerX, centerY, 30, 0, Math.PI * 2);
  cropCtx.stroke();

  const imageBase64 = cropCanvas.toDataURL("image/jpeg", 0.95).split(",")[1] ?? "";

  // Detect scene context for specialized prompts
  const context = detectSceneContext(canvas);

  const response = await fetchOpenAIChatCompletion(apiKey, {
    model: PRIMARY_VISION_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a precision object identification system for ${context === "surgical" ? "surgical/medical" : context} video tracking.
Your task is to identify the SPECIFIC OBJECT at the red crosshair and provide tracking-friendly information.

Respond ONLY in this exact JSON format (no markdown, no code blocks):
{"label":"Short name (2-4 words)","description":"Brief physical description","features":"Key visual features for re-identification"}

For surgical instruments, be very specific:
- Include tool type (forceps, scissors, retractor, etc.)
- Note material (metal, plastic)
- Describe distinctive shape characteristics
- Note any colored markings or handles

Focus on features that distinguish this object from similar items in the scene.`
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Identify the object at the RED CROSSHAIR. This object will be tracked as it moves. Provide identification suitable for re-finding this specific object if tracking is lost."
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" }
          }
        ]
      }
    ],
    max_tokens: 200,
    temperature: 0.1
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";

  try {
    // Try to parse as JSON
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    return {
      label: parsed.label ?? "Unknown Object",
      description: parsed.description ?? "",
      features: parsed.features ?? "",
      referenceImage: imageBase64
    };
  } catch {
    // Fallback: use raw content as label
    return {
      label: content.replace(/[{}"]/g, "").slice(0, 30).trim() || "Unknown Object",
      description: "",
      features: "",
      referenceImage: imageBase64
    };
  }
}

/**
 * Validates if the tracker is still on the identified object
 * Used when confidence drops to prevent tracking wrong things
 */
async function validateTrackedObject(
  canvas: HTMLCanvasElement,
  tracker: Tracker,
  apiKey: string
): Promise<ValidationResult> {
  if (!tracker.objectDescription && !tracker.visualFeatures) {
    // No object info to validate against
    return { isValid: true, confidence: 0.5 };
  }

  // Rate limiting
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

    // Mark current tracked position with green circle
    cropCtx.strokeStyle = "rgba(0, 255, 0, 0.8)";
    cropCtx.lineWidth = 3;
    const centerX = tracker.x - sourceX;
    const centerY = tracker.y - sourceY;
    cropCtx.beginPath();
    cropCtx.arc(centerX, centerY, 25, 0, Math.PI * 2);
    cropCtx.stroke();

    const currentImageBase64 = cropCanvas.toDataURL("image/jpeg", 0.9).split(",")[1];

    const response = await fetchOpenAIChatCompletion(apiKey, {
      model: PRIMARY_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `You are validating if a tracked object is still at its marked position.

Object being tracked: "${tracker.label}"
${tracker.objectDescription ? `Description: ${tracker.objectDescription}` : ""}
${tracker.visualFeatures ? `Visual features: ${tracker.visualFeatures}` : ""}

Respond ONLY in JSON format (no markdown):
{"isValid":true/false,"confidence":0.0-1.0,"observation":"brief explanation"}

isValid should be FALSE if:
- The green marker is on empty background
- The marker is on a DIFFERENT object than described
- The described object has moved away from the marker

isValid should be TRUE if:
- The green marker is still on or very close to the described object`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Is the "${tracker.label}" still at the green circle marker, or has it moved away?`
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${currentImageBase64}`, detail: "high" }
            }
          ]
        }
      ],
      max_tokens: 100,
      temperature: 0.1
    });

    if (!response.ok) {
      return { isValid: true, confidence: 0.5 };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";

    try {
      const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleanContent);
      return {
        isValid: parsed.isValid ?? true,
        confidence: parsed.confidence ?? 0.5,
        observation: parsed.observation
      };
    } catch {
      return { isValid: true, confidence: 0.5 };
    }
  } finally {
    activeAICalls--;
  }
}

/**
 * AI-powered re-acquisition: Find the lost object in the current frame
 * Used when optical flow tracking fails
 */
async function findObjectInFrame(
  canvas: HTMLCanvasElement,
  tracker: Tracker,
  apiKey: string
): Promise<ReacquisitionResult | null> {
  if (!tracker.label || tracker.label.startsWith("Region")) {
    return null; // Can't search without knowing what to find
  }

  // Rate limiting
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
          content: `You are a visual search system. Find a specific object in the frame.
Image dimensions: ${canvas.width}x${canvas.height} pixels.

Object to find: "${tracker.label}"
${tracker.objectDescription ? `Description: ${tracker.objectDescription}` : ""}
${tracker.visualFeatures ? `Visual features: ${tracker.visualFeatures}` : ""}
Last known position: approximately (${Math.round(tracker.lastGoodPosition.x)}, ${Math.round(tracker.lastGoodPosition.y)})

Respond ONLY in JSON format (no markdown):
{"found":true/false,"x":number,"y":number,"confidence":0.0-1.0}

IMPORTANT:
- x and y are PIXEL coordinates where the CENTER of the object is
- x ranges from 0 (left) to ${canvas.width} (right)
- y ranges from 0 (top) to ${canvas.height} (bottom)
- Only return found:true if you're confident you see the object
- Be precise with coordinates - estimate the exact center`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Locate the "${tracker.label}" in this frame. The object may have moved from its last position. Provide the CENTER coordinates where it is now.`
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" }
            }
          ]
        }
      ],
      max_tokens: 80,
      temperature: 0.1
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";

    try {
      const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleanContent);

      if (parsed.found && typeof parsed.x === "number" && typeof parsed.y === "number") {
        return {
          found: true,
          x: Math.max(0, Math.min(canvas.width, parsed.x)),
          y: Math.max(0, Math.min(canvas.height, parsed.y)),
          confidence: parsed.confidence ?? 0.7
        };
      }
      return null;
    } catch {
      return null;
    }
  } finally {
    activeAICalls--;
  }
}

/**
 * Legacy simple identification (for backward compatibility)
 */
async function identifyWithAI(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  apiKey: string,
  existingLabel?: string
): Promise<string> {
  try {
    const result = await identifyObjectWithFeatures(canvas, x, y, apiKey);
    return result.label;
  } catch (err) {
    console.error("AI identification failed:", err);
    return existingLabel ?? "Error";
  }
}

// ============================================================================
// STYLES
// ============================================================================

const styles = {
  container: {
    background: "linear-gradient(180deg, #0c1222 0%, #0f172a 100%)",
    borderRadius: "16px",
    overflow: "hidden",
    color: "white",
    fontFamily: "'Inter', system-ui, sans-serif"
  } as React.CSSProperties,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    background: "rgba(255, 255, 255, 0.03)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
  } as React.CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px"
  } as React.CSSProperties,
  logo: {
    width: "32px",
    height: "32px",
    background: "linear-gradient(135deg, #10b981 0%, #3b82f6 100%)",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px"
  } as React.CSSProperties,
  title: {
    margin: 0,
    fontSize: "1.15rem",
    fontWeight: 600,
    letterSpacing: "-0.02em"
  } as React.CSSProperties,
  modeBadge: {
    fontSize: "0.65rem",
    padding: "4px 10px",
    borderRadius: "20px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    fontWeight: 600
  } as React.CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px"
  } as React.CSSProperties,
  fpsDisplay: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.75rem"
  } as React.CSSProperties,
  apiInput: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "6px",
    padding: "6px 10px",
    color: "white",
    fontSize: "0.75rem",
    width: "200px"
  } as React.CSSProperties,
  helpBtn: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    background: "transparent",
    color: "rgba(255, 255, 255, 0.7)",
    cursor: "pointer",
    fontSize: "0.8rem",
    transition: "all 0.2s"
  } as React.CSSProperties,
  uploadZone: {
    padding: "80px 20px",
    textAlign: "center" as const,
    background: "radial-gradient(ellipse at center, rgba(16, 185, 129, 0.05) 0%, transparent 70%)"
  } as React.CSSProperties,
  uploadContent: {
    maxWidth: "400px",
    margin: "0 auto"
  } as React.CSSProperties,
  uploadIcon: {
    fontSize: "4rem",
    display: "block",
    marginBottom: "20px",
    opacity: 0.9
  } as React.CSSProperties,
  uploadTitle: {
    margin: "0 0 12px",
    fontSize: "1.5rem",
    fontWeight: 600,
    background: "linear-gradient(135deg, #10b981 0%, #3b82f6 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent"
  } as React.CSSProperties,
  uploadDesc: {
    margin: "0 0 24px",
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: "0.95rem",
    lineHeight: 1.6
  } as React.CSSProperties,
  uploadBtn: {
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    color: "white",
    border: "none",
    padding: "14px 32px",
    borderRadius: "12px",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(16, 185, 129, 0.3)",
    transition: "transform 0.2s, box-shadow 0.2s"
  } as React.CSSProperties,
  videoContainer: {
    position: "relative" as const,
    aspectRatio: "16/9",
    background: "#000"
  } as React.CSSProperties,
  canvas: {
    width: "100%",
    height: "100%"
  } as React.CSSProperties,
  hudOverlay: {
    position: "absolute" as const,
    top: "12px",
    left: "12px",
    right: "12px",
    pointerEvents: "none" as const,
    display: "flex",
    gap: "10px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  hudBadge: {
    fontSize: "0.7rem",
    padding: "5px 12px",
    background: "rgba(0, 0, 0, 0.7)",
    borderRadius: "6px",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255, 255, 255, 0.1)"
  } as React.CSSProperties,
  drawIndicator: {
    fontSize: "0.7rem",
    padding: "5px 12px",
    background: "rgba(251, 191, 36, 0.2)",
    color: "#fbbf24",
    borderRadius: "6px",
    border: "1px solid rgba(251, 191, 36, 0.3)"
  } as React.CSSProperties,
  controlsPanel: {
    padding: "16px 20px",
    background: "rgba(255, 255, 255, 0.02)",
    borderTop: "1px solid rgba(255, 255, 255, 0.05)"
  } as React.CSSProperties,
  controlsRow: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  ctrlBtn: {
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "white",
    padding: "10px 18px",
    borderRadius: "10px",
    fontSize: "0.85rem",
    cursor: "pointer",
    transition: "all 0.2s",
    fontWeight: 500
  } as React.CSSProperties,
  ctrlBtnPrimary: {
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    border: "none",
    boxShadow: "0 2px 12px rgba(16, 185, 129, 0.3)"
  } as React.CSSProperties,
  ctrlBtnActive: {
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    border: "none",
    color: "#000",
    fontWeight: 600
  } as React.CSSProperties,
  setupHint: {
    marginTop: "14px",
    fontSize: "0.85rem",
    color: "rgba(255, 255, 255, 0.7)",
    padding: "12px 16px",
    background: "rgba(59, 130, 246, 0.08)",
    borderRadius: "10px",
    borderLeft: "3px solid #3b82f6",
    lineHeight: 1.5
  } as React.CSSProperties,
  trackerList: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "8px",
    marginTop: "14px"
  } as React.CSSProperties,
  trackerItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px",
    background: "rgba(255, 255, 255, 0.04)",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.2s",
    border: "1px solid transparent"
  } as React.CSSProperties,
  trackerDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%"
  } as React.CSSProperties,
  trackerLabel: {
    fontSize: "0.85rem",
    fontWeight: 500
  } as React.CSSProperties,
  trackerState: {
    fontSize: "0.65rem",
    padding: "2px 8px",
    borderRadius: "4px",
    textTransform: "uppercase" as const,
    fontWeight: 600,
    letterSpacing: "0.3px"
  } as React.CSSProperties,
  trackerRemove: {
    background: "none",
    border: "none",
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: "1.1rem",
    cursor: "pointer",
    padding: "0 4px",
    transition: "color 0.2s"
  } as React.CSSProperties,
  aiBtn: {
    background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
    border: "none",
    color: "white",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "0.7rem",
    cursor: "pointer",
    fontWeight: 600
  } as React.CSSProperties,
  helpModal: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0, 0, 0, 0.8)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100
  } as React.CSSProperties,
  helpContent: {
    background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
    padding: "28px",
    borderRadius: "20px",
    maxWidth: "450px",
    width: "90%",
    border: "1px solid rgba(255, 255, 255, 0.1)"
  } as React.CSSProperties,
  helpTitle: {
    margin: "0 0 20px",
    fontSize: "1.3rem",
    fontWeight: 600,
    background: "linear-gradient(135deg, #10b981 0%, #3b82f6 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent"
  } as React.CSSProperties,
  helpGrid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "10px 20px",
    marginBottom: "24px"
  } as React.CSSProperties,
  kbd: {
    background: "rgba(255, 255, 255, 0.08)",
    padding: "5px 10px",
    borderRadius: "6px",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.8rem",
    border: "1px solid rgba(255, 255, 255, 0.1)"
  } as React.CSSProperties,
  helpClose: {
    width: "100%",
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "white",
    padding: "12px",
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: 500,
    transition: "background 0.2s"
  } as React.CSSProperties
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface MedSyncVisionProps {
  openaiApiKey?: string | undefined;
  detectionServerUrl?: string;
}

export function MedSyncVision({ openaiApiKey, detectionServerUrl }: MedSyncVisionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const processingScaleRef = useRef<ProcessingScale>({ x: 1, y: 1, scalar: 1 });
  const flowConfigRef = useRef<FlowConfig>(getScaledFlowConfig(1));
  const anchorConfigRef = useRef<AnchorConfig>(ANCHOR_CONFIG);
  const colorSampleRadiusRef = useRef(CONFIG.COLOR_SAMPLE_SIZE);
  const lastProcessTimeRef = useRef(0);
  const aiValidationGuardRef = useRef<Set<string>>(new Set());
  const aiReacqGuardRef = useRef<Set<string>>(new Set());

  const [videoLoaded, setVideoLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(true);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [drawings, setDrawings] = useState<DrawingStroke[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<DrawingStroke | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [annotationStyle, setAnnotationStyle] = useState<AnnotationStyle>("standard");
  const [selectedTracker, setSelectedTracker] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  // Server-based detection state
  const [useServerDetection, setUseServerDetection] = useState(false);
  const [showServerDetections, setShowServerDetections] = useState(true);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("surgical");

  // Anchor-based tracking state
  // Anchors are used internally for position accuracy but NOT rendered to user
  const [useAnchorTracking, setUseAnchorTracking] = useState(false); // Disabled by default for simplicity

  // Use API key from props
  const openaiKey = openaiApiKey ?? "";

  // Server detection client
  const serverUrl = detectionServerUrl ?? DETECTION_SERVER_URL;
  const {
    connected: serverConnected,
    interpolatedDetections,
    metrics: detectionMetrics,
    sendFrame: sendFrameToServer
  } = useDetectionClient({
    serverUrl,
    mode: detectionMode,
    enabled: useServerDetection && isPlaying,
    targetFps: 12,
    confidenceThreshold: 0.35
  });

  const toggleServerDetection = useCallback(() => {
    setUseServerDetection((prev) => !prev);
  }, []);

  const toggleShowServerDetections = useCallback(() => {
    setShowServerDetections((prev) => !prev);
  }, []);

  const handleDetectionModeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setDetectionMode(event.target.value as DetectionMode);
  }, []);

  const toProcessingCoords = useCallback((x: number, y: number) => {
    const scale = processingScaleRef.current;
    return { x: x * scale.x, y: y * scale.y };
  }, []);

  const toDisplayCoords = useCallback((x: number, y: number) => {
    const scale = processingScaleRef.current;
    return { x: scale.x ? x / scale.x : x, y: scale.y ? y / scale.y : y };
  }, []);

  const trackersRef = useRef<Tracker[]>([]);
  const drawingsRef = useRef<DrawingStroke[]>([]);
  const prevFrameRef = useRef<ImageData | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

  useEffect(() => {
    trackersRef.current = trackers;
  }, [trackers]);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !videoRef.current) return;

    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    videoRef.current.load();
    setVideoLoaded(false);
    setTrackers([]);
    setDrawings([]);
    setIsSetupMode(true);
    setIsPlaying(false);
    prevFrameRef.current = null;
    aiValidationGuardRef.current.clear();
    aiReacqGuardRef.current.clear();
    lastProcessTimeRef.current = 0;
  }, []);

  const handleVideoLoaded = useCallback(() => {
    setVideoLoaded(true);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  const addTracker = useCallback(
    async (x: number, y: number, ctx: CanvasRenderingContext2D | null) => {
      const id = `tracker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const color = COLORS[trackers.length % COLORS.length] ?? COLORS[0];
      const trackerNumber = trackers.length + 1;

      // Capture color signature for re-identification
      let colorSignature: number[] | null = null;
      let anchorSet: AnchorSet | undefined = undefined;

      if (ctx && processingCanvasRef.current) {
        const imageData = ctx.getImageData(
          0,
          0,
          processingCanvasRef.current.width,
          processingCanvasRef.current.height
        );
        colorSignature = captureColorSignature(
          imageData,
          x,
          y,
          processingCanvasRef.current.width,
          colorSampleRadiusRef.current
        );

        // HYBRID APPROACH: Detect anchor keypoints ON the object
        try {
          const anchorConfig = anchorConfigRef.current;
          const anchorResult = detectAnchorsOnObject(
            imageData,
            x,
            y,
            anchorConfig.DETECTION_RADIUS,
            anchorConfig
          );

          if (anchorResult.anchors.length >= anchorConfig.MIN_ANCHORS) {
            anchorSet = createAnchorSet(anchorResult.anchors, `anchors-${id}`);
            console.info(`[Anchors] Detected ${anchorResult.anchors.length} keypoints on object`);
          } else {
            console.info(
              `[Anchors] Only ${anchorResult.anchors.length} keypoints found (min: ${anchorConfig.MIN_ANCHORS})`
            );
          }
        } catch (err) {
          console.warn("[Anchors] Failed to detect anchors:", err);
        }
      }

      const newTracker: Tracker = {
        id,
        x,
        y,
        prevX: x,
        prevY: y,
        velocityX: 0,
        velocityY: 0,
        label: `Region ${trackerNumber}`,
        color: color as string,
        state: "tracking",
        confidence: 1.0,
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
        // Anchor-based tracking
        anchorSet,
        useAnchors:
          anchorSet !== undefined &&
          anchorSet.anchors.length >= anchorConfigRef.current.MIN_ANCHORS
      };

      setTrackers((prev) => [...prev, newTracker]);
      setSelectedTracker(id);

      // AUTO-IDENTIFY: If we have an API key and auto-identify is enabled,
      // immediately identify the object for object-aware tracking
      if (AI_CONFIG.AUTO_IDENTIFY_ON_PLACEMENT && openaiKey && canvasRef.current) {
        // Set status to "thinking" while identifying
        setTrackers((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, labelStatus: "thinking" as LabelStatus, label: "Identifying..." }
              : t
          )
        );

        try {
          const displayPoint = toDisplayCoords(x, y);
          const result = await identifyObjectWithFeatures(
            canvasRef.current,
            displayPoint.x,
            displayPoint.y,
            openaiKey
          );

          // Update tracker with full object information
          setTrackers((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    labelStatus: "labeled" as LabelStatus,
                    label: result.label,
                    objectDescription: result.description,
                    visualFeatures: result.features,
                    referenceImage: result.referenceImage,
                    lastAIValidation: Date.now(),
                    aiConfidence: 1.0
                  }
                : t
            )
          );

          console.info(`[AI] Identified object: "${result.label}"`);
          console.info(`[AI] Description: ${result.description}`);
          console.info(`[AI] Features: ${result.features}`);
        } catch (err) {
          console.error("[AI] Auto-identify failed:", err);
          // Revert to default label
          setTrackers((prev) =>
            prev.map((t) =>
              t.id === id
                ? { ...t, labelStatus: "idle" as LabelStatus, label: `Region ${trackerNumber}` }
                : t
            )
          );
        }
      }
    },
    [trackers.length, openaiKey, toDisplayCoords]
  );

  const removeTracker = useCallback(
    (id: string) => {
      setTrackers((prev) => prev.filter((t) => t.id !== id));
      setDrawings((prev) => prev.filter((d) => d.trackerId !== id));
      if (selectedTracker === id) {
        setSelectedTracker(null);
      }
    },
    [selectedTracker]
  );

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (!videoLoaded || !canvasRef.current) return;
      if (drawMode) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      const processedPoint = toProcessingCoords(x, y);

      const ctx = processingCanvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null;

      if (event.button === 2) {
        const proximityThreshold = 60 * processingScaleRef.current.scalar;
        const nearest = trackers.reduce<{ tracker: Tracker; dist: number } | null>((best, t) => {
          const dist = Math.hypot(t.x - processedPoint.x, t.y - processedPoint.y);
          if (dist < proximityThreshold && (!best || dist < best.dist)) {
            return { tracker: t, dist };
          }
          return best;
        }, null);
        if (nearest) {
          removeTracker(nearest.tracker.id);
        }
      } else {
        addTracker(processedPoint.x, processedPoint.y, ctx);
      }
    },
    [videoLoaded, drawMode, trackers, addTracker, removeTracker, toProcessingCoords]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      handleCanvasClick({ ...event, button: 2 } as React.MouseEvent);
    },
    [handleCanvasClick]
  );

  const handleDrawStart = useCallback(
    (event: React.MouseEvent) => {
      if (!drawMode || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      const processedPoint = toProcessingCoords(x, y);

      const stroke: DrawingStroke = {
        id: `stroke-${Date.now()}`,
        points: [{ x: processedPoint.x, y: processedPoint.y }],
        localPoints: [],
        color: selectedTracker
          ? (trackers.find((t) => t.id === selectedTracker)?.color ?? "#ffffff")
          : "#ffffff",
        trackerId: selectedTracker,
        closed: false,
        label: "",
        visible: true,
        opacity: 1.0
      };
      setCurrentDrawing(stroke);
    },
    [drawMode, selectedTracker, trackers, toProcessingCoords]
  );

  const handleDrawMove = useCallback(
    (event: React.MouseEvent) => {
      if (!currentDrawing || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      const processedPoint = toProcessingCoords(x, y);

      setCurrentDrawing((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          points: [...prev.points, { x: processedPoint.x, y: processedPoint.y }]
        };
      });
    },
    [currentDrawing, toProcessingCoords]
  );

  const handleDrawEnd = useCallback(async () => {
    if (!currentDrawing) return;
    if (currentDrawing.points.length > 2) {
      // If attached to a tracker, compute local points relative to tracker center
      const stroke: DrawingStroke = { ...currentDrawing };

      // Calculate centroid of the drawing
      const centroidX = stroke.points.reduce((sum, p) => sum + p.x, 0) / stroke.points.length;
      const centroidY = stroke.points.reduce((sum, p) => sum + p.y, 0) / stroke.points.length;
      stroke.centroidX = centroidX;
      stroke.centroidY = centroidY;
      stroke.prevCentroidX = centroidX;
      stroke.prevCentroidY = centroidY;

      if (stroke.trackerId) {
        const tracker = trackers.find((t) => t.id === stroke.trackerId);
        if (tracker) {
          stroke.localPoints = stroke.points.map((p) => ({
            x: p.x - tracker.x,
            y: p.y - tracker.y
          }));
        }
      }

      // Check if closed
      const first = stroke.points[0];
      const last = stroke.points[stroke.points.length - 1];
      if (first && last) {
        const closeDist = Math.hypot(first.x - last.x, first.y - last.y);
        stroke.closed = closeDist < 20 * processingScaleRef.current.scalar;
      }

      // HYBRID APPROACH: Detect anchors around the drawing centroid
      const ctx =
        processingCanvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null;
      if (ctx && processingCanvasRef.current && useAnchorTracking) {
        try {
          const anchorConfig = anchorConfigRef.current;
          const imageData = ctx.getImageData(
            0,
            0,
            processingCanvasRef.current.width,
            processingCanvasRef.current.height
          );
          const anchorResult = detectAnchorsOnObject(
            imageData,
            centroidX,
            centroidY,
            anchorConfig.DETECTION_RADIUS,
            anchorConfig
          );

          if (anchorResult.anchors.length >= anchorConfig.MIN_ANCHORS) {
            stroke.anchorSet = createAnchorSet(anchorResult.anchors, `anchors-${stroke.id}`);
            stroke.useAnchors = true;
            console.info(
              `[Drawing Anchors] Detected ${anchorResult.anchors.length} keypoints on drawing area`
            );
          }
        } catch (err) {
          console.warn("[Drawing Anchors] Failed to detect anchors:", err);
        }
      }

      // Initialize AI fields
      stroke.labelStatus = "idle";

      setDrawings((prev) => [...prev, stroke]);

      // AI IDENTIFICATION: Auto-identify what the drawing is marking
      if (
        AI_CONFIG.AUTO_IDENTIFY_ON_PLACEMENT &&
        openaiKey &&
        canvasRef.current &&
        !stroke.trackerId
      ) {
        // Only auto-identify independent drawings (not attached to trackers)
        setDrawings((prev) =>
          prev.map((d) =>
            d.id === stroke.id
              ? { ...d, labelStatus: "thinking" as LabelStatus, label: "Identifying..." }
              : d
          )
        );

        try {
          const displayPoint = toDisplayCoords(centroidX, centroidY);
          const result = await identifyObjectWithFeatures(
            canvasRef.current,
            displayPoint.x,
            displayPoint.y,
            openaiKey
          );

          setDrawings((prev) =>
            prev.map((d) =>
              d.id === stroke.id
                ? {
                    ...d,
                    labelStatus: "labeled" as LabelStatus,
                    label: result.label,
                    objectDescription: result.description,
                    visualFeatures: result.features,
                    referenceImage: result.referenceImage,
                    lastAIValidation: Date.now(),
                    aiConfidence: 1.0
                  }
                : d
            )
          );

          console.info(`[Drawing AI] Identified: "${result.label}"`);
        } catch (err) {
          console.error("[Drawing AI] Auto-identify failed:", err);
          setDrawings((prev) =>
            prev.map((d) => (d.id === stroke.id ? { ...d, labelStatus: "idle" as LabelStatus } : d))
          );
        }
      }
    }
    setCurrentDrawing(null);
  }, [currentDrawing, trackers, openaiKey, useAnchorTracking, toDisplayCoords]);

  const identifyTracker = useCallback(
    async (trackerId: string) => {
      if (!openaiKey || !canvasRef.current) return;

      const tracker = trackers.find((t) => t.id === trackerId);
      if (!tracker) return;

      // Store existing label for context
      const existingLabel = tracker.label;

      setTrackers((prev) =>
        prev.map((t) =>
          t.id === trackerId
            ? { ...t, labelStatus: "thinking" as LabelStatus, label: "Identifying..." }
            : t
        )
      );

      try {
        // Pass existing label for context to help AI improve identification
        const displayPoint = toDisplayCoords(tracker.x, tracker.y);
        const label = await identifyWithAI(
          canvasRef.current,
          displayPoint.x,
          displayPoint.y,
          openaiKey,
          existingLabel.startsWith("Region") ? undefined : existingLabel
        );
        setTrackers((prev) =>
          prev.map((t) =>
            t.id === trackerId ? { ...t, labelStatus: "labeled" as LabelStatus, label } : t
          )
        );
      } catch (err) {
        console.error("AI identification failed:", err);
        setTrackers((prev) =>
          prev.map((t) =>
            t.id === trackerId
              ? { ...t, labelStatus: "error" as LabelStatus, label: existingLabel || "Error" }
              : t
          )
        );
      }
    },
    [openaiKey, trackers, toDisplayCoords]
  );

  const startProcessing = useCallback(() => {
    if (!videoRef.current) return;
    setIsSetupMode(false);
    setIsPlaying(true);
    videoRef.current.play();
  }, []);

  const pauseVideo = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setIsPlaying(false);
  }, []);

  const resumeVideo = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.play();
    setIsPlaying(true);
  }, []);

  const resetDemo = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setIsSetupMode(true);
    setIsPlaying(false);
    setTrackers([]);
    setDrawings([]);
    setSelectedTracker(null);
    prevFrameRef.current = null;
    aiValidationGuardRef.current.clear();
    aiReacqGuardRef.current.clear();
    lastProcessTimeRef.current = 0;
  }, []);

  const cycleStyle = useCallback(() => {
    setAnnotationStyle((prev) => {
      const idx = STYLE_NAMES.indexOf(prev);
      return STYLE_NAMES[(idx + 1) % STYLE_NAMES.length] as AnnotationStyle;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;

      switch (event.key.toLowerCase()) {
        case "d":
          setDrawMode((prev) => !prev);
          break;
        case "s":
          cycleStyle();
          break;
        case "h":
          setShowHelp((prev) => !prev);
          break;
        // 'a' key no longer used - anchors are internal only
        case "r":
          resetDemo();
          break;
        case "i":
          // AI identify selected tracker
          if (selectedTracker && openaiKey) {
            identifyTracker(selectedTracker);
          }
          break;
        case " ":
        case "enter":
          if (isSetupMode && trackers.length > 0) {
            startProcessing();
          } else if (isPlaying) {
            pauseVideo();
          } else if (!isSetupMode) {
            resumeVideo();
          }
          event.preventDefault();
          break;
        case "escape":
          setDrawMode(false);
          setSelectedTracker(null);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isSetupMode,
    isPlaying,
    trackers.length,
    selectedTracker,
    openaiKey,
    cycleStyle,
    resetDemo,
    startProcessing,
    pauseVideo,
    resumeVideo,
    identifyTracker
  ]);

  // === MAIN TRACKING UPDATE (HYBRID: YOLO + OPTICAL FLOW) ===
  const updateTrackers = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const currentFrame = ctx.getImageData(0, 0, width, height);

      if (!prevFrameRef.current || isSetupMode) {
        prevFrameRef.current = currentFrame;
        return;
      }

      // Capture prevFrame before the callback to avoid closure issues
      const prevFrame = prevFrameRef.current;
      if (!prevFrame) {
        prevFrameRef.current = currentFrame;
        return;
      }

      const flowConfig = flowConfigRef.current;
      const anchorConfig = anchorConfigRef.current;
      const colorSampleRadius = colorSampleRadiusRef.current;

      // Get YOLO detections for hybrid tracking
      const yoloDetections = interpolatedDetections;
      const hasYoloDetections = useServerDetection && yoloDetections.length > 0;

      // Match YOLO detections to existing trackers
      const yoloMatches = hasYoloDetections
        ? matchDetectionsToTrackers(
            trackersRef.current,
            yoloDetections,
            width,
            height,
            0.1,
            flowConfig.SEARCH_RADIUS
          )
        : [];

      // Create a lookup map for quick access
      const matchByTrackerId = new Map(yoloMatches.map((m) => [m.trackerId, m]));

      setTrackers((prevTrackers) =>
        prevTrackers.map((tracker) => {
          // Skip if already lost for too long
          if (tracker.state === "lost" && tracker.framesLost > CONFIG.LOST_TIMEOUT) {
            return tracker;
          }

          // Check if tracker is out of frame - mark as lost immediately
          const margin = flowConfig.BOUNDARY_GUARD;
          const outOfFrame =
            tracker.x < margin ||
            tracker.x > width - margin ||
            tracker.y < margin ||
            tracker.y > height - margin;

          if (outOfFrame && tracker.state === "tracking") {
            return {
              ...tracker,
              state: "lost" as TrackerState,
              framesLost: 0,
              confidence: 0
            };
          }

          // Get YOLO match for this tracker (if any)
          const yoloMatch = matchByTrackerId.get(tracker.id);

          // === STATE MACHINE ===
          if (tracker.state === "tracking" || tracker.state === "occluded") {
            // Run optical flow
            const flow = computeOpticalFlow(prevFrame, currentFrame, tracker, width, height, flowConfig);

            // Boundary hit → instant LOST
            if (flow.atBoundary) {
              return {
                ...tracker,
                state: "lost" as TrackerState,
                framesLost: 0,
                confidence: 0
              };
            }

            // === HYBRID TRACKING: Combine optical flow with YOLO ===
            let finalX = flow.x;
            let finalY = flow.y;
            let finalConfidence = flow.confidence;
            let newLabel = tracker.label;
            let bboxWidth = tracker.bboxWidth;
            let bboxHeight = tracker.bboxHeight;
            let bboxConfidence = tracker.bboxConfidence;

            if (yoloMatch) {
              // We have a YOLO detection matching this tracker!
              const yoloCenter = getDetectionCenter(yoloMatch.detection, width, height);
              const yoloConfidence = yoloMatch.detection.confidence;
              const yoloBoxWidth = yoloMatch.detection.bbox.width * width;
              const yoloBoxHeight = yoloMatch.detection.bbox.height * height;

              // Determine blend weight based on:
              // - YOLO confidence
              // - Optical flow validity
              // - IoU quality
              const yoloWeight = Math.min(0.5, yoloConfidence * 0.6 + yoloMatch.iou * 0.3);
              const flowWeight = flow.valid ? 1 - yoloWeight : 0;
              const totalWeight = yoloWeight + flowWeight;

              if (totalWeight > 0) {
                // Weighted average of YOLO and optical flow positions
                finalX = (yoloCenter.x * yoloWeight + flow.x * flowWeight) / totalWeight;
                finalY = (yoloCenter.y * yoloWeight + flow.y * flowWeight) / totalWeight;

                // Boost confidence when YOLO agrees with optical flow
                const agreement = Math.exp(
                  -Math.hypot(yoloCenter.x - flow.x, yoloCenter.y - flow.y) / 50
                );
                finalConfidence = Math.min(
                  1.0,
                  flow.confidence * 0.5 + yoloConfidence * 0.3 + agreement * 0.2
                );
              }

              // Update label from YOLO if tracker has generic label
              if (tracker.label.startsWith("Region") && yoloMatch.detection.label) {
                newLabel = yoloMatch.detection.label;
              }

              // Cache YOLO box size for matching stability
              bboxWidth = yoloBoxWidth;
              bboxHeight = yoloBoxHeight;
              bboxConfidence = yoloConfidence;
            }

            if (!flow.valid && !yoloMatch) {
              // No optical flow AND no YOLO match → likely occluded
              const newFramesOccluded = tracker.framesOccluded + 1;

              if (newFramesOccluded > CONFIG.OCCLUSION_TIMEOUT) {
                // Too long occluded → LOST
                return {
                  ...tracker,
                  state: "lost" as TrackerState,
                  framesLost: 0,
                  framesOccluded: 0,
                  confidence: 0
                };
              }

              return {
                ...tracker,
                state: "occluded" as TrackerState,
                framesOccluded: newFramesOccluded,
                confidence: flow.confidence
              };
            }

            // If only YOLO (no valid optical flow), use YOLO position
            if (!flow.valid && yoloMatch) {
              const yoloCenter = getDetectionCenter(yoloMatch.detection, width, height);
              finalX = yoloCenter.x;
              finalY = yoloCenter.y;
              finalConfidence = yoloMatch.detection.confidence * 0.9;
            }

            // === HYBRID APPROACH: Anchor-based tracking ===
            let updatedAnchorSet = tracker.anchorSet;

            if (useAnchorTracking && tracker.useAnchors && tracker.anchorSet && prevFrame) {
              // Track all anchors with optical flow
              updatedAnchorSet = trackAnchors(
                tracker.anchorSet,
                prevFrame,
                currentFrame,
                anchorConfig
              );

              // Get consensus position from anchors
              const anchorPosition = estimatePositionFromAnchors(
                updatedAnchorSet,
                finalX,
                finalY,
                anchorConfig
              );

              // Blend anchor position with optical flow + YOLO position
              if (anchorPosition.useAnchors) {
                const blended = blendPositions(
                  anchorPosition,
                  { x: finalX, y: finalY, confidence: finalConfidence },
                  0.5 // 50% weight to anchors
                );

                finalX = blended.x;
                finalY = blended.y;

                // Boost confidence if anchors agree
                if (anchorPosition.confidence > 0.6) {
                  finalConfidence = Math.max(finalConfidence, blended.confidence);
                }

                // Log anchor coherence for debugging
                if (updatedAnchorSet.coherenceScore < anchorConfig.MIN_COHERENCE) {
                  console.info(
                    `[Anchors] Low coherence (${updatedAnchorSet.coherenceScore.toFixed(2)}), ${updatedAnchorSet.survivingCount}/${updatedAnchorSet.anchors.length} anchors surviving`
                  );
                }
              }
            }

            // Successful tracking - apply Kalman smoothing
            const kalman = kalmanUpdate(tracker, finalX, finalY);

            // Smooth interpolation
            const smoothX = tracker.x + (kalman.x - tracker.x) * CONFIG.SMOOTHING_FACTOR;
            const smoothY = tracker.y + (kalman.y - tracker.y) * CONFIG.SMOOTHING_FACTOR;

            return {
              ...tracker,
              prevX: tracker.x,
              prevY: tracker.y,
              x: smoothX,
              y: smoothY,
              velocityX: kalman.vx,
              velocityY: kalman.vy,
              kalmanX: kalman.x,
              kalmanY: kalman.y,
              kalmanVx: kalman.vx,
              kalmanVy: kalman.vy,
              state: "tracking" as TrackerState,
              confidence: finalConfidence,
              framesOccluded: 0,
              lastGoodPosition: { x: smoothX, y: smoothY },
              label: newLabel,
              bboxWidth,
              bboxHeight,
              bboxConfidence,
              anchorSet: updatedAnchorSet, // Update anchor set
              history: [
                ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
                { x: smoothX, y: smoothY, timestamp: Date.now() }
              ]
            };
          }

          // === LOST/SEARCHING STATE: Try re-identification ===
          if (tracker.state === "lost" || tracker.state === "searching") {
            const newFramesLost = tracker.framesLost + 1;

            // === HYBRID RE-ID: Check YOLO detections first ===
            if (yoloMatch && yoloMatch.detection.confidence > 0.4) {
              // YOLO found something near the lost tracker's last position
              const yoloCenter = getDetectionCenter(yoloMatch.detection, width, height);
              const yoloBoxWidth = yoloMatch.detection.bbox.width * width;
              const yoloBoxHeight = yoloMatch.detection.bbox.height * height;
              return {
                ...tracker,
                x: yoloCenter.x,
                y: yoloCenter.y,
                prevX: yoloCenter.x,
                prevY: yoloCenter.y,
                kalmanX: yoloCenter.x,
                kalmanY: yoloCenter.y,
                kalmanVx: 0,
                kalmanVy: 0,
                state: "tracking" as TrackerState,
                confidence: yoloMatch.detection.confidence,
                framesLost: 0,
                framesOccluded: 0,
                lastGoodPosition: yoloCenter,
                bboxWidth: yoloBoxWidth,
                bboxHeight: yoloBoxHeight,
                bboxConfidence: yoloMatch.detection.confidence,
                label: tracker.label.startsWith("Region")
                  ? yoloMatch.detection.label
                  : tracker.label,
                history: [
                  ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
                  { ...yoloCenter, timestamp: Date.now() }
                ]
              };
            }

            // Also try to find via unmatched YOLO detections (for re-acquiring lost objects)
            if (hasYoloDetections && newFramesLost % 3 === 0) {
              const unmatchedDetections = getUnmatchedDetections(yoloDetections, yoloMatches);

              // Find closest unmatched detection to last known position
              let bestUnmatched: { detection: Detection; dist: number } | null = null;
              for (const det of unmatchedDetections) {
                const center = getDetectionCenter(det, width, height);
                const dist = Math.hypot(
                  center.x - tracker.lastGoodPosition.x,
                  center.y - tracker.lastGoodPosition.y
                );

                // Look within expanded search area for lost trackers
                if (
                  dist < flowConfig.SEARCH_RADIUS * 4 &&
                  (!bestUnmatched || dist < bestUnmatched.dist)
                ) {
                  bestUnmatched = { detection: det, dist };
                }
              }

              if (bestUnmatched && bestUnmatched.detection.confidence > 0.35) {
                const yoloCenter = getDetectionCenter(bestUnmatched.detection, width, height);
                const yoloBoxWidth = bestUnmatched.detection.bbox.width * width;
                const yoloBoxHeight = bestUnmatched.detection.bbox.height * height;
                return {
                  ...tracker,
                  x: yoloCenter.x,
                  y: yoloCenter.y,
                  prevX: yoloCenter.x,
                  prevY: yoloCenter.y,
                  kalmanX: yoloCenter.x,
                  kalmanY: yoloCenter.y,
                  kalmanVx: 0,
                  kalmanVy: 0,
                  state: "tracking" as TrackerState,
                  confidence: bestUnmatched.detection.confidence,
                  framesLost: 0,
                  framesOccluded: 0,
                  lastGoodPosition: yoloCenter,
                  bboxWidth: yoloBoxWidth,
                  bboxHeight: yoloBoxHeight,
                  bboxConfidence: bestUnmatched.detection.confidence,
                  label: tracker.label.startsWith("Region")
                    ? bestUnmatched.detection.label
                    : tracker.label,
                  history: [
                    ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
                    { ...yoloCenter, timestamp: Date.now() }
                  ]
                };
              }
            }

            // Fallback: Periodically search for re-ID using color signature
            if (newFramesLost % 5 === 0 && tracker.colorSignature) {
              const scaleFactor = CONFIG.SEARCH_RADIUS
                ? flowConfig.SEARCH_RADIUS / CONFIG.SEARCH_RADIUS
                : 1;
              const gridStep = Math.max(8, Math.round(30 * scaleFactor));
              const roiRadius = Math.max(flowConfig.SEARCH_RADIUS * 4, 80 * scaleFactor);
              const useFullSearch = newFramesLost % 25 === 0;
              const roi = useFullSearch
                ? undefined
                : {
                    x: tracker.lastGoodPosition.x - roiRadius,
                    y: tracker.lastGoodPosition.y - roiRadius,
                    width: roiRadius * 2,
                    height: roiRadius * 2
                  };

              const found = searchForTracker(currentFrame, tracker, width, height, {
                gridStep,
                sampleRadius: colorSampleRadius,
                boundaryGuard: flowConfig.BOUNDARY_GUARD,
                roi
              });

              if (found) {
                // Re-ID success! Snap back
                return {
                  ...tracker,
                  x: found.x,
                  y: found.y,
                  prevX: found.x,
                  prevY: found.y,
                  kalmanX: found.x,
                  kalmanY: found.y,
                  kalmanVx: 0,
                  kalmanVy: 0,
                  state: "tracking" as TrackerState,
                  confidence: 0.8,
                  framesLost: 0,
                  framesOccluded: 0,
                  lastGoodPosition: found,
                  history: [
                    ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
                    { x: found.x, y: found.y, timestamp: Date.now() }
                  ]
                };
              }
            }

            return {
              ...tracker,
              state: "searching" as TrackerState,
              framesLost: newFramesLost
            };
          }

          return tracker;
        })
      );

      // Update drawings - both tracker-attached and independent with anchor tracking
      setDrawings((prevDrawings) =>
        prevDrawings.map((drawing) => {
          // === TRACKER-ATTACHED DRAWINGS ===
          if (drawing.trackerId) {
            const tracker = trackersRef.current.find((t) => t.id === drawing.trackerId);
            if (!tracker) return drawing;

            // Update visibility based on tracker state
            const visible = tracker.state === "tracking" || tracker.state === "occluded";
            const opacity =
              tracker.state === "tracking" ? 1.0 : tracker.state === "occluded" ? 0.5 : 0;

            // Update points based on tracker position
            if (drawing.localPoints.length > 0) {
              const newPoints = drawing.localPoints.map((lp) => ({
                x: tracker.x + lp.x,
                y: tracker.y + lp.y
              }));

              // Update centroid
              const newCentroidX = newPoints.reduce((sum, p) => sum + p.x, 0) / newPoints.length;
              const newCentroidY = newPoints.reduce((sum, p) => sum + p.y, 0) / newPoints.length;

              return {
                ...drawing,
                points: newPoints,
                prevCentroidX: drawing.centroidX,
                prevCentroidY: drawing.centroidY,
                centroidX: newCentroidX,
                centroidY: newCentroidY,
                visible,
                opacity
              };
            }

            return { ...drawing, visible, opacity };
          }

          // === INDEPENDENT DRAWINGS WITH ANCHOR TRACKING ===
          if (drawing.useAnchors && drawing.anchorSet && prevFrame) {
            // Track anchors for this drawing
            const updatedAnchorSet = trackAnchors(
              drawing.anchorSet,
              prevFrame,
              currentFrame,
              anchorConfig
            );

            // Get consensus position from anchors
            const anchorPosition = estimatePositionFromAnchors(
              updatedAnchorSet,
              drawing.centroidX ?? 0,
              drawing.centroidY ?? 0,
              anchorConfig
            );

            if (anchorPosition.useAnchors && anchorPosition.confidence > 0.4) {
              // Calculate movement delta from anchor consensus
              const dx = anchorPosition.x - (drawing.centroidX ?? 0);
              const dy = anchorPosition.y - (drawing.centroidY ?? 0);

              // Only apply movement if significant
              if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                // Move all points by the delta
                const newPoints = drawing.points.map((p) => ({
                  x: p.x + dx,
                  y: p.y + dy
                }));

                return {
                  ...drawing,
                  points: newPoints,
                  prevCentroidX: drawing.centroidX,
                  prevCentroidY: drawing.centroidY,
                  centroidX: anchorPosition.x,
                  centroidY: anchorPosition.y,
                  anchorSet: updatedAnchorSet,
                  aiConfidence: anchorPosition.confidence
                };
              }
            }

            // Update anchor set even if no movement
            return {
              ...drawing,
              anchorSet: updatedAnchorSet
            };
          }

          return drawing;
        })
      );

      prevFrameRef.current = currentFrame;

      // === AI-POWERED OBJECT-AWARE TRACKING ===
      // Trigger async AI operations based on tracker state (non-blocking)
      if (openaiKey && canvasRef.current) {
        const canvas = canvasRef.current;

        trackersRef.current.forEach((tracker) => {
          const now = Date.now();
          const anchorConfig = anchorConfigRef.current;
          const displayPoint = toDisplayCoords(tracker.x, tracker.y);
          const displayLastGood = toDisplayCoords(
            tracker.lastGoodPosition.x,
            tracker.lastGoodPosition.y
          );
          const aiTracker: Tracker = {
            ...tracker,
            x: displayPoint.x,
            y: displayPoint.y,
            lastGoodPosition: {
              x: displayLastGood.x,
              y: displayLastGood.y
            }
          };

          // Skip trackers without AI identification
          if (!tracker.objectDescription && !tracker.visualFeatures) {
            return;
          }

          // === AI VALIDATION: Check if we're still tracking the right object ===
          // Triggers when:
          // 1. Confidence drops below threshold, OR
          // 2. Periodic validation time has passed (important for anchor mode!)
          // This ensures AI validates even when anchors provide high confidence
          const timeSinceLastValidation = now - (tracker.lastAIValidation ?? 0);
          const anchorsStable =
            tracker.useAnchors &&
            tracker.anchorSet &&
            tracker.anchorSet.coherenceScore >= anchorConfig.MIN_COHERENCE &&
            tracker.anchorSet.survivingCount >= anchorConfig.MIN_ANCHORS;
          const periodicInterval = anchorsStable
            ? AI_CONFIG.PERIODIC_VALIDATION_MS * 2
            : AI_CONFIG.PERIODIC_VALIDATION_MS;
          const needsPeriodicValidation =
            AI_CONFIG.VALIDATE_WITH_ANCHORS &&
            tracker.useAnchors &&
            timeSinceLastValidation > periodicInterval;
          const needsConfidenceValidation =
            tracker.confidence < AI_CONFIG.VALIDATION_CONFIDENCE_THRESHOLD &&
            timeSinceLastValidation > AI_CONFIG.VALIDATION_COOLDOWN_MS;
          const needsAnchorValidation =
            tracker.useAnchors &&
            tracker.anchorSet &&
            tracker.anchorSet.coherenceScore < anchorConfig.MIN_COHERENCE &&
            timeSinceLastValidation > AI_CONFIG.VALIDATION_COOLDOWN_MS;
          
          if (
            AI_CONFIG.VALIDATION_ON_OCCLUSION &&
            (tracker.state === "tracking" || tracker.state === "occluded") &&
            (needsConfidenceValidation || needsPeriodicValidation || needsAnchorValidation) &&
            !tracker.pendingAIValidation &&
            !aiValidationGuardRef.current.has(tracker.id)
          ) {
            // Mark as pending to prevent duplicate calls
            aiValidationGuardRef.current.add(tracker.id);
            setTrackers((prev) =>
              prev.map((t) => (t.id === tracker.id ? { ...t, pendingAIValidation: true } : t))
            );

            // Async validation
            validateTrackedObject(canvas, aiTracker, openaiKey)
              .then((result) => {
                setTrackers((prev) =>
                  prev.map((t) => {
                    if (t.id !== tracker.id) return t;

                    // Clear pending flag
                    const updated: Tracker = {
                      ...t,
                      pendingAIValidation: false,
                      lastAIValidation: Date.now(),
                      aiConfidence: result.confidence
                    };

                    // If AI says we're NOT on the object anymore → go to LOST
                    if (!result.isValid && result.confidence > 0.6) {
                      console.info(
                        `[AI Validation] "${tracker.label}" is no longer at marker! Triggering re-acquisition.`
                      );
                      return {
                        ...updated,
                        state: "lost" as TrackerState,
                        framesLost: 0,
                        confidence: 0.2
                      };
                    }

                    // AI confirms we're still on the object → boost confidence
                    if (result.isValid && result.confidence > 0.7) {
                      console.info(`[AI Validation] Confirmed: still tracking "${tracker.label}"`);
                      return {
                        ...updated,
                        confidence: Math.max(t.confidence, result.confidence * 0.8)
                      };
                    }

                    return updated;
                  })
                );
              })
              .catch((err) => {
                console.error("[AI Validation] Error:", err);
                setTrackers((prev) =>
                  prev.map((t) => (t.id === tracker.id ? { ...t, pendingAIValidation: false } : t))
                );
              })
              .finally(() => {
                aiValidationGuardRef.current.delete(tracker.id);
              });
          }

          // === AI RE-ACQUISITION: Find the lost object ===
          if (
            (tracker.state === "lost" || tracker.state === "searching") &&
            tracker.framesLost >= AI_CONFIG.REACQUISITION_START_FRAME &&
            tracker.framesLost % AI_CONFIG.REACQUISITION_INTERVAL_FRAMES === 0 &&
            !tracker.pendingAIReacquisition &&
            !tracker.label.startsWith("Region") && // Only search for identified objects
            !aiReacqGuardRef.current.has(tracker.id)
          ) {
            // Mark as pending to prevent duplicate calls
            aiReacqGuardRef.current.add(tracker.id);
            setTrackers((prev) =>
              prev.map((t) => (t.id === tracker.id ? { ...t, pendingAIReacquisition: true } : t))
            );

            console.info(`[AI Re-acquisition] Searching for "${tracker.label}"...`);

            // Async re-acquisition
            findObjectInFrame(canvas, aiTracker, openaiKey)
              .then((result) => {
                setTrackers((prev) =>
                  prev.map((t) => {
                    if (t.id !== tracker.id) return t;

                    // Clear pending flag
                    const updated: Tracker = { ...t, pendingAIReacquisition: false };

                    if (
                      result &&
                      result.found &&
                      result.confidence >= AI_CONFIG.REACQUISITION_MIN_CONFIDENCE
                    ) {
                      const processingPoint = toProcessingCoords(result.x, result.y);
                      // Found the object! Re-acquire
                      console.info(
                        `[AI Re-acquisition] Found "${tracker.label}" at (${result.x.toFixed(0)}, ${result.y.toFixed(0)}) with confidence ${result.confidence.toFixed(2)}`
                      );
                      return {
                        ...updated,
                        x: processingPoint.x,
                        y: processingPoint.y,
                        prevX: processingPoint.x,
                        prevY: processingPoint.y,
                        kalmanX: processingPoint.x,
                        kalmanY: processingPoint.y,
                        kalmanVx: 0,
                        kalmanVy: 0,
                        state: "tracking" as TrackerState,
                        confidence: result.confidence,
                        framesLost: 0,
                        framesOccluded: 0,
                        lastGoodPosition: {
                          x: processingPoint.x,
                          y: processingPoint.y
                        },
                        lastAIValidation: Date.now(),
                        aiConfidence: result.confidence,
                        history: [
                          ...t.history.slice(-CONFIG.TRAIL_LENGTH),
                          { x: processingPoint.x, y: processingPoint.y, timestamp: Date.now() }
                        ]
                      };
                    }

                    console.info(`[AI Re-acquisition] Could not find "${tracker.label}"`);
                    return updated;
                  })
                );
              })
              .catch((err) => {
                console.error("[AI Re-acquisition] Error:", err);
                setTrackers((prev) =>
                  prev.map((t) =>
                    t.id === tracker.id ? { ...t, pendingAIReacquisition: false } : t
                  )
                );
              })
              .finally(() => {
                aiReacqGuardRef.current.delete(tracker.id);
              });
          }
        });
      }
    },
    [
      isSetupMode,
      useServerDetection,
      interpolatedDetections,
      openaiKey,
      useAnchorTracking,
      toDisplayCoords,
      toProcessingCoords
    ]
  );

  // === RENDER LOOP ===
  useEffect(() => {
    let rafId: number | null = null;

    const render = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (!canvas || !video) {
        rafId = requestAnimationFrame(render);
        return;
      }

      if (video.readyState < 2) {
        rafId = requestAnimationFrame(render);
        return;
      }

      syncCanvasToVideo(canvas, video);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const processingCanvas =
        processingCanvasRef.current ?? (processingCanvasRef.current = document.createElement("canvas"));
      const processingDims = getProcessingDimensions(canvas.width, canvas.height);
      const sizeChanged =
        processingCanvas.width !== processingDims.width ||
        processingCanvas.height !== processingDims.height;
      if (sizeChanged) {
        processingCanvas.width = processingDims.width;
        processingCanvas.height = processingDims.height;
        prevFrameRef.current = null;
      }

      processingScaleRef.current = processingDims.scale;
      flowConfigRef.current = getScaledFlowConfig(processingDims.scale.scalar);
      anchorConfigRef.current = getScaledAnchorConfig(processingDims.scale.scalar);
      colorSampleRadiusRef.current = Math.max(
        8,
        Math.round(CONFIG.COLOR_SAMPLE_SIZE * processingDims.scale.scalar)
      );

      const processingCtx = processingCanvas.getContext("2d", { willReadFrequently: true });
      if (!processingCtx) {
        rafId = requestAnimationFrame(render);
        return;
      }

      processingCtx.drawImage(
        video,
        0,
        0,
        processingCanvas.width,
        processingCanvas.height
      );
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (isPlaying && !isSetupMode) {
        const now = performance.now();
        const minInterval = 1000 / PROCESSING_CONFIG.TARGET_FPS;
        let processed = false;
        if (now - lastProcessTimeRef.current >= minInterval) {
          updateTrackers(processingCtx, processingCanvas.width, processingCanvas.height);
          lastProcessTimeRef.current = now;
          processed = true;

          // Send frame to server for YOLO detection
          if (useServerDetection && serverConnected) {
            sendFrameToServer(processingCanvas);
          }
        }

        if (!processed && useServerDetection && serverConnected) {
          sendFrameToServer(processingCanvas);
        }
      }

      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsUpdateRef.current > 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsUpdateRef.current)));
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }

      // Render local tracking annotations
      const renderScale = {
        x: processingDims.scale.x ? 1 / processingDims.scale.x : 1,
        y: processingDims.scale.y ? 1 / processingDims.scale.y : 1
      };
      renderAnnotations(
        ctx,
        trackersRef.current,
        drawingsRef.current,
        currentDrawing,
        annotationStyle,
        selectedTracker,
        renderScale
      );

      // NOTE: Anchor points are used internally for tracking but NOT rendered to user
      // The anchor tracking system works in the background to improve position accuracy
      // without cluttering the visual display

      // Render server detection boxes (YOLO)
      if (useServerDetection && showServerDetections && interpolatedDetections.length > 0) {
        drawDetections(ctx, interpolatedDetections, canvas.width, canvas.height, {
          lineWidth: 3,
          showLabel: true,
          showConfidence: true,
          fontSize: 14
        });
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    isPlaying,
    isSetupMode,
    annotationStyle,
    currentDrawing,
    selectedTracker,
    updateTrackers,
    useServerDetection,
    serverConnected,
    sendFrameToServer,
    showServerDetections,
    interpolatedDetections,
    useAnchorTracking
  ]);

  const getStateStyle = (state: TrackerState): React.CSSProperties => {
    const base = { ...styles.trackerState };
    switch (state) {
      case "tracking":
        return { ...base, background: "rgba(16, 185, 129, 0.2)", color: "#10b981" };
      case "occluded":
        return { ...base, background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b" };
      case "lost":
      case "searching":
        return { ...base, background: "rgba(239, 68, 68, 0.2)", color: "#ef4444" };
      default:
        return base;
    }
  };

  const getModeColor = () => {
    if (isSetupMode) return { background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6" };
    if (isPlaying) return { background: "rgba(16, 185, 129, 0.2)", color: "#10b981" };
    return { background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b" };
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>🔬</div>
          <h2 style={styles.title}>MedSync Vision</h2>
          <span style={{ ...styles.modeBadge, ...getModeColor() }}>
            {isSetupMode ? "Setup" : isPlaying ? "Live" : "Paused"}
          </span>
        </div>
        <div style={styles.headerRight}>
          <span
            style={{
              ...styles.fpsDisplay,
              color: fps > 30 ? "#10b981" : fps > 15 ? "#f59e0b" : "#ef4444"
            }}
          >
            {fps} FPS
          </span>
          {openaiKey && (
            <span
              style={{
                fontSize: "0.7rem",
                color: "#8b5cf6",
                padding: "4px 8px",
                background: "rgba(139, 92, 246, 0.15)",
                borderRadius: "4px"
              }}
            >
              AI Ready
            </span>
          )}
          <button style={styles.helpBtn} onClick={() => setShowHelp(!showHelp)}>
            ?
          </button>
        </div>
      </div>

      <video
        ref={videoRef}
        onLoadedData={handleVideoLoaded}
        playsInline
        muted
        style={{ display: "none" }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {!videoLoaded && (
        <div style={styles.uploadZone}>
          <div style={styles.uploadContent}>
            <span style={styles.uploadIcon}>🎬</span>
            <h3 style={styles.uploadTitle}>Medical Video Analysis</h3>
            <p style={styles.uploadDesc}>
              Load a video file to track and annotate regions of interest with AI-powered labeling
            </p>
            <button style={styles.uploadBtn} onClick={() => fileInputRef.current?.click()}>
              Select Video File
            </button>
          </div>
        </div>
      )}

      {videoLoaded && (
        <div style={{ ...styles.videoContainer, cursor: drawMode ? "crosshair" : "pointer" }}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onContextMenu={handleContextMenu}
            onMouseDown={drawMode ? handleDrawStart : undefined}
            onMouseMove={drawMode ? handleDrawMove : undefined}
            onMouseUp={drawMode ? handleDrawEnd : undefined}
            onMouseLeave={drawMode ? handleDrawEnd : undefined}
            style={styles.canvas}
          />
          <div style={styles.hudOverlay}>
            <span style={styles.hudBadge}>
              {trackers.filter((t) => t.state === "tracking").length}/{trackers.length} Active
            </span>
            {drawings.length > 0 && (
              <span style={styles.hudBadge}>
                {drawings.length} Drawing{drawings.length !== 1 ? "s" : ""}
              </span>
            )}
            {drawMode && <span style={styles.drawIndicator}>✏️ Draw Mode</span>}
          </div>
        </div>
      )}

      {videoLoaded && (
        <div style={styles.controlsPanel}>
          <div style={styles.controlsRow}>
            {isSetupMode ? (
              <>
                <button style={styles.ctrlBtn} onClick={resetDemo}>
                  ↺ Reset
                </button>
                <button
                  style={{
                    ...styles.ctrlBtn,
                    ...styles.ctrlBtnPrimary,
                    opacity: trackers.length === 0 ? 0.5 : 1,
                    cursor: trackers.length === 0 ? "not-allowed" : "pointer"
                  }}
                  onClick={startProcessing}
                  disabled={trackers.length === 0}
                >
                  ▶ Start ({trackers.length})
                </button>
              </>
            ) : (
              <>
                <button style={styles.ctrlBtn} onClick={resetDemo}>
                  ↺ Reset
                </button>
                <button style={styles.ctrlBtn} onClick={isPlaying ? pauseVideo : resumeVideo}>
                  {isPlaying ? "⏸ Pause" : "▶ Resume"}
                </button>
              </>
            )}
            <button
              style={{ ...styles.ctrlBtn, ...(drawMode ? styles.ctrlBtnActive : {}) }}
              onClick={() => setDrawMode(!drawMode)}
            >
              ✏️ Draw
            </button>
            <button style={styles.ctrlBtn} onClick={cycleStyle}>
              ◐ {annotationStyle}
            </button>
            <div
              style={{
                width: "1px",
                height: "24px",
                background: "rgba(255,255,255,0.2)",
                margin: "0 4px"
              }}
            />
            <button
              style={{
                ...styles.ctrlBtn,
                ...(useServerDetection ? styles.ctrlBtnActive : {}),
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
              onClick={toggleServerDetection}
              title="Toggle YOLO object detection via server"
            >
              🎯 YOLO
              {useServerDetection && (
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: serverConnected ? "#10b981" : "#ef4444"
                  }}
                />
              )}
            </button>
            {useServerDetection && (
              <>
                <button
                  style={{ ...styles.ctrlBtn, ...(showServerDetections ? {} : { opacity: 0.5 }) }}
                  onClick={toggleShowServerDetections}
                  title="Toggle detection box visibility"
                >
                  {showServerDetections ? "👁" : "👁‍🗨"}
                </button>
                <select
                  style={{
                    ...styles.ctrlBtn,
                    background: "rgba(255, 255, 255, 0.06)",
                    cursor: "pointer",
                    minWidth: "100px"
                  }}
                  value={detectionMode}
                  onChange={handleDetectionModeChange}
                >
                  <option value="surgical">🏥 Surgical</option>
                  <option value="general">🔍 General</option>
                  <option value="security">🛡️ Security</option>
                </select>
              </>
            )}

            {/* Anchor Tracking Controls */}
            <div style={{ height: "16px", width: "1px", background: "rgba(255,255,255,0.2)" }} />
            <button
              style={{
                ...styles.ctrlBtn,
                ...(useAnchorTracking ? styles.ctrlBtnActive : {}),
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
              onClick={() => setUseAnchorTracking((prev) => !prev)}
              title="Toggle anchor-based tracking (A)"
            >
              ⚓ Anchors
            </button>
            {/* Anchor visualization removed - anchors work internally but are not shown to user */}
          </div>

          {/* Server Detection Status Bar */}
          {useServerDetection && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                padding: "8px 16px",
                background: serverConnected ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                borderTop: `1px solid ${serverConnected ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                fontSize: "0.8rem"
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  color: serverConnected ? "#10b981" : "#ef4444"
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: serverConnected ? "#10b981" : "#ef4444",
                    animation: serverConnected ? "none" : "pulse 1s infinite"
                  }}
                />
                {serverConnected ? "YOLO Server Connected" : "Connecting to YOLO Server..."}
              </span>
              {serverConnected && (
                <>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>
                    RTT: {detectionMetrics.avgRoundTrip}ms
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>
                    Inference: {detectionMetrics.avgInference}ms
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>
                    Detections: {interpolatedDetections.length}
                  </span>
                </>
              )}
            </div>
          )}

          {isSetupMode && (
            <div style={styles.setupHint}>
              <strong>Quick Start:</strong> Click to place tracking points on regions you want to
              follow. Right-click removes a tracker. Press <kbd style={styles.kbd}>I</kbd> to
              AI-identify selected tracker. Click Start when ready!
            </div>
          )}

          {trackers.length > 0 && (
            <div style={styles.trackerList}>
              {trackers.map((t) => (
                <div
                  key={t.id}
                  style={{
                    ...styles.trackerItem,
                    ...(selectedTracker === t.id
                      ? {
                          background: "rgba(59, 130, 246, 0.15)",
                          borderColor: "#3b82f6"
                        }
                      : {})
                  }}
                  onClick={() => setSelectedTracker(t.id === selectedTracker ? null : t.id)}
                >
                  <span style={{ ...styles.trackerDot, background: t.color }} />
                  <span style={styles.trackerLabel}>
                    {t.labelStatus === "thinking" ? "..." : t.label}
                  </span>
                  <span style={getStateStyle(t.state)}>{t.state}</span>
                  {openaiKey && t.state === "tracking" && (
                    <button
                      style={styles.aiBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        identifyTracker(t.id);
                      }}
                    >
                      AI
                    </button>
                  )}
                  <button
                    style={styles.trackerRemove}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTracker(t.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showHelp && (
        <div style={styles.helpModal} onClick={() => setShowHelp(false)}>
          <div style={styles.helpContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.helpTitle}>MedSync Vision Controls</h3>
            <div style={styles.helpGrid}>
              <span style={styles.kbd}>Click</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Place tracking point + auto-detect anchors
              </span>
              <span style={styles.kbd}>Right-click</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Remove nearest tracker
              </span>
              <span style={styles.kbd}>D</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Toggle draw mode
              </span>
              <span style={styles.kbd}>I</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                AI identify (requires API key)
              </span>
              <span style={styles.kbd}>S</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Cycle annotation styles
              </span>
              <span style={styles.kbd}>Space/Enter</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Start / Pause
              </span>
              <span style={styles.kbd}>R</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>Reset demo</span>
              <span style={styles.kbd}>H</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Toggle help
              </span>
            </div>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem", marginBottom: "16px" }}>
              Features: Forward-backward optical flow, Kalman smoothing,{" "}
              <strong>anchor-based rigid body constraint</strong>, color-based re-identification, AI
              object identification & validation
            </p>
            <button style={styles.helpClose} onClick={() => setShowHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// RENDERING ENGINE
// ============================================================================

function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  trackers: Tracker[],
  drawings: DrawingStroke[],
  currentDrawing: DrawingStroke | null,
  style: AnnotationStyle,
  selectedTracker: string | null,
  renderScale: { x: number; y: number } = { x: 1, y: 1 }
) {
  const scaleX = renderScale.x;
  const scaleY = renderScale.y;

  // === RENDER DRAWINGS ===
  [...drawings, currentDrawing].filter(Boolean).forEach((stroke) => {
    if (!stroke || stroke.points.length < 2) return;
    if (!stroke.visible && stroke !== currentDrawing) return;

    // Check if drawing is out of frame - skip rendering if all points are outside
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    const allPointsOutOfFrame = stroke.points.every(
      (p) =>
        p.x * scaleX < 0 ||
        p.x * scaleX > canvasWidth ||
        p.y * scaleY < 0 ||
        p.y * scaleY > canvasHeight
    );
    if (allPointsOutOfFrame) return;

    ctx.save();
    ctx.globalAlpha = stroke.opacity;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = style === "gaming" ? 3 : 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Add glow effect for gaming style
    if (style === "gaming") {
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = 8;
    }

    const first = stroke.points[0];
    if (first) {
      ctx.moveTo(first.x * scaleX, first.y * scaleY);
      stroke.points
        .slice(1)
        .forEach((p) => ctx.lineTo(p.x * scaleX, p.y * scaleY));
      if (stroke.closed) {
        ctx.closePath();
      }
    }
    ctx.stroke();

    // Draw label if set
    if (stroke.label && stroke.points.length > 0) {
      const centroid = stroke.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
        x: 0,
        y: 0
      });
      centroid.x = (centroid.x / stroke.points.length) * scaleX;
      centroid.y = (centroid.y / stroke.points.length) * scaleY;

      ctx.font = "bold 11px system-ui, sans-serif";
      const metrics = ctx.measureText(stroke.label);

      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(centroid.x - 4, centroid.y - 12, metrics.width + 8, 18);

      ctx.fillStyle = "#fff";
      ctx.fillText(stroke.label, centroid.x, centroid.y + 2);
    }

    ctx.restore();
  });

  // === RENDER TRACKERS ===
  trackers.forEach((tracker) => {
    const { x, y, label, color, state, confidence } = tracker;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;

    // Check if tracker is out of frame - don't render if outside visible area
    const outOfFrame =
      scaledX < 0 || scaledX > ctx.canvas.width || scaledY < 0 || scaledY > ctx.canvas.height;

    if (outOfFrame) return; // Don't render out-of-frame trackers

    // Determine visibility
    let opacity = 1.0;
    if (state === "lost" || state === "searching") {
      opacity = 0; // Hidden
    } else if (state === "occluded") {
      opacity = 0.5;
    }

    if (opacity === 0) return; // Don't render hidden trackers

    ctx.save();
    ctx.globalAlpha = opacity;

    const isSelected = tracker.id === selectedTracker;

    // === MARKER SIZE ===
    const markerSize =
      style === "minimal"
        ? CONFIG.MARKER_SIZE_MINIMAL
        : style === "gaming"
          ? CONFIG.MARKER_SIZE_GAMING
          : CONFIG.MARKER_SIZE_STANDARD;

    // === SELECTION RING ===
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(scaledX, scaledY, markerSize + 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // === OUTER GLOW (Gaming) ===
    if (style === "gaming") {
      ctx.beginPath();
      ctx.arc(scaledX, scaledY, markerSize + 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity * 0.25;
      ctx.fill();
      ctx.globalAlpha = opacity;
    }

    // === CONFIDENCE RING ===
    if (style === "detailed" || style === "gaming") {
      ctx.beginPath();
      ctx.arc(
        scaledX,
        scaledY,
        markerSize + 3,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * confidence
      );
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // === MAIN MARKER ===
    ctx.beginPath();
    ctx.arc(scaledX, scaledY, markerSize, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // === CENTER DOT ===
    ctx.beginPath();
    ctx.arc(scaledX, scaledY, markerSize * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fill();

    // === LABEL ===
    if (style !== "minimal") {
      const labelText =
        style === "detailed" ? `${label} (${Math.round(confidence * 100)}%)` : label;

      ctx.font = `${style === "gaming" ? "bold " : ""}12px system-ui, sans-serif`;
      const metrics = ctx.measureText(labelText);
      const padding = 8;
      const labelX = scaledX + markerSize + 12;
      const labelY = scaledY - 8;
      const labelH = 22;

      // Label background
      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.beginPath();
      ctx.roundRect(
        labelX - padding,
        labelY - labelH / 2 - 2,
        metrics.width + padding * 2,
        labelH,
        6
      );
      ctx.fill();

      // Gaming border
      if (style === "gaming") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Label text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(labelText, labelX, labelY + 4);

      // State indicator for detailed
      if (style === "detailed" && state !== "tracking") {
        const stateColor = state === "occluded" ? "#f59e0b" : "#ef4444";
        ctx.fillStyle = stateColor;
        ctx.beginPath();
        ctx.arc(labelX + metrics.width + padding + 6, labelY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  });
}
