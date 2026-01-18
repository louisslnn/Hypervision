"use client";

import { syncCanvasToVideo } from "@hypervision/ar-core";
import { useEffect, useMemo, useRef, useState } from "react";

type GeoFix = {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
  source: "gps" | "smoothed";
};

type Destination = {
  lat: number;
  lon: number;
  label: string;
};

type RouteStep = {
  distance: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
    bearing_after?: number;
    bearing_before?: number;
    exit?: number;
  };
};

type RouteData = {
  geometry: [number, number][];
  steps: RouteStep[];
  distance: number;
  duration: number;
};

type Guidance = {
  distanceM: number;
  bearingDeg: number;
  turnDeg: number | null;
  instruction: string;
  step?: RouteStep;
};

type Detection = {
  label: string;
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type OpenCvMat = {
  data32F: Float32Array;
  rows: number;
  cols: number;
  delete: () => void;
};

type OpenCvNet = {
  setInput: (blob: OpenCvMat) => void;
  forward: () => OpenCvMat;
  setPreferableBackend: (backend: number) => void;
  setPreferableTarget: (target: number) => void;
  delete?: () => void;
};

type OpenCvCapture = {
  read: (mat: OpenCvMat) => void;
};

type OpenCvModule = {
  Mat: new (rows: number, cols: number, type: number) => OpenCvMat;
  VideoCapture: new (video: HTMLVideoElement) => OpenCvCapture;
  Size: new (width: number, height: number) => unknown;
  Scalar: new (r: number, g: number, b: number, a?: number) => unknown;
  blobFromImage: (
    image: OpenCvMat,
    scalefactor: number,
    size: unknown,
    mean: unknown,
    swapRB: boolean,
    crop: boolean
  ) => OpenCvMat;
  readNetFromONNX?: (path: string) => OpenCvNet;
  FS_createDataFile: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean
  ) => void;
  FS_analyzePath?: (path: string) => { exists: boolean };
  DNN_BACKEND_OPENCV: number;
  DNN_TARGET_CPU: number;
  CV_8UC4: number;
};

type MapLibreGeoJsonSource = {
  setData: (data: unknown) => void;
};

type MapLibreMap = {
  addControl: (control: unknown, position?: string) => void;
  on: (event: string, handler: (event: unknown) => void) => void;
  remove: () => void;
  getSource: (id: string) => MapLibreGeoJsonSource | undefined;
  addSource: (id: string, source: { type: string; data: unknown }) => void;
  addLayer: (layer: {
    id: string;
    type: string;
    source: string;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
  }) => void;
  easeTo: (options: { center: [number, number]; zoom?: number; duration?: number }) => void;
  flyTo: (options: { center: [number, number]; zoom?: number; duration?: number }) => void;
};

type MapLibreMarker = {
  setLngLat: (coords: [number, number]) => MapLibreMarker;
  addTo: (map: MapLibreMap) => MapLibreMarker;
  remove: () => void;
};

type MapLibreGlobal = {
  Map: new (options: {
    container: HTMLElement;
    style: string;
    center: [number, number];
    zoom: number;
  }) => MapLibreMap;
  NavigationControl: new () => unknown;
  Marker: new (options: { color: string }) => MapLibreMarker;
};

type MapLibreWindow = Window & { maplibregl?: MapLibreGlobal };

const MAPLIBRE_SCRIPT = "https://unpkg.com/maplibre-gl@3.5.2/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@3.5.2/dist/maplibre-gl.css";
const MAP_STYLE = "https://demotiles.maplibre.org/style.json";

const OPENCV_SCRIPT = "https://docs.opencv.org/4.8.0/opencv.js";
const YOLO_MODEL_PATH = "/models/yolov5n.onnx";

const ROUTE_ENDPOINT = "/api/navigation/route";
const GEOCODE_ENDPOINT = "/api/navigation/geocode";
const GUIDANCE_ENDPOINT = "/api/navigation/guidance";

const INPUT_SIZE = 640;
const DETECTION_INTERVAL_MS = 1500; // Slower detection for stability
const CONFIDENCE_THRESHOLD = 0.45;
const NMS_THRESHOLD = 0.45;
const ROUTE_REFRESH_MS = 20000; // Refresh route every 20 seconds
const ROUTE_MIN_MOVE_M = 15; // Only refresh if moved 15+ meters
const GUIDANCE_INTERVAL_MS = 45000; // Voice guidance every 45 seconds minimum
const INSTRUCTION_STABLE_MS = 15000; // Keep instruction stable for 15 seconds
const SIGNIFICANT_TURN_DEG = 25; // Only announce turns > 25 degrees

const COCO_LABELS = [
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "bus",
  "train",
  "truck",
  "boat",
  "traffic light",
  "fire hydrant",
  "stop sign",
  "parking meter",
  "bench",
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
  "backpack",
  "umbrella",
  "handbag",
  "tie",
  "suitcase",
  "frisbee",
  "skis",
  "snowboard",
  "sports ball",
  "kite",
  "baseball bat",
  "baseball glove",
  "skateboard",
  "surfboard",
  "tennis racket",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
  "chair",
  "couch",
  "potted plant",
  "bed",
  "dining table",
  "toilet",
  "tv",
  "laptop",
  "mouse",
  "remote",
  "keyboard",
  "cell phone",
  "microwave",
  "oven",
  "toaster",
  "sink",
  "refrigerator",
  "book",
  "clock",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush"
];

const HAZARD_LABELS = new Set(["person", "car", "chair", "bus", "bicycle", "motorcycle", "truck"]);

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

const normalizeDeg = (deg: number) => {
  const next = deg % 360;
  return next < 0 ? next + 360 : next;
};

const distanceBetween = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(toRad(lat1)) * Math.cos(toRad(lat2));
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
};

const bearingDeg = (from: { lat: number; lon: number }, to: { lat: number; lon: number }) => {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
};

const turnAngle = (bearing: number, heading: number) => {
  const delta = normalizeDeg(bearing - heading);
  return delta > 180 ? delta - 360 : delta;
};

const formatMeters = (distanceM: number) => {
  if (distanceM < 1) {
    return "0.0m";
  }
  if (distanceM < 1000) {
    return `${distanceM.toFixed(1)}m`;
  }
  return `${(distanceM / 1000).toFixed(2)}km`;
};

// ============= Robust Voice Manager =============
class VoiceManager {
  private initialized = false;
  private speaking = false;
  private lastSpokeAt = 0;
  private minInterval = 30000; // 30 seconds minimum between announcements
  private voice: SpeechSynthesisVoice | null = null;
  private enabled = true;

  constructor() {
    // Pre-load voices when available
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.loadVoice();
      };
      this.loadVoice();
    }
  }

  private loadVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const voices = window.speechSynthesis.getVoices();
    // Prefer high-quality voices
    this.voice =
      voices.find(
        (v) =>
          v.lang.startsWith("en") &&
          (v.name.includes("Samantha") ||
            v.name.includes("Google") ||
            v.name.includes("Microsoft") ||
            v.name.includes("Natural"))
      ) ||
      voices.find((v) => v.lang.startsWith("en-US")) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      voices[0] ||
      null;

    if (this.voice) {
      console.info("[Voice] Selected voice:", this.voice.name);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  setMinInterval(ms: number) {
    this.minInterval = ms;
  }

  // Must be called from a user gesture (click/tap)
  init(): boolean {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.warn("[Voice] SpeechSynthesis not supported");
      return false;
    }

    if (this.initialized) return true;

    try {
      // Cancel any pending speech
      window.speechSynthesis.cancel();

      // Load voices
      this.loadVoice();

      // Unlock audio on iOS/Safari with silent utterance
      const unlock = new SpeechSynthesisUtterance("");
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);

      this.initialized = true;
      console.info("[Voice] Initialized successfully");
      return true;
    } catch (e) {
      console.error("[Voice] Init failed:", e);
      return false;
    }
  }

  speak(text: string, priority: "normal" | "high" = "normal"): boolean {
    if (!this.enabled) {
      console.info("[Voice] Disabled, skipping:", text.substring(0, 30));
      return false;
    }

    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.warn("[Voice] Not available");
      return false;
    }

    const now = Date.now();
    const synth = window.speechSynthesis;

    // Check minimum interval (unless high priority)
    if (priority === "normal" && now - this.lastSpokeAt < this.minInterval) {
      console.info(
        "[Voice] Too soon, skipping. Wait",
        Math.round((this.minInterval - (now - this.lastSpokeAt)) / 1000),
        "s"
      );
      return false;
    }

    // Don't interrupt current speech (unless high priority)
    if (synth.speaking && priority === "normal") {
      console.info("[Voice] Already speaking, skipping");
      return false;
    }

    // Cancel if high priority
    if (priority === "high") {
      synth.cancel();
    }

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;

      if (this.voice) {
        utterance.voice = this.voice;
      }

      utterance.onstart = () => {
        this.speaking = true;
        this.lastSpokeAt = Date.now();
        console.info("[Voice] Started:", text.substring(0, 50) + (text.length > 50 ? "..." : ""));
      };

      utterance.onend = () => {
        this.speaking = false;
        console.info("[Voice] Finished");
      };

      utterance.onerror = (e) => {
        this.speaking = false;
        console.error("[Voice] Error:", e.error);
      };

      synth.speak(utterance);
      return true;
    } catch (e) {
      console.error("[Voice] Speak failed:", e);
      return false;
    }
  }

  stop() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.speaking = false;
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
const voiceManager = new VoiceManager();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const iou = (a: Detection, b: Detection) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
};

const nonMaxSuppression = (detections: Detection[]) => {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  sorted.forEach((candidate) => {
    const overlaps = kept.some((existing) => iou(candidate, existing) > NMS_THRESHOLD);
    if (!overlaps) {
      kept.push(candidate);
    }
  });
  return kept;
};

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Document unavailable"));
      return;
    }
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.loaded = "false";
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

const loadStyle = (href: string) => {
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.querySelector(`link[href="${href}"]`);
  if (existing) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
};

const loadOpenCv = async (): Promise<OpenCvModule> => {
  // Load OpenCV script with a timeout
  const loadWithTimeout = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenCV load timeout")), 30000);
    loadScript(OPENCV_SCRIPT)
      .then(() => {
        clearTimeout(timeout);
        resolve();
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });

  await loadWithTimeout;

  const cv = (window as Window & { cv?: OpenCvModule }).cv;
  if (!cv) {
    throw new Error("OpenCV did not load");
  }
  if (cv.Mat) {
    return cv;
  }

  // Wait for WASM initialization with timeout
  return await new Promise<OpenCvModule>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenCV init timeout")), 30000);
    (cv as OpenCvModule & { onRuntimeInitialized?: () => void }).onRuntimeInitialized = () => {
      clearTimeout(timeout);
      resolve(cv);
    };
  });
};

const ensureModelInFs = (cv: OpenCvModule, name: string, data: Uint8Array) => {
  const exists = cv.FS_analyzePath?.(`/${name}`)?.exists;
  if (exists) {
    return;
  }
  cv.FS_createDataFile("/", name, data, true, false, false);
};

const buildInstruction = (step?: RouteStep | null) => {
  if (!step) {
    return "Continue toward your destination.";
  }
  const name = step.name ? ` onto ${step.name}` : "";
  const modifier = step.maneuver.modifier ? step.maneuver.modifier.replace("-", " ") : "";
  switch (step.maneuver.type) {
    case "depart":
      return `Start${modifier ? ` and head ${modifier}` : ""}${name}.`;
    case "arrive":
      return "You have arrived at your destination.";
    case "turn":
      return `Turn ${modifier || "ahead"}${name}.`;
    case "merge":
      return `Merge ${modifier || "ahead"}${name}.`;
    case "roundabout":
      return step.maneuver.exit
        ? `Enter the roundabout and take exit ${step.maneuver.exit}${name}.`
        : `Enter the roundabout${name}.`;
    case "new name":
      return `Continue${name}.`;
    default:
      return `Continue${name}.`;
  }
};

const findClosestIndex = (geometry: [number, number][], fix: GeoFix) => {
  if (geometry.length === 0) {
    return 0;
  }
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  geometry.forEach((point, index) => {
    const distance = distanceBetween(fix.lat, fix.lon, point[1], point[0]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
};

const pickRouteTarget = (geometry: [number, number][], fix: GeoFix) => {
  if (geometry.length === 0) {
    return null;
  }
  const closest = findClosestIndex(geometry, fix);
  const lookahead = Math.min(geometry.length - 1, closest + 6);
  return geometry[lookahead] ?? geometry[geometry.length - 1] ?? null;
};

const findActiveStep = (steps: RouteStep[], fix: GeoFix) => {
  if (steps.length === 0) {
    return null;
  }
  let bestStep = steps[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  steps.forEach((step) => {
    const [lon, lat] = step.maneuver.location;
    const distance = distanceBetween(fix.lat, fix.lon, lat, lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStep = step;
    }
  });
  return bestStep;
};

export function OutdoorAccessibilityNavigator() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const userMarkerRef = useRef<MapLibreMarker | null>(null);
  const destinationMarkerRef = useRef<MapLibreMarker | null>(null);
  const routeReadyRef = useRef(false);
  const lastRouteRequestRef = useRef(0);
  const lastRouteStartRef = useRef<{ lat: number; lon: number } | null>(null);
  const lastRouteEndRef = useRef<{ lat: number; lon: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cvRef = useRef<OpenCvModule | null>(null);
  const netRef = useRef<OpenCvNet | null>(null);
  const detectionsRef = useRef<Detection[]>([]);
  const lastDetectionRef = useRef(0);
  const guidanceRef = useRef<Guidance | null>(null);
  const lastSpokenRef = useRef(0);
  const lastGuidanceKeyRef = useRef("");

  const [mapStatus, setMapStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sessionActive, setSessionActive] = useState(false);
  const [detectionEnabled, setDetectionEnabled] = useState(false); // Disabled by default to prevent freeze
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [stableInstruction, setStableInstruction] = useState<string>("Set a destination to begin.");
  const [lastSpokenInstruction, setLastSpokenInstruction] = useState<string>("");
  const lastInstructionChangeRef = useRef(0);
  const [gpsFix, setGpsFix] = useState<GeoFix | null>(null);
  const [fusedFix, setFusedFix] = useState<GeoFix | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Destination[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [orientationError, setOrientationError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cvStatus, setCvStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [cvError, setCvError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [followUser, setFollowUser] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [llmEnabled, setLlmEnabled] = useState(true);
  const [llmMessage, setLlmMessage] = useState<string | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);

  const detectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    detections.forEach((det) => {
      counts[det.label] = (counts[det.label] ?? 0) + 1;
    });
    return counts;
  }, [detections]);

  const guidance = useMemo<Guidance | null>(() => {
    if (!fusedFix || !destination) {
      return null;
    }
    const target = routeData ? pickRouteTarget(routeData.geometry, fusedFix) : null;
    const nextTarget = target
      ? { lat: target[1], lon: target[0] }
      : { lat: destination.lat, lon: destination.lon };
    const bearing = bearingDeg(fusedFix, nextTarget);
    const turn = heading === null ? null : turnAngle(bearing, heading);
    const step = routeData ? findActiveStep(routeData.steps, fusedFix) : null;
    const instruction = buildInstruction(step);
    const distanceM = distanceBetween(fusedFix.lat, fusedFix.lon, destination.lat, destination.lon);
    return {
      distanceM,
      bearingDeg: bearing,
      turnDeg: turn,
      instruction,
      ...(step ? { step } : {})
    };
  }, [destination, fusedFix, heading, routeData]);

  useEffect(() => {
    guidanceRef.current = guidance;
  }, [guidance]);

  useEffect(() => {
    if (llmEnabled) {
      return;
    }
    setLlmMessage(null);
    setLlmError(null);
  }, [llmEnabled]);

  useEffect(() => {
    if (destination) {
      return;
    }
    setRouteData(null);
    setRouteStatus("idle");
    setRouteError(null);
  }, [destination]);

  // Raw instruction computation
  const rawInstruction = useMemo(() => {
    if (!destination) {
      return "Set a destination to begin.";
    }
    if (!fusedFix) {
      return "Waiting for GPS fix.";
    }
    if (!guidance) {
      return "Calculating direction.";
    }

    // Simplified, stable direction guidance
    let direction = "Continue straight";
    if (guidance.turnDeg !== null) {
      const absTurn = Math.abs(guidance.turnDeg);
      if (absTurn >= SIGNIFICANT_TURN_DEG) {
        if (guidance.turnDeg > 0) {
          direction = absTurn > 45 ? "Turn right" : "Bear right";
        } else {
          direction = absTurn > 45 ? "Turn left" : "Bear left";
        }
      }
    }

    // Round distance for stability (don't show 127m, show 130m)
    const roundedDistance =
      guidance.distanceM < 100
        ? Math.round(guidance.distanceM / 10) * 10
        : Math.round(guidance.distanceM / 50) * 50;

    return `${direction}. ${formatMeters(roundedDistance)} to destination.`;
  }, [destination, fusedFix, guidance]);

  // Stabilize instruction - only update if enough time has passed
  useEffect(() => {
    const now = Date.now();
    if (now - lastInstructionChangeRef.current >= INSTRUCTION_STABLE_MS) {
      setStableInstruction(rawInstruction);
      lastInstructionChangeRef.current = now;
    }
  }, [rawInstruction]);

  // Use stable instruction for display
  const instruction = stableInstruction;

  // Basic voice announcement (doesn't require LLM)
  // Sync voiceEnabled with voice manager
  useEffect(() => {
    voiceManager.setEnabled(voiceEnabled);
  }, [voiceEnabled]);

  // Basic voice announcements for navigation instructions
  useEffect(() => {
    if (!sessionActive || !voiceEnabled || !destination || !guidance) {
      return;
    }

    // Only speak if instruction changed meaningfully
    if (stableInstruction === lastSpokenInstruction) {
      return;
    }

    // Don't speak generic messages
    if (
      stableInstruction.includes("Set a destination") ||
      stableInstruction.includes("Waiting for GPS") ||
      stableInstruction.includes("Calculating")
    ) {
      return;
    }

    // Build announcement with hazard info
    let announcement = stableInstruction;
    if (detections.length > 0) {
      const hazardSummary = Object.entries(
        detections.reduce(
          (acc, det) => {
            acc[det.label] = (acc[det.label] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        )
      )
        .map(([label, count]) => `${count} ${label}${count > 1 ? "s" : ""}`)
        .join(", ");
      announcement += ` Nearby: ${hazardSummary}.`;
    }

    // VoiceManager handles timing internally (30s min interval)
    if (voiceManager.speak(announcement)) {
      setLastSpokenInstruction(stableInstruction);
    }
  }, [
    sessionActive,
    voiceEnabled,
    destination,
    guidance,
    stableInstruction,
    lastSpokenInstruction,
    detections
  ]);

  // Announce destination changes
  const prevDestinationRef = useRef<Destination | null>(null);
  useEffect(() => {
    if (!sessionActive || !voiceEnabled || !destination) {
      return;
    }

    // Check if destination actually changed
    if (
      prevDestinationRef.current?.label === destination.label &&
      prevDestinationRef.current?.lat === destination.lat &&
      prevDestinationRef.current?.lon === destination.lon
    ) {
      return;
    }

    prevDestinationRef.current = destination;

    const announcement = `Navigating to ${destination.label}. ${guidance?.distanceM ? `About ${formatMeters(guidance.distanceM)} away.` : "Calculating route."}`;
    voiceManager.speak(announcement, "high"); // High priority for destination changes
  }, [destination, guidance, sessionActive, voiceEnabled]);

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }
    let active = true;
    setMapStatus("loading");
    loadStyle(MAPLIBRE_CSS);
    loadScript(MAPLIBRE_SCRIPT)
      .then(() => {
        const maplibregl = (window as MapLibreWindow).maplibregl;
        if (!maplibregl || !active) {
          throw new Error("Map library failed to load");
        }
        const container = mapContainerRef.current;
        if (!container) {
          throw new Error("Map container not found");
        }
        const map = new maplibregl.Map({
          container,
          style: MAP_STYLE,
          center: [-73.9857, 40.7484],
          zoom: 15
        });
        map.addControl(new maplibregl.NavigationControl(), "top-right");
        map.on("load", () => {
          if (!active) {
            return;
          }
          routeReadyRef.current = true;
          setMapStatus("ready");
        });
        map.on("click", (event: unknown) => {
          const e = event as { lngLat: { lat: number; lng: number } };
          setDestination({
            lat: e.lngLat.lat,
            lon: e.lngLat.lng,
            label: "Selected location"
          });
          setSearchResults([]);
          setDestinationQuery("");
        });
        mapRef.current = map;
      })
      .catch((error: Error) => {
        if (active) {
          setMapStatus("error");
          setSearchError(error.message);
        }
      });
    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    console.info("[Navigator] Starting GPS watch...");
    if (!navigator.geolocation) {
      console.warn("[Navigator] Geolocation not supported");
      setGpsError("Geolocation is not supported in this browser.");
      return;
    }
    let watchId: number | null = null;
    try {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          console.info("[Navigator] GPS fix received");
          setGpsFix({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
            source: "gps"
          });
          setGpsError(null);
        },
        (error) => {
          console.warn("[Navigator] GPS error:", error.message);
          setGpsError(error.message || "Unable to read GPS.");
        },
        { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
      );
    } catch (error) {
      console.error("[Navigator] GPS watch error:", error);
      setGpsError("Failed to start GPS.");
    }
    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [sessionActive]);

  useEffect(() => {
    if (!gpsFix) {
      return;
    }
    setFusedFix((prev) => {
      if (!prev) {
        return { ...gpsFix, source: "smoothed" };
      }
      const alpha = clamp(1 - Math.min(gpsFix.accuracy, 30) / 45, 0.2, 0.65);
      return {
        lat: prev.lat + (gpsFix.lat - prev.lat) * alpha,
        lon: prev.lon + (gpsFix.lon - prev.lon) * alpha,
        accuracy: gpsFix.accuracy,
        timestamp: gpsFix.timestamp,
        source: "smoothed"
      };
    });
  }, [gpsFix]);

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    console.info("[Navigator] Setting up orientation listener...");

    if (typeof DeviceOrientationEvent === "undefined") {
      console.warn("[Navigator] DeviceOrientationEvent not available");
      setOrientationError("Orientation is not supported on this device.");
      return;
    }

    const handler = (event: DeviceOrientationEvent) => {
      try {
        const compassHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
          .webkitCompassHeading;
        const alpha = event.alpha;
        if (typeof compassHeading === "number") {
          setHeading(compassHeading);
          return;
        }
        if (typeof alpha === "number") {
          setHeading(normalizeDeg(360 - alpha));
        }
      } catch (err) {
        console.warn("[Navigator] Orientation handler error:", err);
      }
    };

    try {
      window.addEventListener("deviceorientation", handler, true);
      console.info("[Navigator] Orientation listener added");
    } catch (err) {
      console.error("[Navigator] Failed to add orientation listener:", err);
    }

    return () => {
      try {
        window.removeEventListener("deviceorientation", handler, true);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [sessionActive]);

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    console.info("[Navigator] Starting camera...");
    let active = true;
    const video = videoRef.current;
    if (!video) {
      console.warn("[Navigator] Video element not found");
      return;
    }

    // Check if mediaDevices is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("[Navigator] getUserMedia not supported");
      setCameraError("Camera not supported in this browser. Try using HTTPS.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        console.info("[Navigator] Camera stream received");
        video.srcObject = stream;
        video.play().catch((err) => {
          console.warn("[Navigator] Video play error:", err);
        });
      })
      .catch((err) => {
        console.error("[Navigator] Camera error:", err);
        if (active) {
          if (err.name === "NotAllowedError") {
            setCameraError("Camera permission denied. Please allow camera access.");
          } else if (err.name === "NotFoundError") {
            setCameraError("No camera found on this device.");
          } else if (err.name === "NotReadableError") {
            setCameraError("Camera is in use by another application.");
          } else {
            setCameraError(`Camera error: ${err.message || err.name}`);
          }
        }
      });
    return () => {
      active = false;
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [sessionActive]);

  useEffect(() => {
    // Only load OpenCV when detection is explicitly enabled
    if (!sessionActive || !detectionEnabled || cvStatus !== "idle") {
      return;
    }
    let active = true;
    console.info("[Navigator] Loading OpenCV (this may take a moment)...");
    setCvStatus("loading");

    // Use setTimeout to prevent blocking the main thread
    setTimeout(() => {
      if (!active) return;

      loadOpenCv()
        .then(async (cv) => {
          if (!active) return;
          console.info("[Navigator] OpenCV loaded, checking DNN support...");

          if (!cv.readNetFromONNX) {
            throw new Error("OpenCV DNN module is unavailable. Object detection disabled.");
          }

          console.info("[Navigator] Fetching YOLO model...");
          const modelResponse = await fetch(YOLO_MODEL_PATH);
          if (!modelResponse.ok) {
            throw new Error(`Failed to fetch YOLO model: ${modelResponse.status}`);
          }

          const modelBuffer = new Uint8Array(await modelResponse.arrayBuffer());
          console.info("[Navigator] Model loaded, size:", modelBuffer.length);

          ensureModelInFs(cv, "yolov5n.onnx", modelBuffer);

          console.info("[Navigator] Creating neural network...");
          const net = cv.readNetFromONNX("yolov5n.onnx");
          net.setPreferableBackend(cv.DNN_BACKEND_OPENCV);
          net.setPreferableTarget(cv.DNN_TARGET_CPU);

          if (!active) {
            return;
          }
          cvRef.current = cv;
          netRef.current = net;
          setCvStatus("ready");
          console.info("[Navigator] OpenCV ready for object detection");
        })
        .catch((error: Error) => {
          console.error("[Navigator] OpenCV error:", error);
          if (active) {
            setCvStatus("error");
            setCvError(error.message);
          }
        });
    }, 100); // Small delay to let the UI render first

    return () => {
      active = false;
    };
  }, [sessionActive, detectionEnabled, cvStatus]);

  useEffect(() => {
    if (!sessionActive || !detectionEnabled || cvStatus !== "ready") {
      return;
    }
    let rafId: number | null = null;
    let active = true;

    const runDetection = () => {
      const cv = cvRef.current;
      const net = netRef.current;
      const video = videoRef.current;
      if (!cv || !net || !video) {
        return;
      }
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      const frame = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
      const cap = new cv.VideoCapture(video);
      cap.read(frame);

      const blob = cv.blobFromImage(
        frame,
        1 / 255,
        new cv.Size(INPUT_SIZE, INPUT_SIZE),
        new cv.Scalar(0, 0, 0),
        true,
        false
      );
      net.setInput(blob);
      const out = net.forward();
      const data = out.data32F;

      const rawDetections: Detection[] = [];
      const stride = 5 + COCO_LABELS.length;
      const detectionsCount = Math.floor(data.length / stride);
      for (let i = 0; i < detectionsCount; i += 1) {
        const offset = i * stride;
        const objectness = data[offset + 4] ?? 0;
        if (objectness < 0.2) {
          continue;
        }
        let bestScore = 0;
        let bestClass = -1;
        for (let c = 0; c < COCO_LABELS.length; c += 1) {
          const score = data[offset + 5 + c] ?? 0;
          if (score > bestScore) {
            bestScore = score;
            bestClass = c;
          }
        }
        if (bestClass < 0) {
          continue;
        }
        const confidence = bestScore * objectness;
        if (confidence < CONFIDENCE_THRESHOLD) {
          continue;
        }
        const label = COCO_LABELS[bestClass];
        if (!label || !HAZARD_LABELS.has(label)) {
          continue;
        }
        const cx = data[offset] ?? 0;
        const cy = data[offset + 1] ?? 0;
        const width = data[offset + 2] ?? 0;
        const height = data[offset + 3] ?? 0;
        const x = clamp((cx - width / 2) / INPUT_SIZE, 0, 1);
        const y = clamp((cy - height / 2) / INPUT_SIZE, 0, 1);
        rawDetections.push({
          label,
          score: confidence,
          x,
          y,
          width: clamp(width / INPUT_SIZE, 0, 1),
          height: clamp(height / INPUT_SIZE, 0, 1)
        });
      }

      const grouped = new Map<string, Detection[]>();
      rawDetections.forEach((item) => {
        const list = grouped.get(item.label);
        if (list) {
          list.push(item);
        } else {
          grouped.set(item.label, [item]);
        }
      });
      const filtered: Detection[] = [];
      grouped.forEach((items) => {
        filtered.push(...nonMaxSuppression(items));
      });

      detectionsRef.current = filtered;
      setDetections(filtered);

      frame.delete();
      blob.delete();
      out.delete();
    };

    const drawOverlay = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) {
        return;
      }
      syncCanvasToVideo(canvas, video);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const guidanceValue = guidanceRef.current;
      if (guidanceValue) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height * 0.35; // Position higher on screen
        const size = Math.min(canvas.width, canvas.height) * 0.12; // Small like Google Maps
        const angleDeg = guidanceValue.turnDeg ?? guidanceValue.bearingDeg;
        const angle = toRad(angleDeg - 90);

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle);

        // Google Maps style 3D arrow - small and sleek
        // Draw shadow/3D depth layer first (darker, offset)
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.7, size * 0.5);
        ctx.lineTo(0, size * 0.15);
        ctx.lineTo(-size * 0.7, size * 0.5);
        ctx.closePath();
        ctx.fillStyle = "rgba(30, 80, 60, 0.9)"; // Dark green shadow
        ctx.fill();

        // Main arrow (slightly offset up-left for 3D effect)
        ctx.translate(-2, -3);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.7, size * 0.5);
        ctx.lineTo(0, size * 0.15);
        ctx.lineTo(-size * 0.7, size * 0.5);
        ctx.closePath();

        // Google Maps blue gradient
        const gradient = ctx.createLinearGradient(0, -size, 0, size * 0.5);
        gradient.addColorStop(0, "#4285F4"); // Google blue
        gradient.addColorStop(0.5, "#34A853"); // Google green
        gradient.addColorStop(1, "#4285F4"); // Google blue
        ctx.fillStyle = gradient;
        ctx.fill();

        // Thin white outline
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner highlight for 3D effect
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.85);
        ctx.lineTo(size * 0.4, size * 0.2);
        ctx.lineTo(0, size * 0.05);
        ctx.lineTo(-size * 0.4, size * 0.2);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.fill();

        ctx.restore();

        // Draw distance in a pill/badge at bottom
        if (guidanceValue.distanceM) {
          const distText = formatMeters(guidanceValue.distanceM);
          ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, sans-serif";
          ctx.textAlign = "center";
          const textWidth = ctx.measureText(distText).width;

          // Pill background
          const pillX = canvas.width / 2 - textWidth / 2 - 16;
          const pillY = canvas.height - 50;
          const pillWidth = textWidth + 32;
          const pillHeight = 32;
          const pillRadius = 16;

          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillRadius);
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fill();

          // Text
          ctx.fillStyle = "#ffffff";
          ctx.fillText(distText, canvas.width / 2, pillY + 22);
        }
      }

      const activeDetections = detectionsRef.current;
      activeDetections.forEach((det) => {
        const x = det.x * canvas.width;
        const y = det.y * canvas.height;
        const width = det.width * canvas.width;
        const height = det.height * canvas.height;

        // Color based on object type - hazards in red/orange, others in blue
        const isHazard = ["car", "truck", "bus", "motorcycle", "bicycle"].includes(det.label);
        const isPerson = det.label === "person";

        let boxColor = "rgba(59, 130, 246, 0.9)"; // Blue for neutral
        let bgColor = "rgba(59, 130, 246, 0.2)";
        if (isHazard) {
          boxColor = "rgba(239, 68, 68, 0.95)"; // Red for vehicles
          bgColor = "rgba(239, 68, 68, 0.15)";
        } else if (isPerson) {
          boxColor = "rgba(251, 191, 36, 0.95)"; // Yellow for people
          bgColor = "rgba(251, 191, 36, 0.15)";
        }

        // Draw filled background
        ctx.fillStyle = bgColor;
        ctx.fillRect(x, y, width, height);

        // Draw border
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, width, height);

        // Draw corner accents
        const cornerSize = Math.min(width, height) * 0.2;
        ctx.lineWidth = 4;
        // Top-left
        ctx.beginPath();
        ctx.moveTo(x, y + cornerSize);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerSize, y);
        ctx.stroke();
        // Top-right
        ctx.beginPath();
        ctx.moveTo(x + width - cornerSize, y);
        ctx.lineTo(x + width, y);
        ctx.lineTo(x + width, y + cornerSize);
        ctx.stroke();
        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(x, y + height - cornerSize);
        ctx.lineTo(x, y + height);
        ctx.lineTo(x + cornerSize, y + height);
        ctx.stroke();
        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(x + width - cornerSize, y + height);
        ctx.lineTo(x + width, y + height);
        ctx.lineTo(x + width, y + height - cornerSize);
        ctx.stroke();

        // Draw label with background
        const labelText = `${det.label.toUpperCase()} ${(det.score * 100).toFixed(0)}%`;
        ctx.font = "bold 14px -apple-system, BlinkMacSystemFont, sans-serif";
        const textWidth = ctx.measureText(labelText).width;

        // Label background
        ctx.fillStyle = boxColor;
        ctx.fillRect(x, y - 24, textWidth + 12, 22);

        // Label text
        ctx.fillStyle = "white";
        ctx.fillText(labelText, x + 6, y - 8);

        // Add warning icon for hazards
        if (isHazard) {
          ctx.font = "18px -apple-system";
          ctx.fillText("⚠️", x + textWidth + 16, y - 7);
        } else if (isPerson) {
          ctx.font = "18px -apple-system";
          ctx.fillText("👤", x + textWidth + 16, y - 7);
        }
      });
    };

    const loop = (timestamp: number) => {
      if (!active) {
        return;
      }
      if (timestamp - lastDetectionRef.current > DETECTION_INTERVAL_MS) {
        lastDetectionRef.current = timestamp;
        runDetection();
      }
      drawOverlay();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      active = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [cvStatus, detectionEnabled, sessionActive]);

  useEffect(() => {
    if (sessionActive) {
      return;
    }
    detectionsRef.current = [];
    setDetections([]);
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }, [sessionActive]);

  // Separate overlay loop for arrows (runs even when detection is off)
  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    // Skip if detection loop is already running (it handles drawing)
    if (detectionEnabled && cvStatus === "ready") {
      return;
    }

    let active = true;
    let rafId: number | null = null;

    const drawArrowOverlay = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !active) {
        return;
      }
      syncCanvasToVideo(canvas, video);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const guidanceValue = guidanceRef.current;
      if (guidanceValue && (guidanceValue.turnDeg !== null || guidanceValue.bearingDeg !== null)) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height * 0.35;
        const size = Math.min(canvas.width, canvas.height) * 0.12; // Small like Google Maps
        const angleDeg = guidanceValue.turnDeg ?? guidanceValue.bearingDeg ?? 0;
        const angle = toRad(angleDeg - 90);

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle);

        // Google Maps style 3D arrow - small and sleek
        // Draw shadow/3D depth layer first
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.7, size * 0.5);
        ctx.lineTo(0, size * 0.15);
        ctx.lineTo(-size * 0.7, size * 0.5);
        ctx.closePath();
        ctx.fillStyle = "rgba(30, 80, 60, 0.9)";
        ctx.fill();

        // Main arrow (offset for 3D)
        ctx.translate(-2, -3);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.7, size * 0.5);
        ctx.lineTo(0, size * 0.15);
        ctx.lineTo(-size * 0.7, size * 0.5);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, -size, 0, size * 0.5);
        gradient.addColorStop(0, "#4285F4");
        gradient.addColorStop(0.5, "#34A853");
        gradient.addColorStop(1, "#4285F4");
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner highlight
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.85);
        ctx.lineTo(size * 0.4, size * 0.2);
        ctx.lineTo(0, size * 0.05);
        ctx.lineTo(-size * 0.4, size * 0.2);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.fill();

        ctx.restore();

        // Distance pill
        if (guidanceValue.distanceM) {
          const distText = formatMeters(guidanceValue.distanceM);
          ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, sans-serif";
          ctx.textAlign = "center";
          const textWidth = ctx.measureText(distText).width;

          const pillX = canvas.width / 2 - textWidth / 2 - 16;
          const pillY = canvas.height - 50;
          const pillWidth = textWidth + 32;
          const pillHeight = 32;
          const pillRadius = 16;

          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillRadius);
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.fillText(distText, canvas.width / 2, pillY + 22);
        }
      }

      rafId = requestAnimationFrame(drawArrowOverlay);
    };

    rafId = requestAnimationFrame(drawArrowOverlay);
    return () => {
      active = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [sessionActive, detectionEnabled, cvStatus]);

  useEffect(() => {
    if (!mapRef.current || mapStatus !== "ready" || !fusedFix) {
      return;
    }
    const map = mapRef.current;
    if (!userMarkerRef.current) {
      const maplibregl = (window as MapLibreWindow).maplibregl;
      if (!maplibregl) return;
      userMarkerRef.current = new maplibregl.Marker({ color: "#1e1f24" })
        .setLngLat([fusedFix.lon, fusedFix.lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([fusedFix.lon, fusedFix.lat]);
    }
    if (followUser) {
      map.easeTo({ center: [fusedFix.lon, fusedFix.lat], zoom: 16, duration: 500 });
    }
  }, [fusedFix, followUser, mapStatus]);

  useEffect(() => {
    if (!mapRef.current || mapStatus !== "ready") {
      return;
    }
    const map = mapRef.current;
    const maplibregl = (window as MapLibreWindow).maplibregl;
    if (!destination) {
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.remove();
        destinationMarkerRef.current = null;
      }
      return;
    }
    if (!maplibregl) return;
    if (!destinationMarkerRef.current) {
      destinationMarkerRef.current = new maplibregl.Marker({ color: "#2f7c5f" })
        .setLngLat([destination.lon, destination.lat])
        .addTo(map);
      // Fly to the new destination
      map.flyTo({
        center: [destination.lon, destination.lat],
        zoom: 15,
        duration: 1500
      });
    } else {
      destinationMarkerRef.current.setLngLat([destination.lon, destination.lat]);
      // Also fly when destination changes
      map.flyTo({
        center: [destination.lon, destination.lat],
        zoom: 15,
        duration: 1500
      });
    }
  }, [destination, mapStatus]);

  useEffect(() => {
    if (mapStatus !== "ready" || !mapRef.current || !routeReadyRef.current || !routeData) {
      return;
    }
    const map = mapRef.current;
    const routeId = "route-line";
    const routeDataLayer = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: routeData.geometry
          },
          properties: {}
        }
      ]
    };
    const existing = map.getSource(routeId);
    if (!existing) {
      map.addSource(routeId, { type: "geojson", data: routeDataLayer });
      map.addLayer({
        id: routeId,
        type: "line",
        source: routeId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#e5542b", "line-width": 3, "line-opacity": 0.7 }
      });
    } else {
      existing.setData(routeDataLayer);
    }
  }, [routeData, mapStatus]);

  useEffect(() => {
    if (!sessionActive || !fusedFix || !destination) {
      return;
    }
    const now = Date.now();
    const movedEnough =
      !lastRouteStartRef.current ||
      distanceBetween(
        fusedFix.lat,
        fusedFix.lon,
        lastRouteStartRef.current.lat,
        lastRouteStartRef.current.lon
      ) > ROUTE_MIN_MOVE_M;
    const destinationChanged =
      !lastRouteEndRef.current ||
      distanceBetween(
        destination.lat,
        destination.lon,
        lastRouteEndRef.current.lat,
        lastRouteEndRef.current.lon
      ) > 3;

    if (
      !movedEnough &&
      !destinationChanged &&
      now - lastRouteRequestRef.current < ROUTE_REFRESH_MS
    ) {
      return;
    }

    lastRouteRequestRef.current = now;
    lastRouteStartRef.current = { lat: fusedFix.lat, lon: fusedFix.lon };
    lastRouteEndRef.current = { lat: destination.lat, lon: destination.lon };
    setRouteStatus("loading");
    setRouteError(null);

    fetch(ROUTE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { lat: fusedFix.lat, lon: fusedFix.lon },
        end: { lat: destination.lat, lon: destination.lon }
      })
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Routing failed.");
        }
        const data = (await response.json()) as {
          status: string;
          route?: RouteData;
          error?: string;
        };
        if (data.status !== "ok" || !data.route) {
          throw new Error(data.error ?? "Routing error.");
        }
        setRouteData(data.route);
        setRouteStatus("ready");
      })
      .catch((error: Error) => {
        setRouteStatus("error");
        setRouteError(error.message);
      });
  }, [destination, fusedFix, sessionActive]);

  useEffect(() => {
    if (!sessionActive || !llmEnabled || !guidance || !destination) {
      return;
    }
    const now = Date.now();

    // Include detailed object info for LLM to describe
    const hazardList = Object.entries(detectionCounts).map(([label, count]) => ({
      label,
      count
    }));

    // Also provide position hints for detected objects
    const detectedObjects = detections.slice(0, 5).map((det) => ({
      label: det.label,
      confidence: Math.round(det.score * 100),
      position: det.x < 0.33 ? "left" : det.x > 0.66 ? "right" : "center",
      size:
        det.width * det.height > 0.1 ? "large" : det.width * det.height > 0.03 ? "medium" : "small"
    }));

    // Create a stable key by rounding aggressively
    // Only change when: direction changes significantly, distance changes by 50m+, or hazards change
    const turnBucket =
      guidance.turnDeg !== null
        ? Math.abs(guidance.turnDeg) < SIGNIFICANT_TURN_DEG
          ? "straight"
          : guidance.turnDeg > 0
            ? "right"
            : "left"
        : "unknown";
    const distanceBucket = Math.floor(guidance.distanceM / 50) * 50; // Round to nearest 50m

    const key = JSON.stringify({
      turn: turnBucket,
      distance: distanceBucket,
      hazards: hazardList.length > 0,
      destination: destination.label
    });

    // Only update if key changed AND enough time has passed
    if (key === lastGuidanceKeyRef.current && now - lastSpokenRef.current < GUIDANCE_INTERVAL_MS) {
      return;
    }

    lastGuidanceKeyRef.current = key;
    lastSpokenRef.current = now;
    setLlmError(null);

    fetch(GUIDANCE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: stableInstruction, // Use stable instruction
        distanceMeters: guidance.distanceM,
        turnDegrees: guidance.turnDeg,
        destinationLabel: destination.label,
        hazards: hazardList,
        detectedObjects: detectedObjects, // Detailed object info for LLM to describe
        routeDistanceMeters: routeData?.distance ?? null,
        routeDurationSeconds: routeData?.duration ?? null
      })
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Guidance request failed.");
        }
        const data = (await response.json()) as {
          status: string;
          message?: string;
          error?: string;
        };
        if (data.status !== "ok" || !data.message) {
          throw new Error(data.error ?? "Guidance error.");
        }
        setLlmMessage(data.message);
        if (voiceEnabled) {
          voiceManager.speak(data.message);
        }
      })
      .catch((error: Error) => {
        setLlmError(error.message);
      });
  }, [
    destination,
    detectionCounts,
    detections,
    guidance,
    llmEnabled,
    routeData,
    sessionActive,
    stableInstruction,
    voiceEnabled
  ]);

  const requestCompassPermission = async () => {
    try {
      if (typeof DeviceOrientationEvent === "undefined") {
        console.warn("[Navigator] DeviceOrientationEvent not supported");
        setOrientationError("Orientation is not supported on this device.");
        return;
      }
      const permissionRequest = (
        DeviceOrientationEvent as unknown as {
          requestPermission?: () => Promise<"granted" | "denied">;
        }
      ).requestPermission;
      if (permissionRequest) {
        try {
          const result = await permissionRequest();
          if (result !== "granted") {
            setOrientationError("Compass permission denied.");
            return;
          }
        } catch (permError) {
          // iOS may throw if not called from user gesture or not supported
          console.warn("[Navigator] Compass permission error:", permError);
          setOrientationError("Compass not available on this device.");
          return;
        }
      }
      setOrientationError(null);
    } catch (error) {
      console.error("[Navigator] requestCompassPermission error:", error);
      setOrientationError(error instanceof Error ? error.message : "Compass permission error.");
    }
  };

  const handleStart = async () => {
    console.info("[Navigator] Starting navigation session...");
    try {
      setSessionActive(true);
      // Don't await compass - let it fail silently if needed
      requestCompassPermission().catch((err) => {
        console.warn("[Navigator] Compass permission failed:", err);
      });

      // Initialize voice on user gesture (required for mobile)
      voiceManager.setEnabled(voiceEnabled);
      if (voiceEnabled) {
        voiceManager.init();
        setTimeout(() => {
          voiceManager.speak(
            "Navigation started. Search for a destination or tap on the map.",
            "high"
          );
        }, 500);
      }
    } catch (error) {
      console.error("[Navigator] handleStart error:", error);
    }
  };

  const handleStop = () => {
    setSessionActive(false);
  };

  const handleSearch = async () => {
    if (!destinationQuery.trim()) {
      return;
    }
    setSearchError(null);
    console.info("[Navigator] Searching for:", destinationQuery);
    try {
      const response = await fetch(GEOCODE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: destinationQuery, limit: 5 })
      });
      if (!response.ok) {
        throw new Error("Search failed.");
      }
      const data = (await response.json()) as {
        status: string;
        results?: Destination[];
        error?: string;
      };
      console.info("[Navigator] Search results:", data);
      if (data.status !== "ok" || !data.results) {
        throw new Error(data.error ?? "Search error.");
      }
      setSearchResults(data.results);
      if (data.results.length >= 1 && data.results[0]) {
        console.info("[Navigator] Setting destination:", data.results[0]);
        setDestination(data.results[0]);
      }
    } catch (error) {
      console.error("[Navigator] Search error:", error);
      setSearchError(error instanceof Error ? error.message : "Search error.");
    }
  };

  // Fullscreen navigation view
  if (fullscreenMode && sessionActive) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "#000",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {/* Camera View - Full Screen */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <video
            ref={videoRef}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover"
            }}
            playsInline
            muted
          />
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none"
            }}
          />

          {/* Instruction Overlay at Top */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: "20px",
              paddingTop: "env(safe-area-inset-top, 20px)",
              background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)"
            }}
          >
            <p
              style={{
                color: "white",
                fontSize: "18px",
                fontWeight: "600",
                textAlign: "center",
                textShadow: "0 2px 8px rgba(0,0,0,0.8)"
              }}
            >
              {instruction}
            </p>
            {llmMessage && (
              <p
                style={{
                  color: "rgba(255,255,255,0.9)",
                  fontSize: "14px",
                  textAlign: "center",
                  marginTop: "8px",
                  textShadow: "0 1px 4px rgba(0,0,0,0.8)"
                }}
              >
                {llmMessage}
              </p>
            )}
          </div>

          {/* Controls at Bottom */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: "20px",
              paddingBottom: "env(safe-area-inset-bottom, 20px)",
              background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
              display: "flex",
              justifyContent: "center",
              gap: "12px"
            }}
          >
            <button
              onClick={() => setFullscreenMode(false)}
              style={{
                background: "rgba(255,255,255,0.2)",
                color: "white",
                padding: "12px 20px",
                borderRadius: "25px",
                border: "1px solid rgba(255,255,255,0.3)",
                fontSize: "14px",
                fontWeight: "600",
                backdropFilter: "blur(10px)"
              }}
            >
              Exit Fullscreen
            </button>
            <button
              onClick={handleStop}
              style={{
                background: "rgba(229, 84, 43, 0.9)",
                color: "white",
                padding: "12px 20px",
                borderRadius: "25px",
                border: "none",
                fontSize: "14px",
                fontWeight: "600"
              }}
            >
              Stop Navigation
            </button>
            <button
              onClick={() => setVoiceEnabled((prev) => !prev)}
              style={{
                background: voiceEnabled ? "rgba(47, 124, 95, 0.9)" : "rgba(255,255,255,0.2)",
                color: "white",
                padding: "12px 20px",
                borderRadius: "25px",
                border: voiceEnabled ? "none" : "1px solid rgba(255,255,255,0.3)",
                fontSize: "14px",
                fontWeight: "600"
              }}
            >
              🔊 {voiceEnabled ? "On" : "Off"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}
      >
        <div className="card">
          <div className="text-sm font-semibold">Navigation map</div>
          <p className="text-sm text-gray-700">
            Tap the map to set a destination or search for a place. Route lines update as you move.
          </p>
          <div className="mt-3">
            <label className="text-xs text-gray-600">
              Destination search
              <input
                value={destinationQuery}
                onChange={(event) => setDestinationQuery(event.target.value)}
                style={{ width: "100%", marginTop: "4px", padding: "6px", borderRadius: "8px" }}
                placeholder="Downtown crosswalk"
              />
            </label>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button
                className="button"
                style={{
                  background: "var(--color-slate)",
                  color: "white",
                  padding: "8px 14px",
                  borderRadius: "10px"
                }}
                onClick={handleSearch}
              >
                Search
              </button>
              <button
                className="button"
                style={{
                  background: "var(--color-moss)",
                  color: "white",
                  padding: "8px 14px",
                  borderRadius: "10px"
                }}
                onClick={() => {
                  if (fusedFix) {
                    setDestination({
                      lat: fusedFix.lat,
                      lon: fusedFix.lon,
                      label: "Current location"
                    });
                  }
                }}
                disabled={!fusedFix}
              >
                Use current
              </button>
            </div>
            {searchError && <p className="text-xs text-red-600">{searchError}</p>}
            {searchResults.length > 1 && (
              <div className="mt-2">
                {searchResults.map((result) => (
                  <button
                    key={`${result.lat}-${result.lon}`}
                    className="button"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      marginTop: "6px",
                      padding: "8px",
                      borderRadius: "10px",
                      background: "rgba(255,255,255,0.8)",
                      border: "1px solid rgba(0,0,0,0.1)"
                    }}
                    onClick={() => setDestination(result)}
                  >
                    {result.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3">
            <div className="map-surface" ref={mapContainerRef} />
            {mapStatus === "loading" && <p className="text-xs text-gray-500">Loading map...</p>}
            {mapStatus === "error" && <p className="text-xs text-red-600">Map failed to load.</p>}
          </div>
        </div>
        <div className="card">
          <div className="text-sm font-semibold">Camera navigation</div>
          <div className="relative w-full mt-3">
            <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </div>
          {cameraError && <p className="text-xs text-red-600">{cameraError}</p>}
          <p className="text-sm text-gray-700 mt-3">{instruction}</p>
          {llmMessage && <p className="text-sm text-gray-700">{llmMessage}</p>}
          {llmError && <p className="text-xs text-red-600">{llmError}</p>}
          <div className="mt-2" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              className="button"
              style={{
                background: sessionActive ? "var(--color-ember)" : "var(--color-moss)",
                color: "white",
                padding: "8px 14px",
                borderRadius: "10px"
              }}
              onClick={sessionActive ? handleStop : handleStart}
            >
              {sessionActive ? "Stop navigation" : "Start navigation"}
            </button>
            <button
              className="button"
              style={{
                background: "var(--color-slate)",
                color: "white",
                padding: "8px 14px",
                borderRadius: "10px"
              }}
              onClick={() => setFollowUser((prev) => !prev)}
            >
              {followUser ? "Stop follow" : "Follow me"}
            </button>
            <button
              className="button"
              style={{
                background: voiceEnabled ? "var(--color-moss)" : "rgba(30, 31, 36, 0.4)",
                color: "white",
                padding: "8px 14px",
                borderRadius: "10px"
              }}
              onClick={() => setVoiceEnabled((prev) => !prev)}
            >
              🔊 {voiceEnabled ? "On" : "Off"}
            </button>
            <button
              className="button"
              style={{
                background: "var(--color-slate)",
                color: "white",
                padding: "8px 14px",
                borderRadius: "10px"
              }}
              onClick={() => {
                voiceManager.init();
                voiceManager.speak("Voice test successful. Navigation is ready.", "high");
              }}
            >
              Test Voice
            </button>
            <button
              className="button"
              style={{
                background: llmEnabled ? "var(--color-slate)" : "rgba(30, 31, 36, 0.4)",
                color: "white",
                padding: "8px 14px",
                borderRadius: "10px"
              }}
              onClick={() => setLlmEnabled((prev) => !prev)}
            >
              LLM {llmEnabled ? "on" : "off"}
            </button>
            <button
              className="button"
              style={{
                background: detectionEnabled ? "var(--color-slate)" : "rgba(30, 31, 36, 0.4)",
                color: "white",
                padding: "8px 14px",
                borderRadius: "10px"
              }}
              onClick={() => setDetectionEnabled((prev) => !prev)}
              title="Object detection uses ~8MB of data and may slow down the page"
            >
              Detect {detectionEnabled ? "on" : "off"}
            </button>
            {sessionActive && destination && (
              <button
                className="button"
                style={{
                  background: "var(--color-moss)",
                  color: "white",
                  padding: "8px 14px",
                  borderRadius: "10px"
                }}
                onClick={() => setFullscreenMode(true)}
              >
                ⛶ Fullscreen
              </button>
            )}
          </div>
        </div>
      </div>
      <details className="debug-section">
        <summary>Debug metrics</summary>
        <div className="debug-content">
          <span>
            GPS:{" "}
            {fusedFix
              ? `${fusedFix.lat.toFixed(6)}, ${fusedFix.lon.toFixed(6)} | ±${fusedFix.accuracy.toFixed(0)}m`
              : (gpsError ?? "Waiting for GPS")}
          </span>
          <span>
            Heading:{" "}
            {heading === null ? (orientationError ?? "Waiting") : `${heading.toFixed(0)}deg`}
          </span>
          <span>
            Destination:{" "}
            {destination
              ? `${destination.label} (${destination.lat.toFixed(4)}, ${destination.lon.toFixed(4)})`
              : "--"}
          </span>
          <span>
            Route:{" "}
            {routeStatus === "ready" && routeData
              ? `${formatMeters(routeData.distance)} | ${(routeData.duration / 60).toFixed(1)} min`
              : (routeError ?? routeStatus)}
          </span>
          <span>
            OpenCV:{" "}
            {!detectionEnabled
              ? "disabled"
              : cvStatus === "ready"
                ? "ready"
                : (cvError ?? cvStatus)}
          </span>
          <span>
            Detections:{" "}
            {detections.length > 0
              ? Object.entries(detectionCounts)
                  .map(([label, count]) => `${label} ${count}`)
                  .join(" | ")
              : "none"}
          </span>
        </div>
      </details>
      <p className="text-xs text-gray-500">
        Navigation uses GPS plus compass heading, with OpenCV-powered object detection and OpenAI
        guidance summaries.
      </p>
    </div>
  );
}