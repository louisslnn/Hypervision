"use client";

import { syncCanvasToVideo } from "@hypervision/ar-core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  TRACKING_PRESETS,
  buildLumaFrame,
  buildTrackingConfig,
  computeMotionScore,
  createTracker,
  updateTrackers,
  ClickTracker,
  TrackingProfile
} from "../shared/clickTracking";
import { useDetectionClient, drawDetections, DetectionMode } from "../shared/detectionClient";

// Server detection configuration
const DETECTION_SERVER_URL =
  typeof window !== "undefined"
    ? ((window as { ENV_DETECTION_SERVER?: string }).ENV_DETECTION_SERVER ??
      "ws://localhost:8765/ws/detect")
    : "ws://localhost:8765/ws/detect";

type FollowState = "idle" | "locked" | "lost";

const PROFILE_LABELS: Record<TrackingProfile, string> = {
  precision: "Precision",
  balanced: "Balanced",
  performance: "Performance"
};

const styles = {
  container: {
    background: "#0b1120",
    borderRadius: "18px",
    overflow: "hidden",
    color: "white"
  } as React.CSSProperties,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    background: "rgba(255, 255, 255, 0.06)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
    flexWrap: "wrap" as const,
    gap: "12px"
  } as React.CSSProperties,
  titleGroup: {
    display: "flex",
    alignItems: "center",
    gap: "12px"
  } as React.CSSProperties,
  title: {
    margin: 0,
    fontSize: "1.2rem",
    fontWeight: 600
  } as React.CSSProperties,
  badge: {
    fontSize: "0.7rem",
    padding: "4px 10px",
    borderRadius: "999px",
    background: "rgba(59, 130, 246, 0.2)",
    color: "#60a5fa",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    fontWeight: 600
  } as React.CSSProperties,
  metrics: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  metric: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    background: "rgba(255, 255, 255, 0.1)",
    padding: "4px 8px",
    borderRadius: "6px"
  } as React.CSSProperties,
  body: {
    display: "grid",
    gridTemplateColumns: "1fr 280px",
    gap: 0
  } as React.CSSProperties,
  videoSection: {
    borderRight: "1px solid rgba(255, 255, 255, 0.08)"
  } as React.CSSProperties,
  videoContainer: {
    position: "relative" as const,
    aspectRatio: "16/9",
    background: "#000"
  } as React.CSSProperties,
  canvas: {
    width: "100%",
    height: "100%",
    cursor: "crosshair"
  } as React.CSSProperties,
  statusChip: {
    position: "absolute" as const,
    top: "16px",
    left: "16px",
    padding: "6px 10px",
    borderRadius: "6px",
    fontSize: "0.75rem",
    fontWeight: 600,
    background: "rgba(15, 23, 42, 0.8)"
  } as React.CSSProperties,
  overlayHint: {
    position: "absolute" as const,
    bottom: "16px",
    left: "16px",
    right: "16px",
    padding: "10px 12px",
    borderRadius: "10px",
    background: "rgba(15, 23, 42, 0.75)",
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.7)",
    textAlign: "center" as const
  } as React.CSSProperties,
  controlBar: {
    display: "flex",
    gap: "8px",
    padding: "12px 16px",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(255, 255, 255, 0.04)",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  controlBtn: {
    background: "rgba(255, 255, 255, 0.1)",
    border: "none",
    color: "white",
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "0.85rem",
    cursor: "pointer"
  } as React.CSSProperties,
  controlBtnActive: {
    background: "#3b82f6"
  } as React.CSSProperties,
  sidePanel: {
    display: "flex",
    flexDirection: "column" as const,
    padding: "16px",
    gap: "16px"
  } as React.CSSProperties,
  panelTitle: {
    margin: "0 0 10px",
    fontSize: "0.9rem",
    fontWeight: 600
  } as React.CSSProperties,
  card: {
    background: "rgba(255, 255, 255, 0.05)",
    borderRadius: "12px",
    padding: "12px",
    border: "1px solid rgba(255, 255, 255, 0.08)"
  } as React.CSSProperties,
  label: {
    fontSize: "0.7rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "rgba(255,255,255,0.5)"
  } as React.CSSProperties,
  value: {
    fontSize: "1rem",
    fontWeight: 600,
    marginTop: "4px"
  } as React.CSSProperties,
  select: {
    width: "100%",
    marginTop: "8px",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "white",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "0.85rem"
  } as React.CSSProperties
};

interface HoloRayFollowProps {
  detectionServerUrl?: string;
}

export function HoloRayFollow({ detectionServerUrl }: HoloRayFollowProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [followState, setFollowState] = useState<FollowState>("idle");
  const [trackers, setTrackers] = useState<ClickTracker[]>([]);
  const [profile, setProfile] = useState<TrackingProfile>("balanced");
  const [trackingFps, setTrackingFps] = useState(0);
  const [qualityScore, setQualityScore] = useState(0);
  const [motionScore, setMotionScore] = useState(0);
  const [showPath, setShowPath] = useState(true);

  // Server-based detection state
  const [useServerDetection, setUseServerDetection] = useState(false);
  const [showServerDetections, setShowServerDetections] = useState(true);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("general");

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
    enabled: useServerDetection && sessionActive && cameraReady,
    targetFps: 12,
    confidenceThreshold: 0.35
  });

  const trackersRef = useRef<ClickTracker[]>([]);
  const configRef = useRef<ReturnType<typeof buildTrackingConfig> | null>(null);
  const prevLumaRef = useRef<Uint8ClampedArray | null>(null);
  const lastTrackingTickRef = useRef(0);
  const trackingFrameCountRef = useRef(0);
  const lastTrackingFpsRef = useRef(performance.now());

  useEffect(() => {
    trackersRef.current = trackers;
  }, [trackers]);

  useEffect(() => {
    let active = true;
    const video = videoRef.current;
    if (!video) return;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        }
      })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        video.play().catch(() => undefined);
        setCameraReady(true);
        setCameraError(null);
      })
      .catch((err) => {
        if (active) {
          setCameraError(
            err.name === "NotAllowedError"
              ? "Camera access denied. Please allow camera access."
              : "Failed to access camera. Please check your device."
          );
        }
      });

    return () => {
      active = false;
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const ensureTrackingConfig = useCallback(
    (video: HTMLVideoElement) => {
      const preset = TRACKING_PRESETS[profile];
      const config = buildTrackingConfig(preset, video.videoWidth, video.videoHeight);
      const canvas = analysisCanvasRef.current ?? document.createElement("canvas");
      analysisCanvasRef.current = canvas;

      if (canvas.width !== config.analysisWidth || canvas.height !== config.analysisHeight) {
        canvas.width = config.analysisWidth;
        canvas.height = config.analysisHeight;
      }

      configRef.current = config;
      return config;
    },
    [profile]
  );

  const captureLumaFrame = useCallback(
    (video: HTMLVideoElement, config: ReturnType<typeof buildTrackingConfig>) => {
      const canvas = analysisCanvasRef.current;
      if (!canvas) {
        return null;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return null;
      }

      ctx.save();
      ctx.translate(config.analysisWidth, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, config.analysisWidth, config.analysisHeight);
      ctx.restore();

      const imageData = ctx.getImageData(0, 0, config.analysisWidth, config.analysisHeight);
      return buildLumaFrame(imageData);
    },
    []
  );

  const toggleSession = useCallback(() => {
    setSessionActive((prev) => !prev);
  }, []);

  const clearTarget = useCallback(() => {
    setTrackers([]);
    trackersRef.current = [];
    setFollowState("idle");
  }, []);

  useEffect(() => {
    clearTarget();
  }, [clearTarget, profile]);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (!cameraReady || !sessionActive || !canvasRef.current || !videoRef.current) return;
      const config = configRef.current ?? ensureTrackingConfig(videoRef.current);
      if (!config) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = config.analysisWidth / rect.width;
      const scaleY = config.analysisHeight / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      const luma = captureLumaFrame(videoRef.current, config);
      if (!luma) return;

      const tracker = createTracker({
        id: `follow-${Date.now()}`,
        label: "Target",
        color: "#60a5fa",
        x,
        y,
        luma,
        width: config.analysisWidth,
        height: config.analysisHeight,
        config,
        now: Date.now()
      });

      if (!tracker) {
        return;
      }

      trackersRef.current = [tracker];
      setTrackers([tracker]);
      setFollowState("locked");
    },
    [cameraReady, captureLumaFrame, ensureTrackingConfig, sessionActive]
  );

  useEffect(() => {
    let rafId: number | null = null;

    const render = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) {
        rafId = requestAnimationFrame(render);
        return;
      }

      if (video.readyState < 2 || video.videoWidth === 0) {
        rafId = requestAnimationFrame(render);
        return;
      }

      syncCanvasToVideo(canvas, video);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(render);
        return;
      }

      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      const config = ensureTrackingConfig(video);
      const scaleX = canvas.width / config.analysisWidth;
      const scaleY = canvas.height / config.analysisHeight;

      if (sessionActive) {
        const interval = 1000 / config.targetFps;
        const now = performance.now();
        if (now - lastTrackingTickRef.current >= interval) {
          lastTrackingTickRef.current = now;
          const luma = captureLumaFrame(video, config);
          if (luma) {
            const motion = computeMotionScore(prevLumaRef.current, luma);
            prevLumaRef.current = motion.next;
            setMotionScore(motion.score);

            // Scale YOLO detections to analysis frame dimensions (from normalized coords)
            const scaleToAnalysis = (val: number, isX: boolean) =>
              val * (isX ? config.analysisWidth : config.analysisHeight);

            const scaledDetections =
              useServerDetection && interpolatedDetections.length > 0
                ? interpolatedDetections.map((det) => ({
                    ...det,
                    bbox: {
                      x1: scaleToAnalysis(det.bbox.x1, true),
                      y1: scaleToAnalysis(det.bbox.y1, false),
                      x2: scaleToAnalysis(det.bbox.x2, true),
                      y2: scaleToAnalysis(det.bbox.y2, false),
                      centerX: scaleToAnalysis(det.bbox.centerX, true),
                      centerY: scaleToAnalysis(det.bbox.centerY, false),
                      width: det.bbox.width * config.analysisWidth,
                      height: det.bbox.height * config.analysisHeight
                    }
                  }))
                : [];

            const update = updateTrackers(
              trackersRef.current,
              luma,
              config.analysisWidth,
              config.analysisHeight,
              config,
              Date.now(),
              {
                detections: scaledDetections,
                yoloWeight: 0.4,
                yoloReacquireRadius: config.searchRadius * 3
              }
            );
            trackersRef.current = update.trackers;
            setTrackers([...update.trackers]);

            const avgConfidence =
              update.trackers.length > 0
                ? update.trackers.reduce((sum, tracker) => sum + tracker.confidence, 0) /
                  update.trackers.length
                : 0;
            setQualityScore(Math.round(avgConfidence));

            if (update.trackers.length === 0) {
              setFollowState("idle");
            } else if (update.trackers[0]?.state === "lost") {
              setFollowState("lost");
            } else {
              setFollowState("locked");
            }

            trackingFrameCountRef.current += 1;
            if (now - lastTrackingFpsRef.current > 1000) {
              setTrackingFps(
                Math.round(
                  (trackingFrameCountRef.current * 1000) / (now - lastTrackingFpsRef.current)
                )
              );
              trackingFrameCountRef.current = 0;
              lastTrackingFpsRef.current = now;
            }
          }
        }

        // Send frame to server for YOLO detection
        if (useServerDetection && serverConnected) {
          sendFrameToServer(canvas);
        }
      }

      renderFollowOverlay(ctx, trackersRef.current, scaleX, scaleY, showPath);

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
    captureLumaFrame,
    ensureTrackingConfig,
    sessionActive,
    showPath,
    useServerDetection,
    serverConnected,
    sendFrameToServer,
    showServerDetections,
    interpolatedDetections
  ]);

  const target = trackers[0];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <h2 style={styles.title}>HoloRay Follow</h2>
          <span style={styles.badge}>Live</span>
        </div>
        <div style={styles.metrics}>
          <span style={styles.metric}>{trackingFps} TPS</span>
          <span style={styles.metric}>Quality {qualityScore}%</span>
          <span style={styles.metric}>Motion {(motionScore * 100).toFixed(1)}%</span>
        </div>
      </div>

      {cameraError && (
        <div
          style={{ padding: "12px 20px", color: "#fca5a5", background: "rgba(239, 68, 68, 0.15)" }}
        >
          {cameraError}
        </div>
      )}

      <div style={styles.body}>
        <div style={styles.videoSection}>
          <div style={styles.videoContainer}>
            <video ref={videoRef} playsInline muted style={{ display: "none" }} />
            <canvas ref={canvasRef} style={styles.canvas} onClick={handleCanvasClick} />
            <div style={styles.statusChip}>
              {followState === "locked" && "Target locked"}
              {followState === "lost" && "Target lost"}
              {followState === "idle" && "Click to lock"}
            </div>
            <div style={styles.overlayHint}>
              Click any object to start following. Click again to retarget.
            </div>
          </div>

          <div style={styles.controlBar}>
            <button
              style={{ ...styles.controlBtn, ...(sessionActive ? styles.controlBtnActive : {}) }}
              onClick={toggleSession}
              disabled={!cameraReady}
            >
              {sessionActive ? "⏸ Pause" : "▶ Start"}
            </button>
            <button style={styles.controlBtn} onClick={clearTarget}>
              Clear target
            </button>
            <button
              style={{ ...styles.controlBtn, ...(showPath ? styles.controlBtnActive : {}) }}
              onClick={() => setShowPath((prev) => !prev)}
            >
              Path
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
                ...styles.controlBtn,
                ...(useServerDetection ? styles.controlBtnActive : {}),
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
              onClick={() => setUseServerDetection(!useServerDetection)}
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
                  style={{
                    ...styles.controlBtn,
                    ...(showServerDetections ? {} : { opacity: 0.5 })
                  }}
                  onClick={() => setShowServerDetections(!showServerDetections)}
                  title="Toggle detection box visibility"
                >
                  {showServerDetections ? "👁" : "👁‍🗨"}
                </button>
                <select
                  style={{
                    ...styles.controlBtn,
                    background: "rgba(255, 255, 255, 0.1)",
                    cursor: "pointer",
                    minWidth: "100px"
                  }}
                  value={detectionMode}
                  onChange={(e) => setDetectionMode(e.target.value as DetectionMode)}
                >
                  <option value="general">🔍 General</option>
                  <option value="security">🛡️ Security</option>
                  <option value="surgical">🏥 Surgical</option>
                </select>
              </>
            )}
          </div>

          {/* Server Detection Status */}
          {useServerDetection && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "8px 16px",
                background: serverConnected ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                borderTop: `1px solid ${serverConnected ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                fontSize: "0.75rem"
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
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: serverConnected ? "#10b981" : "#ef4444"
                  }}
                />
                {serverConnected ? "YOLO Connected" : "Connecting..."}
              </span>
              {serverConnected && (
                <>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>
                    {detectionMetrics.avgInference}ms
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>
                    {interpolatedDetections.length} objects
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.sidePanel}>
          <div style={styles.card}>
            <div style={styles.label}>Tracking profile</div>
            <select
              style={styles.select}
              value={profile}
              onChange={(event) => setProfile(event.target.value as TrackingProfile)}
            >
              {Object.entries(PROFILE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div style={styles.card}>
            <div style={styles.label}>Target status</div>
            <div style={styles.value}>{target ? target.state : "No target"}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.label}>Confidence</div>
            <div style={styles.value}>{target ? `${target.confidence}%` : "--"}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.label}>Velocity</div>
            <div style={styles.value}>
              {target
                ? `${Math.hypot(target.velocity.x, target.velocity.y).toFixed(1)} px/f`
                : "--"}
            </div>
          </div>
          <div style={styles.card}>
            <h3 style={styles.panelTitle}>Follow workflow</h3>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "rgba(255,255,255,0.65)" }}>
              Start the session, click the subject you want to follow, and the tracker will stay
              locked while you move the camera.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderFollowOverlay(
  ctx: CanvasRenderingContext2D,
  trackers: ClickTracker[],
  scaleX: number,
  scaleY: number,
  showPath: boolean
) {
  const tracker = trackers[0];
  if (!tracker) {
    return;
  }

  const drawX = tracker.x * scaleX;
  const drawY = tracker.y * scaleY;

  if (showPath && tracker.history.length > 3) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(96, 165, 250, 0.8)";
    ctx.lineWidth = 2;
    const start = tracker.history[0];
    if (start) {
      ctx.moveTo(start.x * scaleX, start.y * scaleY);
      tracker.history.slice(1).forEach((point, index) => {
        ctx.globalAlpha = Math.max(0.2, index / tracker.history.length);
        ctx.lineTo(point.x * scaleX, point.y * scaleY);
      });
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = "rgba(96, 165, 250, 0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(drawX, drawY, 22, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(96, 165, 250, 0.2)";
  ctx.beginPath();
  ctx.arc(drawX, drawY, 16, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "12px system-ui, sans-serif";
  const label = `Target ${tracker.confidence}%`;
  const metrics = ctx.measureText(label);
  const padding = 6;
  const labelX = drawX - metrics.width / 2 - padding;
  const labelY = drawY - 32;

  ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
  ctx.beginPath();
  ctx.roundRect(labelX, labelY - 10, metrics.width + padding * 2, 18, 4);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.fillText(label, labelX + padding, labelY + 3);
}