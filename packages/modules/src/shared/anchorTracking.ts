"use client";

/**
 * Anchor-Based Object Tracking Module
 *
 * Provides multi-point anchor tracking for improved precision:
 * 1. Detects keypoints/anchors ON the object when marker is placed
 * 2. Tracks all anchors with optical flow
 * 3. Enforces rigid body constraints (anchors should move together)
 * 4. Uses consensus of surviving anchors for final position
 */

// ============================================================================
// TYPES
// ============================================================================

export interface Anchor {
  id: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  // Offset from main tracker center (for rigid body constraint)
  offsetX: number;
  offsetY: number;
  // Tracking state
  confidence: number;
  isValid: boolean;
  // Template for matching
  template: number[] | null;
  templateSize: number;
}

export interface AnchorSet {
  id: string;
  anchors: Anchor[];
  // Expected distances between anchors (for rigid body validation)
  expectedDistances: Map<string, number>;
  // Center of the anchor constellation
  centroidX: number;
  centroidY: number;
  // Quality metrics
  coherenceScore: number; // How well anchors agree (0-1)
  survivingCount: number;
}

export interface AnchorDetectionResult {
  anchors: Anchor[];
  objectBounds: { x: number; y: number; width: number; height: number };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export const ANCHOR_CONFIG = {
  // Anchor detection
  MAX_ANCHORS: 6, // Maximum anchors per object
  MIN_ANCHORS: 3, // Minimum for rigid body constraint
  DETECTION_RADIUS: 80, // Search radius around marker for anchors
  EDGE_THRESHOLD: 30, // Gradient threshold for edge detection
  CORNER_THRESHOLD: 0.02, // Harris corner response threshold
  MIN_ANCHOR_SPACING: 15, // Minimum distance between anchors

  // Tracking
  ANCHOR_TEMPLATE_SIZE: 11, // Template size for each anchor
  ANCHOR_SEARCH_RADIUS: 25, // Search radius for anchor tracking
  MIN_ANCHOR_CONFIDENCE: 0.4, // Minimum confidence to keep anchor

  // Rigid body constraint
  DISTANCE_TOLERANCE: 0.25, // 25% tolerance in inter-anchor distances
  MIN_COHERENCE: 0.5, // Minimum coherence to trust anchor set
  OUTLIER_THRESHOLD: 2.0, // Standard deviations to mark as outlier

  // Template update (helps adapt to lighting changes)
  TEMPLATE_UPDATE_CONFIDENCE: 0.75,
  TEMPLATE_UPDATE_ALPHA: 0.15
};

export type AnchorConfig = typeof ANCHOR_CONFIG;

function resolveAnchorConfig(overrides?: Partial<AnchorConfig>): AnchorConfig {
  return { ...ANCHOR_CONFIG, ...(overrides ?? {}) };
}

// ============================================================================
// EDGE & CORNER DETECTION
// ============================================================================

/**
 * Compute image gradients using Sobel operator
 */
function computeGradients(
  imageData: ImageData,
  x: number,
  y: number,
  radius: number
): {
  gradX: Float32Array;
  gradY: Float32Array;
  magnitude: Float32Array;
  width: number;
  height: number;
} {
  const { data, width, height } = imageData;
  const size = radius * 2 + 1;
  const gradX = new Float32Array(size * size);
  const gradY = new Float32Array(size * size);
  const magnitude = new Float32Array(size * size);

  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  // Get grayscale pixel
  const getGray = (px: number, py: number): number => {
    if (px < 0 || px >= width || py < 0 || py >= height) return 0;
    const idx = (py * width + px) * 4;
    return (data[idx] ?? 0) * 0.299 + (data[idx + 1] ?? 0) * 0.587 + (data[idx + 2] ?? 0) * 0.114;
  };

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx;
      const py = y + dy;
      const localIdx = (dy + radius) * size + (dx + radius);

      // Convolve with Sobel kernels
      let gx = 0,
        gy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const gray = getGray(px + kx, py + ky);
          const ki = (ky + 1) * 3 + (kx + 1);
          gx += gray * (sobelX[ki] ?? 0);
          gy += gray * (sobelY[ki] ?? 0);
        }
      }

      gradX[localIdx] = gx;
      gradY[localIdx] = gy;
      magnitude[localIdx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  return { gradX, gradY, magnitude, width: size, height: size };
}

/**
 * Harris corner detection on gradient data
 */
function detectCorners(
  gradX: Float32Array,
  gradY: Float32Array,
  width: number,
  height: number,
  threshold: number
): Array<{ x: number; y: number; response: number }> {
  const corners: Array<{ x: number; y: number; response: number }> = [];
  const windowSize = 3;
  const k = 0.04; // Harris constant

  for (let y = windowSize; y < height - windowSize; y++) {
    for (let x = windowSize; x < width - windowSize; x++) {
      // Compute structure tensor components in window
      let sumIxIx = 0,
        sumIyIy = 0,
        sumIxIy = 0;

      for (let wy = -windowSize; wy <= windowSize; wy++) {
        for (let wx = -windowSize; wx <= windowSize; wx++) {
          const idx = (y + wy) * width + (x + wx);
          const ix = gradX[idx] ?? 0;
          const iy = gradY[idx] ?? 0;
          sumIxIx += ix * ix;
          sumIyIy += iy * iy;
          sumIxIy += ix * iy;
        }
      }

      // Harris response: det(M) - k * trace(M)^2
      const det = sumIxIx * sumIyIy - sumIxIy * sumIxIy;
      const trace = sumIxIx + sumIyIy;
      const response = det - k * trace * trace;

      if (response > threshold) {
        corners.push({ x, y, response });
      }
    }
  }

  // Sort by response (strongest first)
  corners.sort((a, b) => b.response - a.response);

  return corners;
}

/**
 * Find strong edge points along gradient ridges
 */
function detectEdgePoints(
  magnitude: Float32Array,
  gradX: Float32Array,
  gradY: Float32Array,
  width: number,
  height: number,
  threshold: number
): Array<{ x: number; y: number; strength: number }> {
  const edgePoints: Array<{ x: number; y: number; strength: number }> = [];

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx] ?? 0;

      if (mag < threshold) continue;

      // Non-maximum suppression along gradient direction
      const gx = gradX[idx] ?? 0;
      const gy = gradY[idx] ?? 0;
      const angle = Math.atan2(gy, gx);

      // Sample in gradient direction
      const dx = Math.round(Math.cos(angle));
      const dy = Math.round(Math.sin(angle));

      const idx1 = (y + dy) * width + (x + dx);
      const idx2 = (y - dy) * width + (x - dx);

      const mag1 = magnitude[idx1] ?? 0;
      const mag2 = magnitude[idx2] ?? 0;

      // Is this a local maximum along gradient?
      if (mag >= mag1 && mag >= mag2) {
        edgePoints.push({ x, y, strength: mag });
      }
    }
  }

  // Sort by strength
  edgePoints.sort((a, b) => b.strength - a.strength);

  return edgePoints;
}

// ============================================================================
// ANCHOR DETECTION
// ============================================================================

/**
 * Capture a small template around a point
 */
function captureTemplate(
  imageData: ImageData,
  x: number,
  y: number,
  size: number
): number[] | null {
  const { data, width, height } = imageData;
  const half = Math.floor(size / 2);
  const template: number[] = [];

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;

      if (px < 0 || px >= width || py < 0 || py >= height) {
        return null; // Out of bounds
      }

      const idx = (py * width + px) * 4;
      // Grayscale
      const gray =
        (data[idx] ?? 0) * 0.299 + (data[idx + 1] ?? 0) * 0.587 + (data[idx + 2] ?? 0) * 0.114;
      template.push(gray);
    }
  }

  return template;
}

/**
 * Non-maximum suppression to spread out anchor points
 */
function nonMaximumSuppression(
  points: Array<{ x: number; y: number; score: number }>,
  minSpacing: number,
  maxCount: number
): Array<{ x: number; y: number; score: number }> {
  const selected: Array<{ x: number; y: number; score: number }> = [];

  for (const point of points) {
    // Check if too close to already selected points
    let tooClose = false;
    for (const sel of selected) {
      const dist = Math.hypot(point.x - sel.x, point.y - sel.y);
      if (dist < minSpacing) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      selected.push(point);
      if (selected.length >= maxCount) break;
    }
  }

  return selected;
}

/**
 * Detect anchors around a clicked point on an object
 */
export function detectAnchorsOnObject(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius?: number,
  configOverrides?: Partial<AnchorConfig>
): AnchorDetectionResult {
  const config = resolveAnchorConfig(configOverrides);
  const detectionRadius = radius ?? config.DETECTION_RADIUS;

  // Compute gradients in the search region
  const gradients = computeGradients(
    imageData,
    Math.round(centerX),
    Math.round(centerY),
    detectionRadius
  );

  // Detect corners
  const corners = detectCorners(
    gradients.gradX,
    gradients.gradY,
    gradients.width,
    gradients.height,
    config.CORNER_THRESHOLD
  );

  // Detect edge points
  const edgePoints = detectEdgePoints(
    gradients.magnitude,
    gradients.gradX,
    gradients.gradY,
    gradients.width,
    gradients.height,
    config.EDGE_THRESHOLD
  );

  // Convert local coordinates to global
  const offset = detectionRadius;
  const cornerGlobal = corners.map((c) => ({
    x: centerX - offset + c.x,
    y: centerY - offset + c.y,
    score: c.response
  }));

  const edgeGlobal = edgePoints.map((e) => ({
    x: centerX - offset + e.x,
    y: centerY - offset + e.y,
    score: e.strength
  }));

  // Combine and prioritize corners (more stable), then edges
  const allPoints = [
    ...cornerGlobal.slice(0, 10).map((p) => ({ ...p, score: p.score * 2 })), // Boost corners
    ...edgeGlobal.slice(0, 20)
  ];

  // Always include the center point as an anchor
  allPoints.unshift({ x: centerX, y: centerY, score: Infinity });

  // Apply non-maximum suppression
  const selectedPoints = nonMaximumSuppression(
    allPoints,
    config.MIN_ANCHOR_SPACING,
    config.MAX_ANCHORS
  );

  // Create anchor objects
  const anchors: Anchor[] = selectedPoints.map((point, idx) => {
    const template = captureTemplate(imageData, point.x, point.y, config.ANCHOR_TEMPLATE_SIZE);

    return {
      id: `anchor-${idx}`,
      x: point.x,
      y: point.y,
      prevX: point.x,
      prevY: point.y,
      offsetX: point.x - centerX,
      offsetY: point.y - centerY,
      confidence: 1.0,
      isValid: true,
      template,
      templateSize: config.ANCHOR_TEMPLATE_SIZE
    };
  });

  // Calculate object bounds
  const xs = anchors.map((a) => a.x);
  const ys = anchors.map((a) => a.y);
  const objectBounds = {
    x: Math.min(...xs) - 10,
    y: Math.min(...ys) - 10,
    width: Math.max(...xs) - Math.min(...xs) + 20,
    height: Math.max(...ys) - Math.min(...ys) + 20
  };

  return { anchors, objectBounds };
}

// ============================================================================
// ANCHOR SET MANAGEMENT
// ============================================================================

/**
 * Create an anchor set with pre-computed distance constraints
 */
export function createAnchorSet(anchors: Anchor[], id: string): AnchorSet {
  // Compute expected distances between all anchor pairs
  const expectedDistances = new Map<string, number>();

  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a1 = anchors[i];
      const a2 = anchors[j];
      if (a1 && a2) {
        const key = `${a1.id}-${a2.id}`;
        const dist = Math.hypot(a1.x - a2.x, a1.y - a2.y);
        expectedDistances.set(key, dist);
      }
    }
  }

  // Compute centroid
  const centroidX = anchors.reduce((sum, a) => sum + a.x, 0) / anchors.length;
  const centroidY = anchors.reduce((sum, a) => sum + a.y, 0) / anchors.length;

  return {
    id,
    anchors,
    expectedDistances,
    centroidX,
    centroidY,
    coherenceScore: 1.0,
    survivingCount: anchors.length
  };
}

// ============================================================================
// ANCHOR TRACKING
// ============================================================================

/**
 * Template matching for a single anchor
 */
function matchAnchorTemplate(
  imageData: ImageData,
  anchor: Anchor,
  searchRadius: number,
  minConfidence: number = ANCHOR_CONFIG.MIN_ANCHOR_CONFIDENCE
): { x: number; y: number; confidence: number } | null {
  if (!anchor.template) {
    return null;
  }

  const { data, width, height } = imageData;
  const templateSize = anchor.templateSize;
  const half = Math.floor(templateSize / 2);

  let bestX = anchor.x;
  let bestY = anchor.y;
  let bestScore = -Infinity;

  // Normalize template
  const templateMean = anchor.template.reduce((s, v) => s + v, 0) / anchor.template.length;
  const templateStd = Math.sqrt(
    anchor.template.reduce((s, v) => s + (v - templateMean) ** 2, 0) / anchor.template.length
  );

  if (templateStd < 1) return null; // Flat template

  // Search around predicted position (using velocity if available)
  const searchX = anchor.x;
  const searchY = anchor.y;

  for (let dy = -searchRadius; dy <= searchRadius; dy += 2) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += 2) {
      const cx = Math.round(searchX + dx);
      const cy = Math.round(searchY + dy);

      // Bounds check
      if (cx - half < 0 || cx + half >= width || cy - half < 0 || cy + half >= height) {
        continue;
      }

      // Extract patch and compute NCC
      let patchMean = 0;
      const patch: number[] = [];

      for (let py = -half; py <= half; py++) {
        for (let px = -half; px <= half; px++) {
          const idx = ((cy + py) * width + (cx + px)) * 4;
          const gray =
            (data[idx] ?? 0) * 0.299 + (data[idx + 1] ?? 0) * 0.587 + (data[idx + 2] ?? 0) * 0.114;
          patch.push(gray);
          patchMean += gray;
        }
      }

      patchMean /= patch.length;
      const patchStd = Math.sqrt(
        patch.reduce((s, v) => s + (v - patchMean) ** 2, 0) / patch.length
      );

      if (patchStd < 1) continue; // Flat patch

      // Normalized Cross-Correlation
      let ncc = 0;
      for (let i = 0; i < patch.length; i++) {
        ncc += ((patch[i] ?? 0) - patchMean) * ((anchor.template[i] ?? 0) - templateMean);
      }
      ncc /= patch.length * patchStd * templateStd;

      if (ncc > bestScore) {
        bestScore = ncc;
        bestX = cx;
        bestY = cy;
      }
    }
  }

  // Note: Sub-pixel refinement could be added here with interpolation

  // Convert NCC to confidence
  const confidence = Math.max(0, Math.min(1, (bestScore + 1) / 2));

  if (confidence < minConfidence) {
    return null;
  }

  return { x: bestX, y: bestY, confidence };
}

/**
 * Track all anchors in a set
 */
export function trackAnchors(
  anchorSet: AnchorSet,
  _prevFrame: ImageData, // Reserved for future optical flow integration
  currentFrame: ImageData,
  configOverrides?: Partial<AnchorConfig>
): AnchorSet {
  const config = resolveAnchorConfig(configOverrides);
  const trackedAnchors: Anchor[] = [];

  for (const anchor of anchorSet.anchors) {
    if (!anchor.isValid) {
      trackedAnchors.push({ ...anchor });
      continue;
    }

    const result = matchAnchorTemplate(
      currentFrame,
      anchor,
      config.ANCHOR_SEARCH_RADIUS,
      config.MIN_ANCHOR_CONFIDENCE
    );

    if (result) {
      let updatedTemplate = anchor.template;
      if (result.confidence >= config.TEMPLATE_UPDATE_CONFIDENCE) {
        const newTemplate = captureTemplate(
          currentFrame,
          result.x,
          result.y,
          anchor.templateSize
        );
        if (newTemplate && anchor.template && newTemplate.length === anchor.template.length) {
          const alpha = config.TEMPLATE_UPDATE_ALPHA;
          updatedTemplate = anchor.template.map(
            (val, idx) => val * (1 - alpha) + (newTemplate[idx] ?? 0) * alpha
          );
        }
      }

      trackedAnchors.push({
        ...anchor,
        prevX: anchor.x,
        prevY: anchor.y,
        x: result.x,
        y: result.y,
        confidence: result.confidence,
        isValid: true,
        template: updatedTemplate ?? anchor.template
      });
    } else {
      // Lost this anchor
      trackedAnchors.push({
        ...anchor,
        confidence: 0,
        isValid: false
      });
    }
  }

  // Apply rigid body constraint and compute coherence
  return enforceRigidBodyConstraint(anchorSet, trackedAnchors, config);
}

// ============================================================================
// RIGID BODY CONSTRAINT
// ============================================================================

/**
 * Enforce rigid body constraint and identify outliers
 */
function enforceRigidBodyConstraint(
  originalSet: AnchorSet,
  trackedAnchors: Anchor[],
  config: AnchorConfig
): AnchorSet {
  const validAnchors = trackedAnchors.filter((a) => a.isValid);

  if (validAnchors.length < 2) {
    // Not enough anchors for constraint
    return {
      ...originalSet,
      anchors: trackedAnchors,
      coherenceScore: validAnchors.length > 0 ? 0.5 : 0,
      survivingCount: validAnchors.length
    };
  }

  // Compute current distances and compare to expected
  const distanceErrors: Map<string, number> = new Map();
  let totalError = 0;
  let errorCount = 0;

  for (let i = 0; i < validAnchors.length; i++) {
    for (let j = i + 1; j < validAnchors.length; j++) {
      const a1 = validAnchors[i];
      const a2 = validAnchors[j];
      if (!a1 || !a2) continue;

      const key = `${a1.id}-${a2.id}`;
      const expectedDist = originalSet.expectedDistances.get(key);

      if (expectedDist !== undefined) {
        const currentDist = Math.hypot(a1.x - a2.x, a1.y - a2.y);
        const error = Math.abs(currentDist - expectedDist) / expectedDist;
        distanceErrors.set(key, error);
        totalError += error;
        errorCount++;
      }
    }
  }

  const avgError = errorCount > 0 ? totalError / errorCount : 0;

  // Find outliers (anchors involved in high-error distances)
  const anchorErrorCounts = new Map<string, number>();

  for (const [key, error] of distanceErrors) {
    if (error > config.DISTANCE_TOLERANCE) {
      const [id1, id2] = key.split("-");
      if (id1) anchorErrorCounts.set(id1, (anchorErrorCounts.get(id1) ?? 0) + 1);
      if (id2) anchorErrorCounts.set(id2, (anchorErrorCounts.get(id2) ?? 0) + 1);
    }
  }

  // Mark anchors with multiple high-error distances as invalid
  const finalAnchors = trackedAnchors.map((anchor) => {
    const errorCount = anchorErrorCounts.get(anchor.id) ?? 0;
    const isOutlier = errorCount >= 2; // Involved in 2+ bad distances

    return {
      ...anchor,
      isValid: anchor.isValid && !isOutlier,
      confidence: isOutlier ? anchor.confidence * 0.5 : anchor.confidence
    };
  });

  // Compute coherence score
  const coherenceScore = Math.max(0, 1 - avgError * 2);

  // Compute new centroid from valid anchors
  const stillValid = finalAnchors.filter((a) => a.isValid);
  const centroidX =
    stillValid.length > 0
      ? stillValid.reduce((sum, a) => sum + a.x, 0) / stillValid.length
      : originalSet.centroidX;
  const centroidY =
    stillValid.length > 0
      ? stillValid.reduce((sum, a) => sum + a.y, 0) / stillValid.length
      : originalSet.centroidY;

  return {
    ...originalSet,
    anchors: finalAnchors,
    centroidX,
    centroidY,
    coherenceScore,
    survivingCount: stillValid.length
  };
}

// ============================================================================
// POSITION ESTIMATION
// ============================================================================

/**
 * Estimate object position from anchor consensus
 */
export function estimatePositionFromAnchors(
  anchorSet: AnchorSet,
  mainMarkerX: number,
  mainMarkerY: number,
  configOverrides?: Partial<AnchorConfig>
): { x: number; y: number; confidence: number; useAnchors: boolean } {
  const config = resolveAnchorConfig(configOverrides);
  const validAnchors = anchorSet.anchors.filter((a) => a.isValid);

  // If not enough anchors or low coherence, fall back to main marker
  if (
    validAnchors.length < config.MIN_ANCHORS ||
    anchorSet.coherenceScore < config.MIN_COHERENCE
  ) {
    return {
      x: mainMarkerX,
      y: mainMarkerY,
      confidence: 0.5,
      useAnchors: false
    };
  }

  // Weighted average position based on anchor confidence
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;

  for (const anchor of validAnchors) {
    // Position relative to object center = anchor position - offset
    const estimatedCenterX = anchor.x - anchor.offsetX;
    const estimatedCenterY = anchor.y - anchor.offsetY;

    const weight = anchor.confidence;
    weightedX += estimatedCenterX * weight;
    weightedY += estimatedCenterY * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return { x: mainMarkerX, y: mainMarkerY, confidence: 0.5, useAnchors: false };
  }

  const estimatedX = weightedX / totalWeight;
  const estimatedY = weightedY / totalWeight;

  // Confidence based on coherence and number of surviving anchors
  const anchorRatio = validAnchors.length / anchorSet.anchors.length;
  const confidence = anchorSet.coherenceScore * anchorRatio;

  return {
    x: estimatedX,
    y: estimatedY,
    confidence,
    useAnchors: true
  };
}

/**
 * Blend anchor position with optical flow position
 */
export function blendPositions(
  anchorPosition: { x: number; y: number; confidence: number; useAnchors: boolean },
  opticalFlowPosition: { x: number; y: number; confidence: number },
  anchorWeight: number = 0.6 // How much to trust anchors vs optical flow
): { x: number; y: number; confidence: number } {
  if (!anchorPosition.useAnchors) {
    return opticalFlowPosition;
  }

  // Weighted blend based on both confidence and anchor weight
  const aWeight = anchorPosition.confidence * anchorWeight;
  const oWeight = opticalFlowPosition.confidence * (1 - anchorWeight);
  const totalWeight = aWeight + oWeight;

  if (totalWeight === 0) {
    return opticalFlowPosition;
  }

  return {
    x: (anchorPosition.x * aWeight + opticalFlowPosition.x * oWeight) / totalWeight,
    y: (anchorPosition.y * aWeight + opticalFlowPosition.y * oWeight) / totalWeight,
    confidence: Math.max(anchorPosition.confidence, opticalFlowPosition.confidence)
  };
}

// ============================================================================
// VISUALIZATION HELPERS
// ============================================================================

/**
 * Render anchor visualization on canvas
 */
export function renderAnchors(
  ctx: CanvasRenderingContext2D,
  anchorSet: AnchorSet,
  scaleX: number = 1,
  scaleY: number = 1,
  options: {
    showLines?: boolean;
    anchorColor?: string;
    invalidColor?: string;
    lineColor?: string;
  } = {}
): void {
  const {
    showLines = true,
    anchorColor = "rgba(0, 255, 255, 0.8)",
    invalidColor = "rgba(255, 0, 0, 0.5)",
    lineColor = "rgba(0, 255, 255, 0.3)"
  } = options;

  // Draw lines between anchors
  if (showLines && anchorSet.anchors.length > 1) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;

    for (let i = 0; i < anchorSet.anchors.length; i++) {
      for (let j = i + 1; j < anchorSet.anchors.length; j++) {
        const a1 = anchorSet.anchors[i];
        const a2 = anchorSet.anchors[j];
        if (!a1 || !a2) continue;
        if (!a1.isValid || !a2.isValid) continue;

        ctx.beginPath();
        ctx.moveTo(a1.x * scaleX, a1.y * scaleY);
        ctx.lineTo(a2.x * scaleX, a2.y * scaleY);
        ctx.stroke();
      }
    }
  }

  // Draw anchor points
  for (const anchor of anchorSet.anchors) {
    const x = anchor.x * scaleX;
    const y = anchor.y * scaleY;

    ctx.fillStyle = anchor.isValid ? anchorColor : invalidColor;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Confidence ring
    if (anchor.isValid) {
      ctx.strokeStyle = anchorColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6 + anchor.confidence * 4, 0, Math.PI * 2 * anchor.confidence);
      ctx.stroke();
    }
  }

  // Draw centroid
  ctx.fillStyle = "rgba(255, 255, 0, 0.8)";
  ctx.beginPath();
  ctx.arc(anchorSet.centroidX * scaleX, anchorSet.centroidY * scaleY, 3, 0, Math.PI * 2);
  ctx.fill();
}
