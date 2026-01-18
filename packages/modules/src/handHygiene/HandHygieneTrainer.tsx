"use client";

import {
  MediaPipeHandTrackingAdapter,
  syncCanvasToVideo,
  TrackingQualityDTO
} from "@hypervision/ar-core";
import { useEffect, useRef, useState } from "react";

const TARGET_SECONDS = 20;

export function HandHygieneTrainer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [handsVisible, setHandsVisible] = useState(false);
  const [quality, setQuality] = useState<TrackingQualityDTO | null>(null);

  useEffect(() => {
    let active = true;
    const video = videoRef.current;
    if (!video) {
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (!active) {
          return;
        }
        video.srcObject = stream;
        video.play().catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const adapter = new MediaPipeHandTrackingAdapter();
    let rafId: number | null = null;
    let startTime = 0;
    let active = true;

    const run = async () => {
      if (!videoRef.current || !canvasRef.current) {
        return;
      }

      await adapter.init();

      const loop = (timestamp: number) => {
        if (!active || !videoRef.current || !canvasRef.current) {
          return;
        }
        const canvas = canvasRef.current;
        const videoEl = videoRef.current;
        if (!canvas || !videoEl) {
          rafId = requestAnimationFrame(loop);
          return;
        }

        syncCanvasToVideo(canvas, videoEl);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          rafId = requestAnimationFrame(loop);
          return;
        }

        adapter
          .detect(videoEl, timestamp)
          .then((result) => {
            const hands = result.landmarks;
            setQuality({ ...result.quality, fps: 0 });
            setHandsVisible(hands.length >= 2);

            if (hands.length >= 2) {
              if (!startTime) {
                startTime = timestamp;
              }
              const elapsedSeconds = (timestamp - startTime) / 1000;
              setElapsed(Math.min(elapsedSeconds, TARGET_SECONDS));
            } else {
              startTime = 0;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "rgba(0, 160, 120, 0.8)";
            hands.forEach((hand) => {
              const tip = hand.landmarks[8];
              if (tip) {
                ctx.beginPath();
                ctx.arc(tip.x * canvas.width, tip.y * canvas.height, 8, 0, Math.PI * 2);
                ctx.fill();
              }
            });
          })
          .catch(() => undefined)
          .finally(() => {
            rafId = requestAnimationFrame(loop);
          });
      };

      rafId = requestAnimationFrame(loop);
    };

    run().catch(() => undefined);

    return () => {
      active = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      adapter.close();
    };
  }, []);

  const progress = Math.min(100, (elapsed / TARGET_SECONDS) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full max-w-3xl">
        <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-sm">Hands visible: {handsVisible ? "yes" : "no"}</div>
        <div className="text-sm">Target: {TARGET_SECONDS}s of rubbing</div>
        <div className="w-full h-3 rounded-full bg-gray-200">
          <div className="h-3 rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-sm">Progress: {elapsed.toFixed(1)}s</div>
        {quality && (
          <div className="text-xs text-gray-500">Latency: {quality.latencyMs.toFixed(1)}ms</div>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Educational training demo only. No recordings or uploads are performed.
      </p>
    </div>
  );
}
