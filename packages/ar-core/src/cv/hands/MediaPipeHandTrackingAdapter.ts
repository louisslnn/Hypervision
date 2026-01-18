import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

import { HandLandmarksDTO, Handedness } from "../../types/hand";
import { TrackingQualityDTO } from "../../types/tracking";

import { HandTrackingPort, HandTrackingResult } from "./HandTrackingPort";

export type MediaPipeHandTrackingOptions = {
  modelAssetPath?: string;
  wasmBaseUrl?: string;
  numHands?: number;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
};

const DEFAULT_MODEL_ASSET_FLOAT16 =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const DEFAULT_MODEL_ASSET_FLOAT32 =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float32/latest/hand_landmarker.task";
const DEFAULT_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const DEFAULT_MIN_CONFIDENCE = 0.5;

export class MediaPipeHandTrackingAdapter implements HandTrackingPort {
  private options: MediaPipeHandTrackingOptions;
  private landmarker: HandLandmarker | null = null;
  private lastTimestampMs: number | null = null;

  constructor(options: MediaPipeHandTrackingOptions = {}) {
    this.options = options;
  }

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      this.options.wasmBaseUrl ?? DEFAULT_WASM_BASE
    );

    this.lastTimestampMs = null;
    const createLandmarker = async (modelAssetPath: string) =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath
        },
        numHands: this.options.numHands ?? 2,
        minHandDetectionConfidence:
          this.options.minHandDetectionConfidence ?? DEFAULT_MIN_CONFIDENCE,
        minHandPresenceConfidence: this.options.minHandPresenceConfidence ?? DEFAULT_MIN_CONFIDENCE,
        minTrackingConfidence: this.options.minTrackingConfidence ?? DEFAULT_MIN_CONFIDENCE,
        runningMode: "VIDEO"
      });

    this.landmarker?.close();
    const primaryModel = this.options.modelAssetPath ?? DEFAULT_MODEL_ASSET_FLOAT16;
    try {
      this.landmarker = await createLandmarker(primaryModel);
    } catch (error) {
      if (!this.options.modelAssetPath && primaryModel === DEFAULT_MODEL_ASSET_FLOAT16) {
        this.landmarker = await createLandmarker(DEFAULT_MODEL_ASSET_FLOAT32);
      } else {
        throw error;
      }
    }
  }

  async detect(video: HTMLVideoElement, timestampMs: number): Promise<HandTrackingResult> {
    if (!this.landmarker) {
      throw new Error("Hand landmarker not initialized");
    }

    let safeTimestampMs = Math.floor(timestampMs);
    if (!Number.isFinite(safeTimestampMs) || safeTimestampMs < 0) {
      safeTimestampMs = Math.floor(performance.now());
    }
    if (this.lastTimestampMs !== null && safeTimestampMs <= this.lastTimestampMs) {
      safeTimestampMs = this.lastTimestampMs + 1;
    }
    this.lastTimestampMs = safeTimestampMs;

    const start = performance.now();
    const result = this.landmarker.detectForVideo(video, safeTimestampMs);
    const latencyMs = performance.now() - start;

    const landmarks: HandLandmarksDTO[] = (result.landmarks ?? []).map((hand, index) => {
      const handedness = result.handednesses?.[index]?.[0]?.categoryName;
      const score = result.handednesses?.[index]?.[0]?.score;

      const base = {
        handId: `hand-${index}`,
        landmarks: hand.map((point) => ({ x: point.x, y: point.y, z: point.z })),
        handedness: parseHandedness(handedness)
      };

      return score !== undefined ? { ...base, score } : base;
    });

    const confidence =
      landmarks.length === 0
        ? 0
        : landmarks.reduce((sum, hand) => sum + (hand.score ?? 0.5), 0) / landmarks.length;

    const quality: TrackingQualityDTO = {
      confidence,
      fps: 0,
      latencyMs
    };

    return {
      landmarks,
      quality,
      timestampMs: safeTimestampMs
    };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastTimestampMs = null;
  }
}

function parseHandedness(input?: string): Handedness {
  if (input === "Left" || input === "Right") {
    return input;
  }
  return "Unknown";
}
