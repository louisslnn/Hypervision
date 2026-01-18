export type GestureThresholds = {
  pinchDistance: number;
  pinchReleaseDistance: number;
  smoothFactor: number;
};

export const DEFAULT_GESTURE_THRESHOLDS: GestureThresholds = {
  pinchDistance: 0.08,
  pinchReleaseDistance: 0.11,
  smoothFactor: 0.3
};
