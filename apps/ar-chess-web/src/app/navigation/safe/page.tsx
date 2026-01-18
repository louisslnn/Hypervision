"use client";

import { useEffect, useRef, useState } from "react";

// Minimal safe navigation page to debug crashes

export default function SafeNavigationPage() {
  const [errors, setErrors] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [gpsStatus, setGpsStatus] = useState("idle");
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [compassStatus, setCompassStatus] = useState("idle");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const log = (msg: string) => {
    console.info(msg);
    setLogs((prev) => [...prev, `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  };

  const logError = (msg: string, err?: unknown) => {
    const errMsg = err instanceof Error ? err.message : String(err || "");
    const full = errMsg ? `${msg}: ${errMsg}` : msg;
    console.error(full);
    setErrors((prev) => [...prev, full]);
  };

  // Global error handler
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      logError(`Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`);
    };
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      logError(`Unhandled rejection`, event.reason);
    };
    window.addEventListener("error", handler);
    window.addEventListener("unhandledrejection", rejectionHandler);
    return () => {
      window.removeEventListener("error", handler);
      window.removeEventListener("unhandledrejection", rejectionHandler);
    };
  }, []);

  // GPS Effect
  useEffect(() => {
    if (!sessionActive) {
      setGpsStatus("idle");
      return;
    }

    log("Starting GPS...");
    setGpsStatus("requesting");

    try {
      if (!navigator.geolocation) {
        logError("Geolocation not supported");
        setGpsStatus("error");
        return;
      }

      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          log(`GPS fix: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
          setGpsStatus("active");
        },
        (err) => {
          logError("GPS error", err);
          setGpsStatus("error");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );

      return () => {
        log("Stopping GPS watch");
        navigator.geolocation.clearWatch(watchId);
      };
    } catch (err) {
      logError("GPS effect crashed", err);
      setGpsStatus("error");
      return;
    }
  }, [sessionActive]);

  // Camera Effect
  useEffect(() => {
    if (!sessionActive) {
      setCameraStatus("idle");
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    log("Starting camera...");
    setCameraStatus("requesting");

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("getUserMedia not supported");
        }

        log("Calling getUserMedia...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false
        });

        log(`Got stream with ${stream.getTracks().length} tracks`);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          log("Assigned stream to video element");

          try {
            await videoRef.current.play();
            log("Video playing");
            setCameraStatus("active");
          } catch (playErr) {
            logError("Video play failed", playErr);
            setCameraStatus("error");
          }
        }
      } catch (err) {
        logError("Camera error", err);
        setCameraStatus("error");
      }
    };

    startCamera();

    return () => {
      log("Cleaning up camera");
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [sessionActive]);

  // Compass Effect
  useEffect(() => {
    if (!sessionActive) {
      setCompassStatus("idle");
      return;
    }

    log("Starting compass...");
    setCompassStatus("requesting");

    try {
      if (typeof DeviceOrientationEvent === "undefined") {
        log("DeviceOrientationEvent not defined");
        setCompassStatus("unavailable");
        return;
      }

      const handler = (event: DeviceOrientationEvent) => {
        const heading =
          (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
            .webkitCompassHeading ?? event.alpha;
        if (typeof heading === "number") {
          setCompassStatus(`active: ${heading.toFixed(0)}°`);
        }
      };

      // Check for iOS permission requirement
      const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (DOE.requestPermission) {
        log("iOS detected, requesting permission...");
        DOE.requestPermission()
          .then((result: string) => {
            if (result === "granted") {
              log("Compass permission granted");
              window.addEventListener("deviceorientation", handler);
            } else {
              log("Compass permission denied");
              setCompassStatus("denied");
            }
          })
          .catch((err: Error) => {
            log(`Compass permission error: ${err.message}`);
            setCompassStatus("error");
          });
      } else {
        log("Adding orientation listener (non-iOS)");
        window.addEventListener("deviceorientation", handler);
        setCompassStatus("listening");
      }

      return () => {
        window.removeEventListener("deviceorientation", handler);
      };
    } catch (err) {
      logError("Compass effect crashed", err);
      setCompassStatus("error");
      return;
    }
  }, [sessionActive]);

  const handleStart = () => {
    log("=== START CLICKED ===");
    setErrors([]);
    try {
      setSessionActive(true);
      log("sessionActive set to true");
    } catch (err) {
      logError("handleStart crashed", err);
    }
  };

  const handleStop = () => {
    log("=== STOP CLICKED ===");
    setSessionActive(false);
  };

  return (
    <main style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "16px" }}>
        🔧 Safe Navigation Debug
      </h1>

      <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
        <button
          onClick={sessionActive ? handleStop : handleStart}
          style={{
            background: sessionActive ? "#ef4444" : "#22c55e",
            color: "white",
            padding: "12px 24px",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            fontWeight: "600"
          }}
        >
          {sessionActive ? "Stop" : "Start Navigation"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Status Panel */}
        <div style={{ background: "#f5f5f5", padding: "16px", borderRadius: "8px" }}>
          <h2 style={{ fontWeight: "600", marginBottom: "12px" }}>Status</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <StatusRow label="Session" value={sessionActive ? "active" : "inactive"} />
            <StatusRow label="GPS" value={gpsStatus} />
            <StatusRow label="Camera" value={cameraStatus} />
            <StatusRow label="Compass" value={compassStatus} />
          </div>
        </div>

        {/* Camera Preview */}
        <div>
          <h2 style={{ fontWeight: "600", marginBottom: "12px" }}>Camera</h2>
          <video
            ref={videoRef}
            style={{
              width: "100%",
              borderRadius: "8px",
              background: "#000",
              minHeight: "200px"
            }}
            playsInline
            muted
          />
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div
          style={{
            marginTop: "24px",
            background: "#fef2f2",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #fecaca"
          }}
        >
          <h2 style={{ fontWeight: "600", color: "#dc2626", marginBottom: "8px" }}>❌ Errors</h2>
          <pre style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap", color: "#991b1b" }}>
            {errors.join("\n")}
          </pre>
        </div>
      )}

      {/* Logs */}
      <div
        style={{
          marginTop: "24px",
          background: "#f0fdf4",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid #bbf7d0"
        }}
      >
        <h2 style={{ fontWeight: "600", color: "#166534", marginBottom: "8px" }}>📋 Logs</h2>
        <pre
          style={{
            fontSize: "0.8rem",
            whiteSpace: "pre-wrap",
            color: "#166534",
            maxHeight: "300px",
            overflow: "auto"
          }}
        >
          {logs.length > 0 ? logs.join("\n") : "Click Start to see logs..."}
        </pre>
      </div>

      <div style={{ marginTop: "16px" }}>
        <a href="/navigation" style={{ color: "#2f7c5f" }}>
          ← Back to Navigation
        </a>
        {" | "}
        <a href="/navigation/test" style={{ color: "#2f7c5f" }}>
          Run Full Tests
        </a>
      </div>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  const isActive = value.includes("active");
  const isError = value.includes("error") || value.includes("denied");

  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span>{label}:</span>
      <span
        style={{
          color: isActive ? "#22c55e" : isError ? "#ef4444" : "#666",
          fontWeight: isActive || isError ? "600" : "normal"
        }}
      >
        {value}
      </span>
    </div>
  );
}