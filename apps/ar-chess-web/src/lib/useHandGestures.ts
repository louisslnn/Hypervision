import {
  DEFAULT_GESTURE_THRESHOLDS,
  GestureEventDTO,
  HomographyMatrix,
  MediaPipeHandTrackingAdapter,
  Vector2Filter
} from "@hypervision/ar-core";
import { useEffect, useRef, useState } from "react";

import { screenToSquare } from "./boardMapping";

export type GestureHookState = {
  cursor: { x: number; y: number } | undefined;
  pinchActive: boolean;
  fps: number;
  latencyMs: number;
};

type UseHandGesturesOptions = {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  inverseHomography: HomographyMatrix | null;
  onEvent: (event: GestureEventDTO) => void;
};

export function useHandGestures({
  enabled,
  videoRef,
  inverseHomography,
  onEvent
}: UseHandGesturesOptions) {
  const [state, setState] = useState<GestureHookState>({
    cursor: undefined,
    pinchActive: false,
    fps: 0,
    latencyMs: 0
  });
  const pinchActiveRef = useRef(false);

  // Use refs to always access the latest values in the animation loop
  const inverseHomographyRef = useRef(inverseHomography);
  const onEventRef = useRef(onEvent);

  // Keep refs in sync
  useEffect(() => {
    inverseHomographyRef.current = inverseHomography;
  }, [inverseHomography]);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const adapter = new MediaPipeHandTrackingAdapter();
    const filter = new Vector2Filter(DEFAULT_GESTURE_THRESHOLDS.smoothFactor);
    let rafId: number | null = null;
    let lastFrameTime = performance.now();
    let lastFpsUpdate = performance.now();
    let active = true;

    const loop = async (timestamp: number) => {
      const video = videoRef.current;
      if (!video || !active) {
        return;
      }

      try {
        const result = await adapter.detect(video, timestamp);
        const hands = result.landmarks;

        const fpsNow = 1000 / Math.max(1, timestamp - lastFrameTime);
        lastFrameTime = timestamp;
        if (timestamp - lastFpsUpdate > 500) {
          setState((prev) => ({ ...prev, fps: fpsNow }));
          lastFpsUpdate = timestamp;
        }

        const primary = hands[0];
        if (!primary) {
          setState((prev) => ({ ...prev, cursor: undefined, pinchActive: false }));
          pinchActiveRef.current = false;
          return;
        }

        const thumb = primary.landmarks[4];
        const index = primary.landmarks[8];
        if (!thumb || !index) {
          return;
        }

        const pinchDistance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        const wasPinching = pinchActiveRef.current;
        const isPinching =
          pinchDistance < DEFAULT_GESTURE_THRESHOLDS.pinchDistance ||
          (wasPinching && pinchDistance < DEFAULT_GESTURE_THRESHOLDS.pinchReleaseDistance);

        pinchActiveRef.current = isPinching;

        const rawCursor = {
          // Don't flip x here - the canvas is already CSS-flipped
          x: (thumb.x + index.x) / 2,
          y: (thumb.y + index.y) / 2
        };
        const filtered = filter.update(rawCursor);

        const width = video.clientWidth || video.videoWidth;
        const height = video.clientHeight || video.videoHeight;
        const cursor = {
          x: filtered.x * width,
          y: filtered.y * height
        };

        // Use ref to get latest homography
        const currentHomography = inverseHomographyRef.current;
        const overSquare = currentHomography ? screenToSquare(currentHomography, cursor) : null;

        const cursorEvent: GestureEventDTO = {
          type: "CURSOR_MOVE",
          timestampMs: timestamp,
          cursor,
          ...(overSquare ? { overSquare } : {})
        };
        onEventRef.current(cursorEvent);

        onEventRef.current({
          type: "CONFIRM_TICK",
          timestampMs: timestamp
        });

        if (!wasPinching && isPinching) {
          const pinchDown: GestureEventDTO = {
            type: "PINCH_DOWN",
            timestampMs: timestamp,
            cursor,
            ...(overSquare ? { overSquare } : {})
          };
          onEventRef.current(pinchDown);
        }

        if (wasPinching && !isPinching) {
          const pinchUp: GestureEventDTO = {
            type: "PINCH_UP",
            timestampMs: timestamp,
            cursor,
            ...(overSquare ? { overSquare } : {})
          };
          onEventRef.current(pinchUp);
        }

        setState({
          cursor,
          pinchActive: isPinching,
          fps: fpsNow,
          latencyMs: result.quality.latencyMs
        });
      } catch {
        setState((prev) => ({ ...prev, pinchActive: false }));
      } finally {
        rafId = requestAnimationFrame(loop);
      }
    };

    adapter.init().then(() => {
      rafId = requestAnimationFrame(loop);
    });

    return () => {
      active = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      adapter.close();
      filter.reset();
    };
  }, [enabled, videoRef]);

  return state;
}
