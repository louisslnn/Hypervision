"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * HoloRay Detection Client
 * ========================
 * WebSocket client for real-time object detection via the HoloRay Detection Server.
 *
 * This module provides:
 * - WebSocket connection management with auto-reconnect
 * - Frame capture and transmission
 * - Detection result handling
 * - Hybrid tracking (interpolation between server detections)
 */

// ============================================================================
// Types
// ============================================================================

export type DetectionMode = "general" | "surgical" | "security";

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  class: string;
  label: string;
  confidence: number;
  bbox: BoundingBox;
  // Tracking metadata (added by client)
  velocity?: { x: number; y: number };
  lastSeen?: number;
  trackId?: string;
}

export interface DetectionResult {
  type: "detections";
  detections: Detection[];
  timestamp: number;
  serverTimestamp: number;
  inferenceMs: number;
  frameId: string;
  frameSize: { width: number; height: number };
}

export interface DetectionClientConfig {
  serverUrl: string;
  mode: DetectionMode;
  targetFps?: number;
  confidenceThreshold?: number;
  onDetections?: (result: DetectionResult) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxInFlight?: number;
  maxPendingMs?: number;
  maxResultAgeMs?: number;
}

export interface ServerStats {
  framesProcessed: number;
  avgInferenceMs: number;
  estimatedFps: number;
}

// ============================================================================
// Detection Tracker (for interpolation between server updates)
// ============================================================================

interface TrackedDetection extends Detection {
  trackId: string;
  velocity: { x: number; y: number };
  lastUpdate: number;
  interpolatedBox: BoundingBox;
  matchConfidence: number;
}

class DetectionTracker {
  private tracked: Map<string, TrackedDetection> = new Map();
  private nextTrackId = 1;
  private readonly maxAge = 3000; // ms before removing stale tracks
  private readonly maxPredictionMs = 1500;
  private readonly iouThreshold = 0.3;
  private readonly velocitySmoothingFactor = 0.4;

  /**
   * Update tracked detections with new server results
   */
  update(detections: Detection[], timestamp: number): TrackedDetection[] {
    const now = timestamp || Date.now();

    // Match new detections to existing tracks using IoU
    const matched = new Set<string>();
    const newTracked: TrackedDetection[] = [];

    for (const det of detections) {
      let bestMatch: TrackedDetection | null = null;
      let bestIoU = this.iouThreshold;

      // Find best matching existing track
      for (const [trackId, track] of this.tracked) {
        if (matched.has(trackId)) continue;

        const iou = this.computeIoU(det.bbox, track.interpolatedBox);
        if (iou > bestIoU) {
          bestIoU = iou;
          bestMatch = track;
        }
      }

      if (bestMatch) {
        // Update existing track
        const dt = Math.max(1, now - bestMatch.lastUpdate) / 1000;
        const dx = det.bbox.centerX - bestMatch.interpolatedBox.centerX;
        const dy = det.bbox.centerY - bestMatch.interpolatedBox.centerY;

        const newVelocity = {
          x:
            bestMatch.velocity.x * this.velocitySmoothingFactor +
            (dx / dt) * (1 - this.velocitySmoothingFactor),
          y:
            bestMatch.velocity.y * this.velocitySmoothingFactor +
            (dy / dt) * (1 - this.velocitySmoothingFactor)
        };

        const updated: TrackedDetection = {
          ...det,
          trackId: bestMatch.trackId,
          velocity: newVelocity,
          lastUpdate: now,
          interpolatedBox: { ...det.bbox },
          matchConfidence: bestIoU,
          lastSeen: now
        };

        this.tracked.set(bestMatch.trackId, updated);
        matched.add(bestMatch.trackId);
        newTracked.push(updated);
      } else {
        // Create new track
        const trackId = `track_${this.nextTrackId++}`;
        const newTrack: TrackedDetection = {
          ...det,
          trackId,
          velocity: { x: 0, y: 0 },
          lastUpdate: now,
          interpolatedBox: { ...det.bbox },
          matchConfidence: det.confidence,
          lastSeen: now
        };

        this.tracked.set(trackId, newTrack);
        newTracked.push(newTrack);
      }
    }

    // Remove stale tracks
    for (const [trackId, track] of this.tracked) {
      if (now - track.lastUpdate > this.maxAge) {
        this.tracked.delete(trackId);
      }
    }

    return newTracked;
  }

  /**
   * Get interpolated positions between server updates
   */
  interpolate(timestamp: number): TrackedDetection[] {
    const now = timestamp || Date.now();
    const result: TrackedDetection[] = [];

    for (const [, track] of this.tracked) {
      const dtMs = now - track.lastUpdate;
      if (dtMs > this.maxAge) continue;
      const dt = Math.max(0, Math.min(dtMs, this.maxPredictionMs)) / 1000;

      // Predict position based on velocity
      const predictedCenterX = track.interpolatedBox.centerX + track.velocity.x * dt;
      const predictedCenterY = track.interpolatedBox.centerY + track.velocity.y * dt;

      // Clamp to valid range
      const clampedCenterX = Math.max(0, Math.min(1, predictedCenterX));
      const clampedCenterY = Math.max(0, Math.min(1, predictedCenterY));

      const halfW = track.interpolatedBox.width / 2;
      const halfH = track.interpolatedBox.height / 2;

      const interpolatedBox: BoundingBox = {
        centerX: clampedCenterX,
        centerY: clampedCenterY,
        x1: Math.max(0, clampedCenterX - halfW),
        y1: Math.max(0, clampedCenterY - halfH),
        x2: Math.min(1, clampedCenterX + halfW),
        y2: Math.min(1, clampedCenterY + halfH),
        width: track.interpolatedBox.width,
        height: track.interpolatedBox.height
      };

      result.push({
        ...track,
        interpolatedBox
      });
    }

    return result;
  }

  /**
   * Compute Intersection over Union between two boxes
   */
  private computeIoU(box1: BoundingBox, box2: BoundingBox): number {
    const x1 = Math.max(box1.x1, box2.x1);
    const y1 = Math.max(box1.y1, box2.y1);
    const x2 = Math.min(box1.x2, box2.x2);
    const y2 = Math.min(box1.y2, box2.y2);

    if (x2 <= x1 || y2 <= y1) return 0;

    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Clear all tracks
   */
  clear(): void {
    this.tracked.clear();
  }

  /**
   * Get current track count
   */
  getTrackCount(): number {
    return this.tracked.size;
  }
}

// ============================================================================
// Detection Client
// ============================================================================

export class DetectionClient {
  private config: Required<DetectionClientConfig>;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private frameCount = 0;
  private lastFrameTime = 0;
  private inflight = 0;
  private lastSendAt = 0;
  private tracker: DetectionTracker;
  private latestDetections: Detection[] = [];

  // Performance metrics
  private roundTripTimes: number[] = [];
  private serverInferenceTimes: number[] = [];

  constructor(config: DetectionClientConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      mode: config.mode,
      targetFps: config.targetFps ?? 15,
      confidenceThreshold: config.confidenceThreshold ?? 0.35,
      onDetections: config.onDetections ?? (() => {}),
      onConnect: config.onConnect ?? (() => {}),
      onDisconnect: config.onDisconnect ?? (() => {}),
      onError: config.onError ?? (() => {}),
      autoReconnect: config.autoReconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 3000,
      maxInFlight: config.maxInFlight ?? 1,
      maxPendingMs: config.maxPendingMs ?? 1500,
      maxResultAgeMs: config.maxResultAgeMs ?? 2000
    };

    this.tracker = new DetectionTracker();
  }

  /**
   * Connect to the detection server
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.info("[DetectionClient] Connected to server");
        this.config.onConnect();

        // Send initial configuration
        this.sendConfig();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error("[DetectionClient] Failed to parse message:", e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.info("[DetectionClient] Disconnected from server");
        this.config.onDisconnect();

        if (this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error("[DetectionClient] WebSocket error:", error);
        this.config.onError(new Error("WebSocket connection error"));
      };
    } catch (e) {
      console.error("[DetectionClient] Failed to connect:", e);
      this.config.onError(e as Error);

      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.tracker.clear();
    this.inflight = 0;
    this.lastSendAt = 0;
  }

  /**
   * Send a video frame for detection
   */
sendFrame(canvas: HTMLCanvasElement): void {
  if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const now = Date.now();
  const minInterval = 1000 / this.config.targetFps;

  if (now - this.lastFrameTime < minInterval) {
    return;
  }

  if (this.inflight >= this.config.maxInFlight) {
    if (now - this.lastSendAt < this.config.maxPendingMs) {
      return;
    }
    this.inflight = 0;
  }

  this.lastFrameTime = now;
  this.lastSendAt = now;
  this.frameCount += 1;
  const frameId = `frame_${this.frameCount}`;
  this.inflight += 1;

  try {
    // Convert canvas to base64
    const imageData = canvas.toDataURL("image/jpeg", 0.8);

    this.ws.send(
      JSON.stringify({
        type: "frame",
        data: imageData,
        mode: this.config.mode,
        timestamp: now,
        frame_id: frameId
      })
    );
  } catch (e) {
    this.inflight = Math.max(0, this.inflight - 1);
    console.error("[DetectionClient] Failed to send frame:", e);
  }
}


  /**
   * Send raw image data
   */
sendImageData(imageData: string, timestamp?: number): void {
  if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const now = timestamp ?? Date.now();

  if (this.inflight >= this.config.maxInFlight) {
    if (now - this.lastSendAt < this.config.maxPendingMs) {
      return;
    }
    this.inflight = 0;
  }

  this.lastSendAt = now;
  this.frameCount += 1;
  const frameId = `frame_${this.frameCount}`;
  this.inflight += 1;

  try {
    this.ws.send(
      JSON.stringify({
        type: "frame",
        data: imageData,
        mode: this.config.mode,
        timestamp: now,
        frame_id: frameId
      })
    );
  } catch (e) {
    this.inflight = Math.max(0, this.inflight - 1);
    console.error("[DetectionClient] Failed to send frame:", e);
  }
}


  /**
   * Get interpolated detections (between server updates)
   */
  getInterpolatedDetections(): Detection[] {
    return this.tracker.interpolate(Date.now());
  }

  /**
   * Get latest raw detections from server
   */
  getLatestDetections(): Detection[] {
    return this.latestDetections;
  }

  /**
   * Set detection mode
   */
  setMode(mode: DetectionMode): void {
    this.config.mode = mode;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<{ targetFps: number; confidenceThreshold: number }>): void {
    if (updates.targetFps !== undefined) {
      this.config.targetFps = updates.targetFps;
    }
    if (updates.confidenceThreshold !== undefined) {
      this.config.confidenceThreshold = updates.confidenceThreshold;
    }

    this.sendConfig();
  }

  /**
   * Request server statistics
   */
  requestStats(): void {
    if (!this.isConnected || !this.ws) return;

    this.ws.send(JSON.stringify({ type: "stats" }));
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; frameCount: number; trackCount: number } {
    return {
      connected: this.isConnected,
      frameCount: this.frameCount,
      trackCount: this.tracker.getTrackCount()
    };
  }

  /**
   * Get performance metrics
   */
  getMetrics(): { avgRoundTrip: number; avgInference: number; clientFps: number } {
    const avgRoundTrip =
      this.roundTripTimes.length > 0
        ? this.roundTripTimes.reduce((a, b) => a + b, 0) / this.roundTripTimes.length
        : 0;

    const avgInference =
      this.serverInferenceTimes.length > 0
        ? this.serverInferenceTimes.reduce((a, b) => a + b, 0) / this.serverInferenceTimes.length
        : 0;

    return {
      avgRoundTrip: Math.round(avgRoundTrip),
      avgInference: Math.round(avgInference),
      clientFps: this.config.targetFps
    };
  }

  /**
   * Clear tracking state
   */
  clearTracks(): void {
    this.tracker.clear();
    this.latestDetections = [];
  }

  // Private methods

  private handleMessage(data: Record<string, unknown>): void {
    const type = data.type as string;

    switch (type) {
      case "detections": {
        if (this.inflight > 0) {
          this.inflight -= 1;
        }
        const result: DetectionResult = {
          type: "detections",
          detections: (data.detections as Detection[]) || [],
          timestamp: (data.timestamp as number) || 0,
          serverTimestamp: (data.server_timestamp as number) || Date.now(),
          inferenceMs: (data.inference_ms as number) || 0,
          frameId: (data.frame_id as string) || "",
          frameSize: (data.frame_size as { width: number; height: number }) || {
            width: 0,
            height: 0
          }
        };

        const receivedAt = Date.now();

        // Track round-trip time
        const roundTrip = receivedAt - result.timestamp;
        this.roundTripTimes.push(roundTrip);
        if (this.roundTripTimes.length > 30) {
          this.roundTripTimes.shift();
        }

        // Track server inference time
        this.serverInferenceTimes.push(result.inferenceMs);
        if (this.serverInferenceTimes.length > 30) {
          this.serverInferenceTimes.shift();
        }

        const resultAge = result.timestamp
          ? Math.max(0, receivedAt - result.timestamp)
          : 0;
        if (resultAge > this.config.maxResultAgeMs) {
          break;
        }

        // Update tracker with new detections
        this.latestDetections = result.detections;
        this.tracker.update(result.detections, receivedAt);

        // Notify callback
        this.config.onDetections(result);
        break;
      }

      case "stats": {
        console.info("[DetectionClient] Server stats:", data.stats);
        break;
      }

      case "config_ack": {
        console.info("[DetectionClient] Config acknowledged:", data.config);
        break;
      }

      case "pong": {
        // Connection alive
        break;
      }

      case "skipped": {
        // Frame was skipped due to rate limiting
        if (this.inflight > 0) {
          this.inflight -= 1;
        }
        break;
      }

      case "error": {
        console.error("[DetectionClient] Server error:", data.message);
        this.config.onError(new Error(data.message as string));
        break;
      }
    }
  }

  private sendConfig(): void {
    if (!this.isConnected || !this.ws) return;

    this.ws.send(
      JSON.stringify({
        type: "config",
        confidence: this.config.confidenceThreshold,
        target_fps: this.config.targetFps
      })
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    console.info(`[DetectionClient] Reconnecting in ${this.config.reconnectInterval}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.config.reconnectInterval);
  }
}

// ============================================================================
// React Hook
// ============================================================================

export interface UseDetectionClientOptions {
  serverUrl: string;
  mode: DetectionMode;
  enabled?: boolean;
  targetFps?: number;
  confidenceThreshold?: number;
}

export interface UseDetectionClientResult {
  client: DetectionClient | null;
  connected: boolean;
  detections: Detection[];
  interpolatedDetections: Detection[];
  metrics: { avgRoundTrip: number; avgInference: number; clientFps: number };
  sendFrame: (canvas: HTMLCanvasElement) => void;
  setMode: (mode: DetectionMode) => void;
  clearTracks: () => void;
}

export function useDetectionClient(options: UseDetectionClientOptions): UseDetectionClientResult {
  const { serverUrl, mode, enabled = true, targetFps = 15, confidenceThreshold = 0.35 } = options;

  const clientRef = useRef<DetectionClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [interpolatedDetections, setInterpolatedDetections] = useState<Detection[]>([]);
  const [metrics, setMetrics] = useState({
    avgRoundTrip: 0,
    avgInference: 0,
    clientFps: targetFps
  });

  // Create client
  useEffect(() => {
    if (!enabled || !serverUrl) {
      return;
    }

    const client = new DetectionClient({
      serverUrl,
      mode,
      targetFps,
      confidenceThreshold,
      onDetections: (result) => {
        setDetections(result.detections);
      },
      onConnect: () => {
        setConnected(true);
      },
      onDisconnect: () => {
        setConnected(false);
      },
      onError: (error) => {
        console.error("[useDetectionClient] Error:", error);
      }
    });

    client.connect();
    clientRef.current = client;

    // Update interpolated detections on animation frame
    let animationId: number;
    const updateInterpolated = () => {
      if (clientRef.current) {
        setInterpolatedDetections(clientRef.current.getInterpolatedDetections());
        setMetrics(clientRef.current.getMetrics());
      }
      animationId = requestAnimationFrame(updateInterpolated);
    };
    animationId = requestAnimationFrame(updateInterpolated);

    return () => {
      cancelAnimationFrame(animationId);
      client.disconnect();
      clientRef.current = null;
    };
  }, [serverUrl, enabled, mode, targetFps, confidenceThreshold]);

  // Update mode when it changes
  useEffect(() => {
    if (clientRef.current) {
      clientRef.current.setMode(mode);
    }
  }, [mode]);

  const sendFrame = useCallback((canvas: HTMLCanvasElement) => {
    if (clientRef.current) {
      clientRef.current.sendFrame(canvas);
    }
  }, []);

  const setMode = useCallback((newMode: DetectionMode) => {
    if (clientRef.current) {
      clientRef.current.setMode(newMode);
    }
  }, []);

  const clearTracks = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.clearTracks();
    }
    setDetections([]);
    setInterpolatedDetections([]);
  }, []);

  return {
    client: clientRef.current,
    connected,
    detections,
    interpolatedDetections,
    metrics,
    sendFrame,
    setMode,
    clearTracks
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert normalized bounding box to pixel coordinates
 */
export function bboxToPixels(
  bbox: BoundingBox,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; width: number; height: number; centerX: number; centerY: number } {
  return {
    x: bbox.x1 * canvasWidth,
    y: bbox.y1 * canvasHeight,
    width: bbox.width * canvasWidth,
    height: bbox.height * canvasHeight,
    centerX: bbox.centerX * canvasWidth,
    centerY: bbox.centerY * canvasHeight
  };
}

/**
 * Draw detection box on canvas
 */
export function drawDetection(
  ctx: CanvasRenderingContext2D,
  detection: Detection,
  canvasWidth: number,
  canvasHeight: number,
  options: {
    color?: string;
    lineWidth?: number;
    showLabel?: boolean;
    showConfidence?: boolean;
    fontSize?: number;
  } = {}
): void {
  const {
    color = "#10b981",
    lineWidth = 2,
    showLabel = true,
    showConfidence = true,
    fontSize = 12
  } = options;

  const bbox = detection.bbox;
  const x = bbox.x1 * canvasWidth;
  const y = bbox.y1 * canvasHeight;
  const w = bbox.width * canvasWidth;
  const h = bbox.height * canvasHeight;

  // Draw bounding box
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, w, h);

  // Draw label background and text
  if (showLabel || showConfidence) {
    const labelText = showConfidence
      ? `${detection.label} ${Math.round(detection.confidence * 100)}%`
      : detection.label;

    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    const textMetrics = ctx.measureText(labelText);
    const padding = 4;
    const labelHeight = fontSize + padding * 2;
    const labelWidth = textMetrics.width + padding * 2;

    // Label background
    ctx.fillStyle = color;
    ctx.fillRect(x, y - labelHeight, labelWidth, labelHeight);

    // Label text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(labelText, x + padding, y - padding);
  }
}

/**
 * Draw all detections on canvas
 */
export function drawDetections(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  canvasWidth: number,
  canvasHeight: number,
  options?: Parameters<typeof drawDetection>[4]
): void {
  const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  detections.forEach((detection, index) => {
    const colorForBox = options?.color
      ? options.color
      : (colors[index % colors.length] ?? "#10b981");
    const drawOptions: {
      color: string;
      lineWidth?: number;
      showLabel?: boolean;
      showConfidence?: boolean;
      fontSize?: number;
    } = {
      color: colorForBox
    };

    if (options?.lineWidth !== undefined) drawOptions.lineWidth = options.lineWidth;
    if (options?.showLabel !== undefined) drawOptions.showLabel = options.showLabel;
    if (options?.showConfidence !== undefined) drawOptions.showConfidence = options.showConfidence;
    if (options?.fontSize !== undefined) drawOptions.fontSize = options.fontSize;

    drawDetection(ctx, detection, canvasWidth, canvasHeight, drawOptions);
  });
}