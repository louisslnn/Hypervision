/// <reference lib="webworker" />

export {};

import {
  AnchorConfig,
  AnchorSet,
  ANCHOR_CONFIG,
  estimatePositionFromAnchors,
  trackAnchors
} from "../shared/anchorTracking";
import {
  blendEmbeddings,
  compareEmbeddings,
  computeReIdEmbedding,
  DEFAULT_REID_CONFIG,
  ReIdConfig,
  ReIdEmbedding
} from "./reidEmbedding";

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
  reidEmbedding?: ReIdEmbedding | null;
  lastEmbeddingUpdate?: number;
  template?: Uint8Array | null;
  templateSize?: number;
  templateMean?: number;
  templateStd?: number;
  lastTemplateUpdate?: number;
  visualKeypoints?: Point[] | null;
  visualDescriptors?: number[] | null;
  visualDescriptorRows?: number;
  visualDescriptorCols?: number;
  visualRoiCenter?: Point | null;
  visualRoiSize?: number;
  visualHist?: number[] | null;
  dnaTemplate?: Uint8Array | null;
  dnaTemplateMean?: number;
  dnaTemplateStd?: number;
  reidCandidate?: Point | null;
  reidCandidateFrames?: number;
  templateMismatchFrames?: number;
  framesTracked?: number;
  bboxWidth?: number;
  bboxHeight?: number;
  bboxConfidence?: number;
  objectDescription?: string;
  visualFeatures?: string;
  lastAIValidation?: number;
  aiConfidence?: number;
  referenceImage?: string;
  pendingAIValidation?: boolean;
  pendingAIReacquisition?: boolean;
  aiValidationStrikes?: number;
  anchorSet?: AnchorSet | undefined;
  useAnchors?: boolean | undefined;
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
  labelStatus?: LabelStatus;
  objectDescription?: string;
  visualFeatures?: string;
  referenceImage?: string;
  lastAIValidation?: number;
  aiConfidence?: number;
  anchorSet?: AnchorSet | undefined;
  useAnchors?: boolean | undefined;
  centroidX?: number | undefined;
  centroidY?: number | undefined;
  prevCentroidX?: number | undefined;
  prevCentroidY?: number | undefined;
}

interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface Detection {
  id: string;
  class: string;
  label: string;
  confidence: number;
  bbox: BoundingBox;
}

interface FlowConfig {
  SEARCH_RADIUS: number;
  SAMPLE_RADIUS: number;
  SAMPLE_STEP: number;
  MIN_FLOW_CONFIDENCE: number;
  FORWARD_BACKWARD_THRESHOLD: number;
  BOUNDARY_GUARD: number;
  GRADIENT_SAMPLE_RADIUS: number;
  EDGE_WEIGHT: number;
  LOST_SCORE_THRESHOLD: number;
}

type GlobalMotion = {
  dx: number;
  dy: number;
  confidence: number;
};

type GlobalMotionConfig = {
  GRID_X: number;
  GRID_Y: number;
  PATCH_SIZE: number;
  SEARCH_RADIUS: number;
  STEP: number;
  MIN_CONFIDENCE: number;
};

type MotionPrediction = {
  x: number;
  y: number;
  velocityScale: number;
  globalDx: number;
  globalDy: number;
};

type TrackingCandidateSource = keyof typeof SOURCE_WEIGHTS;

type TrackingCandidate = {
  x: number;
  y: number;
  confidence: number;
  source: TrackingCandidateSource;
};

const CONFIG = {
  SEARCH_RADIUS: 65,
  SAMPLE_RADIUS: 22,
  SAMPLE_STEP: 2,
  MIN_FLOW_CONFIDENCE: 0.25,
  FORWARD_BACKWARD_THRESHOLD: 6.0,
  MULTI_SCALE_FACTORS: [0.8, 1.0, 1.2],
  OCCLUSION_SCORE_THRESHOLD: 4000,
  LOST_SCORE_THRESHOLD: 12000,
  OCCLUSION_TIMEOUT: 20,
  LOST_TIMEOUT: 240,
  BOUNDARY_GUARD: 15,
  KALMAN_PROCESS_NOISE: 0.6,
  KALMAN_MEASUREMENT_NOISE: 0.15,
  SMOOTHING_FACTOR: 0.35,
  COLOR_SAMPLE_SIZE: 48,
  COLOR_MATCH_THRESHOLD: 0.45,
  EDGE_WEIGHT: 0.5,
  GRADIENT_SAMPLE_RADIUS: 24,
  TRAIL_LENGTH: 80
};

const TEMPLATE_CONFIG = {
  SIZE: 25,
  MIN_NCC: 0.5,
  UPDATE_INTERVAL_MS: 350,
  UPDATE_CONFIDENCE: 0.7,
  UPDATE_ALPHA: 0.25,
  COARSE_STEP: 3,
  REFINE_RADIUS: 8
};

const GLOBAL_MOTION_CONFIG = {
  GRID_X: 5,
  GRID_Y: 3,
  PATCH_SIZE: 15,
  SEARCH_RADIUS: 18,
  STEP: 2,
  MIN_CONFIDENCE: 0.35
};

const FUSION_CONFIG = {
  MIN_CONFIDENCE: 0.3,
  GATING_FACTOR: 1.0
};

const SOURCE_WEIGHTS = {
  flow: 1,
  yolo: 0.9,
  template: 0.95,
  anchor: 1.05,
  orb: 1.1
} as const;

const REID_UPDATE_INTERVAL_MS = 1200;

const DNA_CONFIG = {
  ROI_SIZE: 120,
  ORB_FEATURES: 200,
  HSV_BINS_H: 12,
  HSV_BINS_S: 6,
  COLOR_SIM_THRESHOLD: 0.28,
  LOWE_RATIO: 0.75,
  MIN_RANSAC_INLIERS: 6,
  RANSAC_REPROJ_THRESHOLD: 5.0,
  EDGE_STRIDE: 32,
  EDGE_MARGIN: 80,
  LOCAL_ROI_SCALE: 2.2,
  FULL_ROI_SCALE: 3.0,
  REID_CONFIRM_FRAMES: 2,
  REID_CONFIRM_RADIUS: 12,
  DRIFT_CHECK_INTERVAL: 20,
  LOW_VELOCITY_THRESHOLD: 2.0
} as const;

const getScaledGlobalMotionConfig = (scale: number): GlobalMotionConfig => {
  const radiusScale = Math.max(0.5, Math.min(1, scale));
  return {
    GRID_X: GLOBAL_MOTION_CONFIG.GRID_X,
    GRID_Y: GLOBAL_MOTION_CONFIG.GRID_Y,
    PATCH_SIZE: ensureOdd(Math.max(9, Math.round(GLOBAL_MOTION_CONFIG.PATCH_SIZE * radiusScale))),
    SEARCH_RADIUS: Math.max(6, Math.round(GLOBAL_MOTION_CONFIG.SEARCH_RADIUS * radiusScale)),
    STEP: Math.max(2, Math.round(GLOBAL_MOTION_CONFIG.STEP * radiusScale)),
    MIN_CONFIDENCE: GLOBAL_MOTION_CONFIG.MIN_CONFIDENCE
  };
};

type OpenCvModule = typeof self & {
  cv?: {
    Mat: new (...args: unknown[]) => {
      delete: () => void;
      rows: number;
      cols: number;
      data32F: Float32Array;
      data: Uint8Array;
      data64F?: Float64Array;
      roi: (rect: { x: number; y: number; width: number; height: number }) => any;
      empty: () => boolean;
    };
    matFromImageData: (data: ImageData) => any;
    cvtColor: (src: any, dst: any, code: number) => void;
    COLOR_RGBA2GRAY: number;
    goodFeaturesToTrack: (
      image: any,
      corners: any,
      maxCorners: number,
      qualityLevel: number,
      minDistance: number
    ) => void;
    calcOpticalFlowPyrLK: (
      prevImg: any,
      nextImg: any,
      prevPts: any,
      nextPts: any,
      status: any,
      err: any,
      winSize: { width: number; height: number },
      maxLevel: number,
      criteria: { type: number; maxCount: number; epsilon: number }
    ) => void;
    TERM_CRITERIA_EPS: number;
    TERM_CRITERIA_COUNT: number;
    CV_32FC2: number;
    CV_8U?: number;
    NORM_HAMMING?: number;
    ORB_create?: (nfeatures?: number) => {
      detectAndCompute: (image: any, mask: any, keypoints: any, descriptors: any) => void;
    };
    ORB?: new () => {
      detectAndCompute: (image: any, mask: any, keypoints: any, descriptors: any) => void;
    };
    BFMatcher?: new (normType: number, crossCheck: boolean) => {
      knnMatch: (queryDescriptors: any, trainDescriptors: any, matches: any, k: number) => void;
    };
    KeyPointVector?: new () => {
      size: () => number;
      get: (index: number) => { pt: { x: number; y: number } };
      delete: () => void;
    };
    DMatchVectorVector?: new () => {
      size: () => number;
      get: (index: number) => any;
      delete: () => void;
    };
    DMatchVector?: new () => {
      size: () => number;
      get: (index: number) => { distance: number; queryIdx: number; trainIdx: number };
      delete: () => void;
    };
    findHomography?: (
      srcPoints: any,
      dstPoints: any,
      method: number,
      ransacReprojThreshold: number,
      mask?: any
    ) => any;
    perspectiveTransform?: (src: any, dst: any, homography: any) => void;
    estimateAffinePartial2D?: (
      from: any,
      to: any,
      inliers: any,
      method: number,
      ransacReprojThreshold: number,
      maxIters: number,
      confidence: number,
      refineIters: number
    ) => any;
    RANSAC?: number;
    Size: new (w: number, h: number) => { width: number; height: number };
  };
};

const OPENCV_SCRIPT_LOCAL = "/opencv/opencv.js";
// Multiple CDN fallbacks for OpenCV
const OPENCV_CDN_URLS = [
  "https://docs.opencv.org/4.9.0/opencv.js",
  "https://docs.opencv.org/4.8.0/opencv.js",
  "https://docs.opencv.org/4.7.0/opencv.js"
];

const formatOpenCvError = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const getWorkerOrigin = () => {
  if (typeof self === "undefined" || !("location" in self)) return "";
  const origin = self.location?.origin;
  if (origin && origin !== "null") return origin;
  const href = self.location?.href ?? "";
  const match = href.match(/^(?:blob:)?(https?:\/\/[^/]+)/i);
  return match?.[1] ?? "";
};

const getLocalOpenCvUrl = () => {
  const origin = getWorkerOrigin();
  return origin ? `${origin}${OPENCV_SCRIPT_LOCAL}` : "";
};

const importOpenCvScript = (url: string) => {
  if (!url) {
    throw new Error("OpenCV script URL unavailable");
  }
  if (typeof importScripts !== "function") {
    throw new Error("importScripts unavailable in this worker context");
  }
  importScripts(url);
};

const loadOpenCvScripts = () => {
  const errors: string[] = [];
  const localUrl = getLocalOpenCvUrl();

  // Try local first
  if (localUrl) {
    try {
      importOpenCvScript(localUrl);
      console.log("[MedSync Worker] ✅ Loaded OpenCV from local:", localUrl);
      return;
    } catch (err) {
      const message = formatOpenCvError(err);
      console.warn("[MedSync Worker] Failed to load local OpenCV:", err);
      errors.push(`local (${localUrl}): ${message}`);
    }
  }

  // Try CDN URLs in order
  for (const cdnUrl of OPENCV_CDN_URLS) {
    try {
      importOpenCvScript(cdnUrl);
      console.log("[MedSync Worker] ✅ Loaded OpenCV from CDN:", cdnUrl);
      return;
    } catch (err) {
      const message = formatOpenCvError(err);
      console.warn(`[MedSync Worker] Failed to load OpenCV from ${cdnUrl}:`, err);
      errors.push(`cdn (${cdnUrl}): ${message}`);
    }
  }

  throw new Error(`OpenCV load failed after trying all sources: ${errors.join(" | ")}`);
};

let cvReady = false;
let cvLoading: Promise<OpenCvModule["cv"]> | null = null;
let openCvLastError: string | null = null;
let openCvEnabled = false;
let orbDetector: { detectAndCompute: (image: any, mask: any, keypoints: any, descriptors: any) => void } | null =
  null;
let orbMatcher: { knnMatch: (queryDescriptors: any, trainDescriptors: any, matches: any, k: number) => void } | null =
  null;

const ensureOpenCv = async (): Promise<OpenCvModule["cv"] | null> => {
  if (!openCvEnabled) {
    console.log("[MedSync Worker] OpenCV disabled");
    return null;
  }

  const existingCv = (self as OpenCvModule).cv;
  if (existingCv?.Mat) {
    cvReady = true;
    console.log("[MedSync Worker] OpenCV already loaded");
    return existingCv;
  }

  if (!cvLoading) {
    openCvLastError = null;
    console.log("[MedSync Worker] Starting OpenCV load...");
    
    cvLoading = new Promise((resolve, reject) => {
      try {
        loadOpenCvScripts();
      } catch (err) {
        console.error("[MedSync Worker] Script load failed:", err);
        reject(err);
        return;
      }

      const cv = (self as OpenCvModule).cv;
      if (!cv) {
        const error = new Error("OpenCV did not load - cv object not found");
        console.error("[MedSync Worker]", error.message);
        reject(error);
        return;
      }
      
      // Check if already initialized
      if (cv.Mat) {
        cvReady = true;
        console.log("[MedSync Worker] ✅ OpenCV initialized immediately");
        resolve(cv);
        return;
      }
      
      // Wait for runtime initialization with timeout
      console.log("[MedSync Worker] Waiting for OpenCV runtime initialization...");
      const timeout = setTimeout(() => {
        const error = new Error("OpenCV runtime initialization timed out after 30s");
        console.error("[MedSync Worker]", error.message);
        reject(error);
      }, 30000);
      
      (cv as OpenCvModule["cv"] & { onRuntimeInitialized?: () => void }).onRuntimeInitialized =
        () => {
          clearTimeout(timeout);
          cvReady = true;
          console.log("[MedSync Worker] ✅ OpenCV runtime initialized");
          resolve(cv);
        };
    });
  }

  try {
    return await cvLoading;
  } catch (err) {
    openCvLastError = formatOpenCvError(err);
    console.error("[MedSync Worker] OpenCV load error:", openCvLastError);
    return null;
  }
};

const ensureOrbResources = (cv: OpenCvModule["cv"]) => {
  if (!cv) return null;
  if (!orbDetector) {
    orbDetector = createOrbDetector(cv);
  }
  if (!orbMatcher && cv.BFMatcher && typeof cv.NORM_HAMMING === "number") {
    orbMatcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  }
  if (!orbDetector || !orbMatcher) return null;
  return { orb: orbDetector, matcher: orbMatcher };
};

interface YoloTrackerMatch {
  trackerId: string;
  detection: Detection;
  iou: number;
  centerDistance: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const ensureOdd = (value: number) => (value % 2 === 0 ? value + 1 : value);

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

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

  const d_x1 = detection.bbox.x1 * canvasWidth;
  const d_y1 = detection.bbox.y1 * canvasHeight;
  const d_x2 = detection.bbox.x2 * canvasWidth;
  const d_y2 = detection.bbox.y2 * canvasHeight;

  const inter_x1 = Math.max(t_x1, d_x1);
  const inter_y1 = Math.max(t_y1, d_y1);
  const inter_x2 = Math.min(t_x2, d_x2);
  const inter_y2 = Math.min(t_y2, d_y2);

  const inter_w = Math.max(0, inter_x2 - inter_x1);
  const inter_h = Math.max(0, inter_y2 - inter_y1);
  const inter_area = inter_w * inter_h;

  const tracker_area = trackerWidth * trackerHeight;
  const detection_area = (d_x2 - d_x1) * (d_y2 - d_y1);
  const union_area = tracker_area + detection_area - inter_area;

  return union_area > 0 ? inter_area / union_area : 0;
}

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

function getUnmatchedDetections(detections: Detection[], matches: YoloTrackerMatch[]): Detection[] {
  const matchedDetectionIds = new Set(matches.map((m) => m.detection.id));
  return detections.filter((d) => !matchedDetectionIds.has(d.id));
}

function captureColorSignature(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  sampleRadius: number = CONFIG.COLOR_SAMPLE_SIZE
): number[] {
  const signature: number[] = new Array(48).fill(0);
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

      const hBucket = Math.min(15, Math.floor(h / 22.5));
      const sBucket = Math.min(15, Math.floor(s * 16));
      const vBucket = Math.min(15, Math.floor(v * 16));

      const hIdx = hBucket;
      const sIdx = 16 + sBucket;
      const vIdx = 32 + vBucket;
      signature[hIdx] = (signature[hIdx] ?? 0) + 1;
      signature[sIdx] = (signature[sIdx] ?? 0) + 1;
      signature[vIdx] = (signature[vIdx] ?? 0) + 1;
      samples++;
    }
  }

  if (samples > 0) {
    for (let i = 0; i < signature.length; i++) {
      signature[i] = (signature[i] ?? 0) / samples;
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

      const idxLeft = (py * width + px - 1) * 4;
      const idxRight = (py * width + px + 1) * 4;
      const idxTop = ((py - 1) * width + px) * 4;
      const idxBottom = ((py + 1) * width + px) * 4;

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

  if (norm1 === 0 || norm2 === 0) return sum / grad1.length;
  return sum / Math.sqrt(norm1 * norm2);
}

function captureTemplate(
  frame: ImageData,
  centerX: number,
  centerY: number,
  size: number
): Uint8Array | null {
  const half = Math.floor(size / 2);
  if (
    centerX < half ||
    centerX >= frame.width - half ||
    centerY < half ||
    centerY >= frame.height - half
  ) {
    return null;
  }

  const template = new Uint8Array(size * size);
  const data = frame.data;
  let idx = 0;

  for (let y = -half; y <= half; y++) {
    for (let x = -half; x <= half; x++) {
      const px = Math.round(centerX + x);
      const py = Math.round(centerY + y);
      const offset = (py * frame.width + px) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      template[idx++] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  return template;
}

function computeTemplateStats(template: Uint8Array): { mean: number; std: number } {
  if (!template.length) return { mean: 0, std: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < template.length; i++) {
    const v = template[i] ?? 0;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / template.length;
  const variance = Math.max(0, sumSq / template.length - mean * mean);
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
  if (
    centerX < half ||
    centerX >= frame.width - half ||
    centerY < half ||
    centerY >= frame.height - half
  ) {
    return null;
  }

  const data = frame.data;
  const count = size * size;
  let sum = 0;
  let sumSq = 0;

  for (let y = -half; y <= half; y++) {
    for (let x = -half; x <= half; x++) {
      const px = Math.round(centerX + x);
      const py = Math.round(centerY + y);
      const offset = (py * frame.width + px) * 4;
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
  for (let y = -half; y <= half; y++) {
    for (let x = -half; x <= half; x++) {
      const px = Math.round(centerX + x);
      const py = Math.round(centerY + y);
      const offset = (py * frame.width + px) * 4;
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

  const refineRadius = Math.min(TEMPLATE_CONFIG.REFINE_RADIUS, boundedRadius);
  for (let y = bestY - refineRadius; y <= bestY + refineRadius; y += 1) {
    for (let x = bestX - refineRadius; x <= bestX + refineRadius; x += 1) {
      if (
        x < half ||
        x >= width - half ||
        y < half ||
        y >= height - half
      ) {
        continue;
      }
      const ncc = computeNccAt(frame, x, y, size, template, templateStats);
      if (ncc === null) continue;
      if (ncc > bestScore) {
        bestScore = ncc;
        bestX = x;
        bestY = y;
      }
    }
  }

  const confidence = clamp((bestScore + 1) / 2, 0, 1);
  return { x: bestX, y: bestY, score: bestScore, confidence };
}

function blendTemplate(
  existing: Uint8Array,
  update: Uint8Array,
  alpha: number
): Uint8Array {
  const blended = new Uint8Array(existing.length);
  const mix = clamp(alpha, 0, 1);
  for (let i = 0; i < existing.length; i++) {
    blended[i] = Math.round(existing[i] * (1 - mix) + (update[i] ?? 0) * mix);
  }
  return blended;
}

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

const computeHsvHistogram = (
  frame: ImageData,
  centerX: number,
  centerY: number,
  roiSize: number,
  binsH: number,
  binsS: number
): number[] | null => {
  const half = Math.floor(roiSize / 2);
  const x1 = clamp(Math.round(centerX - half), 0, frame.width - 1);
  const y1 = clamp(Math.round(centerY - half), 0, frame.height - 1);
  const x2 = clamp(Math.round(centerX + half), 0, frame.width - 1);
  const y2 = clamp(Math.round(centerY + half), 0, frame.height - 1);
  const hist = new Array(binsH * binsS).fill(0);

  let samples = 0;
  const step = Math.max(1, Math.round(roiSize / 40));
  for (let y = y1; y <= y2; y += step) {
    for (let x = x1; x <= x2; x += step) {
      const idx = (y * frame.width + x) * 4;
      const r = frame.data[idx] ?? 0;
      const g = frame.data[idx + 1] ?? 0;
      const b = frame.data[idx + 2] ?? 0;
      const hsv = rgbToHsv(r, g, b);
      const hBin = Math.min(binsH - 1, Math.floor((hsv.h / 360) * binsH));
      const sBin = Math.min(binsS - 1, Math.floor(hsv.s * binsS));
      hist[sBin * binsH + hBin] += 1;
      samples++;
    }
  }

  if (samples === 0) return null;
  for (let i = 0; i < hist.length; i++) {
    hist[i] = hist[i] / samples;
  }
  return hist;
};

const compareHistogram = (a: number[] | null, b: number[] | null): number => {
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

const blendHistogram = (base: number[], update: number[], alpha: number): number[] => {
  const clampedAlpha = clamp(alpha, 0, 1);
  const blended = base.map((value, index) => value * (1 - clampedAlpha) + (update[index] ?? 0) * clampedAlpha);
  const sum = blended.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return blended;
  return blended.map((value) => value / sum);
};

const getHistogramSimilarity = (
  tracker: Tracker,
  frame: ImageData,
  centerX: number,
  centerY: number,
  roiSize: number
): number => {
  if (!tracker.visualHist) return 1;
  const hist = computeHsvHistogram(
    frame,
    centerX,
    centerY,
    roiSize,
    DNA_CONFIG.HSV_BINS_H,
    DNA_CONFIG.HSV_BINS_S
  );
  if (!hist) return 0;
  return compareHistogram(tracker.visualHist, hist);
};

const createOrbDetector = (cv: OpenCvModule["cv"]) => {
  if (!cv) return null;
  if (cv.ORB_create) return cv.ORB_create(DNA_CONFIG.ORB_FEATURES);
  if (cv.ORB) return new cv.ORB();
  return null;
};

const buildDescriptorMat = (
  cv: OpenCvModule["cv"],
  descriptors: number[],
  rows: number,
  cols: number
) => {
  if (!cv || !descriptors.length || rows <= 0 || cols <= 0) return null;
  const type = cv.CV_8U ?? 0;
  return cv.matFromArray(rows, cols, type, descriptors);
};

const extractOrbFeatures = (
  cv: OpenCvModule["cv"],
  orb: { detectAndCompute: (image: any, mask: any, keypoints: any, descriptors: any) => void },
  gray: any,
  centerX: number,
  centerY: number,
  roiSize: number
): {
  keypoints: Point[];
  descriptors: number[];
  descriptorRows: number;
  descriptorCols: number;
  roiCenter: Point;
  roiSize: number;
  roiOffset: Point;
} | null => {
  if (!cv || !orb || !gray) return null;

  const half = Math.floor(roiSize / 2);
  const x1 = clamp(Math.round(centerX - half), 0, gray.cols - 1);
  const y1 = clamp(Math.round(centerY - half), 0, gray.rows - 1);
  const x2 = clamp(Math.round(centerX + half), 0, gray.cols - 1);
  const y2 = clamp(Math.round(centerY + half), 0, gray.rows - 1);
  const width = Math.max(2, x2 - x1);
  const height = Math.max(2, y2 - y1);
  if (width < 12 || height < 12) return null;

  const roi = gray.roi({ x: x1, y: y1, width, height });
  const keypoints = cv.KeyPointVector ? new cv.KeyPointVector() : null;
  const descriptors = new cv.Mat();
  const mask = new cv.Mat();

  if (!keypoints) {
    roi.delete();
    descriptors.delete();
    mask.delete();
    return null;
  }

  orb.detectAndCompute(roi, mask, keypoints, descriptors);

  if (!descriptors.rows || descriptors.rows < 4) {
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  const kpCount = Math.min(keypoints.size(), DNA_CONFIG.ORB_FEATURES);
  const kpList: Point[] = [];
  for (let i = 0; i < kpCount; i++) {
    const kp = keypoints.get(i);
    kpList.push({ x: kp.pt.x, y: kp.pt.y });
  }

  const descArray = Array.from(descriptors.data as Uint8Array);
  const result = {
    keypoints: kpList,
    descriptors: descArray,
    descriptorRows: descriptors.rows,
    descriptorCols: descriptors.cols,
    roiCenter: { x: centerX - x1, y: centerY - y1 },
    roiSize: Math.max(width, height),
    roiOffset: { x: x1, y: y1 }
  };

  keypoints.delete();
  descriptors.delete();
  mask.delete();
  roi.delete();
  return result;
};

const matchOrbAndLocalize = (
  cv: OpenCvModule["cv"],
  orb: { detectAndCompute: (image: any, mask: any, keypoints: any, descriptors: any) => void },
  matcher: { knnMatch: (queryDescriptors: any, trainDescriptors: any, matches: any, k: number) => void },
  gray: any,
  roiRect: { x: number; y: number; width: number; height: number },
  dna: Tracker
): { x: number; y: number; confidence: number; inliers: number } | null => {
  if (!cv || !orb || !matcher || !gray) return null;
  if (!dna.visualDescriptors || !dna.visualDescriptorRows || !dna.visualDescriptorCols || !dna.visualKeypoints) {
    return null;
  }
  if (!cv.findHomography || !cv.perspectiveTransform) return null;

  const roi = gray.roi(roiRect);
  const keypoints = cv.KeyPointVector ? new cv.KeyPointVector() : null;
  const descriptors = new cv.Mat();
  const mask = new cv.Mat();

  if (!keypoints) {
    roi.delete();
    descriptors.delete();
    mask.delete();
    return null;
  }

  orb.detectAndCompute(roi, mask, keypoints, descriptors);
  if (!descriptors.rows || descriptors.rows < 4) {
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  const dnaMat = buildDescriptorMat(
    cv,
    dna.visualDescriptors,
    dna.visualDescriptorRows,
    dna.visualDescriptorCols
  );
  if (!dnaMat) {
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  const matchesVec = cv.DMatchVectorVector ? new cv.DMatchVectorVector() : null;
  if (!matchesVec) {
    dnaMat.delete();
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  matcher.knnMatch(dnaMat, descriptors, matchesVec, 2);

  const goodMatches: Array<{ queryIdx: number; trainIdx: number }> = [];
  for (let i = 0; i < matchesVec.size(); i++) {
    const matchVec = matchesVec.get(i);
    if (!matchVec || matchVec.size() < 2) continue;
    const m0 = matchVec.get(0);
    const m1 = matchVec.get(1);
    if (!m0 || !m1) continue;
    if (m0.distance < DNA_CONFIG.LOWE_RATIO * m1.distance) {
      goodMatches.push({ queryIdx: m0.queryIdx, trainIdx: m0.trainIdx });
    }
    matchVec.delete?.();
  }

  if (goodMatches.length < 4) {
    matchesVec.delete();
    dnaMat.delete();
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  const srcPts: number[] = [];
  const dstPts: number[] = [];
  for (const match of goodMatches) {
    const src = dna.visualKeypoints[match.queryIdx];
    if (!src) continue;
    const dstKp = keypoints.get(match.trainIdx);
    if (!dstKp) continue;
    srcPts.push(src.x, src.y);
    dstPts.push(dstKp.pt.x, dstKp.pt.y);
  }

  if (srcPts.length < 8 || dstPts.length < 8) {
    matchesVec.delete();
    dnaMat.delete();
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  const srcMat = cv.matFromArray(srcPts.length / 2, 1, cv.CV_32FC2, srcPts);
  const dstMat = cv.matFromArray(dstPts.length / 2, 1, cv.CV_32FC2, dstPts);
  const inlierMask = new cv.Mat();
  const homography = cv.findHomography(
    srcMat,
    dstMat,
    cv.RANSAC ?? 8,
    DNA_CONFIG.RANSAC_REPROJ_THRESHOLD,
    inlierMask
  );

  if (!homography || homography.empty()) {
    srcMat.delete();
    dstMat.delete();
    inlierMask.delete();
    matchesVec.delete();
    dnaMat.delete();
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  let inliers = 0;
  for (let i = 0; i < inlierMask.rows; i++) {
    if ((inlierMask.data[i] ?? 0) === 1) inliers++;
  }

  if (inliers < DNA_CONFIG.MIN_RANSAC_INLIERS) {
    homography.delete();
    srcMat.delete();
    dstMat.delete();
    inlierMask.delete();
    matchesVec.delete();
    dnaMat.delete();
    keypoints.delete();
    descriptors.delete();
    mask.delete();
    roi.delete();
    return null;
  }

  const roiCenter = dna.visualRoiCenter ?? { x: roiRect.width / 2, y: roiRect.height / 2 };
  const centerMat = cv.matFromArray(1, 1, cv.CV_32FC2, [roiCenter.x, roiCenter.y]);
  const centerOut = new cv.Mat();
  cv.perspectiveTransform(centerMat, centerOut, homography);
  const outX = centerOut.data32F[0] ?? 0;
  const outY = centerOut.data32F[1] ?? 0;

  const confidence = Math.min(1, inliers / 20);
  const result = {
    x: roiRect.x + outX,
    y: roiRect.y + outY,
    confidence,
    inliers
  };

  centerMat.delete();
  centerOut.delete();
  homography.delete();
  srcMat.delete();
  dstMat.delete();
  inlierMask.delete();
  matchesVec.delete();
  dnaMat.delete();
  keypoints.delete();
  descriptors.delete();
  mask.delete();
  roi.delete();
  return result;
};

const buildRoiFromCenter = (
  centerX: number,
  centerY: number,
  roiSize: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } => {
  const half = Math.floor(roiSize / 2);
  const x1 = clamp(Math.round(centerX - half), 0, width - 1);
  const y1 = clamp(Math.round(centerY - half), 0, height - 1);
  const x2 = clamp(Math.round(centerX + half), 0, width - 1);
  const y2 = clamp(Math.round(centerY + half), 0, height - 1);
  return { x: x1, y: y1, width: Math.max(2, x2 - x1), height: Math.max(2, y2 - y1) };
};

const confirmReidCandidate = (
  tracker: Tracker,
  candidate: Point,
  candidateConfidence: number
): { confirmed: boolean; nextCandidate: Point | null; nextFrames: number } => {
  const baseDist = Math.max(DNA_CONFIG.ROI_SIZE, tracker.visualRoiSize ?? DNA_CONFIG.ROI_SIZE);
  const allowed =
    baseDist + (tracker.framesLost + tracker.framesOccluded) * 4;
  const dist = Math.hypot(
    candidate.x - tracker.lastGoodPosition.x,
    candidate.y - tracker.lastGoodPosition.y
  );

  if (dist > allowed && candidateConfidence < 0.85) {
    return { confirmed: false, nextCandidate: tracker.reidCandidate ?? null, nextFrames: tracker.reidCandidateFrames ?? 0 };
  }

  if (!tracker.reidCandidate) {
    return { confirmed: false, nextCandidate: candidate, nextFrames: 1 };
  }

  const prev = tracker.reidCandidate;
  const stepDist = Math.hypot(candidate.x - prev.x, candidate.y - prev.y);
  if (stepDist <= DNA_CONFIG.REID_CONFIRM_RADIUS) {
    const frames = (tracker.reidCandidateFrames ?? 0) + 1;
    if (frames >= DNA_CONFIG.REID_CONFIRM_FRAMES) {
      return { confirmed: true, nextCandidate: null, nextFrames: 0 };
    }
    return { confirmed: false, nextCandidate: candidate, nextFrames: frames };
  }

  return { confirmed: false, nextCandidate: candidate, nextFrames: 1 };
};

type OrbMatch = { x: number; y: number; confidence: number; inliers: number };

const pickBestOrbMatch = (current: OrbMatch | null, candidate: OrbMatch | null): OrbMatch | null => {
  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate.confidence > current.confidence + 0.05) return candidate;
  if (Math.abs(candidate.confidence - current.confidence) <= 0.05 && candidate.inliers > current.inliers) {
    return candidate;
  }
  return current;
};

const buildOrbCandidate = (
  tracker: Tracker,
  frame: ImageData,
  match: { x: number; y: number; confidence: number; inliers: number },
  baseRoiSize: number,
  minColorSimilarity: number
): OrbMatch | null => {
  const histScore = getHistogramSimilarity(tracker, frame, match.x, match.y, baseRoiSize);
  if (tracker.visualHist && histScore < minColorSimilarity) return null;
  const confidence = clamp(match.confidence * (0.7 + histScore * 0.3), 0, 1);
  return { x: match.x, y: match.y, confidence, inliers: match.inliers };
};

const runOrbDriftCheck = (options: {
  tracker: Tracker;
  frame: ImageData;
  gray: any;
  cv: OpenCvModule["cv"];
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}): OrbMatch | null => {
  const { tracker, frame, gray, cv, width, height, centerX, centerY } = options;
  if (!tracker.visualDescriptors || !tracker.visualKeypoints) return null;
  const resources = ensureOrbResources(cv);
  if (!resources) return null;

  const baseRoiSize = Math.max(DNA_CONFIG.ROI_SIZE, tracker.visualRoiSize ?? DNA_CONFIG.ROI_SIZE);
  const roiSize = Math.round(baseRoiSize * DNA_CONFIG.LOCAL_ROI_SCALE);
  const roiRect = buildRoiFromCenter(centerX, centerY, roiSize, width, height);
  const match = matchOrbAndLocalize(cv, resources.orb, resources.matcher, gray, roiRect, tracker);
  if (!match) return null;
  return buildOrbCandidate(tracker, frame, match, baseRoiSize, DNA_CONFIG.COLOR_SIM_THRESHOLD * 0.8);
};

const runOrbReidSearch = (options: {
  tracker: Tracker;
  frame: ImageData;
  gray: any;
  cv: OpenCvModule["cv"];
  width: number;
  height: number;
  globalMotion: GlobalMotion;
  framesLost: number;
}): OrbMatch | null => {
  const { tracker, frame, gray, cv, width, height, globalMotion, framesLost } = options;
  if (!tracker.visualDescriptors || !tracker.visualKeypoints) return null;
  const resources = ensureOrbResources(cv);
  if (!resources) return null;

  const baseRoiSize = Math.max(DNA_CONFIG.ROI_SIZE, tracker.visualRoiSize ?? DNA_CONFIG.ROI_SIZE);
  const scaleBoost = clamp(1 + framesLost * 0.04, 1, 2.2);
  const localRoiSize = Math.round(baseRoiSize * DNA_CONFIG.LOCAL_ROI_SCALE * scaleBoost);
  const fullRoiSize = Math.round(baseRoiSize * DNA_CONFIG.FULL_ROI_SCALE * scaleBoost);
  const centerX = tracker.lastGoodPosition.x + globalMotion.dx;
  const centerY = tracker.lastGoodPosition.y + globalMotion.dy;

  let best: OrbMatch | null = null;

  const localRect = buildRoiFromCenter(centerX, centerY, localRoiSize, width, height);
  const localMatch = matchOrbAndLocalize(cv, resources.orb, resources.matcher, gray, localRect, tracker);
  best = pickBestOrbMatch(
    best,
    localMatch ? buildOrbCandidate(tracker, frame, localMatch, baseRoiSize, DNA_CONFIG.COLOR_SIM_THRESHOLD * 0.75) : null
  );

  const shouldEdgeSearch = framesLost % 6 === 0 || framesLost <= 2;
  if (shouldEdgeSearch) {
    const margin = Math.min(DNA_CONFIG.EDGE_MARGIN, Math.floor(Math.min(width, height) * 0.25));
    const stride = Math.max(20, DNA_CONFIG.EDGE_STRIDE);
    const maxCenters = 28;
    let count = 0;

    for (let x = margin; x <= width - margin; x += stride) {
      if (count >= maxCenters) break;
      const topRect = buildRoiFromCenter(x, margin, fullRoiSize, width, height);
      const topMatch = matchOrbAndLocalize(cv, resources.orb, resources.matcher, gray, topRect, tracker);
      best = pickBestOrbMatch(
        best,
        topMatch ? buildOrbCandidate(tracker, frame, topMatch, baseRoiSize, DNA_CONFIG.COLOR_SIM_THRESHOLD) : null
      );
      count++;

      if (count >= maxCenters) break;
      const bottomRect = buildRoiFromCenter(x, height - margin, fullRoiSize, width, height);
      const bottomMatch = matchOrbAndLocalize(cv, resources.orb, resources.matcher, gray, bottomRect, tracker);
      best = pickBestOrbMatch(
        best,
        bottomMatch ? buildOrbCandidate(tracker, frame, bottomMatch, baseRoiSize, DNA_CONFIG.COLOR_SIM_THRESHOLD) : null
      );
      count++;
    }

    for (let y = margin + stride; y <= height - margin - stride; y += stride) {
      if (count >= maxCenters) break;
      const leftRect = buildRoiFromCenter(margin, y, fullRoiSize, width, height);
      const leftMatch = matchOrbAndLocalize(cv, resources.orb, resources.matcher, gray, leftRect, tracker);
      best = pickBestOrbMatch(
        best,
        leftMatch ? buildOrbCandidate(tracker, frame, leftMatch, baseRoiSize, DNA_CONFIG.COLOR_SIM_THRESHOLD) : null
      );
      count++;

      if (count >= maxCenters) break;
      const rightRect = buildRoiFromCenter(width - margin, y, fullRoiSize, width, height);
      const rightMatch = matchOrbAndLocalize(cv, resources.orb, resources.matcher, gray, rightRect, tracker);
      best = pickBestOrbMatch(
        best,
        rightMatch ? buildOrbCandidate(tracker, frame, rightMatch, baseRoiSize, DNA_CONFIG.COLOR_SIM_THRESHOLD) : null
      );
      count++;
    }
  }

  const shouldGridSearch = framesLost > 10 && framesLost % 12 === 0;
  if (shouldGridSearch) {
    const gridX = 4;
    const gridY = 3;
    for (let gy = 0; gy < gridY; gy++) {
      for (let gx = 0; gx < gridX; gx++) {
        const gridXPos = Math.round(((gx + 0.5) * width) / gridX);
        const gridYPos = Math.round(((gy + 0.5) * height) / gridY);
        const gridRect = buildRoiFromCenter(gridXPos, gridYPos, fullRoiSize, width, height);
        const gridMatch = matchOrbAndLocalize(cv, resources.orb, resources.matcher, gray, gridRect, tracker);
        best = pickBestOrbMatch(
          best,
          gridMatch ? buildOrbCandidate(tracker, frame, gridMatch, baseRoiSize, DNA_CONFIG.COLOR_SIM_THRESHOLD) : null
        );
      }
    }
  }

  return best;
};

function getMotionPrediction(
  tracker: Tracker,
  globalMotion?: GlobalMotion | null
): MotionPrediction {
  const velocity = Math.sqrt(
    tracker.velocityX * tracker.velocityX + tracker.velocityY * tracker.velocityY
  );
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

function getAdaptiveFlowConfig(
  base: FlowConfig,
  tracker: Tracker,
  globalMotion?: GlobalMotion | null
): FlowConfig {
  const speed = Math.hypot(tracker.velocityX, tracker.velocityY);
  const globalMagnitude = globalMotion ? Math.hypot(globalMotion.dx, globalMotion.dy) : 0;
  const motionBoost = clamp(1 + speed * 0.08 + globalMagnitude * 0.03, 1, 2.4);
  const occlusionBoost = tracker.framesOccluded > 0 ? 1 + Math.min(1, tracker.framesOccluded / 6) * 0.5 : 1;
  const searchRadius = Math.max(6, Math.round(base.SEARCH_RADIUS * motionBoost * occlusionBoost));
  const sampleRadius = Math.max(4, Math.round(base.SAMPLE_RADIUS * clamp(1 + speed * 0.03, 1, 1.6)));
  const minConfidence = base.MIN_FLOW_CONFIDENCE * (tracker.framesOccluded > 0 ? 0.9 : 1);

  return {
    ...base,
    SEARCH_RADIUS: searchRadius,
    SAMPLE_RADIUS: sampleRadius,
    MIN_FLOW_CONFIDENCE: minConfidence,
    FORWARD_BACKWARD_THRESHOLD: Math.max(
      1,
      base.FORWARD_BACKWARD_THRESHOLD * clamp(motionBoost, 1, 2)
    ),
    GRADIENT_SAMPLE_RADIUS: Math.max(
      4,
      Math.round(base.GRADIENT_SAMPLE_RADIUS * clamp(1 + speed * 0.05, 1, 1.8))
    ),
    LOST_SCORE_THRESHOLD: Math.round(base.LOST_SCORE_THRESHOLD * motionBoost)
  };
}

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

  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const cx = Math.round(((gx + 0.5) * width) / gridX);
      const cy = Math.round(((gy + 0.5) * height) / gridY);

      if (
        cx < half + config.SEARCH_RADIUS ||
        cx >= width - half - config.SEARCH_RADIUS ||
        cy < half + config.SEARCH_RADIUS ||
        cy >= height - half - config.SEARCH_RADIUS
      ) {
        continue;
      }

      const template = captureTemplate(prevFrame, cx, cy, config.PATCH_SIZE);
      if (!template) continue;
      const stats = computeTemplateStats(template);
      if (stats.std < 1e-3) continue;

      const match = matchTemplate(
        currFrame,
        template,
        stats,
        cx,
        cy,
        width,
        height,
        config.SEARCH_RADIUS,
        config.STEP,
        minScore
      );

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
  const avgConfidence =
    confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  const density = confidences.length / (gridX * gridY);

  return {
    dx,
    dy,
    confidence: clamp(avgConfidence * density, 0, 1)
  };
}

function offsetAnchorSet(anchorSet: AnchorSet, dx: number, dy: number): AnchorSet {
  return {
    ...anchorSet,
    centroidX: anchorSet.centroidX + dx,
    centroidY: anchorSet.centroidY + dy,
    anchors: anchorSet.anchors.map((anchor) => ({
      ...anchor,
      x: anchor.x + dx,
      y: anchor.y + dy,
      prevX: anchor.prevX + dx,
      prevY: anchor.prevY + dy
    }))
  };
}

function fuseTrackingCandidates(
  candidates: TrackingCandidate[],
  gatingDistance: number
): { x: number; y: number; confidence: number } | null {
  if (!candidates.length) return null;

  const weights = candidates.map((candidate) => ({
    candidate,
    weight: candidate.confidence * (SOURCE_WEIGHTS[candidate.source] ?? 1)
  }));
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);

  const best = weights.reduce((prev, curr) => (curr.weight > prev.weight ? curr : prev));
  if (totalWeight <= 0) {
    return { x: best.candidate.x, y: best.candidate.y, confidence: best.candidate.confidence };
  }

  const meanX = weights.reduce((sum, entry) => sum + entry.candidate.x * entry.weight, 0) / totalWeight;
  const meanY = weights.reduce((sum, entry) => sum + entry.candidate.y * entry.weight, 0) / totalWeight;
  const gate = Math.max(6, gatingDistance);

  const filtered = weights.filter((entry) => {
    const dist = Math.hypot(entry.candidate.x - meanX, entry.candidate.y - meanY);
    return dist <= gate || weights.length === 1;
  });

  if (!filtered.length) {
    return { x: best.candidate.x, y: best.candidate.y, confidence: best.candidate.confidence };
  }

  const filteredWeight = filtered.reduce((sum, entry) => sum + entry.weight, 0);
  const fusedX =
    filtered.reduce((sum, entry) => sum + entry.candidate.x * entry.weight, 0) / filteredWeight;
  const fusedY =
    filtered.reduce((sum, entry) => sum + entry.candidate.y * entry.weight, 0) / filteredWeight;
  const avgDist =
    filtered.reduce((sum, entry) => sum + Math.hypot(entry.candidate.x - fusedX, entry.candidate.y - fusedY), 0) /
    filtered.length;
  const agreement = 1 - clamp(avgDist / gate, 0, 1);
  const weightedConfidence =
    filtered.reduce((sum, entry) => sum + entry.candidate.confidence * (SOURCE_WEIGHTS[entry.candidate.source] ?? 1), 0) /
    filtered.length;
  const confidence = clamp(weightedConfidence * 0.7 + agreement * 0.3, 0, 1);

  return { x: fusedX, y: fusedY, confidence };
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
  const velocity = Math.sqrt(
    tracker.velocityX * tracker.velocityX + tracker.velocityY * tracker.velocityY
  );
  const velocityScale = prediction.velocityScale;
  const predictedX = prediction.x;
  const predictedY = prediction.y;

  const startX = predictedX;
  const startY = predictedY;

  const margin = cfg.BOUNDARY_GUARD + cfg.SAMPLE_RADIUS;
  const atBoundary =
    startX < margin || startX > width - margin || startY < margin || startY > height - margin;

  if (atBoundary) {
    return { x: tracker.x, y: tracker.y, confidence: 0, valid: false, atBoundary: true };
  }

  const prevData = prevFrame.data;
  const currData = currFrame.data;

  const refGradient = computeGradientMagnitude(
    prevFrame,
    Math.round(tracker.x),
    Math.round(tracker.y),
    width,
    height,
    cfg.GRADIENT_SAMPLE_RADIUS
  );

  let bestX = startX;
  let bestY = startY;
  let bestScore = Infinity;

  const globalMagnitude = Math.hypot(prediction.globalDx, prediction.globalDy);
  const adaptiveRadius = Math.min(
    cfg.SEARCH_RADIUS * 1.8,
    cfg.SEARCH_RADIUS + velocity * 2 + globalMagnitude * 1.5
  );

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

      const testGradient = computeGradientMagnitude(
        currFrame,
        testX,
        testY,
        width,
        height,
        cfg.GRADIENT_SAMPLE_RADIUS
      );
      const edgeScore = compareGradients(refGradient, testGradient) * 1000;
      const combinedScore = colorScore * (1 - cfg.EDGE_WEIGHT) + edgeScore * cfg.EDGE_WEIGHT;

      const dist = Math.sqrt(dx * dx + dy * dy);
      const distPenalty = dist * 0.3;

      const expectedDx = tracker.velocityX * velocityScale + prediction.globalDx;
      const expectedDy = tracker.velocityY * velocityScale + prediction.globalDy;
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

  const fbError = Math.sqrt(
    (backX - tracker.x) * (backX - tracker.x) + (backY - tracker.y) * (backY - tracker.y)
  );

  const passesFb = fbError < cfg.FORWARD_BACKWARD_THRESHOLD;
  const confidence = passesFb ? Math.max(0, 1 - bestScore / cfg.LOST_SCORE_THRESHOLD) : 0;
  const valid = passesFb && confidence >= cfg.MIN_FLOW_CONFIDENCE;

  return { x: bestX, y: bestY, confidence, valid, atBoundary: false };
}

function kalmanUpdate(
  tracker: Tracker,
  measuredX: number,
  measuredY: number
): { x: number; y: number; vx: number; vy: number } {
  const pNoise = CONFIG.KALMAN_PROCESS_NOISE;
  const mNoise = CONFIG.KALMAN_MEASUREMENT_NOISE;

  const predX = tracker.kalmanX + tracker.kalmanVx;
  const predY = tracker.kalmanY + tracker.kalmanVy;

  const gain = pNoise / (pNoise + mNoise);

  const newX = predX + gain * (measuredX - predX);
  const newY = predY + gain * (measuredY - predY);
  const newVx = tracker.kalmanVx + gain * (measuredX - predX) * 0.5;
  const newVy = tracker.kalmanVy + gain * (measuredY - predY) * 0.5;

  return { x: newX, y: newY, vx: newVx, vy: newVy };
}

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
    embedding?: ReIdEmbedding | null;
    embeddingConfig?: ReIdConfig;
    maxCandidates?: number;
    embeddingThreshold?: number;
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
  const candidates: Array<{ x: number; y: number; similarity: number }> = [];
  const maxCandidates = options?.maxCandidates ?? DEFAULT_REID_CONFIG.maxCandidates;

  for (let y = startY; y < endY; y += gridStep) {
    for (let x = startX; x < endX; x += gridStep) {
      const signature = captureColorSignature(frame, x, y, width, sampleRadius);
      const similarity = compareColorSignatures(tracker.colorSignature, signature);

      if (similarity > CONFIG.COLOR_MATCH_THRESHOLD && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { x, y };
      }

      if (similarity > CONFIG.COLOR_MATCH_THRESHOLD && options?.embedding) {
        candidates.push({ x, y, similarity });
      }
    }
  }

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

  if (options?.embedding && candidates.length > 0) {
    candidates.sort((a, b) => b.similarity - a.similarity);
    const shortlist = candidates.slice(0, maxCandidates);
    let bestEmbeddingMatch: Point | null = null;
    let bestEmbeddingScore = 0;
    const embeddingThreshold =
      options.embeddingThreshold ??
      options.embeddingConfig?.matchThreshold ??
      DEFAULT_REID_CONFIG.matchThreshold;

    for (const candidate of shortlist) {
      const embedding = computeReIdEmbedding(
        frame,
        candidate.x,
        candidate.y,
        width,
        height,
        options.embeddingConfig
      );
      const score = compareEmbeddings(options.embedding, embedding);
      if (score > bestEmbeddingScore) {
        bestEmbeddingScore = score;
        bestEmbeddingMatch = { x: candidate.x, y: candidate.y };
      }
    }

    if (bestEmbeddingMatch && bestEmbeddingScore >= embeddingThreshold) {
      return bestEmbeddingMatch;
    }
  }

  return bestMatch;
}

const computeOpenCvFlow = (
  cv: OpenCvModule["cv"],
  prevGray: any,
  currGray: any,
  tracker: Tracker,
  width: number,
  height: number,
  flowConfig: FlowConfig
): { x: number; y: number; confidence: number; valid: boolean; atBoundary: boolean } | null => {
  if (!cv || !prevGray || !currGray) return null;

  const roiRadius = Math.max(flowConfig.SEARCH_RADIUS, 12);
  const roiSize = Math.min(Math.round(roiRadius * 2.5), Math.min(width, height));
  const roiX = clamp(Math.round(tracker.x - roiSize / 2), 0, width - roiSize);
  const roiY = clamp(Math.round(tracker.y - roiSize / 2), 0, height - roiSize);

  if (roiSize < 12) return null;

  const roiRect = { x: roiX, y: roiY, width: roiSize, height: roiSize };
  const prevRoi = prevGray.roi(roiRect);
  const corners = new cv.Mat();
  cv.goodFeaturesToTrack(prevRoi, corners, 60, 0.01, 3);

  if (!corners.rows || corners.rows < 4) {
    prevRoi.delete();
    corners.delete();
    return null;
  }

  const prevPts = new cv.Mat(corners.rows, 1, cv.CV_32FC2);
  for (let i = 0; i < corners.rows; i++) {
    const idx = i * 2;
    prevPts.data32F[idx] = (corners.data32F[idx] ?? 0) + roiX;
    prevPts.data32F[idx + 1] = (corners.data32F[idx + 1] ?? 0) + roiY;
  }

  const nextPts = new cv.Mat();
  const status = new cv.Mat();
  const err = new cv.Mat();
  const winSize = new cv.Size(21, 21);
  const criteria = {
    type: cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_COUNT,
    maxCount: 20,
    epsilon: 0.03
  };

  cv.calcOpticalFlowPyrLK(prevGray, currGray, prevPts, nextPts, status, err, winSize, 3, criteria);

  const goodPrev: number[] = [];
  const goodNext: number[] = [];

  for (let i = 0; i < status.rows; i++) {
    if ((status.data[i] ?? 0) === 1) {
      goodPrev.push(prevPts.data32F[i * 2] ?? 0, prevPts.data32F[i * 2 + 1] ?? 0);
      goodNext.push(nextPts.data32F[i * 2] ?? 0, nextPts.data32F[i * 2 + 1] ?? 0);
    }
  }

  let dx = 0;
  let dy = 0;
  let confidence = 0;

  if (goodPrev.length >= 8 && cv.estimateAffinePartial2D) {
    const inliers = new cv.Mat();
    const prevMat = new cv.Mat(goodPrev.length / 2, 1, cv.CV_32FC2);
    const nextMat = new cv.Mat(goodNext.length / 2, 1, cv.CV_32FC2);
    prevMat.data32F.set(goodPrev);
    nextMat.data32F.set(goodNext);

    const transform = cv.estimateAffinePartial2D(
      prevMat,
      nextMat,
      inliers,
      cv.RANSAC ?? 8,
      3,
      2000,
      0.99,
      10
    );

    if (transform && !transform.empty()) {
      const data = transform.data64F ?? new Float64Array();
      dx = data[2] ?? 0;
      dy = data[5] ?? 0;
      let inlierCount = 0;
      for (let i = 0; i < inliers.rows; i++) {
        if ((inliers.data[i] ?? 0) === 1) inlierCount++;
      }
      confidence = inlierCount / (goodPrev.length / 2);
    } else {
      let sumDx = 0;
      let sumDy = 0;
      const count = goodPrev.length / 2;
      for (let i = 0; i < count; i++) {
        sumDx += (goodNext[i * 2] ?? 0) - (goodPrev[i * 2] ?? 0);
        sumDy += (goodNext[i * 2 + 1] ?? 0) - (goodPrev[i * 2 + 1] ?? 0);
      }
      dx = sumDx / count;
      dy = sumDy / count;
      confidence = count / (corners.rows || 1);
    }

    inliers.delete();
    prevMat.delete();
    nextMat.delete();
    if (transform) transform.delete?.();
  } else if (goodPrev.length >= 2) {
    let sumDx = 0;
    let sumDy = 0;
    const count = goodPrev.length / 2;
    for (let i = 0; i < count; i++) {
      sumDx += (goodNext[i * 2] ?? 0) - (goodPrev[i * 2] ?? 0);
      sumDy += (goodNext[i * 2 + 1] ?? 0) - (goodPrev[i * 2 + 1] ?? 0);
    }
    dx = sumDx / count;
    dy = sumDy / count;
    confidence = count / (corners.rows || 1);
  }

  prevRoi.delete();
  corners.delete();
  prevPts.delete();
  nextPts.delete();
  status.delete();
  err.delete();

  if (!confidence || confidence < flowConfig.MIN_FLOW_CONFIDENCE) {
    return null;
  }

  const nextX = tracker.x + dx;
  const nextY = tracker.y + dy;
  const margin = flowConfig.BOUNDARY_GUARD + flowConfig.SAMPLE_RADIUS;
  const atBoundary =
    nextX < margin || nextX > width - margin || nextY < margin || nextY > height - margin;

  if (atBoundary) {
    return { x: tracker.x, y: tracker.y, confidence: 0, valid: false, atBoundary: true };
  }

  return { x: nextX, y: nextY, confidence, valid: true, atBoundary: false };
};

const estimateGlobalMotionCv = (
  cv: OpenCvModule["cv"],
  prevGray: any,
  currGray: any
): GlobalMotion | null => {
  if (!cv || !prevGray || !currGray) return null;

  const corners = new cv.Mat();
  cv.goodFeaturesToTrack(prevGray, corners, 200, 0.01, 8);

  if (!corners.rows || corners.rows < 12) {
    corners.delete();
    return null;
  }

  const prevPts = new cv.Mat(corners.rows, 1, cv.CV_32FC2);
  for (let i = 0; i < corners.rows; i++) {
    const idx = i * 2;
    prevPts.data32F[idx] = corners.data32F[idx] ?? 0;
    prevPts.data32F[idx + 1] = corners.data32F[idx + 1] ?? 0;
  }

  const nextPts = new cv.Mat();
  const status = new cv.Mat();
  const err = new cv.Mat();
  const winSize = new cv.Size(21, 21);
  const criteria = {
    type: cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_COUNT,
    maxCount: 20,
    epsilon: 0.03
  };

  cv.calcOpticalFlowPyrLK(prevGray, currGray, prevPts, nextPts, status, err, winSize, 3, criteria);

  const goodPrev: number[] = [];
  const goodNext: number[] = [];

  for (let i = 0; i < status.rows; i++) {
    if ((status.data[i] ?? 0) === 1) {
      goodPrev.push(prevPts.data32F[i * 2] ?? 0, prevPts.data32F[i * 2 + 1] ?? 0);
      goodNext.push(nextPts.data32F[i * 2] ?? 0, nextPts.data32F[i * 2 + 1] ?? 0);
    }
  }

  let dx = 0;
  let dy = 0;
  let confidence = 0;

  if (goodPrev.length >= 8 && cv.estimateAffinePartial2D) {
    const inliers = new cv.Mat();
    const prevMat = new cv.Mat(goodPrev.length / 2, 1, cv.CV_32FC2);
    const nextMat = new cv.Mat(goodNext.length / 2, 1, cv.CV_32FC2);
    prevMat.data32F.set(goodPrev);
    nextMat.data32F.set(goodNext);

    const transform = cv.estimateAffinePartial2D(
      prevMat,
      nextMat,
      inliers,
      cv.RANSAC ?? 8,
      3,
      2000,
      0.99,
      10
    );

    if (transform && !transform.empty()) {
      const data = transform.data64F ?? new Float64Array();
      dx = data[2] ?? 0;
      dy = data[5] ?? 0;
      let inlierCount = 0;
      for (let i = 0; i < inliers.rows; i++) {
        if ((inliers.data[i] ?? 0) === 1) inlierCount++;
      }
      confidence = inlierCount / (goodPrev.length / 2);
    } else {
      const count = goodPrev.length / 2;
      let sumDx = 0;
      let sumDy = 0;
      for (let i = 0; i < count; i++) {
        sumDx += (goodNext[i * 2] ?? 0) - (goodPrev[i * 2] ?? 0);
        sumDy += (goodNext[i * 2 + 1] ?? 0) - (goodPrev[i * 2 + 1] ?? 0);
      }
      dx = sumDx / count;
      dy = sumDy / count;
      confidence = count / (corners.rows || 1);
    }

    inliers.delete();
    prevMat.delete();
    nextMat.delete();
    if (transform) transform.delete?.();
  } else if (goodPrev.length >= 2) {
    const count = goodPrev.length / 2;
    let sumDx = 0;
    let sumDy = 0;
    for (let i = 0; i < count; i++) {
      sumDx += (goodNext[i * 2] ?? 0) - (goodPrev[i * 2] ?? 0);
      sumDy += (goodNext[i * 2 + 1] ?? 0) - (goodPrev[i * 2 + 1] ?? 0);
    }
    dx = sumDx / count;
    dy = sumDy / count;
    confidence = count / (corners.rows || 1);
  }

  corners.delete();
  prevPts.delete();
  nextPts.delete();
  status.delete();
  err.delete();

  if (!confidence || confidence < 0.2) {
    return null;
  }

  return { dx, dy, confidence };
};

const runTrackingFrame = async (options: {
  prevFrame: ImageData | null;
  currentFrame: ImageData;
  trackers: Tracker[];
  drawings: DrawingStroke[];
  width: number;
  height: number;
  flowConfig: FlowConfig;
  anchorConfig: AnchorConfig;
  colorSampleRadius: number;
  reidConfig: ReIdConfig;
  useServerDetection: boolean;
  useAnchorTracking: boolean;
  yoloDetections: Detection[];
}): Promise<{ trackers: Tracker[]; drawings: DrawingStroke[] }> => {
  const {
    prevFrame,
    currentFrame,
    trackers,
    drawings,
    width,
    height,
    flowConfig,
    anchorConfig,
    colorSampleRadius,
    reidConfig,
    useServerDetection,
    useAnchorTracking,
    yoloDetections
  } = options;

  if (!prevFrame) {
    return { trackers, drawings };
  }

  const hasYoloDetections = useServerDetection && yoloDetections.length > 0;
  const yoloMatches = hasYoloDetections
    ? matchDetectionsToTrackers(trackers, yoloDetections, width, height, 0.1, flowConfig.SEARCH_RADIUS)
    : [];
  const matchByTrackerId = new Map(yoloMatches.map((m) => [m.trackerId, m]));

  const cv = await ensureOpenCv();
  let prevGray: any = null;
  let currGray: any = null;
  let prevMat: any = null;
  let currMat: any = null;

  if (cv && openCvEnabled && cvReady) {
    prevMat = cv.matFromImageData(prevFrame);
    currMat = cv.matFromImageData(currentFrame);
    prevGray = new cv.Mat();
    currGray = new cv.Mat();
    cv.cvtColor(prevMat, prevGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(currMat, currGray, cv.COLOR_RGBA2GRAY);
  }

  const globalMotionConfig = getScaledGlobalMotionConfig(
    CONFIG.SEARCH_RADIUS ? flowConfig.SEARCH_RADIUS / CONFIG.SEARCH_RADIUS : 1
  );
  const baseGlobalMotion = estimateGlobalMotion(
    prevFrame,
    currentFrame,
    width,
    height,
    globalMotionConfig
  );
  let frameGlobalMotion = baseGlobalMotion;
  if (cv && prevGray && currGray && openCvEnabled && cvReady) {
    const cvMotion = estimateGlobalMotionCv(cv, prevGray, currGray);
    if (cvMotion && (!frameGlobalMotion || cvMotion.confidence > frameGlobalMotion.confidence)) {
      frameGlobalMotion = cvMotion;
    }
  }
  const globalMotion = frameGlobalMotion ?? { dx: 0, dy: 0, confidence: 0 };

  const now = Date.now();

  const nextTrackers = trackers.map((tracker) => {
    if (tracker.state === "lost" && tracker.framesLost > CONFIG.LOST_TIMEOUT) {
      return tracker;
    }

    const margin = flowConfig.BOUNDARY_GUARD;
    const outOfFrame =
      tracker.x < margin || tracker.x > width - margin || tracker.y < margin || tracker.y > height - margin;

    if (outOfFrame && tracker.state === "tracking") {
      return {
        ...tracker,
        state: "lost" as TrackerState,
        framesLost: 0,
        confidence: 0,
        framesTracked: 0,
        reidCandidate: null,
        reidCandidateFrames: 0
      };
    }

    const yoloMatch = matchByTrackerId.get(tracker.id);

    if (tracker.state === "tracking" || tracker.state === "occluded") {
      const adaptiveFlowConfig = getAdaptiveFlowConfig(flowConfig, tracker, globalMotion);
      const prediction = getMotionPrediction(tracker, globalMotion);
      let flow = computeOpticalFlow(
        prevFrame,
        currentFrame,
        tracker,
        width,
        height,
        adaptiveFlowConfig,
        globalMotion
      );

      if (cv && prevGray && currGray && openCvEnabled) {
        const cvFlow = computeOpenCvFlow(
          cv,
          prevGray,
          currGray,
          tracker,
          width,
          height,
          adaptiveFlowConfig
        );
        if (cvFlow) {
          flow = cvFlow;
        }
      }

      if (flow.atBoundary) {
        return {
          ...tracker,
          state: "lost" as TrackerState,
          framesLost: 0,
          confidence: 0,
          framesTracked: 0,
          reidCandidate: null,
          reidCandidateFrames: 0
        };
      }

      let newLabel = tracker.label;
      let bboxWidth = tracker.bboxWidth;
      let bboxHeight = tracker.bboxHeight;
      let bboxConfidence = tracker.bboxConfidence;
      let yoloCandidate: TrackingCandidate | null = null;

      if (yoloMatch) {
        const yoloCenter = getDetectionCenter(yoloMatch.detection, width, height);
        const yoloConfidence = yoloMatch.detection.confidence;
        const yoloBoxWidth = yoloMatch.detection.bbox.width * width;
        const yoloBoxHeight = yoloMatch.detection.bbox.height * height;

        yoloCandidate = {
          x: yoloCenter.x,
          y: yoloCenter.y,
          confidence: yoloConfidence,
          source: "yolo"
        };

        if (tracker.label.startsWith("Region") && yoloMatch.detection.label) {
          newLabel = yoloMatch.detection.label;
        }

        bboxWidth = yoloBoxWidth;
        bboxHeight = yoloBoxHeight;
        bboxConfidence = yoloConfidence;
      }

      const templateCandidate =
        tracker.template && tracker.templateStd && tracker.templateMean
          ? matchTemplate(
              currentFrame,
              tracker.template,
              { mean: tracker.templateMean, std: tracker.templateStd },
              prediction.x,
              prediction.y,
              width,
              height,
              adaptiveFlowConfig.SEARCH_RADIUS * 1.4,
              TEMPLATE_CONFIG.COARSE_STEP,
              TEMPLATE_CONFIG.MIN_NCC
            )
          : null;

      let updatedAnchorSet = tracker.anchorSet;
      let anchorCandidate: TrackingCandidate | null = null;
      if (useAnchorTracking && tracker.useAnchors && tracker.anchorSet && prevFrame) {
        const speed = Math.hypot(tracker.velocityX, tracker.velocityY);
        const motionBoost = clamp(
          1 + speed * 0.05 + Math.hypot(globalMotion.dx, globalMotion.dy) * 0.03,
          1,
          2
        );
        const anchorSearchRadius = Math.max(
          6,
          Math.round(anchorConfig.ANCHOR_SEARCH_RADIUS * motionBoost)
        );
        const anchorInput =
          globalMotion.confidence > 0.2
            ? offsetAnchorSet(tracker.anchorSet, globalMotion.dx, globalMotion.dy)
            : tracker.anchorSet;

        updatedAnchorSet = trackAnchors(
          anchorInput,
          prevFrame,
          currentFrame,
          { ...anchorConfig, ANCHOR_SEARCH_RADIUS: anchorSearchRadius }
        );
        const anchorPosition = estimatePositionFromAnchors(
          updatedAnchorSet,
          prediction.x,
          prediction.y,
          anchorConfig
        );

        if (anchorPosition.useAnchors) {
          anchorCandidate = {
            x: anchorPosition.x,
            y: anchorPosition.y,
            confidence: anchorPosition.confidence,
            source: "anchor"
          };
        }
      }

      let orbCandidate: TrackingCandidate | null = null;
      if (cv && currGray && openCvEnabled && cvReady && tracker.state === "tracking") {
        const framesTracked = tracker.framesTracked ?? 0;
        const speed = Math.hypot(tracker.velocityX, tracker.velocityY);
        const shouldDriftCheck =
          tracker.framesOccluded === 0 &&
          ((framesTracked > 0 && framesTracked % DNA_CONFIG.DRIFT_CHECK_INTERVAL === 0) ||
            speed < DNA_CONFIG.LOW_VELOCITY_THRESHOLD);
        if (shouldDriftCheck) {
          const orbMatch = runOrbDriftCheck({
            tracker,
            frame: currentFrame,
            gray: currGray,
            cv,
            width,
            height,
            centerX: prediction.x,
            centerY: prediction.y
          });
          if (orbMatch && orbMatch.confidence > 0.35) {
            orbCandidate = {
              x: orbMatch.x,
              y: orbMatch.y,
              confidence: orbMatch.confidence,
              source: "orb"
            };
          }
        }
      }

      const candidates: TrackingCandidate[] = [];
      if (flow.valid) {
        candidates.push({
          x: flow.x,
          y: flow.y,
          confidence: flow.confidence,
          source: "flow"
        });
      }
      if (yoloCandidate) {
        candidates.push(yoloCandidate);
      }
      if (templateCandidate) {
        candidates.push({
          x: templateCandidate.x,
          y: templateCandidate.y,
          confidence: templateCandidate.confidence,
          source: "template"
        });
      }
      if (anchorCandidate) {
        candidates.push(anchorCandidate);
      }
      if (orbCandidate) {
        candidates.push(orbCandidate);
      }

      let fused = fuseTrackingCandidates(
        candidates,
        adaptiveFlowConfig.SEARCH_RADIUS * FUSION_CONFIG.GATING_FACTOR
      );

      if (orbCandidate && (!fused || fused.confidence < 0.45)) {
        fused = {
          x: orbCandidate.x,
          y: orbCandidate.y,
          confidence: Math.max(orbCandidate.confidence, fused?.confidence ?? 0)
        };
      } else if (orbCandidate && fused && orbCandidate.confidence > 0.8) {
        const orbDist = Math.hypot(orbCandidate.x - fused.x, orbCandidate.y - fused.y);
        if (orbDist > adaptiveFlowConfig.SEARCH_RADIUS * 1.2) {
          fused = { x: orbCandidate.x, y: orbCandidate.y, confidence: orbCandidate.confidence };
        }
      }

      if (!fused || fused.confidence < FUSION_CONFIG.MIN_CONFIDENCE) {
        const newFramesOccluded = tracker.framesOccluded + 1;
        if (newFramesOccluded > CONFIG.OCCLUSION_TIMEOUT) {
          return {
            ...tracker,
            state: "lost" as TrackerState,
            framesLost: 0,
            framesOccluded: 0,
            confidence: 0,
            framesTracked: 0,
            reidCandidate: null,
            reidCandidateFrames: 0
          };
        }

        return {
          ...tracker,
          state: "occluded" as TrackerState,
          framesOccluded: newFramesOccluded,
          confidence: fused?.confidence ?? 0
        };
      }

      const finalX = fused.x;
      const finalY = fused.y;
      const finalConfidence = fused.confidence;

      const kalman = kalmanUpdate(tracker, finalX, finalY);
      const smoothSpeed = Math.hypot(kalman.vx, kalman.vy);
      const motionFactor = clamp(
        smoothSpeed / Math.max(1, adaptiveFlowConfig.SEARCH_RADIUS),
        0,
        1
      );
      const smoothingFactor = lerp(CONFIG.SMOOTHING_FACTOR, 0.85, motionFactor);
      const smoothX = tracker.x + (kalman.x - tracker.x) * smoothingFactor;
      const smoothY = tracker.y + (kalman.y - tracker.y) * smoothingFactor;

      let updatedEmbedding = tracker.reidEmbedding ?? null;
      let updatedEmbeddingAt = tracker.lastEmbeddingUpdate ?? 0;
      let updatedTemplate = tracker.template ?? null;
      let templateMean = tracker.templateMean ?? 0;
      let templateStd = tracker.templateStd ?? 0;
      let lastTemplateUpdate = tracker.lastTemplateUpdate ?? 0;
      if (finalConfidence > 0.7 && now - updatedEmbeddingAt > REID_UPDATE_INTERVAL_MS) {
        const embedding = computeReIdEmbedding(
          currentFrame,
          smoothX,
          smoothY,
          width,
          height,
          reidConfig
        );
        if (embedding) {
          updatedEmbedding = blendEmbeddings(updatedEmbedding, embedding, reidConfig.updateAlpha);
          updatedEmbeddingAt = now;
        }
      }

      if (
        finalConfidence > TEMPLATE_CONFIG.UPDATE_CONFIDENCE &&
        now - lastTemplateUpdate > TEMPLATE_CONFIG.UPDATE_INTERVAL_MS
      ) {
        const size = ensureOdd(tracker.templateSize ?? TEMPLATE_CONFIG.SIZE);
        const newTemplate = captureTemplate(currentFrame, smoothX, smoothY, size);
        if (newTemplate) {
          if (updatedTemplate && updatedTemplate.length === newTemplate.length) {
            updatedTemplate = blendTemplate(
              updatedTemplate,
              newTemplate,
              TEMPLATE_CONFIG.UPDATE_ALPHA
            );
          } else {
            updatedTemplate = newTemplate;
          }
          const stats = computeTemplateStats(updatedTemplate);
          templateMean = stats.mean;
          templateStd = stats.std;
          lastTemplateUpdate = now;
        }
      }

      const nextFramesTracked = (tracker.framesTracked ?? 0) + 1;
      const bboxSize = Math.max(bboxWidth ?? 0, bboxHeight ?? 0);
      const targetRoiSize =
        bboxSize > 0
          ? Math.round(clamp(bboxSize * 1.8, 60, DNA_CONFIG.ROI_SIZE))
          : DNA_CONFIG.ROI_SIZE;
      const dnaRoiSize = Math.max(tracker.visualRoiSize ?? 0, targetRoiSize);
      let visualKeypoints = tracker.visualKeypoints ?? null;
      let visualDescriptors = tracker.visualDescriptors ?? null;
      let visualDescriptorRows = tracker.visualDescriptorRows ?? 0;
      let visualDescriptorCols = tracker.visualDescriptorCols ?? 0;
      let visualRoiCenter = tracker.visualRoiCenter ?? null;
      let visualRoiSize = tracker.visualRoiSize ?? dnaRoiSize;
      let visualHist = tracker.visualHist ?? null;

      const stableForDna = finalConfidence > 0.65 && tracker.framesOccluded === 0;
      const shouldInitDna =
        stableForDna && (!visualDescriptors || !visualKeypoints || visualKeypoints.length < 4);
      const shouldRefreshDna =
        stableForDna &&
        nextFramesTracked % 90 === 0 &&
        smoothSpeed < DNA_CONFIG.LOW_VELOCITY_THRESHOLD * 1.6;

      if (stableForDna && (shouldInitDna || shouldRefreshDna || !visualHist || nextFramesTracked % 15 === 0)) {
        const newHist = computeHsvHistogram(
          currentFrame,
          smoothX,
          smoothY,
          dnaRoiSize,
          DNA_CONFIG.HSV_BINS_H,
          DNA_CONFIG.HSV_BINS_S
        );
        if (newHist) {
          if (!visualHist) {
            visualHist = newHist;
          } else {
            const histScore = compareHistogram(visualHist, newHist);
            if (histScore > 0.15 || shouldInitDna) {
              visualHist = blendHistogram(visualHist, newHist, shouldInitDna ? 0.35 : 0.2);
            }
          }
        }
      }

      if (cv && currGray && openCvEnabled && cvReady && (shouldInitDna || shouldRefreshDna)) {
        const resources = ensureOrbResources(cv);
        if (resources) {
          const features = extractOrbFeatures(
            cv,
            resources.orb,
            currGray,
            smoothX,
            smoothY,
            dnaRoiSize
          );
          if (features) {
            visualKeypoints = features.keypoints;
            visualDescriptors = features.descriptors;
            visualDescriptorRows = features.descriptorRows;
            visualDescriptorCols = features.descriptorCols;
            visualRoiCenter = features.roiCenter;
            visualRoiSize = features.roiSize;
          }
        }
      }

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
        reidEmbedding: updatedEmbedding,
        lastEmbeddingUpdate: updatedEmbeddingAt,
        template: updatedTemplate,
        templateMean,
        templateStd,
        lastTemplateUpdate,
        bboxWidth,
        bboxHeight,
        bboxConfidence,
        anchorSet: updatedAnchorSet,
        visualKeypoints,
        visualDescriptors,
        visualDescriptorRows,
        visualDescriptorCols,
        visualRoiCenter,
        visualRoiSize,
        visualHist,
        framesTracked: nextFramesTracked,
        reidCandidate: null,
        reidCandidateFrames: 0,
        history: [
          ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
          { x: smoothX, y: smoothY, timestamp: now }
        ]
      };
    }

    if (tracker.state === "lost" || tracker.state === "searching") {
      const newFramesLost = tracker.framesLost + 1;
      const adaptiveFlowConfig = getAdaptiveFlowConfig(flowConfig, tracker, globalMotion);
      let pendingReidCandidate = tracker.reidCandidate ?? null;
      let pendingReidCandidateFrames = tracker.reidCandidateFrames ?? 0;

      if (yoloMatch && yoloMatch.detection.confidence > 0.4) {
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
          framesTracked: 0,
          lastGoodPosition: yoloCenter,
          bboxWidth: yoloBoxWidth,
          bboxHeight: yoloBoxHeight,
          bboxConfidence: yoloMatch.detection.confidence,
          label: tracker.label.startsWith("Region")
            ? yoloMatch.detection.label
            : tracker.label,
          reidCandidate: null,
          reidCandidateFrames: 0,
          aiValidationStrikes: 0,
          history: [
            ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
            { ...yoloCenter, timestamp: now }
          ]
        };
      }

      if (hasYoloDetections && newFramesLost % 3 === 0) {
        const unmatchedDetections = getUnmatchedDetections(yoloDetections, yoloMatches);
        let bestUnmatched: { detection: Detection; dist: number } | null = null;
        for (const det of unmatchedDetections) {
          const center = getDetectionCenter(det, width, height);
          const dist = Math.hypot(
            center.x - tracker.lastGoodPosition.x,
            center.y - tracker.lastGoodPosition.y
          );

          if (
            dist < adaptiveFlowConfig.SEARCH_RADIUS * 4 &&
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
            framesTracked: 0,
            lastGoodPosition: yoloCenter,
            bboxWidth: yoloBoxWidth,
            bboxHeight: yoloBoxHeight,
            bboxConfidence: bestUnmatched.detection.confidence,
            label: tracker.label.startsWith("Region")
              ? bestUnmatched.detection.label
              : tracker.label,
            reidCandidate: null,
            reidCandidateFrames: 0,
            aiValidationStrikes: 0,
            history: [
              ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
              { ...yoloCenter, timestamp: now }
            ]
          };
        }
      }

      if (cv && currGray && openCvEnabled && cvReady) {
        const shouldOrbSearch = newFramesLost <= 2 || newFramesLost % 2 === 0;
        if (shouldOrbSearch) {
          const orbReidMatch = runOrbReidSearch({
            tracker,
            frame: currentFrame,
            gray: currGray,
            cv,
            width,
            height,
            globalMotion,
            framesLost: newFramesLost
          });

          if (orbReidMatch) {
            const confirm = confirmReidCandidate(
              { ...tracker, framesLost: newFramesLost },
              { x: orbReidMatch.x, y: orbReidMatch.y },
              orbReidMatch.confidence
            );
            if (confirm.confirmed) {
              return {
                ...tracker,
                x: orbReidMatch.x,
                y: orbReidMatch.y,
                prevX: orbReidMatch.x,
                prevY: orbReidMatch.y,
                kalmanX: orbReidMatch.x,
                kalmanY: orbReidMatch.y,
                kalmanVx: 0,
                kalmanVy: 0,
                state: "tracking" as TrackerState,
                confidence: orbReidMatch.confidence,
                framesLost: 0,
                framesOccluded: 0,
                lastGoodPosition: { x: orbReidMatch.x, y: orbReidMatch.y },
                framesTracked: 0,
                reidCandidate: null,
                reidCandidateFrames: 0,
                aiValidationStrikes: 0,
                history: [
                  ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
                  { x: orbReidMatch.x, y: orbReidMatch.y, timestamp: now }
                ]
              };
            }
            pendingReidCandidate = confirm.nextCandidate;
            pendingReidCandidateFrames = confirm.nextFrames;
          }
        }
      }

      if (
        tracker.template &&
        tracker.templateStd &&
        tracker.templateMean &&
        newFramesLost % 4 === 0
      ) {
        const templateMatch = matchTemplate(
          currentFrame,
          tracker.template,
          { mean: tracker.templateMean, std: tracker.templateStd },
          tracker.lastGoodPosition.x,
          tracker.lastGoodPosition.y,
          width,
          height,
          adaptiveFlowConfig.SEARCH_RADIUS * 4,
          TEMPLATE_CONFIG.COARSE_STEP,
          Math.max(0.4, TEMPLATE_CONFIG.MIN_NCC - 0.1)
        );

        if (templateMatch) {
          return {
            ...tracker,
            x: templateMatch.x,
            y: templateMatch.y,
            prevX: templateMatch.x,
            prevY: templateMatch.y,
            kalmanX: templateMatch.x,
            kalmanY: templateMatch.y,
            kalmanVx: 0,
            kalmanVy: 0,
            state: "tracking" as TrackerState,
            confidence: templateMatch.confidence,
            framesLost: 0,
            framesOccluded: 0,
            framesTracked: 0,
            lastGoodPosition: { x: templateMatch.x, y: templateMatch.y },
            reidCandidate: null,
            reidCandidateFrames: 0,
            aiValidationStrikes: 0,
            history: [
              ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
              { x: templateMatch.x, y: templateMatch.y, timestamp: now }
            ]
          };
        }
      }

      if (newFramesLost % 5 === 0 && tracker.colorSignature) {
        const scaleFactor = CONFIG.SEARCH_RADIUS
          ? adaptiveFlowConfig.SEARCH_RADIUS / CONFIG.SEARCH_RADIUS
          : 1;
        const gridStep = Math.max(8, Math.round(30 * scaleFactor));
        const roiRadius = Math.max(adaptiveFlowConfig.SEARCH_RADIUS * 4, 80 * scaleFactor);
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
          boundaryGuard: adaptiveFlowConfig.BOUNDARY_GUARD,
          roi,
          embedding: tracker.reidEmbedding ?? null,
          embeddingConfig: reidConfig,
          maxCandidates: reidConfig.maxCandidates,
          embeddingThreshold: reidConfig.matchThreshold
        });

        if (found) {
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
            framesTracked: 0,
            lastGoodPosition: found,
            reidCandidate: null,
            reidCandidateFrames: 0,
            aiValidationStrikes: 0,
            history: [
              ...tracker.history.slice(-CONFIG.TRAIL_LENGTH),
              { x: found.x, y: found.y, timestamp: now }
            ]
          };
        }
      }

      return {
        ...tracker,
        state: "searching" as TrackerState,
        framesLost: newFramesLost,
        framesTracked: 0,
        reidCandidate: pendingReidCandidate,
        reidCandidateFrames: pendingReidCandidateFrames
      };
    }

    return tracker;
  });

  const nextDrawings = drawings.map((drawing) => {
    if (drawing.trackerId) {
      const tracker = nextTrackers.find((t) => t.id === drawing.trackerId);
      if (!tracker) return drawing;

      const visible = tracker.state === "tracking" || tracker.state === "occluded";
      const opacity =
        tracker.state === "tracking" ? 1.0 : tracker.state === "occluded" ? 0.5 : 0;

      if (drawing.localPoints.length > 0) {
        const newPoints = drawing.localPoints.map((lp) => ({
          x: tracker.x + lp.x,
          y: tracker.y + lp.y
        }));

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

    if (drawing.useAnchors && drawing.anchorSet && prevFrame) {
      const motionBoost = clamp(
        1 + Math.hypot(globalMotion.dx, globalMotion.dy) * 0.05,
        1,
        2
      );
      const anchorSearchRadius = Math.max(
        6,
        Math.round(anchorConfig.ANCHOR_SEARCH_RADIUS * motionBoost)
      );
      const anchorInput =
        globalMotion.confidence > 0.2
          ? offsetAnchorSet(drawing.anchorSet, globalMotion.dx, globalMotion.dy)
          : drawing.anchorSet;

      const updatedAnchorSet = trackAnchors(
        anchorInput,
        prevFrame,
        currentFrame,
        { ...anchorConfig, ANCHOR_SEARCH_RADIUS: anchorSearchRadius }
      );
      const anchorPosition = estimatePositionFromAnchors(
        updatedAnchorSet,
        drawing.centroidX ?? 0,
        drawing.centroidY ?? 0,
        anchorConfig
      );

      if (anchorPosition.useAnchors && anchorPosition.confidence > 0.4) {
        const dx = anchorPosition.x - (drawing.centroidX ?? 0);
        const dy = anchorPosition.y - (drawing.centroidY ?? 0);

        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
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

      return {
        ...drawing,
        anchorSet: updatedAnchorSet
      };
    }

    return drawing;
  });

  if (prevGray) prevGray.delete();
  if (currGray) currGray.delete();
  if (prevMat) prevMat.delete();
  if (currMat) currMat.delete();

  return { trackers: nextTrackers, drawings: nextDrawings };
};

type WorkerInitMessage = {
  type: "init";
  openCvEnabled: boolean;
};

type WorkerResetMessage = {
  type: "reset";
  sessionId: number;
};

type WorkerFrameMessage = {
  type: "frame";
  frameId: number;
  sessionId: number;
  editVersion: number;
  width: number;
  height: number;
  imageBitmap: ImageBitmap;
  trackers: Tracker[];
  drawings: DrawingStroke[];
  flowConfig: FlowConfig;
  anchorConfig: AnchorConfig;
  colorSampleRadius: number;
  reidConfig: ReIdConfig;
  useServerDetection: boolean;
  useAnchorTracking: boolean;
  yoloDetections: Detection[];
};

type WorkerMessage = WorkerInitMessage | WorkerResetMessage | WorkerFrameMessage;

type WorkerResultMessage = {
  type: "result";
  frameId: number;
  sessionId: number;
  editVersion: number;
  trackers: Tracker[];
  drawings: DrawingStroke[];
};

type WorkerReadyMessage = {
  type: "ready";
  openCvReady?: boolean;
};

type WorkerOpenCvMessage = {
  type: "opencv";
  openCvReady: boolean;
  error?: string;
};

let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let prevFrame: ImageData | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    openCvEnabled = message.openCvEnabled;
    console.log("[MedSync Worker] Initialized, openCvEnabled:", openCvEnabled);
    
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "ready"
    } satisfies WorkerReadyMessage);
    
    if (openCvEnabled) {
      console.log("[MedSync Worker] Starting OpenCV load process...");
      ensureOpenCv().then((cv) => {
        console.log("[MedSync Worker] OpenCV load complete, success:", Boolean(cv));
        (self as DedicatedWorkerGlobalScope).postMessage({
          type: "opencv",
          openCvReady: Boolean(cv),
          error: cv ? undefined : openCvLastError ?? "OpenCV unavailable"
        } satisfies WorkerOpenCvMessage);
      }).catch((err) => {
        console.error("[MedSync Worker] OpenCV load crashed:", err);
        (self as DedicatedWorkerGlobalScope).postMessage({
          type: "opencv",
          openCvReady: false,
          error: formatOpenCvError(err)
        } satisfies WorkerOpenCvMessage);
      });
    }
    return;
  }

  if (message.type === "reset") {
    prevFrame = null;
    return;
  }

  if (message.type === "frame") {
      const {
        frameId,
        sessionId,
        editVersion,
        width,
        height,
        imageBitmap,
      trackers,
      drawings,
      flowConfig,
      anchorConfig,
      colorSampleRadius,
      reidConfig,
      useServerDetection,
      useAnchorTracking,
      yoloDetections
    } = message;

    if (!offscreenCanvas) {
      offscreenCanvas = new OffscreenCanvas(width, height);
      ctx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
    }

    if (!ctx) {
      imageBitmap.close();
      return;
    }

    if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
      offscreenCanvas.width = width;
      offscreenCanvas.height = height;
      prevFrame = null;
    }

    ctx.drawImage(imageBitmap, 0, 0, width, height);
    imageBitmap.close();

    const currentFrame = ctx.getImageData(0, 0, width, height);
    const result = await runTrackingFrame({
      prevFrame,
      currentFrame,
      trackers,
      drawings,
      width,
      height,
      flowConfig,
      anchorConfig,
      colorSampleRadius,
      reidConfig,
      useServerDetection,
      useAnchorTracking,
      yoloDetections
    });

    prevFrame = currentFrame;

    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "result",
      frameId,
      sessionId,
      editVersion,
      trackers: result.trackers,
      drawings: result.drawings
    } satisfies WorkerResultMessage);
  }
};
