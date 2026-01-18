"use client";

import { syncCanvasToVideo } from "@hypervision/ar-core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  identifyObjectWithFeatures,
  validateTrackedObject,
  findObjectInFrame,
  AI_TRACKING_CONFIG
} from "../shared/aiObjectTracking";
import {
  TRACKING_PRESETS,
  buildLumaFrame,
  buildTrackingConfig,
  computeMotionScore,
  createTracker,
  updateTrackers,
  ClickTracker,
  TrackingProfile,
  TrackerState,
  LabelStatus
} from "../shared/clickTracking";
import { useDetectionClient, drawDetections, DetectionMode } from "../shared/detectionClient";

// Server detection configuration
const DETECTION_SERVER_URL =
  typeof window !== "undefined"
    ? ((window as { ENV_DETECTION_SERVER?: string }).ENV_DETECTION_SERVER ??
      "ws://localhost:8765/ws/detect")
    : "ws://localhost:8765/ws/detect";

type AnnotationStyle = "minimal" | "standard" | "detailed" | "gaming";

type TrackingMode = "single" | "multi";

type AlertType = "motion" | "zone" | "lost" | "info";

interface Alert {
  id: string;
  type: AlertType;
  message: string;
  timestamp: number;
  trackerId?: string | undefined;
}

const COLORS = ["#10b981", "#f59e0b", "#3b82f6", "#ef4444", "#8b5cf6", "#ec4899"];
const STYLE_NAMES: AnnotationStyle[] = ["minimal", "standard", "detailed", "gaming"];
const PROFILE_LABELS: Record<TrackingProfile, string> = {
  precision: "Precision",
  balanced: "Balanced",
  performance: "Performance"
};

const MODE_LABELS: Record<TrackingMode, string> = {
  single: "Single Target",
  multi: "Multi Target"
};

const UI_UPDATE_MS = 160;
const ALERT_LIMIT = 12;

const styles = {
  container: {
    background: "#0f172a",
    borderRadius: "16px",
    overflow: "hidden",
    color: "white"
  } as React.CSSProperties,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    background: "rgba(255, 255, 255, 0.05)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
    gap: "16px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px"
  } as React.CSSProperties,
  title: {
    margin: 0,
    fontSize: "1.2rem",
    fontWeight: 600
  } as React.CSSProperties,
  statusBadge: {
    fontSize: "0.7rem",
    padding: "4px 10px",
    borderRadius: "20px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    fontWeight: 600
  } as React.CSSProperties,
  statusActive: {
    background: "rgba(16, 185, 129, 0.2)",
    color: "#10b981"
  } as React.CSSProperties,
  statusInactive: {
    background: "rgba(255, 255, 255, 0.1)",
    color: "rgba(255, 255, 255, 0.6)"
  } as React.CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  metricTag: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    background: "rgba(255, 255, 255, 0.08)",
    padding: "4px 8px",
    borderRadius: "6px"
  } as React.CSSProperties,
  helpBtn: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    background: "transparent",
    color: "white",
    cursor: "pointer"
  } as React.CSSProperties,
  errorBanner: {
    padding: "12px 20px",
    background: "rgba(239, 68, 68, 0.2)",
    color: "#fca5a5",
    fontSize: "0.9rem"
  } as React.CSSProperties,
  mainContent: {
    display: "grid",
    gridTemplateColumns: "1fr 320px",
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
  liveIndicator: {
    position: "absolute" as const,
    top: "16px",
    left: "16px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    background: "rgba(16, 185, 129, 0.9)",
    borderRadius: "4px",
    fontSize: "0.75rem",
    fontWeight: 700,
    letterSpacing: "1px"
  } as React.CSSProperties,
  liveDot: {
    width: "8px",
    height: "8px",
    background: "white",
    borderRadius: "50%"
  } as React.CSSProperties,
  startOverlay: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.6)",
    textAlign: "center" as const,
    padding: "24px"
  } as React.CSSProperties,
  startBtn: {
    background: "#10b981",
    color: "white",
    border: "none",
    padding: "16px 32px",
    borderRadius: "12px",
    fontSize: "1.1rem",
    fontWeight: 600,
    cursor: "pointer"
  } as React.CSSProperties,
  controlsBar: {
    display: "flex",
    gap: "8px",
    padding: "12px 16px",
    background: "rgba(255, 255, 255, 0.03)",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  ctrlBtn: {
    background: "rgba(255, 255, 255, 0.1)",
    border: "none",
    color: "white",
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "0.85rem",
    cursor: "pointer"
  } as React.CSSProperties,
  ctrlBtnActive: {
    background: "#10b981"
  } as React.CSSProperties,
  sessionHint: {
    padding: "10px 16px",
    fontSize: "0.8rem",
    color: "rgba(255, 255, 255, 0.6)",
    background: "rgba(16, 185, 129, 0.1)",
    borderTop: "1px solid rgba(16, 185, 129, 0.2)"
  } as React.CSSProperties,
  sidePanel: {
    display: "flex",
    flexDirection: "column" as const,
    background: "rgba(255, 255, 255, 0.02)"
  } as React.CSSProperties,
  panelSection: {
    padding: "16px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
  } as React.CSSProperties,
  panelTitle: {
    margin: "0 0 12px",
    fontSize: "0.9rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "8px"
  } as React.CSSProperties,
  panelRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  select: {
    width: "100%",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "white",
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "0.85rem"
  } as React.CSSProperties,
  trackerList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px"
  } as React.CSSProperties,
  trackerItem: {
    padding: "10px",
    background: "rgba(255, 255, 255, 0.05)",
    borderRadius: "8px",
    cursor: "pointer",
    borderLeft: "3px solid transparent"
  } as React.CSSProperties,
  trackerHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px"
  } as React.CSSProperties,
  trackerDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%"
  } as React.CSSProperties,
  trackerLabel: {
    flex: 1,
    fontSize: "0.9rem",
    fontWeight: 500
  } as React.CSSProperties,
  trackerRemove: {
    background: "none",
    border: "none",
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: "1.2rem",
    cursor: "pointer",
    padding: "0 4px"
  } as React.CSSProperties,
  trackerStats: {
    display: "flex",
    gap: "8px",
    marginTop: "6px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  trackerState: {
    fontSize: "0.7rem",
    padding: "2px 6px",
    borderRadius: "4px",
    textTransform: "uppercase" as const
  } as React.CSSProperties,
  trackerConfidence: {
    fontSize: "0.7rem",
    color: "rgba(255, 255, 255, 0.5)"
  } as React.CSSProperties,
  trackerVelocity: {
    marginTop: "4px",
    fontSize: "0.7rem",
    color: "rgba(255, 255, 255, 0.4)",
    fontFamily: "monospace"
  } as React.CSSProperties,
  alertList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px"
  } as React.CSSProperties,
  alertItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "8px",
    background: "rgba(255, 255, 255, 0.05)",
    borderRadius: "6px",
    fontSize: "0.8rem"
  } as React.CSSProperties,
  alertMotion: {
    background: "rgba(239, 68, 68, 0.1)",
    borderLeft: "2px solid #ef4444"
  } as React.CSSProperties,
  alertContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px"
  } as React.CSSProperties,
  alertMessage: {
    color: "rgba(255, 255, 255, 0.9)"
  } as React.CSSProperties,
  alertTime: {
    fontSize: "0.7rem",
    color: "rgba(255, 255, 255, 0.4)"
  } as React.CSSProperties,
  emptyState: {
    margin: 0,
    fontSize: "0.85rem",
    color: "rgba(255, 255, 255, 0.4)"
  } as React.CSSProperties,
  helpModal: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100
  } as React.CSSProperties,
  helpContent: {
    background: "#1e293b",
    padding: "24px",
    borderRadius: "16px",
    maxWidth: "420px",
    width: "90%"
  } as React.CSSProperties,
  helpGrid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "8px 16px",
    marginBottom: "20px"
  } as React.CSSProperties,
  kbd: {
    background: "rgba(255, 255, 255, 0.1)",
    padding: "4px 8px",
    borderRadius: "4px",
    fontFamily: "monospace",
    fontSize: "0.85rem"
  } as React.CSSProperties,
  helpClose: {
    width: "100%",
    background: "rgba(255, 255, 255, 0.1)",
    border: "none",
    color: "white",
    padding: "10px",
    borderRadius: "8px",
    cursor: "pointer"
  } as React.CSSProperties
};

interface SecureWatchProps {
  openaiApiKey?: string | undefined;
  detectionServerUrl?: string;
}

export function SecureWatch({ openaiApiKey, detectionServerUrl }: SecureWatchProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [trackers, setTrackers] = useState<ClickTracker[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [annotationStyle, setAnnotationStyle] = useState<AnnotationStyle>("standard");
  const [selectedTracker, setSelectedTracker] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [trackingFps, setTrackingFps] = useState(0);
  const [motionScore, setMotionScore] = useState(0);
  const [qualityScore, setQualityScore] = useState(0);
  const [profile, setProfile] = useState<TrackingProfile>("balanced");
  const [trackingMode, setTrackingMode] = useState<TrackingMode>("multi");
  const [showHelp, setShowHelp] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [motionDetection, setMotionDetection] = useState(true);
  const [zoneAlerts, setZoneAlerts] = useState(true);

  // Server-based detection state
  const [useServerDetection, setUseServerDetection] = useState(false);
  const [showServerDetections, setShowServerDetections] = useState(true);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("security");

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
  const alertsRef = useRef<Alert[]>([]);
  const configRef = useRef<ReturnType<typeof buildTrackingConfig> | null>(null);
  const prevLumaRef = useRef<Uint8ClampedArray | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(performance.now());
  const trackingFrameCountRef = useRef(0);
  const lastTrackingFpsRef = useRef(performance.now());
  const lastTrackingTickRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const lastMotionAlertRef = useRef(0);
  const sessionActiveRef = useRef(false);
  const motionDetectionRef = useRef(motionDetection);
  const zoneAlertsRef = useRef(zoneAlerts);
  const profileRef = useRef(profile);
  const zoneMapRef = useRef(new Map<string, string>());

  useEffect(() => {
    trackersRef.current = trackers;
  }, [trackers]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  useEffect(() => {
    motionDetectionRef.current = motionDetection;
  }, [motionDetection]);

  useEffect(() => {
    zoneAlertsRef.current = zoneAlerts;
  }, [zoneAlerts]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

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

  const addAlert = useCallback((type: AlertType, message: string, trackerId?: string) => {
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      type,
      message,
      timestamp: Date.now(),
      trackerId
    };
    setAlerts((prev) => [alert, ...prev].slice(0, ALERT_LIMIT));
  }, []);

  const resetAll = useCallback(() => {
    setTrackers([]);
    trackersRef.current = [];
    setAlerts([]);
    alertsRef.current = [];
    setSelectedTracker(null);
    prevLumaRef.current = null;
    zoneMapRef.current.clear();
    addAlert("info", "System reset");
  }, [addAlert]);

  const toggleSession = useCallback(() => {
    if (sessionActiveRef.current) {
      setSessionActive(false);
      addAlert("info", "Monitoring paused");
    } else {
      setSessionActive(true);
      addAlert("info", "Monitoring started");
    }
  }, [addAlert]);

  const cycleStyle = useCallback(() => {
    setAnnotationStyle((prev) => {
      const idx = STYLE_NAMES.indexOf(prev);
      return STYLE_NAMES[(idx + 1) % STYLE_NAMES.length] as AnnotationStyle;
    });
  }, []);

  const handleProfileChange = useCallback(
    (nextProfile: TrackingProfile) => {
      setProfile(nextProfile);
      resetAll();
    },
    [resetAll]
  );

  const removeTracker = useCallback(
    (id: string) => {
      const tracker = trackersRef.current.find((t) => t.id === id);
      if (tracker) {
        addAlert("lost", `Tracker removed: ${tracker.label}`);
      }
      trackersRef.current = trackersRef.current.filter((t) => t.id !== id);
      setTrackers(trackersRef.current);
      if (selectedTracker === id) {
        setSelectedTracker(null);
      }
      zoneMapRef.current.delete(id);
    },
    [addAlert, selectedTracker]
  );

  const ensureTrackingConfig = useCallback((video: HTMLVideoElement) => {
    const preset = TRACKING_PRESETS[profileRef.current];
    const config = buildTrackingConfig(preset, video.videoWidth, video.videoHeight);
    const canvas = analysisCanvasRef.current ?? document.createElement("canvas");
    analysisCanvasRef.current = canvas;

    if (canvas.width !== config.analysisWidth || canvas.height !== config.analysisHeight) {
      const prev = configRef.current;
      canvas.width = config.analysisWidth;
      canvas.height = config.analysisHeight;

      if (prev && trackersRef.current.length > 0) {
        const scaleX = config.analysisWidth / prev.analysisWidth;
        const scaleY = config.analysisHeight / prev.analysisHeight;
        trackersRef.current = trackersRef.current.map((tracker) => ({
          ...tracker,
          x: tracker.x * scaleX,
          y: tracker.y * scaleY,
          history: tracker.history.map((point) => ({
            ...point,
            x: point.x * scaleX,
            y: point.y * scaleY
          }))
        }));
      }
    }

    configRef.current = config;
    return config;
  }, []);

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

  const addTrackerAt = useCallback(
    async (x: number, y: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        return;
      }
      const config = configRef.current ?? ensureTrackingConfig(video);
      if (!config) {
        return;
      }
      const luma = captureLumaFrame(video, config);
      if (!luma) {
        return;
      }
      const id = `tracker-${Date.now()}`;
      const colorIndex = trackersRef.current.length % COLORS.length;
      const color = COLORS[colorIndex] ?? "#10b981";
      const trackerNumber = trackersRef.current.length + 1;

      const tracker = createTracker({
        id,
        label: `Subject ${trackerNumber}`,
        color,
        x,
        y,
        luma,
        width: config.analysisWidth,
        height: config.analysisHeight,
        config,
        now: Date.now()
      });

      if (!tracker) {
        addAlert("info", "Target too close to edge. Try clicking a clearer area.");
        return;
      }

      // Store initial position for re-acquisition
      tracker.lastGoodPosition = { x: tracker.x, y: tracker.y };

      if (trackingMode === "single") {
        trackersRef.current = [tracker];
        setSelectedTracker(tracker.id);
      } else {
        if (trackersRef.current.length >= config.maxTrackers) {
          addAlert("info", "Maximum tracker count reached.");
          return;
        }
        trackersRef.current = [...trackersRef.current, tracker];
        setSelectedTracker(tracker.id);
      }

      setTrackers([...trackersRef.current]);
      addAlert("zone", `Tracking locked on ${tracker.label}`, tracker.id);

      // AUTO-IDENTIFY: If we have an API key and auto-identify is enabled,
      // immediately identify the object for object-aware tracking
      if (AI_TRACKING_CONFIG.AUTO_IDENTIFY_ON_PLACEMENT && openaiApiKey && canvas) {
        // Set status to "thinking" while identifying
        const updateTrackerLabel = (
          label: string,
          status: LabelStatus,
          extras?: Partial<ClickTracker>
        ) => {
          trackersRef.current = trackersRef.current.map((t) =>
            t.id === id ? { ...t, labelStatus: status, label, ...extras } : t
          );
          setTrackers([...trackersRef.current]);
        };

        updateTrackerLabel("Identifying...", "thinking");

        try {
          // Scale coordinates from analysis space to display space for AI
          const scaleX = canvas.width / config.analysisWidth;
          const scaleY = canvas.height / config.analysisHeight;
          const displayX = x * scaleX;
          const displayY = y * scaleY;

          const result = await identifyObjectWithFeatures(canvas, displayX, displayY, openaiApiKey);

          // Update tracker with full object information
          updateTrackerLabel(result.label, "labeled", {
            objectDescription: result.description,
            visualFeatures: result.features,
            referenceImage: result.referenceImage,
            lastAIValidation: Date.now(),
            aiConfidence: 1.0
          });

          console.info(`[AI Security] Identified target: "${result.label}"`);
          addAlert("info", `Identified: ${result.label}`, id);
        } catch (err) {
          console.error("[AI Security] Auto-identify failed:", err);
          // Revert to default label
          updateTrackerLabel(`Subject ${trackerNumber}`, "idle");
        }
      }
    },
    [addAlert, captureLumaFrame, ensureTrackingConfig, trackingMode, openaiApiKey]
  );

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (!cameraReady || !canvasRef.current || !sessionActiveRef.current) return;
      const config = configRef.current;
      if (!config) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = config.analysisWidth / rect.width;
      const scaleY = config.analysisHeight / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      if (event.button === 2) {
        const nearest = trackersRef.current.reduce<{ tracker: ClickTracker; dist: number } | null>(
          (best, tracker) => {
            const dist = Math.hypot(tracker.x - x, tracker.y - y);
            if (dist < 40 && (!best || dist < best.dist)) {
              return { tracker, dist };
            }
            return best;
          },
          null
        );
        if (nearest) {
          removeTracker(nearest.tracker.id);
        }
        return;
      }

      addTrackerAt(x, y);
    },
    [addTrackerAt, cameraReady, removeTracker]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      handleCanvasClick({ ...event, button: 2 } as React.MouseEvent);
    },
    [handleCanvasClick]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;

      switch (event.key.toLowerCase()) {
        case "s":
          cycleStyle();
          break;
        case "h":
          setShowHelp((prev) => !prev);
          break;
        case "r":
          resetAll();
          break;
        case "z":
          setShowZones((prev) => !prev);
          break;
        case "m":
          setMotionDetection((prev) => !prev);
          break;
        case "t":
          setTrackingMode((prev) => (prev === "multi" ? "single" : "multi"));
          break;
        case "p":
          setZoneAlerts((prev) => !prev);
          break;
        case " ":
        case "enter":
          if (cameraReady) {
            toggleSession();
          }
          event.preventDefault();
          break;
        case "escape":
          setSelectedTracker(null);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cameraReady, cycleStyle, resetAll, toggleSession]);

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

      frameCountRef.current += 1;
      const now = performance.now();
      if (now - lastFpsUpdateRef.current > 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsUpdateRef.current)));
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }

      const config = ensureTrackingConfig(video);
      const scaleX = canvas.width / config.analysisWidth;
      const scaleY = canvas.height / config.analysisHeight;

      if (sessionActiveRef.current) {
        const interval = 1000 / config.targetFps;
        if (now - lastTrackingTickRef.current >= interval) {
          lastTrackingTickRef.current = now;
          const luma = captureLumaFrame(video, config);
          if (luma) {
            const motion = computeMotionScore(prevLumaRef.current, luma);
            prevLumaRef.current = motion.next;
            if (motionDetectionRef.current) {
              setMotionScore(motion.score);
              if (
                motion.score > config.motionThreshold &&
                now - lastMotionAlertRef.current > config.motionCooldownMs
              ) {
                lastMotionAlertRef.current = now;
                addAlert("motion", "Motion spike detected in scene");
              }
            } else {
              setMotionScore(0);
            }

            // Pass YOLO detections for hybrid tracking - scale from normalized coords to analysis frame
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
                yoloWeight: 0.35,
                yoloReacquireRadius: config.searchRadius * 2.5
              }
            );

            trackersRef.current = update.trackers;
            const avgConfidence =
              update.trackers.length > 0
                ? update.trackers.reduce((sum, tracker) => sum + tracker.confidence, 0) /
                  update.trackers.length
                : 0;
            setQualityScore(Math.round(avgConfidence));

            update.stateChanges.forEach((change) => {
              if (change.to === "lost") {
                const target = trackersRef.current.find((tracker) => tracker.id === change.id);
                addAlert("lost", `Lost tracking on ${target?.label ?? "target"}`, change.id);
              }
              if (change.from === "lost" && change.to === "tracking") {
                const target = trackersRef.current.find((tracker) => tracker.id === change.id);
                addAlert("info", `Reacquired ${target?.label ?? "target"}`, change.id);
              }
            });

            if (zoneAlertsRef.current) {
              update.trackers.forEach((tracker) => {
                const zone = getZoneLabel(
                  tracker.x,
                  tracker.y,
                  config.analysisWidth,
                  config.analysisHeight
                );
                const prevZone = zoneMapRef.current.get(tracker.id);
                if (prevZone && prevZone !== zone) {
                  addAlert("zone", `${tracker.label} entered ${zone}`, tracker.id);
                }
                zoneMapRef.current.set(tracker.id, zone);
              });
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

            if (now - lastUiUpdateRef.current > UI_UPDATE_MS) {
              setTrackers([...trackersRef.current]);
              lastUiUpdateRef.current = now;
            }

            // === AI-POWERED OBJECT-AWARE TRACKING ===
            // Trigger async AI operations based on tracker state (non-blocking)
            if (openaiApiKey && canvas) {
              trackersRef.current.forEach((tracker) => {
                // Skip trackers without AI identification
                if (!tracker.objectDescription && !tracker.visualFeatures) {
                  return;
                }

                // Scale coords from analysis to display space
                const displayX = tracker.x * scaleX;
                const displayY = tracker.y * scaleY;
                const trackerForAI = {
                  ...tracker,
                  x: displayX,
                  y: displayY,
                  lastGoodPosition: tracker.lastGoodPosition
                    ? {
                        x: tracker.lastGoodPosition.x * scaleX,
                        y: tracker.lastGoodPosition.y * scaleY
                      }
                    : { x: displayX, y: displayY }
                };

                // === AI VALIDATION: Check if we're still tracking the right object ===
                if (
                  AI_TRACKING_CONFIG.VALIDATION_ON_OCCLUSION &&
                  (tracker.state === "tracking" || tracker.state === "occluded") &&
                  tracker.confidence < AI_TRACKING_CONFIG.VALIDATION_CONFIDENCE_THRESHOLD &&
                  !tracker.pendingAIValidation &&
                  now - (tracker.lastAIValidation ?? 0) > AI_TRACKING_CONFIG.VALIDATION_COOLDOWN_MS
                ) {
                  // Mark as pending to prevent duplicate calls
                  trackersRef.current = trackersRef.current.map((t) =>
                    t.id === tracker.id ? { ...t, pendingAIValidation: true } : t
                  );

                  // Async validation
                  validateTrackedObject(canvas, trackerForAI, openaiApiKey)
                    .then((result) => {
                      trackersRef.current = trackersRef.current.map((t) => {
                        if (t.id !== tracker.id) return t;

                        // Clear pending flag
                        const updated: ClickTracker = {
                          ...t,
                          pendingAIValidation: false,
                          lastAIValidation: Date.now(),
                          aiConfidence: result.confidence
                        };

                        // If AI says we're NOT on the object anymore → go to LOST
                        if (!result.isValid && result.confidence > 0.6) {
                          console.info(`[AI Security] "${tracker.label}" is no longer at marker!`);
                          addAlert("lost", `${tracker.label} moved away from marker`, tracker.id);
                          return {
                            ...updated,
                            state: "lost" as TrackerState,
                            lostFrames: 0,
                            confidence: 0.2
                          };
                        }

                        return updated;
                      });
                      setTrackers([...trackersRef.current]);
                    })
                    .catch((err) => {
                      console.error("[AI Security Validation] Error:", err);
                      trackersRef.current = trackersRef.current.map((t) =>
                        t.id === tracker.id ? { ...t, pendingAIValidation: false } : t
                      );
                    });
                }

                // === AI RE-ACQUISITION: Find the lost object ===
                if (
                  tracker.state === "lost" &&
                  tracker.lostFrames >= AI_TRACKING_CONFIG.REACQUISITION_START_FRAME &&
                  tracker.lostFrames % AI_TRACKING_CONFIG.REACQUISITION_INTERVAL_FRAMES === 0 &&
                  !tracker.pendingAIReacquisition &&
                  !tracker.label.startsWith("Subject") // Only search for identified objects
                ) {
                  // Mark as pending
                  trackersRef.current = trackersRef.current.map((t) =>
                    t.id === tracker.id ? { ...t, pendingAIReacquisition: true } : t
                  );

                  console.info(`[AI Security] Searching for "${tracker.label}"...`);

                  // Async re-acquisition
                  findObjectInFrame(canvas, trackerForAI, openaiApiKey)
                    .then((result) => {
                      trackersRef.current = trackersRef.current.map((t) => {
                        if (t.id !== tracker.id) return t;

                        // Clear pending flag
                        const updated: ClickTracker = { ...t, pendingAIReacquisition: false };

                        if (
                          result &&
                          result.found &&
                          result.confidence >= AI_TRACKING_CONFIG.REACQUISITION_MIN_CONFIDENCE
                        ) {
                          // Found the object! Scale back to analysis space
                          const analysisX = result.x / scaleX;
                          const analysisY = result.y / scaleY;

                          console.info(
                            `[AI Security] Found "${tracker.label}" at (${analysisX.toFixed(0)}, ${analysisY.toFixed(0)})`
                          );
                          addAlert("info", `Reacquired ${tracker.label} via AI`, tracker.id);

                          return {
                            ...updated,
                            x: analysisX,
                            y: analysisY,
                            velocity: { x: 0, y: 0 },
                            state: "tracking" as TrackerState,
                            confidence: result.confidence,
                            lostFrames: 0,
                            lastGoodPosition: { x: analysisX, y: analysisY },
                            lastAIValidation: Date.now(),
                            aiConfidence: result.confidence
                          };
                        }

                        return updated;
                      });
                      setTrackers([...trackersRef.current]);
                    })
                    .catch((err) => {
                      console.error("[AI Security Re-acquisition] Error:", err);
                      trackersRef.current = trackersRef.current.map((t) =>
                        t.id === tracker.id ? { ...t, pendingAIReacquisition: false } : t
                      );
                    });
                }
              });
            }
          }
        }

        // Send frame to server for YOLO detection
        if (useServerDetection && serverConnected) {
          sendFrameToServer(canvas);
        }
      }

      renderSecurityOverlay(
        ctx,
        canvas.width,
        canvas.height,
        trackersRef.current,
        annotationStyle,
        showZones,
        selectedTracker,
        scaleX,
        scaleY
      );

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
    annotationStyle,
    captureLumaFrame,
    ensureTrackingConfig,
    showZones,
    selectedTracker,
    addAlert,
    useServerDetection,
    serverConnected,
    sendFrameToServer,
    showServerDetections,
    interpolatedDetections
  ]);

  const getStateStyle = (state: TrackerState): React.CSSProperties => {
    const base = { ...styles.trackerState };
    if (state === "tracking") {
      return { ...base, background: "rgba(16, 185, 129, 0.3)", color: "#10b981" };
    }
    if (state === "occluded") {
      return { ...base, background: "rgba(245, 158, 11, 0.3)", color: "#f59e0b" };
    }
    return { ...base, background: "rgba(239, 68, 68, 0.3)", color: "#ef4444" };
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>SecureWatch</h2>
          <span
            style={{
              ...styles.statusBadge,
              ...(sessionActive ? styles.statusActive : styles.statusInactive)
            }}
          >
            {sessionActive ? "● MONITORING" : "○ STANDBY"}
          </span>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.metricTag}>{fps} FPS</span>
          <span style={styles.metricTag}>{trackingFps} TPS</span>
          <span style={styles.metricTag}>Quality {qualityScore}%</span>
          <span style={styles.metricTag}>Motion {(motionScore * 100).toFixed(1)}%</span>
          <button style={styles.helpBtn} onClick={() => setShowHelp(!showHelp)}>
            ?
          </button>
        </div>
      </div>

      {cameraError && (
        <div style={styles.errorBanner}>
          <span>⚠️ {cameraError}</span>
        </div>
      )}

      <div style={styles.mainContent}>
        <div style={styles.videoSection}>
          <div style={styles.videoContainer}>
            <video ref={videoRef} playsInline muted style={{ display: "none" }} />
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onContextMenu={handleContextMenu}
              style={styles.canvas}
            />

            {sessionActive && (
              <div style={styles.liveIndicator}>
                <span style={styles.liveDot} />
                LIVE
              </div>
            )}

            {!sessionActive && cameraReady && (
              <div style={styles.startOverlay}>
                <button style={styles.startBtn} onClick={toggleSession}>
                  ▶ Start Monitoring
                </button>
                <p
                  style={{
                    margin: "12px 0 0",
                    color: "rgba(255, 255, 255, 0.6)",
                    fontSize: "0.9rem"
                  }}
                >
                  Click to begin real-time tracking. Then click on any subject to lock tracking.
                </p>
              </div>
            )}
          </div>

          <div style={styles.controlsBar}>
            <button
              style={{ ...styles.ctrlBtn, ...(sessionActive ? styles.ctrlBtnActive : {}) }}
              onClick={toggleSession}
              disabled={!cameraReady}
            >
              {sessionActive ? "⏸ Pause" : "▶ Start"}
            </button>
            <button style={styles.ctrlBtn} onClick={resetAll}>
              Reset
            </button>
            <button
              style={{ ...styles.ctrlBtn, ...(showZones ? styles.ctrlBtnActive : {}) }}
              onClick={() => setShowZones(!showZones)}
            >
              🔲 Zones
            </button>
            <button
              style={{ ...styles.ctrlBtn, ...(motionDetection ? styles.ctrlBtnActive : {}) }}
              onClick={() => setMotionDetection(!motionDetection)}
            >
              📡 Motion
            </button>
            <button
              style={{ ...styles.ctrlBtn, ...(zoneAlerts ? styles.ctrlBtnActive : {}) }}
              onClick={() => setZoneAlerts(!zoneAlerts)}
            >
              🚨 Alerts
            </button>
            <button style={styles.ctrlBtn} onClick={cycleStyle}>
              Style: {annotationStyle}
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
                ...styles.ctrlBtn,
                ...(useServerDetection ? styles.ctrlBtnActive : {}),
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
                  style={{ ...styles.ctrlBtn, ...(showServerDetections ? {} : { opacity: 0.5 }) }}
                  onClick={() => setShowServerDetections(!showServerDetections)}
                  title="Toggle detection box visibility"
                >
                  {showServerDetections ? "👁" : "👁‍🗨"}
                </button>
                <select
                  style={{
                    ...styles.ctrlBtn,
                    background: "rgba(255, 255, 255, 0.1)",
                    cursor: "pointer",
                    minWidth: "100px"
                  }}
                  value={detectionMode}
                  onChange={(e) => setDetectionMode(e.target.value as DetectionMode)}
                >
                  <option value="security">🛡️ Security</option>
                  <option value="general">🔍 General</option>
                  <option value="surgical">🏥 Surgical</option>
                </select>
              </>
            )}
          </div>

          {/* Server Detection Status Bar */}
          {useServerDetection && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                padding: "8px 16px",
                background: serverConnected ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                borderTop: `1px solid ${serverConnected ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                fontSize: "0.8rem"
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
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: serverConnected ? "#10b981" : "#ef4444"
                  }}
                />
                {serverConnected ? "YOLO Server Connected" : "Connecting to YOLO Server..."}
              </span>
              {serverConnected && (
                <>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>
                    RTT: {detectionMetrics.avgRoundTrip}ms
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>
                    Inference: {detectionMetrics.avgInference}ms
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>
                    Detections: {interpolatedDetections.length}
                  </span>
                </>
              )}
            </div>
          )}

          {sessionActive && !useServerDetection && (
            <div style={styles.sessionHint}>
              <strong>Tip:</strong> Click anywhere on the video to add a tracking point. Right-click
              to remove.
            </div>
          )}
        </div>

        <div style={styles.sidePanel}>
          <div style={styles.panelSection}>
            <h3 style={styles.panelTitle}>Tracking Controls</h3>
            <div style={styles.panelRow}>
              <label style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)" }}>Profile</label>
              <select
                style={styles.select}
                value={profile}
                onChange={(event) => handleProfileChange(event.target.value as TrackingProfile)}
              >
                {Object.entries(PROFILE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ ...styles.panelRow, marginTop: "10px" }}>
              <label style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)" }}>Mode</label>
              <select
                style={styles.select}
                value={trackingMode}
                onChange={(event) => setTrackingMode(event.target.value as TrackingMode)}
              >
                {Object.entries(MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={styles.panelSection}>
            <h3 style={styles.panelTitle}>Tracked Subjects</h3>
            {trackers.length === 0 ? (
              <p style={styles.emptyState}>No subjects tracked. Click on video to add.</p>
            ) : (
              <div style={styles.trackerList}>
                {trackers.map((tracker) => (
                  <div
                    key={tracker.id}
                    style={{
                      ...styles.trackerItem,
                      ...(selectedTracker === tracker.id
                        ? { background: "rgba(59, 130, 246, 0.2)", borderLeftColor: "#3b82f6" }
                        : {}),
                      ...(tracker.state === "lost" ? { opacity: 0.5 } : {})
                    }}
                    onClick={() =>
                      setSelectedTracker(tracker.id === selectedTracker ? null : tracker.id)
                    }
                  >
                    <div style={styles.trackerHeader}>
                      <span style={{ ...styles.trackerDot, background: tracker.color }} />
                      <span style={styles.trackerLabel}>{tracker.label}</span>
                      <button
                        style={styles.trackerRemove}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeTracker(tracker.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div style={styles.trackerStats}>
                      <span style={getStateStyle(tracker.state)}>{tracker.state}</span>
                      <span style={styles.trackerConfidence}>{tracker.confidence}%</span>
                      <span style={styles.trackerConfidence}>Δ {tracker.lastScore.toFixed(2)}</span>
                    </div>
                    <div style={styles.trackerVelocity}>
                      Speed:{" "}
                      {Math.round(Math.hypot(tracker.velocity.x, tracker.velocity.y) * 10) / 10}{" "}
                      px/f
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ ...styles.panelSection, flex: 1, overflowY: "auto" as const }}>
            <h3 style={styles.panelTitle}>Alerts</h3>
            {alerts.length === 0 ? (
              <p style={styles.emptyState}>No alerts</p>
            ) : (
              <div style={styles.alertList}>
                {alerts.slice(0, 6).map((alert) => (
                  <div
                    key={alert.id}
                    style={{
                      ...styles.alertItem,
                      ...(alert.type === "motion" ? styles.alertMotion : {})
                    }}
                  >
                    <span style={{ fontSize: "0.9rem" }}>
                      {alert.type === "motion"
                        ? "🔴"
                        : alert.type === "lost"
                          ? "⚠️"
                          : alert.type === "zone"
                            ? "📍"
                            : "ℹ️"}
                    </span>
                    <div style={styles.alertContent}>
                      <span style={styles.alertMessage}>{alert.message}</span>
                      <span style={styles.alertTime}>{formatTime(alert.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showHelp && (
        <div style={styles.helpModal} onClick={() => setShowHelp(false)}>
          <div style={styles.helpContent} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px" }}>SecureWatch Controls</h3>
            <div style={styles.helpGrid}>
              <span style={styles.kbd}>Click</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Add tracking point
              </span>
              <span style={styles.kbd}>Right-click</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Remove tracker
              </span>
              <span style={styles.kbd}>Space/Enter</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Start/Pause
              </span>
              <span style={styles.kbd}>S</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Cycle styles
              </span>
              <span style={styles.kbd}>Z</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Toggle zones
              </span>
              <span style={styles.kbd}>M</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Toggle motion
              </span>
              <span style={styles.kbd}>T</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Toggle single/multi target
              </span>
              <span style={styles.kbd}>P</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Toggle zone alerts
              </span>
              <span style={styles.kbd}>R</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                Reset session
              </span>
            </div>
            <button style={styles.helpClose} onClick={() => setShowHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getZoneLabel(x: number, y: number, width: number, height: number): string {
  const grid = 4;
  const col = Math.min(grid - 1, Math.max(0, Math.floor((x / width) * grid)));
  const row = Math.min(grid - 1, Math.max(0, Math.floor((y / height) * grid)));
  const colLabel = String.fromCharCode(65 + col);
  return `${colLabel}${row + 1}`;
}

function renderSecurityOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  trackers: ClickTracker[],
  style: AnnotationStyle,
  showZones: boolean,
  selectedTracker: string | null,
  scaleX: number,
  scaleY: number
) {
  if (showZones) {
    ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);

    const gridSize = 4;
    for (let i = 1; i < gridSize; i += 1) {
      ctx.beginPath();
      ctx.moveTo((width / gridSize) * i, 0);
      ctx.lineTo((width / gridSize) * i, height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, (height / gridSize) * i);
      ctx.lineTo(width, (height / gridSize) * i);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  trackers.forEach((tracker) => {
    const drawX = tracker.x * scaleX;
    const drawY = tracker.y * scaleY;
    const opacity = tracker.state === "lost" ? 0.35 : tracker.state === "occluded" ? 0.7 : 1;
    ctx.globalAlpha = opacity;

    if (style !== "minimal" && tracker.history.length > 5) {
      ctx.beginPath();
      ctx.strokeStyle = tracker.color;
      ctx.lineWidth = 2;
      const start = tracker.history[0];
      if (start) {
        ctx.moveTo(start.x * scaleX, start.y * scaleY);
        tracker.history.slice(1).forEach((point, index) => {
          ctx.globalAlpha = opacity * (index / tracker.history.length);
          ctx.lineTo(point.x * scaleX, point.y * scaleY);
        });
      }
      ctx.stroke();
      ctx.globalAlpha = opacity;
    }

    const boxSize = tracker.templateSize * scaleX;
    if (style === "detailed" || style === "gaming") {
      ctx.strokeStyle = tracker.color;
      ctx.lineWidth = style === "gaming" ? 3 : 2;
      ctx.strokeRect(drawX - boxSize / 2, drawY - boxSize / 2, boxSize, boxSize);
    }

    const pointSize = style === "minimal" ? 6 : style === "gaming" ? 10 : 8;
    if (style === "gaming") {
      ctx.strokeStyle = tracker.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(drawX - 15, drawY);
      ctx.lineTo(drawX - 5, drawY);
      ctx.moveTo(drawX + 5, drawY);
      ctx.lineTo(drawX + 15, drawY);
      ctx.moveTo(drawX, drawY - 15);
      ctx.lineTo(drawX, drawY - 5);
      ctx.moveTo(drawX, drawY + 5);
      ctx.lineTo(drawX, drawY + 15);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(drawX, drawY, pointSize, 0, Math.PI * 2);
      ctx.fillStyle = tracker.color;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(drawX, drawY, pointSize * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fill();
    }

    if (selectedTracker === tracker.id) {
      ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(drawX, drawY, pointSize + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (style !== "minimal") {
      const labelText =
        style === "detailed" ? `${tracker.label} | ${tracker.confidence}%` : tracker.label;
      ctx.font = `${style === "gaming" ? "bold " : ""}11px system-ui, sans-serif`;
      const metrics = ctx.measureText(labelText);
      const padding = 6;
      const labelX = drawX - metrics.width / 2 - padding;
      const labelY = drawY - (style === "detailed" || style === "gaming" ? 52 : 28);

      ctx.fillStyle = style === "gaming" ? tracker.color : "rgba(0, 0, 0, 0.8)";
      ctx.beginPath();
      ctx.roundRect(labelX, labelY - 10, metrics.width + padding * 2, 18, 3);
      ctx.fill();

      ctx.fillStyle = style === "gaming" ? "#000" : "#fff";
      ctx.fillText(labelText, labelX + padding, labelY + 3);
    }

    ctx.globalAlpha = 1;
  });
}
