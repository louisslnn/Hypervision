import React from "react";

type PerfHudProps = {
  fps: number;
  latencyMs: number;
  visible: boolean;
};

export function PerfHud({ fps, latencyMs, visible }: PerfHudProps) {
  if (!visible) {
    return null;
  }
  return (
    <div className="absolute top-4 right-4 px-3 py-2 rounded-md bg-black/70 text-white text-xs">
      <div>FPS: {fps.toFixed(1)}</div>
      <div>Inference: {latencyMs.toFixed(1)}ms</div>
    </div>
  );
}
