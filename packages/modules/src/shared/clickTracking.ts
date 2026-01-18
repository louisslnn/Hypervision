export type TrackerState = "tracking" | "occluded" | "lost";
export type TrackingProfile = "precision" | "balanced" | "performance";

export type TrackingPreset = {
  analysisWidth: number;
  targetFps: number;
  templateSize: number;
  searchRadius: number;
  searchStep: number;
  refineRadius: number;
  smoothing: number;
  velocitySmoothing: number;
  occludedThreshold: number;
  lostThreshold: number;
  templateUpdateRate: number;
  minConfidenceForUpdate: number;
  maxHistory: number;
  motionThreshold: number;
  motionCooldownMs: number;
  maxTrackers: number;
};

export type TrackingConfig = TrackingPreset & { analysisHeight: number };

export type TrackerPoint = { x: number; y: number; t: number };

export type LabelStatus = "idle" | "thinking" | "labeled" | "error";

export type ClickTracker = {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  state: TrackerState;
  confidence: number;
  lastScore: number;
  velocity: { x: number; y: number };
  history: TrackerPoint[];
  createdAt: number;
  lostFrames: number;
  template: Uint8ClampedArray;
  templateSize: number;
  // AI object-aware tracking fields
  labelStatus?: LabelStatus;
  objectDescription?: string; // Detailed description of the object
  visualFeatures?: string; // Key visual features for re-identification
  lastAIValidation?: number; // Timestamp of last AI validation check
  aiConfidence?: number; // AI's confidence we're still on the object
  referenceImage?: string; // Base64 of original object crop for comparison
  pendingAIValidation?: boolean; // Flag to prevent duplicate AI validation calls
  pendingAIReacquisition?: boolean; // Flag to prevent duplicate re-acquisition calls
  lastGoodPosition?: { x: number; y: number }; // Last known good position for re-acquisition
};

export type TrackingUpdate = {
  trackers: ClickTracker[];
  stateChanges: Array<{ id: string; from: TrackerState; to: TrackerState }>;
};

// YOLO detection interface for hybrid tracking (matches detectionClient.ts Detection type)
export interface YoloBoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface YoloDetection {
  id: string;
  class: string;
  label: string;
  confidence: number;
  bbox: YoloBoundingBox;
  velocity?: { x: number; y: number };
  lastSeen?: number;
  trackId?: string;
}

export interface HybridTrackingOptions {
  detections?: YoloDetection[];
  yoloWeight?: number; // Weight for YOLO position correction (0-1, default 0.3)
  yoloReacquireRadius?: number; // Search radius for re-acquiring lost trackers
}

export const TRACKING_PRESETS: Record<TrackingProfile, TrackingPreset> = {
  precision: {
    analysisWidth: 480,
    targetFps: 24,
    templateSize: 31,
    searchRadius: 70,
    searchStep: 2,
    refineRadius: 6,
    smoothing: 0.55,
    velocitySmoothing: 0.35,
    occludedThreshold: 0.22,
    lostThreshold: 0.32,
    templateUpdateRate: 0.12,
    minConfidenceForUpdate: 70,
    maxHistory: 120,
    motionThreshold: 0.08,
    motionCooldownMs: 2500,
    maxTrackers: 6
  },
  balanced: {
    analysisWidth: 360,
    targetFps: 24,
    templateSize: 27,
    searchRadius: 60,
    searchStep: 3,
    refineRadius: 5,
    smoothing: 0.6,
    velocitySmoothing: 0.4,
    occludedThreshold: 0.25,
    lostThreshold: 0.35,
    templateUpdateRate: 0.14,
    minConfidenceForUpdate: 65,
    maxHistory: 100,
    motionThreshold: 0.1,
    motionCooldownMs: 2500,
    maxTrackers: 6
  },
  performance: {
    analysisWidth: 260,
    targetFps: 20,
    templateSize: 23,
    searchRadius: 50,
    searchStep: 4,
    refineRadius: 4,
    smoothing: 0.65,
    velocitySmoothing: 0.45,
    occludedThreshold: 0.28,
    lostThreshold: 0.38,
    templateUpdateRate: 0.18,
    minConfidenceForUpdate: 60,
    maxHistory: 80,
    motionThreshold: 0.12,
    motionCooldownMs: 2500,
    maxTrackers: 4
  }
};

export function buildTrackingConfig(
  preset: TrackingPreset,
  videoWidth: number,
  videoHeight: number
): TrackingConfig {
  const safeWidth = videoWidth > 0 ? videoWidth : 16;
  const safeHeight = videoHeight > 0 ? videoHeight : 9;
  const aspect = safeWidth / safeHeight;
  const analysisHeight = Math.max(120, Math.round(preset.analysisWidth / aspect));
  return { ...preset, analysisHeight };
}

export function buildLumaFrame(imageData: ImageData): Uint8ClampedArray {
  const { data, width, height } = imageData;
  const luma = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    luma[j] = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
  }
  return luma;
}

export function computeMotionScore(
  prev: Uint8ClampedArray | null,
  next: Uint8ClampedArray
): { score: number; next: Uint8ClampedArray } {
  if (!prev || prev.length !== next.length) {
    return { score: 0, next };
  }
  let diff = 0;
  for (let i = 0; i < next.length; i += 1) {
    diff += Math.abs((next[i] ?? 0) - (prev[i] ?? 0));
  }
  const score = diff / (next.length * 255);
  return { score, next };
}

export function createTracker(options: {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  luma: Uint8ClampedArray;
  width: number;
  height: number;
  config: TrackingConfig;
  now: number;
}): ClickTracker | null {
  const templateSize = normalizeTemplateSize(options.config.templateSize);
  const clamped = clampPoint(
    Math.round(options.x),
    Math.round(options.y),
    options.width,
    options.height,
    templateSize
  );

  const template = extractTemplate(
    options.luma,
    options.width,
    options.height,
    clamped.x,
    clamped.y,
    templateSize
  );

  if (!template) {
    return null;
  }

  return {
    id: options.id,
    label: options.label,
    color: options.color,
    x: clamped.x,
    y: clamped.y,
    state: "tracking",
    confidence: 100,
    lastScore: 0,
    velocity: { x: 0, y: 0 },
    history: [{ x: clamped.x, y: clamped.y, t: options.now }],
    createdAt: options.now,
    lostFrames: 0,
    template,
    templateSize
  };
}

/**
 * Match a YOLO detection to a tracker by checking proximity
 */
function findMatchingDetection(
  tracker: ClickTracker,
  detections: YoloDetection[],
  maxDistance: number = 80
): { detection: YoloDetection; distance: number } | null {
  let best: { detection: YoloDetection; distance: number } | null = null;

  for (const det of detections) {
    const centerX = det.bbox.centerX;
    const centerY = det.bbox.centerY;
    const distance = Math.hypot(tracker.x - centerX, tracker.y - centerY);

    if (distance < maxDistance && (!best || distance < best.distance)) {
      best = { detection: det, distance };
    }
  }

  return best;
}

/**
 * Get the center of a YOLO detection box
 */
function getYoloCenter(detection: YoloDetection): { x: number; y: number } {
  return { x: detection.bbox.centerX, y: detection.bbox.centerY };
}

export function updateTrackers(
  trackers: ClickTracker[],
  luma: Uint8ClampedArray,
  width: number,
  height: number,
  config: TrackingConfig,
  now: number,
  hybridOptions?: HybridTrackingOptions
): TrackingUpdate {
  const stateChanges: TrackingUpdate["stateChanges"] = [];
  const detections = hybridOptions?.detections ?? [];
  const yoloWeight = hybridOptions?.yoloWeight ?? 0.35;
  const yoloReacquireRadius = hybridOptions?.yoloReacquireRadius ?? config.searchRadius * 2;
  const hasYolo = detections.length > 0;

  // Track which detections have been used
  const usedDetectionIndices = new Set<number>();

  const updated = trackers.map((tracker) => {
    const result = matchTemplate(luma, width, height, tracker, config);
    const rawConfidence = Math.max(0, Math.min(100, Math.round((1 - result.score) * 100)));
    let confidence = Math.round(tracker.confidence * 0.7 + rawConfidence * 0.3);

    // Find matching YOLO detection
    const yoloMatch = hasYolo
      ? findMatchingDetection(tracker, detections, config.searchRadius * 1.5)
      : null;
    if (yoloMatch) {
      const idx = detections.indexOf(yoloMatch.detection);
      if (idx >= 0) usedDetectionIndices.add(idx);
    }

    let state: TrackerState = "tracking";
    if (result.score > config.lostThreshold && !yoloMatch) {
      // Lost according to template, but check if YOLO sees it
      state = "lost";
    } else if (result.score > config.lostThreshold && yoloMatch) {
      // Template lost but YOLO found it - trust YOLO
      state = yoloMatch.detection.confidence > 0.4 ? "tracking" : "occluded";
    } else if (result.score > config.occludedThreshold) {
      state = "occluded";
    }

    if (state !== tracker.state) {
      stateChanges.push({ id: tracker.id, from: tracker.state, to: state });
    }

    const lostFrames = state === "lost" ? tracker.lostFrames + 1 : 0;
    const predictedX = tracker.x + tracker.velocity.x;
    const predictedY = tracker.y + tracker.velocity.y;

    // === HYBRID POSITION CALCULATION ===
    let targetX: number;
    let targetY: number;
    let newLabel = tracker.label;

    if (state === "lost" && !yoloMatch) {
      // Truly lost - use velocity prediction
      targetX = predictedX;
      targetY = predictedY;
    } else if (yoloMatch && state !== "lost") {
      // Have both template match and YOLO - blend them
      const yoloCenter = getYoloCenter(yoloMatch.detection);
      const effectiveYoloWeight = yoloWeight * yoloMatch.detection.confidence;
      const templateWeight = 1 - effectiveYoloWeight;

      targetX = result.x * templateWeight + yoloCenter.x * effectiveYoloWeight;
      targetY = result.y * templateWeight + yoloCenter.y * effectiveYoloWeight;

      // Boost confidence when both agree
      const agreement = 1 - yoloMatch.distance / (config.searchRadius * 2);
      confidence = Math.min(
        100,
        confidence + Math.round(agreement * 15 * yoloMatch.detection.confidence)
      );

      // Update label from YOLO if generic
      if (tracker.label.startsWith("Target") && yoloMatch.detection.label) {
        newLabel = yoloMatch.detection.label;
      }
    } else if (yoloMatch && state === "lost") {
      // Template lost but YOLO found - use YOLO position
      const yoloCenter = getYoloCenter(yoloMatch.detection);
      targetX = yoloCenter.x;
      targetY = yoloCenter.y;
      confidence = Math.round(yoloMatch.detection.confidence * 80);
      state = "tracking"; // Recover from lost

      if (state !== tracker.state) {
        stateChanges.push({ id: tracker.id, from: tracker.state, to: state });
      }

      if (tracker.label.startsWith("Target") && yoloMatch.detection.label) {
        newLabel = yoloMatch.detection.label;
      }
    } else {
      // Template match only
      targetX = result.x;
      targetY = result.y;
    }

    const smoothing = state === "lost" ? 0.2 : config.smoothing;
    const nextX = tracker.x + (targetX - tracker.x) * smoothing;
    const nextY = tracker.y + (targetY - tracker.y) * smoothing;

    const velocity = {
      x:
        tracker.velocity.x * config.velocitySmoothing +
        (nextX - tracker.x) * (1 - config.velocitySmoothing),
      y:
        tracker.velocity.y * config.velocitySmoothing +
        (nextY - tracker.y) * (1 - config.velocitySmoothing)
    };

    const history =
      state === "lost"
        ? tracker.history
        : [...tracker.history.slice(-config.maxHistory + 1), { x: nextX, y: nextY, t: now }];

    if (state === "tracking" && confidence >= config.minConfidenceForUpdate) {
      const patch = extractTemplate(
        luma,
        width,
        height,
        Math.round(nextX),
        Math.round(nextY),
        tracker.templateSize
      );
      if (patch) {
        blendTemplate(tracker.template, patch, config.templateUpdateRate);
      }
    }

    return {
      ...tracker,
      x: nextX,
      y: nextY,
      confidence,
      lastScore: result.score,
      state,
      velocity,
      history,
      lostFrames,
      label: newLabel
    };
  });

  // Check for lost trackers that can be re-acquired via unmatched YOLO detections
  const finalTrackers = updated.map((tracker) => {
    if (tracker.state !== "lost" || !hasYolo) return tracker;

    // Look for nearby unmatched YOLO detection
    for (let i = 0; i < detections.length; i++) {
      if (usedDetectionIndices.has(i)) continue;

      const det = detections[i];
      if (!det) continue;

      const center = getYoloCenter(det);
      const dist = Math.hypot(tracker.x - center.x, tracker.y - center.y);

      if (dist < yoloReacquireRadius && det.confidence > 0.35) {
        usedDetectionIndices.add(i);

        // Re-acquire tracker (we know it's "lost" from the check above)
        stateChanges.push({ id: tracker.id, from: "lost", to: "tracking" });

        return {
          ...tracker,
          x: center.x,
          y: center.y,
          state: "tracking" as TrackerState,
          confidence: Math.round(det.confidence * 75),
          lostFrames: 0,
          label: tracker.label.startsWith("Target") ? det.label : tracker.label,
          history: [
            ...tracker.history.slice(-config.maxHistory + 1),
            { x: center.x, y: center.y, t: now }
          ]
        };
      }
    }

    return tracker;
  });

  return { trackers: finalTrackers, stateChanges };
}

function normalizeTemplateSize(size: number): number {
  const rounded = Math.max(15, Math.round(size));
  return rounded % 2 === 0 ? rounded + 1 : rounded;
}

function clampPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  templateSize: number
): { x: number; y: number } {
  const half = Math.floor(templateSize / 2);
  return {
    x: clamp(x, half, width - half - 1),
    y: clamp(y, half, height - half - 1)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function matchTemplate(
  luma: Uint8ClampedArray,
  width: number,
  height: number,
  tracker: ClickTracker,
  config: TrackingConfig
): { x: number; y: number; score: number } {
  const size = tracker.templateSize;
  const half = Math.floor(size / 2);
  const baseRadius = config.searchRadius + tracker.lostFrames * 6;
  const radius = Math.min(baseRadius, config.searchRadius * 2.5);
  const step = config.searchStep;

  const predictedX = clamp(Math.round(tracker.x + tracker.velocity.x * 2), half, width - half - 1);
  const predictedY = clamp(Math.round(tracker.y + tracker.velocity.y * 2), half, height - half - 1);

  let best = searchWindow(
    luma,
    width,
    height,
    tracker.template,
    size,
    predictedX,
    predictedY,
    radius,
    step,
    {
      x: predictedX,
      y: predictedY,
      score: Number.POSITIVE_INFINITY
    }
  );

  if (config.refineRadius > 0 && step > 1) {
    best = searchWindow(
      luma,
      width,
      height,
      tracker.template,
      size,
      best.x,
      best.y,
      config.refineRadius,
      1,
      best
    );
  }

  return best;
}

function searchWindow(
  luma: Uint8ClampedArray,
  width: number,
  height: number,
  template: Uint8ClampedArray,
  size: number,
  centerX: number,
  centerY: number,
  radius: number,
  step: number,
  best: { x: number; y: number; score: number }
): { x: number; y: number; score: number } {
  const half = Math.floor(size / 2);
  const minX = clamp(centerX - radius, half, width - half - 1);
  const maxX = clamp(centerX + radius, half, width - half - 1);
  const minY = clamp(centerY - radius, half, height - half - 1);
  const maxY = clamp(centerY + radius, half, height - half - 1);

  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const score = computeSad(luma, width, template, size, x, y);
      if (score < best.score) {
        best = { x, y, score };
      }
    }
  }

  return best;
}

function computeSad(
  luma: Uint8ClampedArray,
  width: number,
  template: Uint8ClampedArray,
  size: number,
  centerX: number,
  centerY: number
): number {
  const half = Math.floor(size / 2);
  let sum = 0;
  let idx = 0;
  for (let y = centerY - half; y <= centerY + half; y += 1) {
    const row = y * width + (centerX - half);
    for (let x = 0; x < size; x += 1) {
      const lumaVal = luma[row + x] ?? 0;
      const templateVal = template[idx] ?? 0;
      const diff = lumaVal - templateVal;
      sum += diff < 0 ? -diff : diff;
      idx += 1;
    }
  }
  return sum / (255 * template.length);
}

function extractTemplate(
  luma: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  size: number
): Uint8ClampedArray | null {
  const half = Math.floor(size / 2);
  if (
    centerX - half < 0 ||
    centerY - half < 0 ||
    centerX + half >= width ||
    centerY + half >= height
  ) {
    return null;
  }

  const template = new Uint8ClampedArray(size * size);
  let idx = 0;
  for (let y = centerY - half; y <= centerY + half; y += 1) {
    const row = y * width + (centerX - half);
    for (let x = 0; x < size; x += 1) {
      template[idx] = luma[row + x] ?? 0;
      idx += 1;
    }
  }
  return template;
}

function blendTemplate(current: Uint8ClampedArray, next: Uint8ClampedArray, rate: number) {
  const keep = 1 - rate;
  for (let i = 0; i < current.length; i += 1) {
    const currentVal = current[i] ?? 0;
    const nextVal = next[i] ?? 0;
    current[i] = Math.round(currentVal * keep + nextVal * rate);
  }
}