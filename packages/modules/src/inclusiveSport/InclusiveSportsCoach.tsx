"use client";

import {
  MediaPipeHandTrackingAdapter,
  syncCanvasToVideo,
  TrackingQualityDTO
} from "@hypervision/ar-core";
import { useEffect, useMemo, useRef, useState } from "react";

type DrillMode = "reaction" | "reaction-clear" | "sync";
type AccessibilityMode = "standard" | "large" | "high-contrast";
type CameraFacing = "user" | "environment";

type TargetDefinition = {
  id: string;
  label: string;
  x: number;
  y: number;
};

type ActiveTarget = TargetDefinition & {
  radius: number;
};

type ScoreState = {
  hits: number;
  misses: number;
  streak: number;
  lastReactionMs: number | null;
  averageReactionMs: number | null;
  reactionTimesMs: number[];
};

type HandPoint = {
  x: number;
  y: number;
};

type TargetWindow = {
  targets: ActiveTarget[];
  createdAt: number;
  expiresAt: number;
};

type AgeRangeOption = {
  id: string;
  label: string;
  medianMs: number;
  averageMs: number;
};

const TARGETS: TargetDefinition[] = [
  { id: "left", label: "Left wing", x: 0.18, y: 0.55 },
  { id: "right", label: "Right wing", x: 0.82, y: 0.55 },
  { id: "high", label: "High zone", x: 0.5, y: 0.2 },
  { id: "low", label: "Low zone", x: 0.5, y: 0.82 },
  { id: "center", label: "Center", x: 0.5, y: 0.52 }
];

const AGE_RANGES: AgeRangeOption[] = [
  { id: "under-18", label: "Under 18", medianMs: 230, averageMs: 250 },
  { id: "18-29", label: "18-29", medianMs: 250, averageMs: 270 },
  { id: "30-39", label: "30-39", medianMs: 260, averageMs: 285 },
  { id: "40-49", label: "40-49", medianMs: 275, averageMs: 300 },
  { id: "50-59", label: "50-59", medianMs: 295, averageMs: 325 },
  { id: "60-plus", label: "60+", medianMs: 320, averageMs: 355 }
];

const QUALITY_UPDATE_MS = 350;
const BASE_WINDOW_MS = 3200;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pickRandomTargets = (count: number) => {
  const pool = [...TARGETS];
  const picked: TargetDefinition[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const choice = pool[index];
    if (!choice) {
      break;
    }
    picked.push(choice);
    pool.splice(index, 1);
  }
  return picked;
};

export function InclusiveSportsCoach() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [drillMode, setDrillMode] = useState<DrillMode>("reaction");
  const [accessibility, setAccessibility] = useState<AccessibilityMode>("standard");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user");
  const [ageRangeId, setAgeRangeId] = useState<string>("");
  const [quality, setQuality] = useState<TrackingQualityDTO | null>(null);
  const [handsDetected, setHandsDetected] = useState(0);
  const [statusText, setStatusText] = useState("Ready to start.");
  const [targets, setTargets] = useState<ActiveTarget[]>([]);
  const [score, setScore] = useState<ScoreState>({
    hits: 0,
    misses: 0,
    streak: 0,
    lastReactionMs: null,
    averageReactionMs: null,
    reactionTimesMs: []
  });

  const targetRef = useRef<TargetWindow | null>(null);
  const scoreRef = useRef(score);
  const statusRef = useRef(statusText);
  const targetsRef = useRef<ActiveTarget[]>([]);
  const clearWaitRef = useRef(false);
  const clearTargetsRef = useRef<ActiveTarget[] | null>(null);
  const controlRef = useRef({ sessionActive, drillMode, accessibility, voiceEnabled });
  const lastSpokenRef = useRef("");
  const lastQualityUpdateRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    statusRef.current = statusText;
  }, [statusText]);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    controlRef.current = { sessionActive, drillMode, accessibility, voiceEnabled };
  }, [sessionActive, drillMode, accessibility, voiceEnabled]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let active = true;
    setCameraError(null);
    setTrackingError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera not supported on this device.");
      return;
    }

    const requestConstraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: cameraFacing },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    navigator.mediaDevices
      .getUserMedia(requestConstraints)
      .then((stream) => {
        if (!active) {
          return;
        }
        video.setAttribute("playsinline", "true");
        video.muted = true;
        video.srcObject = stream;
        const tryPlay = () => {
          video
            .play()
            .catch(() => setCameraError("Camera playback blocked. Tap Start session to allow it."));
        };
        if (video.readyState >= 1) {
          tryPlay();
        } else {
          video.addEventListener("loadedmetadata", tryPlay, { once: true });
        }
      })
      .catch((error) => {
        if (active) {
          setCameraError(
            error?.name === "NotAllowedError"
              ? "Camera permission denied."
              : "Unable to access camera."
          );
        }
      });

    return () => {
      active = false;
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraFacing]);

  useEffect(() => {
    if (!sessionActive) {
      targetRef.current = null;
      setTargets([]);
      clearWaitRef.current = false;
      clearTargetsRef.current = null;
      setStatusText("Session paused.");
    } else {
      setStatusText("Session active.");
    }
  }, [sessionActive]);

  const speak = (text: string) => {
    if (!controlRef.current.voiceEnabled || typeof window === "undefined") {
      return;
    }
    if (lastSpokenRef.current === text) {
      return;
    }
    lastSpokenRef.current = text;
    const synth = window.speechSynthesis;
    if (!synth) {
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    synth.speak(utterance);
  };

  const updateStatus = (message: string) => {
    if (statusRef.current === message) {
      return;
    }
    statusRef.current = message;
    setStatusText(message);
  };

  const resetSession = () => {
    targetRef.current = null;
    setTargets([]);
    clearWaitRef.current = false;
    clearTargetsRef.current = null;
    setScore({
      hits: 0,
      misses: 0,
      streak: 0,
      lastReactionMs: null,
      averageReactionMs: null,
      reactionTimesMs: []
    });
    updateStatus("Session reset.");
  };

  const toggleSession = () => {
    const video = videoRef.current;
    if (video?.paused) {
      video
        .play()
        .catch(() => setCameraError("Camera playback blocked. Tap Start session to allow it."));
    }
    setSessionActive((prev) => !prev);
  };

  const targetRadius = accessibility === "large" ? 0.16 : 0.12;
  const targetWindowMs =
    drillMode === "sync"
      ? accessibility === "large"
        ? BASE_WINDOW_MS + 1000
        : BASE_WINDOW_MS + 600
      : accessibility === "large"
        ? BASE_WINDOW_MS + 600
        : BASE_WINDOW_MS;

  const spawnTargets = () => {
    const isSync = controlRef.current.drillMode === "sync";
    const isReactionClear = controlRef.current.drillMode === "reaction-clear";
    const count = isSync ? 2 : 1;
    const now = Date.now();
    const selection = pickRandomTargets(count).map((target) => ({
      ...target,
      radius: targetRadius
    }));
    const reachLabel = selection[0]?.label ?? "target";
    targetRef.current = {
      targets: selection,
      createdAt: now,
      expiresAt: now + targetWindowMs
    };
    setTargets(selection);
    updateStatus(
      isSync
        ? "Sync target: hit both zones together."
        : isReactionClear
          ? `Reach ${reachLabel}. Clear hands before the next target.`
          : `Reach ${reachLabel}.`
    );
    speak(isSync ? "Sync targets" : reachLabel);
  };

  const registerHit = (reactionMs: number, statusOverride?: string) => {
    const nextReactionTimes = [...scoreRef.current.reactionTimesMs, reactionMs];
    const nextHits = scoreRef.current.hits + 1;
    const nextAverage =
      scoreRef.current.averageReactionMs === null
        ? reactionMs
        : (scoreRef.current.averageReactionMs * scoreRef.current.hits + reactionMs) / nextHits;
    const nextScore: ScoreState = {
      hits: nextHits,
      misses: scoreRef.current.misses,
      streak: scoreRef.current.streak + 1,
      lastReactionMs: reactionMs,
      averageReactionMs: nextAverage,
      reactionTimesMs: nextReactionTimes
    };
    scoreRef.current = nextScore;
    setScore(nextScore);
    updateStatus(statusOverride ?? "Nice. New target.");
    speak("Nice");
  };

  const registerMiss = () => {
    const nextScore: ScoreState = {
      hits: scoreRef.current.hits,
      misses: scoreRef.current.misses + 1,
      streak: 0,
      lastReactionMs: scoreRef.current.lastReactionMs,
      averageReactionMs: scoreRef.current.averageReactionMs,
      reactionTimesMs: scoreRef.current.reactionTimesMs
    };
    scoreRef.current = nextScore;
    setScore(nextScore);
    updateStatus("Missed. Try again.");
    speak("Reset");
  };

  const matchTargets = (activeTargets: ActiveTarget[], hands: HandPoint[]) => {
    if (hands.length === 0) {
      return false;
    }
    const used = new Set<number>();
    for (const target of activeTargets) {
      let chosenIndex: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      hands.forEach((hand, index) => {
        if (used.has(index)) {
          return;
        }
        const dx = hand.x - target.x;
        const dy = hand.y - target.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= target.radius && distance < bestDistance) {
          bestDistance = distance;
          chosenIndex = index;
        }
      });
      if (chosenIndex === null) {
        return false;
      }
      used.add(chosenIndex);
    }
    return true;
  };

  const areHandsClear = (activeTargets: ActiveTarget[], hands: HandPoint[]) => {
    for (const hand of hands) {
      for (const target of activeTargets) {
        const dx = hand.x - target.x;
        const dy = hand.y - target.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= target.radius) {
          return false;
        }
      }
    }
    return true;
  };

  useEffect(() => {
    const adapter = new MediaPipeHandTrackingAdapter({
      numHands: 2,
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    });
    let rafId: number | null = null;
    let active = true;

    const run = async () => {
      if (!videoRef.current || !canvasRef.current) {
        return;
      }
      try {
        await adapter.init();
      } catch {
        if (active) {
          setTrackingError("Hand tracking failed to load. Check your network or refresh the page.");
          updateStatus("Hand tracking unavailable.");
        }
        return;
      }

      const loop = (timestamp: number) => {
        if (!active || !videoRef.current || !canvasRef.current) {
          return;
        }

        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
          if (controlRef.current.sessionActive) {
            updateStatus("Camera warming up.");
          }
          rafId = requestAnimationFrame(loop);
          return;
        }
        syncCanvasToVideo(canvas, video);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          rafId = requestAnimationFrame(loop);
          return;
        }

        const timestampMs = Number.isFinite(video.currentTime)
          ? video.currentTime * 1000
          : timestamp;

        adapter
          .detect(video, timestampMs)
          .then((result) => {
            const hands: HandPoint[] = result.landmarks
              .map((hand) => hand.landmarks[8])
              .filter((point) => Boolean(point))
              .map((point) => ({
                x: clamp(point?.x ?? 0, 0, 1),
                y: clamp(point?.y ?? 0, 0, 1)
              }));

            if (timestamp - lastQualityUpdateRef.current > QUALITY_UPDATE_MS) {
              const lastFrame = lastFrameRef.current;
              const fps = lastFrame ? 1000 / Math.max(1, timestamp - lastFrame) : 0;
              lastFrameRef.current = timestamp;
              lastQualityUpdateRef.current = timestamp;
              setHandsDetected(hands.length);
              setQuality({ ...result.quality, fps });
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const liveTargets = targetsRef.current;
            liveTargets.forEach((target) => {
              ctx.beginPath();
              ctx.arc(
                target.x * canvas.width,
                target.y * canvas.height,
                target.radius * canvas.width,
                0,
                Math.PI * 2
              );
              ctx.fillStyle =
                accessibility === "high-contrast"
                  ? "rgba(255, 255, 255, 0.25)"
                  : "rgba(255, 255, 255, 0.15)";
              ctx.fill();
              ctx.lineWidth = accessibility === "high-contrast" ? 3 : 2;
              ctx.strokeStyle =
                accessibility === "high-contrast"
                  ? "rgba(255, 255, 255, 0.95)"
                  : "rgba(255, 255, 255, 0.75)";
              ctx.stroke();
            });

            hands.forEach((hand) => {
              ctx.beginPath();
              ctx.arc(hand.x * canvas.width, hand.y * canvas.height, 8, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(47, 124, 95, 0.9)";
              ctx.fill();
            });

            if (!controlRef.current.sessionActive) {
              return;
            }

            const isReactionClear = controlRef.current.drillMode === "reaction-clear";
            const needsHands = controlRef.current.drillMode === "sync" ? 2 : 1;
            if (hands.length < needsHands) {
              updateStatus("Waiting for players.");
              return;
            }

            if (isReactionClear && clearWaitRef.current) {
              const clearTargets = clearTargetsRef.current ?? [];
              if (clearTargets.length === 0 || areHandsClear(clearTargets, hands)) {
                clearWaitRef.current = false;
                clearTargetsRef.current = null;
                spawnTargets();
              } else {
                updateStatus("Clear hands for next target.");
              }
              return;
            }

            if (!targetRef.current) {
              spawnTargets();
              return;
            }

            const now = Date.now();
            const activeTargetWindow = targetRef.current;
            if (now > activeTargetWindow.expiresAt) {
              registerMiss();
              spawnTargets();
              return;
            }

            const hit = matchTargets(activeTargetWindow.targets, hands);
            if (hit) {
              if (isReactionClear) {
                registerHit(now - activeTargetWindow.createdAt, "Clear hands for next target.");
                clearWaitRef.current = true;
                clearTargetsRef.current = activeTargetWindow.targets;
                targetRef.current = null;
                setTargets([]);
                return;
              }
              registerHit(now - activeTargetWindow.createdAt);
              spawnTargets();
            }
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
  }, [accessibility, targetRadius, targetWindowMs]);

  const accuracy = useMemo(() => {
    const total = score.hits + score.misses;
    return total === 0 ? 0 : Math.round((score.hits / total) * 100);
  }, [score]);

  const sessionStats = useMemo(() => {
    const times = score.reactionTimesMs;
    if (times.length === 0) {
      return null;
    }
    const sorted = [...times].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const upper = sorted[mid] ?? 0;
    const lower = sorted[mid - 1] ?? upper;
    const medianMs = sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
    const averageMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    return {
      count: times.length,
      medianMs,
      averageMs
    };
  }, [score.reactionTimesMs]);

  const selectedAgeRange = useMemo(
    () => AGE_RANGES.find((range) => range.id === ageRangeId) ?? null,
    [ageRangeId]
  );

  const formatMs = (valueMs: number) => `${(valueMs / 1000).toFixed(2)}s`;

  const insight = useMemo(() => {
    if (!sessionStats || !selectedAgeRange) {
      return null;
    }
    const deltaMs = sessionStats.medianMs - selectedAgeRange.medianMs;
    const absMs = Math.abs(deltaMs);
    const thresholdMs = 30;
    if (absMs < thresholdMs) {
      return {
        label: "In range",
        detail: `Within about ${formatMs(thresholdMs)} of the typical median for your age range.`
      };
    }
    const direction = deltaMs < 0 ? "faster" : "slower";
    return {
      label: direction === "faster" ? "Above typical" : "Below typical",
      detail: `About ${formatMs(absMs)} ${direction} than the typical median for your age range.`
    };
  }, [sessionStats, selectedAgeRange]);

  const mirrorView = cameraFacing === "user";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="relative w-full">
        <video
          ref={videoRef}
          className="w-full rounded-lg bg-black"
          playsInline
          muted
          style={mirrorView ? { transform: "scaleX(-1)" } : undefined}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={mirrorView ? { transform: "scaleX(-1)" } : undefined}
        />
      </div>
      {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}
      {trackingError && <p className="text-sm text-red-600">{trackingError}</p>}
      <div className="text-sm font-semibold">Inclusive Sports Coach</div>
      <p className="text-sm text-gray-700">{statusText}</p>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}
      >
        <div className="p-3 bg-white/70 rounded-md border">
          <div className="text-xs uppercase text-gray-500">Hits</div>
          <div className="text-lg font-semibold">{score.hits}</div>
        </div>
        <div className="p-3 bg-white/70 rounded-md border">
          <div className="text-xs uppercase text-gray-500">Misses</div>
          <div className="text-lg font-semibold">{score.misses}</div>
        </div>
        <div className="p-3 bg-white/70 rounded-md border">
          <div className="text-xs uppercase text-gray-500">Accuracy</div>
          <div className="text-lg font-semibold">{accuracy}%</div>
        </div>
        <div className="p-3 bg-white/70 rounded-md border">
          <div className="text-xs uppercase text-gray-500">Reaction</div>
          <div className="text-lg font-semibold">
            {score.lastReactionMs ? `${(score.lastReactionMs / 1000).toFixed(2)}s` : "--"}
          </div>
        </div>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px" }}
      >
        <label className="text-xs text-gray-600">
          Drill mode
          <select
            value={drillMode}
            onChange={(event) => setDrillMode(event.target.value as DrillMode)}
            style={{ width: "100%", marginTop: "4px", padding: "6px", borderRadius: "8px" }}
          >
            <option value="reaction">Reaction single</option>
            <option value="reaction-clear">Reaction reset</option>
            <option value="sync">Co-op sync</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Accessibility
          <select
            value={accessibility}
            onChange={(event) => setAccessibility(event.target.value as AccessibilityMode)}
            style={{ width: "100%", marginTop: "4px", padding: "6px", borderRadius: "8px" }}
          >
            <option value="standard">Standard</option>
            <option value="large">Large targets</option>
            <option value="high-contrast">High contrast</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Camera
          <select
            value={cameraFacing}
            onChange={(event) => setCameraFacing(event.target.value as CameraFacing)}
            style={{ width: "100%", marginTop: "4px", padding: "6px", borderRadius: "8px" }}
          >
            <option value="user">Front</option>
            <option value="environment">Rear</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Voice cues
          <select
            value={voiceEnabled ? "on" : "off"}
            onChange={(event) => setVoiceEnabled(event.target.value === "on")}
            style={{ width: "100%", marginTop: "4px", padding: "6px", borderRadius: "8px" }}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Age range
          <select
            value={ageRangeId}
            onChange={(event) => setAgeRangeId(event.target.value)}
            style={{ width: "100%", marginTop: "4px", padding: "6px", borderRadius: "8px" }}
          >
            <option value="">Select</option>
            {AGE_RANGES.map((range) => (
              <option key={range.id} value={range.id}>
                {range.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button
          className="button"
          style={{
            background: sessionActive ? "var(--color-ember)" : "var(--color-moss)",
            color: "white",
            padding: "8px 14px",
            borderRadius: "10px"
          }}
          onClick={toggleSession}
        >
          {sessionActive ? "Pause session" : "Start session"}
        </button>
        <button
          className="button"
          style={{
            background: "var(--color-slate)",
            color: "white",
            padding: "8px 14px",
            borderRadius: "10px"
          }}
          onClick={resetSession}
        >
          Reset
        </button>
      </div>
      {!sessionActive && sessionStats && (
        <div className="p-3 bg-white/70 rounded-md border">
          <div className="text-sm font-semibold">Session summary</div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "8px",
              marginTop: "8px"
            }}
          >
            <div>
              <div className="text-xs uppercase text-gray-500">Your median</div>
              <div className="text-lg font-semibold">{formatMs(sessionStats.medianMs)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Your average</div>
              <div className="text-lg font-semibold">{formatMs(sessionStats.averageMs)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Age median</div>
              <div className="text-lg font-semibold">
                {selectedAgeRange ? formatMs(selectedAgeRange.medianMs) : "--"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Age average</div>
              <div className="text-lg font-semibold">
                {selectedAgeRange ? formatMs(selectedAgeRange.averageMs) : "--"}
              </div>
            </div>
          </div>
          {insight && (
            <div style={{ marginTop: "8px" }}>
              <div className="text-xs uppercase text-gray-500">Insight</div>
              <div className="text-sm text-gray-700">
                {insight.label}. {insight.detail}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500" style={{ marginTop: "8px" }}>
            Benchmarks are general references and are not a medical assessment.
          </p>
        </div>
      )}
      <details className="debug-section">
        <summary>Debug metrics</summary>
        <div className="debug-content">
          <span>Hands detected: {handsDetected}</span>
          <span>
            Tracking:{" "}
            {quality
              ? `fps ${quality.fps.toFixed(1)} | latency ${quality.latencyMs.toFixed(0)}ms`
              : "pending"}
          </span>
          <span>Targets: {targets.map((target) => target.label).join(", ") || "none"}</span>
          <span>
            Average reaction:{" "}
            {score.averageReactionMs ? `${(score.averageReactionMs / 1000).toFixed(2)}s` : "--"}
          </span>
          <span>Streak: {score.streak}</span>
        </div>
      </details>
      <p className="text-xs text-gray-500">
        Cooperative sports drill powered by hand tracking. No recordings or uploads are performed.
      </p>
    </div>
  );
}
