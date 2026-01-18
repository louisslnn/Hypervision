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
import {
  useDetectionClient,
  drawDetections,
  DetectionMode,
  type Detection
} from "../shared/detectionClient";
import { useWebRtcCollab, WebRtcRole } from "../shared/webrtcCollab";
import type { CollabMessage } from "../shared/webrtcCollab";

// Server detection configuration
const DETECTION_SERVER_URL =
  typeof window !== "undefined"
    ? ((window as { ENV_DETECTION_SERVER?: string }).ENV_DETECTION_SERVER ??
      "ws://localhost:8765/ws/detect")
    : "ws://localhost:8765/ws/detect";

const SIGNAL_SERVER_URL =
  typeof window !== "undefined"
    ? ((window as { ENV_SIGNAL_SERVER?: string }).ENV_SIGNAL_SERVER ?? "ws://localhost:9001")
    : "ws://localhost:9001";

type AnnotationStyle = "minimal" | "standard" | "detailed" | "gaming";

type TrackingMode = "single" | "multi";

type VideoSource = "camera" | "demo" | "file" | "webrtc";

type AlertType = "motion" | "zone" | "lost" | "info";

type CollabTracker = {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
};

type CollabAction =
  | { type: "tracker:add"; payload: CollabTracker }
  | { type: "tracker:update"; payload: { id: string; label: string } }
  | { type: "tracker:remove"; payload: { id: string } }
  | { type: "session:toggle"; payload: { active: boolean } }
  | { type: "reset" }
  | { type: "state:sync"; payload: { sessionActive: boolean; trackers: CollabTracker[] } };

type AddTrackerOptions = {
  id?: string;
  label?: string;
  color?: string;
  broadcast?: boolean;
  skipAutoIdentify?: boolean;
  forceMulti?: boolean;
  silent?: boolean;
  detectorTrackId?: string;
  detectorLabel?: string;
  detectorConfidence?: number;
};

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

const DEMO_CLIPS: Array<{
  id: string;
  label: string;
  url: string;
  note: string;
}> = [
  {
    id: "opencv-vtest",
    label: "OpenCV Sample (vtest)",
    url: "/securewatch/clips/opencv-vtest-25s.mp4",
    note: "Outdoor pedestrians in a static scene."
  },
  {
    id: "opencv-vid00003",
    label: "OpenCV Extra (VID00003)",
    url: "/securewatch/clips/opencv-vid00003-25s.mp4",
    note: "Street-level motion with multiple people."
  }
];

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
  input: {
    width: "100%",
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "white",
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "0.85rem"
  } as React.CSSProperties,
  fieldStack: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px"
  } as React.CSSProperties,
  fieldLabel: {
    fontSize: "0.75rem",
    color: "rgba(255,255,255,0.6)"
  } as React.CSSProperties,
  fieldHint: {
    fontSize: "0.72rem",
    color: "rgba(255,255,255,0.5)"
  } as React.CSSProperties,
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap" as const
  } as React.CSSProperties,
  statusDotSmall: {
    width: "8px",
    height: "8px",
    borderRadius: "50%"
  } as React.CSSProperties,
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 8px",
    borderRadius: "999px",
    fontSize: "0.7rem",
    background: "rgba(255,255,255,0.1)"
  } as React.CSSProperties,
  mutedText: {
    fontSize: "0.75rem",
    color: "rgba(255,255,255,0.5)"
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

function createRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createTrackerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tracker-${crypto.randomUUID()}`;
  }
  return `tracker-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function getDetectionBox(detection: Detection): Detection["bbox"] {
  const withInterpolation = detection as Detection & { interpolatedBox?: Detection["bbox"] };
  return withInterpolation.interpolatedBox ?? detection.bbox;
}

function formatDetectorLabel(label: string, trackerNumber: number): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return `Subject ${trackerNumber}`;
  }
  const normalized = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return `${normalized} ${trackerNumber}`;
}

function pickDetectionForPoint(
  detections: Detection[],
  x: number,
  y: number,
  config: ReturnType<typeof buildTrackingConfig>
): Detection | null {
  let bestInside: { detection: Detection; score: number } | null = null;
  let bestNearby: { detection: Detection; distance: number } | null = null;

  detections.forEach((det) => {
    const box = getDetectionBox(det);
    const centerX = box.centerX * config.analysisWidth;
    const centerY = box.centerY * config.analysisHeight;
    const halfW = (box.width * config.analysisWidth) / 2;
    const halfH = (box.height * config.analysisHeight) / 2;
    const inside =
      x >= centerX - halfW &&
      x <= centerX + halfW &&
      y >= centerY - halfH &&
      y <= centerY + halfH;

    if (inside) {
      const score = det.confidence;
      if (!bestInside || score > bestInside.score) {
        bestInside = { detection: det, score };
      }
    } else {
      const distance = Math.hypot(centerX - x, centerY - y);
      if (!bestNearby || distance < bestNearby.distance) {
        bestNearby = { detection: det, distance };
      }
    }
  });

  if (bestInside) {
    return bestInside.detection;
  }

  if (bestNearby && bestNearby.distance <= config.searchRadius * 1.5) {
    return bestNearby.detection;
  }

  return null;
}

function parseCollabAction(message: CollabMessage): CollabAction | null {
  if (message.type === "reset") {
    return { type: "reset" };
  }

  if (!isRecord(message.payload)) {
    return null;
  }

  if (message.type === "tracker:add") {
    const { id, label, color, x, y } = message.payload;
    if (isString(id) && isString(label) && isString(color) && isNumber(x) && isNumber(y)) {
      return { type: "tracker:add", payload: { id, label, color, x, y } };
    }
    return null;
  }

  if (message.type === "tracker:update") {
    const { id, label } = message.payload;
    if (isString(id) && isString(label)) {
      return { type: "tracker:update", payload: { id, label } };
    }
    return null;
  }

  if (message.type === "tracker:remove") {
    const { id } = message.payload;
    if (isString(id)) {
      return { type: "tracker:remove", payload: { id } };
    }
    return null;
  }

  if (message.type === "session:toggle") {
    const { active } = message.payload;
    if (typeof active === "boolean") {
      return { type: "session:toggle", payload: { active } };
    }
    return null;
  }

  if (message.type === "state:sync") {
    const { sessionActive, trackers } = message.payload;
    if (typeof sessionActive !== "boolean" || !Array.isArray(trackers)) {
      return null;
    }

    const normalizedTrackers: CollabTracker[] = [];
    trackers.forEach((tracker) => {
      if (!isRecord(tracker)) return;
      const { id, label, color, x, y } = tracker;
      if (isString(id) && isString(label) && isString(color) && isNumber(x) && isNumber(y)) {
        normalizedTrackers.push({ id, label, color, x, y });
      }
    });

    return {
      type: "state:sync",
      payload: { sessionActive, trackers: normalizedTrackers }
    };
  }

  return null;
}

interface SecureWatchProps {
  openaiApiKey?: string | undefined;
  detectionServerUrl?: string;
  signalServerUrl?: string;
}

export function SecureWatch({
  openaiApiKey,
  detectionServerUrl,
  signalServerUrl
}: SecureWatchProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoSource, setVideoSource] = useState<VideoSource>("camera");
  const [demoClipId, setDemoClipId] = useState<string>(DEMO_CLIPS[0]?.id ?? "demo");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [shareStream, setShareStream] = useState<MediaStream | null>(null);
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

  const [collabEnabled, setCollabEnabled] = useState(false);
  const [collabRoomId, setCollabRoomId] = useState<string>(() => createRoomCode());
  const [collabRole, setCollabRole] = useState<WebRtcRole>("host");
  const [collabServerUrl, setCollabServerUrl] = useState<string>(
    signalServerUrl ?? SIGNAL_SERVER_URL
  );

  const selectedClip = DEMO_CLIPS.find((clip) => clip.id === demoClipId) ?? DEMO_CLIPS[0];

  useEffect(() => {
    if (signalServerUrl) {
      setCollabServerUrl(signalServerUrl);
    }
  }, [signalServerUrl]);

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
    enabled: useServerDetection && sessionActive && videoReady,
    targetFps: 12,
    confidenceThreshold: 0.35
  });

  const trackersRef = useRef<ClickTracker[]>([]);
  const alertsRef = useRef<Alert[]>([]);
  const interpolatedDetectionsRef = useRef<Detection[]>([]);
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
  const fileUrlRef = useRef<string | null>(null);
  const collabSendRef = useRef<(message: { type: string; payload?: Record<string, unknown> }) => void>(
    () => undefined
  );
  const pendingCollabRef = useRef<CollabAction[]>([]);

  useEffect(() => {
    trackersRef.current = trackers;
  }, [trackers]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    interpolatedDetectionsRef.current = interpolatedDetections;
  }, [interpolatedDetections]);

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
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => setVideoReady(true);
    const handlePlaying = () => setIsVideoPlaying(true);
    const handlePause = () => setIsVideoPlaying(false);
    const handleEnded = () => setIsVideoPlaying(false);
    const handleError = () => {
      setVideoError("Video playback failed. Please check the selected source.");
    };

    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("loadedmetadata", handleCanPlay);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);

    return () => {
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("loadedmetadata", handleCanPlay);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
    };
  }, []);

  useEffect(() => {
    if (videoSource !== "camera") {
      setCameraStream(null);
      return;
    }

    let active = true;
    let localStream: MediaStream | null = null;

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
        localStream = stream;
        setCameraStream(stream);
        setVideoError(null);
      })
      .catch((err) => {
        if (active) {
          setVideoError(
            err.name === "NotAllowedError"
              ? "Camera access denied. Please allow camera access."
              : "Failed to access camera. Please check your device."
          );
        }
      });

    return () => {
      active = false;
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoSource]);

  useEffect(() => {
    return () => {
      if (fileUrlRef.current) {
        URL.revokeObjectURL(fileUrlRef.current);
        fileUrlRef.current = null;
      }
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

  const resetAll = useCallback(
    (options?: { silent?: boolean; broadcast?: boolean }) => {
      setTrackers([]);
      trackersRef.current = [];
      setAlerts([]);
      alertsRef.current = [];
      setSelectedTracker(null);
      prevLumaRef.current = null;
      zoneMapRef.current.clear();
      setQualityScore(0);
      setMotionScore(0);
      setTrackingFps(0);

      if (!options?.silent) {
        addAlert("info", "System reset");
      }

      if ((options?.broadcast ?? true) && collabEnabled) {
        collabSendRef.current({ type: "reset" });
      }
    },
    [addAlert, collabEnabled]
  );

  const setSessionState = useCallback(
    (nextActive: boolean, options?: { broadcast?: boolean; silent?: boolean; reason?: string }) => {
      setSessionActive(nextActive);

      if (nextActive && videoRef.current?.paused) {
        videoRef.current.play().catch(() => undefined);
      }

      if (!options?.silent) {
        addAlert(
          "info",
          options?.reason ?? (nextActive ? "Monitoring started" : "Monitoring paused")
        );
      }

      if ((options?.broadcast ?? true) && collabEnabled) {
        collabSendRef.current({
          type: "session:toggle",
          payload: { active: nextActive }
        });
      }
    },
    [addAlert, collabEnabled]
  );

  const toggleSession = useCallback(() => {
    setSessionState(!sessionActiveRef.current);
  }, [setSessionState]);

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

  const handleVideoSourceChange = useCallback((nextSource: VideoSource) => {
    setVideoSource(nextSource);
  }, []);

  const handleDemoClipChange = useCallback((clipId: string) => {
    setDemoClipId(clipId);
    setVideoSource("demo");
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    setFileUrl(url);
    setFileName(file.name);
    setVideoSource("file");
    setVideoError(null);
  }, []);

  const handlePlaybackToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, []);

  const handlePlaybackRestart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    video.play().catch(() => undefined);
  }, []);

  const removeTracker = useCallback(
    (id: string, options?: { silent?: boolean; broadcast?: boolean }) => {
      const tracker = trackersRef.current.find((t) => t.id === id);
      if (tracker && !options?.silent) {
        addAlert("lost", `Tracker removed: ${tracker.label}`);
      }
      trackersRef.current = trackersRef.current.filter((t) => t.id !== id);
      setTrackers(trackersRef.current);
      if (selectedTracker === id) {
        setSelectedTracker(null);
      }
      zoneMapRef.current.delete(id);

      if ((options?.broadcast ?? true) && collabEnabled) {
        collabSendRef.current({ type: "tracker:remove", payload: { id } });
      }
    },
    [addAlert, collabEnabled, selectedTracker]
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
    (video: HTMLVideoElement, config: ReturnType<typeof buildTrackingConfig>, mirror: boolean) => {
      const canvas = analysisCanvasRef.current;
      if (!canvas) {
        return null;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return null;
      }

      if (mirror) {
        ctx.save();
        ctx.translate(config.analysisWidth, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, config.analysisWidth, config.analysisHeight);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, config.analysisWidth, config.analysisHeight);
      }

      const imageData = ctx.getImageData(0, 0, config.analysisWidth, config.analysisHeight);
      return buildLumaFrame(imageData);
    },
    []
  );

  const addTrackerAt = useCallback(
    async (x: number, y: number, options: AddTrackerOptions = {}) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        return;
      }
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      if (options.id && trackersRef.current.some((tracker) => tracker.id === options.id)) {
        return;
      }

      const config = configRef.current ?? ensureTrackingConfig(video);
      if (!config) {
        return;
      }
      const luma = captureLumaFrame(video, config, videoSource === "camera");
      if (!luma) {
        return;
      }

      const detectionCandidate =
        useServerDetection &&
        interpolatedDetectionsRef.current.length > 0 &&
        !options.detectorTrackId
          ? pickDetectionForPoint(interpolatedDetectionsRef.current, x, y, config)
          : null;
      const detectorTrackId =
        options.detectorTrackId ?? detectionCandidate?.trackId ?? detectionCandidate?.id;
      const detectorLabel = options.detectorLabel ?? detectionCandidate?.label;
      const detectorConfidence =
        options.detectorConfidence ?? detectionCandidate?.confidence ?? undefined;

      const id = options.id ?? createTrackerId();
      const trackerNumber = trackersRef.current.length + 1;
      const color =
        options.color ?? COLORS[trackersRef.current.length % COLORS.length] ?? "#10b981";
      const label =
        options.label ??
        (detectorLabel
          ? formatDetectorLabel(detectorLabel, trackerNumber)
          : `Subject ${trackerNumber}`);

      const now = Date.now();
      const tracker = createTracker({
        id,
        label,
        color,
        x,
        y,
        luma,
        width: config.analysisWidth,
        height: config.analysisHeight,
        config,
        now
      });

      if (!tracker) {
        if (!options.silent) {
          addAlert("info", "Target too close to edge. Try clicking a clearer area.");
        }
        return;
      }

      tracker.lastGoodPosition = { x: tracker.x, y: tracker.y };
      if (detectorTrackId) {
        tracker.detectorTrackId = detectorTrackId;
        tracker.detectorLabel = detectorLabel;
        tracker.detectorConfidence = detectorConfidence;
        tracker.detectorMisses = 0;
        tracker.lastDetectorAt = now;
      }

      const allowMulti = options.forceMulti || trackingMode === "multi";
      if (!allowMulti) {
        trackersRef.current = [tracker];
        setSelectedTracker(tracker.id);
      } else {
        if (trackersRef.current.length >= config.maxTrackers) {
          if (!options.silent) {
            addAlert("info", "Maximum tracker count reached.");
          }
          return;
        }
        trackersRef.current = [...trackersRef.current, tracker];
        setSelectedTracker(tracker.id);
      }

      setTrackers([...trackersRef.current]);
      if (!options.silent) {
        addAlert("zone", `Tracking locked on ${tracker.label}`, tracker.id);
      }

      if ((options.broadcast ?? true) && collabEnabled) {
        collabSendRef.current({
          type: "tracker:add",
          payload: {
            id: tracker.id,
            label: tracker.label,
            color: tracker.color,
            x: tracker.x / config.analysisWidth,
            y: tracker.y / config.analysisHeight
          }
        });
      }

      if (
        !options.skipAutoIdentify &&
        AI_TRACKING_CONFIG.AUTO_IDENTIFY_ON_PLACEMENT &&
        openaiApiKey &&
        canvas
      ) {
        const updateTrackerLabel = (
          nextLabel: string,
          status: LabelStatus,
          extras?: Partial<ClickTracker>
        ) => {
          trackersRef.current = trackersRef.current.map((t) =>
            t.id === id ? { ...t, labelStatus: status, label: nextLabel, ...extras } : t
          );
          setTrackers([...trackersRef.current]);

          if ((options.broadcast ?? true) && collabEnabled && status === "labeled") {
            collabSendRef.current({
              type: "tracker:update",
              payload: { id, label: nextLabel }
            });
          }
        };

        updateTrackerLabel("Identifying...", "thinking");

        try {
          const scaleX = canvas.width / config.analysisWidth;
          const scaleY = canvas.height / config.analysisHeight;
          const displayX = x * scaleX;
          const displayY = y * scaleY;

          const result = await identifyObjectWithFeatures(canvas, displayX, displayY, openaiApiKey);

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
          updateTrackerLabel(label, "idle");
        }
      }
    },
    [
      addAlert,
      captureLumaFrame,
      collabEnabled,
      ensureTrackingConfig,
      openaiApiKey,
      trackingMode,
      useServerDetection,
      videoSource
    ]
  );

  const applyCollabAction = useCallback(
    async (action: CollabAction) => {
      const video = videoRef.current;
      if (!video) return;

      const config = configRef.current ?? ensureTrackingConfig(video);
      if (!config) return;

      switch (action.type) {
        case "tracker:add": {
          const x = action.payload.x * config.analysisWidth;
          const y = action.payload.y * config.analysisHeight;
          await addTrackerAt(x, y, {
            id: action.payload.id,
            label: action.payload.label,
            color: action.payload.color,
            broadcast: false,
            skipAutoIdentify: true,
            forceMulti: true,
            silent: true
          });
          break;
        }
        case "tracker:update":
          trackersRef.current = trackersRef.current.map((tracker) =>
            tracker.id === action.payload.id ? { ...tracker, label: action.payload.label } : tracker
          );
          setTrackers([...trackersRef.current]);
          break;
        case "tracker:remove":
          removeTracker(action.payload.id, { silent: true, broadcast: false });
          break;
        case "reset":
          resetAll({ silent: true, broadcast: false });
          break;
        case "session:toggle":
          setSessionState(action.payload.active, {
            broadcast: false,
            reason: action.payload.active
              ? "Monitoring started by collaborator"
              : "Monitoring paused by collaborator"
          });
          break;
        case "state:sync":
          resetAll({ silent: true, broadcast: false });
          for (const tracker of action.payload.trackers) {
            const nextX = tracker.x * config.analysisWidth;
            const nextY = tracker.y * config.analysisHeight;
            await addTrackerAt(nextX, nextY, {
              id: tracker.id,
              label: tracker.label,
              color: tracker.color,
              broadcast: false,
              skipAutoIdentify: true,
              forceMulti: true,
              silent: true
            });
          }
          setSessionState(action.payload.sessionActive, {
            broadcast: false,
            silent: true
          });
          break;
      }
    },
    [addTrackerAt, ensureTrackingConfig, removeTracker, resetAll, setSessionState]
  );

  const handleCollabMessage = useCallback(
    (message: CollabMessage) => {
      const action = parseCollabAction(message);
      if (!action) return;

      const video = videoRef.current;
      if (!video || !videoReady || video.videoWidth === 0) {
        pendingCollabRef.current.push(action);
        return;
      }

      void applyCollabAction(action);
    },
    [applyCollabAction, videoReady]
  );

  const collab = useWebRtcCollab({
    enabled: collabEnabled,
    serverUrl: collabServerUrl,
    roomId: collabRoomId,
    role: collabRole,
    localStream: shareStream,
    onMessage: handleCollabMessage
  });

  useEffect(() => {
    collabSendRef.current = collab.sendMessage;
  }, [collab.sendMessage]);

  useEffect(() => {
    if (!videoReady || pendingCollabRef.current.length === 0) return;
    const queue = [...pendingCollabRef.current];
    pendingCollabRef.current = [];
    queue.forEach((action) => {
      void applyCollabAction(action);
    });
  }, [applyCollabAction, videoReady]);

  useEffect(() => {
    if (collabEnabled && trackingMode !== "multi") {
      setTrackingMode("multi");
    }
  }, [collabEnabled, trackingMode]);

  useEffect(() => {
    if (!collab.dataChannelOpen || collabRole !== "host" || !videoReady) return;
    const video = videoRef.current;
    if (!video) return;

    const config = configRef.current ?? ensureTrackingConfig(video);
    if (!config) return;

    const payload = {
      sessionActive: sessionActiveRef.current,
      trackers: trackersRef.current.map((tracker) => ({
        id: tracker.id,
        label: tracker.label,
        color: tracker.color,
        x: tracker.x / config.analysisWidth,
        y: tracker.y / config.analysisHeight
      }))
    };

    collab.sendMessage({ type: "state:sync", payload });
  }, [collab.dataChannelOpen, collabRole, collab.sendMessage, ensureTrackingConfig, videoReady]);

  useEffect(() => {
    setSessionActive(false);
    resetAll({ silent: true, broadcast: false });
    pendingCollabRef.current = [];
    if (shareStream && shareStream !== cameraStream) {
      shareStream.getTracks().forEach((track) => track.stop());
      setShareStream(null);
    }
  }, [cameraStream, demoClipId, fileUrl, resetAll, shareStream, videoSource]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setVideoReady(false);
    setVideoError(null);
    setIsVideoPlaying(false);

    if (video.srcObject) {
      video.srcObject = null;
    }
    if (video.src) {
      video.removeAttribute("src");
    }

    video.loop = false;

    if (videoSource === "camera") {
      if (!cameraStream) {
        return;
      }
      video.srcObject = cameraStream;
    } else if (videoSource === "demo") {
      if (!selectedClip) {
        setVideoError("Demo clip not found.");
        return;
      }
      video.src = selectedClip.url;
      video.loop = true;
    } else if (videoSource === "file") {
      if (!fileUrl) {
        setVideoError("Select a video file to play.");
        return;
      }
      video.src = fileUrl;
    } else if (videoSource === "webrtc") {
      if (!collab.remoteStream) {
        return;
      }
      video.srcObject = collab.remoteStream;
    }

    video.play().catch(() => undefined);
  }, [cameraStream, collab.remoteStream, fileUrl, selectedClip, videoSource]);

  useEffect(() => {
    if (!collabEnabled || collabRole !== "host") {
      if (shareStream && shareStream !== cameraStream) {
        shareStream.getTracks().forEach((track) => track.stop());
      }
      setShareStream(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (videoSource === "camera" && cameraStream) {
      if (shareStream !== cameraStream) {
        setShareStream(cameraStream);
      }
      return;
    }

    if ((videoSource === "demo" || videoSource === "file") && videoReady) {
      if (shareStream && shareStream !== cameraStream) {
        return;
      }
      const captured = typeof video.captureStream === "function" ? video.captureStream() : null;
      if (captured) {
        setShareStream(captured);
        return;
      }
    }

    setShareStream(null);
  }, [cameraStream, collabEnabled, collabRole, fileUrl, selectedClip, shareStream, videoReady, videoSource]);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (!videoReady || !canvasRef.current || !sessionActiveRef.current) return;
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
    [addTrackerAt, removeTracker, videoReady]
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
          if (!collabEnabled) {
            setTrackingMode((prev) => (prev === "multi" ? "single" : "multi"));
          }
          break;
        case "p":
          setZoneAlerts((prev) => !prev);
          break;
        case " ":
        case "enter":
          if (videoReady) {
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
  }, [collabEnabled, cycleStyle, resetAll, toggleSession, videoReady]);

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

      if (videoSource === "camera") {
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }

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
          const luma = captureLumaFrame(video, config, videoSource === "camera");
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

            const detectionsSnapshot = useServerDetection
              ? interpolatedDetectionsRef.current
              : [];
            const normalizedDetections =
              detectionsSnapshot.length > 0
                ? detectionsSnapshot.map((det) => {
                    const box = getDetectionBox(det);
                    return { ...det, bbox: box };
                  })
                : [];

            const scaledDetections =
              normalizedDetections.length > 0
                ? normalizedDetections.map((det) => ({
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
                detectorEnabled: useServerDetection,
                detectorDominant: useServerDetection,
                yoloWeight: 0.65,
                yoloReacquireRadius: config.searchRadius * 2.5
              }
            );

            trackersRef.current = update.trackers;
            let nextQuality = 0;
            if (update.trackers.length > 0) {
              nextQuality =
                update.trackers.reduce((sum, tracker) => sum + tracker.confidence, 0) /
                update.trackers.length;
            } else if (useServerDetection && normalizedDetections.length > 0) {
              const detectionAvg =
                normalizedDetections.reduce((sum, det) => sum + det.confidence, 0) /
                normalizedDetections.length;
              nextQuality = detectionAvg * 100;
            }
            setQualityScore(Math.round(nextQuality));

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
      if (useServerDetection && showServerDetections) {
        const detectionsSnapshot = interpolatedDetectionsRef.current;
        if (detectionsSnapshot.length > 0) {
          const normalizedDetections = detectionsSnapshot.map((det) => ({
            ...det,
            bbox: getDetectionBox(det)
          }));
          drawDetections(ctx, normalizedDetections, canvas.width, canvas.height, {
            lineWidth: 3,
            showLabel: true,
            showConfidence: true,
            fontSize: 14
          });
        }
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
    videoSource
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

      {videoError && (
        <div style={styles.errorBanner}>
          <span>⚠️ {videoError}</span>
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

            {!sessionActive && videoReady && (
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
              disabled={!videoReady}
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
            {(videoSource === "demo" || videoSource === "file") && (
              <>
                <button style={styles.ctrlBtn} onClick={handlePlaybackToggle}>
                  {isVideoPlaying ? "⏸ Video" : "▶ Video"}
                </button>
                <button style={styles.ctrlBtn} onClick={handlePlaybackRestart}>
                  ↺ Restart
                </button>
              </>
            )}
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
            <h3 style={styles.panelTitle}>Video Source</h3>
            <div style={styles.fieldStack}>
              <label style={styles.fieldLabel}>Source</label>
              <select
                style={styles.select}
                value={videoSource}
                onChange={(event) => handleVideoSourceChange(event.target.value as VideoSource)}
              >
                <option value="camera">🎥 Camera</option>
                <option value="demo">🎞 Demo clip</option>
                <option value="file">📂 Upload file</option>
                <option value="webrtc">🤝 WebRTC</option>
              </select>
            </div>

            {videoSource === "demo" && (
              <div style={{ ...styles.fieldStack, marginTop: "10px" }}>
                <label style={styles.fieldLabel}>Clip</label>
                <select
                  style={styles.select}
                  value={demoClipId}
                  onChange={(event) => handleDemoClipChange(event.target.value)}
                >
                  {DEMO_CLIPS.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.label}
                    </option>
                  ))}
                </select>
                <span style={styles.fieldHint}>{selectedClip?.note}</span>
              </div>
            )}

            {videoSource === "file" && (
              <div style={{ ...styles.fieldStack, marginTop: "10px" }}>
                <label style={styles.fieldLabel}>Upload</label>
                <input
                  type="file"
                  accept="video/*"
                  style={styles.input}
                  onChange={handleFileSelect}
                />
                <span style={styles.fieldHint}>{fileName ?? "No file selected."}</span>
              </div>
            )}

            {videoSource === "webrtc" && (
              <div style={{ ...styles.fieldStack, marginTop: "10px" }}>
                <span style={styles.fieldHint}>
                  {collab.remoteStream ? "Remote stream active." : "Waiting for remote stream..."}
                </span>
              </div>
            )}

            <div style={{ ...styles.statusRow, marginTop: "10px" }}>
              <span
                style={{
                  ...styles.statusDotSmall,
                  background: videoReady ? "#10b981" : "rgba(255,255,255,0.3)"
                }}
              />
              <span style={styles.mutedText}>
                {videoReady ? "Video ready" : "Waiting for video"}
              </span>
            </div>
          </div>

          <div style={styles.panelSection}>
            <h3 style={styles.panelTitle}>Collaboration</h3>
            <div style={styles.fieldStack}>
              <label style={styles.fieldLabel}>Role</label>
              <select
                style={styles.select}
                value={collabRole}
                onChange={(event) => setCollabRole(event.target.value as WebRtcRole)}
                disabled={collabEnabled}
              >
                <option value="host">Host</option>
                <option value="join">Join</option>
              </select>
            </div>
            <div style={{ ...styles.fieldStack, marginTop: "10px" }}>
              <label style={styles.fieldLabel}>Room</label>
              <input
                style={styles.input}
                value={collabRoomId}
                onChange={(event) => setCollabRoomId(event.target.value.toUpperCase())}
                disabled={collabEnabled}
              />
            </div>
            <div style={{ ...styles.fieldStack, marginTop: "10px" }}>
              <label style={styles.fieldLabel}>Signal server</label>
              <input
                style={styles.input}
                value={collabServerUrl}
                onChange={(event) => setCollabServerUrl(event.target.value)}
                disabled={collabEnabled}
              />
            </div>
            <div style={{ ...styles.panelRow, marginTop: "10px" }}>
              <button
                style={{ ...styles.ctrlBtn, ...(collabEnabled ? styles.ctrlBtnActive : {}) }}
                onClick={() => setCollabEnabled((prev) => !prev)}
              >
                {collabEnabled ? "Disconnect" : "Connect"}
              </button>
              {collab.remoteStream && videoSource !== "webrtc" && (
                <button style={styles.ctrlBtn} onClick={() => setVideoSource("webrtc")}>
                  Use remote stream
                </button>
              )}
            </div>
            <div style={{ ...styles.statusRow, marginTop: "10px" }}>
              <span
                style={{
                  ...styles.statusDotSmall,
                  background: collab.peerConnected ? "#10b981" : "rgba(255,255,255,0.3)"
                }}
              />
              <span style={styles.mutedText}>
                {collabEnabled
                  ? collab.peerConnected
                    ? "Peer connected"
                    : "Waiting for peer"
                  : "Offline"}
              </span>
              {collab.dataChannelOpen && <span style={styles.pill}>Data channel ready</span>}
            </div>
            {collab.lastError && <span style={styles.fieldHint}>{collab.lastError}</span>}
            <span style={{ ...styles.fieldHint, marginTop: "8px" }}>
              Host streams the current video source. Joiners can switch to WebRTC to view it.
            </span>
          </div>

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
                disabled={collabEnabled}
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
