"use client";

import { useEffect, useRef, useState } from "react";

type TestResult = {
  name: string;
  status: "pending" | "running" | "pass" | "fail";
  message?: string;
  error?: string;
};

export default function NavigationTestPage() {
  const [tests, setTests] = useState<TestResult[]>([
    { name: "Browser APIs Available", status: "pending" },
    { name: "Geolocation Permission", status: "pending" },
    { name: "Camera Permission", status: "pending" },
    { name: "Device Orientation", status: "pending" },
    { name: "OpenCV Script Load", status: "pending" },
    { name: "YOLO Model Fetch", status: "pending" },
    { name: "Geocode API", status: "pending" },
    { name: "Route API", status: "pending" },
    { name: "Guidance API", status: "pending" }
  ]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const updateTest = (name: string, update: Partial<TestResult>) => {
    setTests((prev) => prev.map((t) => (t.name === name ? { ...t, ...update } : t)));
  };

  const runAllTests = async () => {
    // Reset all tests
    setTests((prev) => prev.map((t) => ({ name: t.name, status: "pending" as const })));

    // Test 1: Browser APIs
    updateTest("Browser APIs Available", { status: "running" });
    try {
      const apis = {
        geolocation: !!navigator.geolocation,
        mediaDevices: !!navigator.mediaDevices,
        getUserMedia: !!navigator.mediaDevices?.getUserMedia,
        deviceOrientation: typeof DeviceOrientationEvent !== "undefined",
        speechSynthesis: typeof speechSynthesis !== "undefined",
        fetch: typeof fetch !== "undefined"
      };
      const missing = Object.entries(apis)
        .filter(([, v]) => !v)
        .map(([k]) => k);

      if (missing.length > 0) {
        updateTest("Browser APIs Available", {
          status: "fail",
          error: `Missing: ${missing.join(", ")}`
        });
      } else {
        updateTest("Browser APIs Available", {
          status: "pass",
          message: "All required APIs available"
        });
      }
    } catch (err) {
      updateTest("Browser APIs Available", {
        status: "fail",
        error: err instanceof Error ? err.message : String(err)
      });
    }

    // Test 2: Geolocation
    updateTest("Geolocation Permission", { status: "running" });
    try {
      if (!navigator.geolocation) {
        throw new Error("Geolocation not supported");
      }
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          enableHighAccuracy: false
        });
      });
      updateTest("Geolocation Permission", {
        status: "pass",
        message: `Lat: ${position.coords.latitude.toFixed(4)}, Lon: ${position.coords.longitude.toFixed(4)}`
      });
    } catch (err) {
      const error = err as GeolocationPositionError | Error;
      updateTest("Geolocation Permission", {
        status: "fail",
        error: "message" in error ? error.message : String(error)
      });
    }

    // Test 3: Camera
    updateTest("Camera Permission", { status: "running" });
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia not supported");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      updateTest("Camera Permission", {
        status: "pass",
        message: `Stream active: ${stream.active}, tracks: ${stream.getTracks().length}`
      });
    } catch (err) {
      updateTest("Camera Permission", {
        status: "fail",
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      });
    }

    // Test 4: Device Orientation
    updateTest("Device Orientation", { status: "running" });
    try {
      if (typeof DeviceOrientationEvent === "undefined") {
        throw new Error("DeviceOrientationEvent not supported");
      }

      // Check if permission API exists (iOS 13+)
      const DOE = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
      };

      if (DOE.requestPermission) {
        try {
          const result = await DOE.requestPermission();
          if (result !== "granted") {
            throw new Error("Permission denied");
          }
          updateTest("Device Orientation", {
            status: "pass",
            message: "Permission granted (iOS)"
          });
        } catch {
          // May fail if not from user gesture
          updateTest("Device Orientation", {
            status: "pass",
            message: "Available (needs user gesture on iOS)"
          });
        }
      } else {
        // No permission needed (Android/Desktop)
        updateTest("Device Orientation", {
          status: "pass",
          message: "Available (no permission needed)"
        });
      }
    } catch (err) {
      updateTest("Device Orientation", {
        status: "fail",
        error: err instanceof Error ? err.message : String(err)
      });
    }

    // Test 5: OpenCV Script
    updateTest("OpenCV Script Load", { status: "running" });
    try {
      const script = document.createElement("script");
      script.src = "https://docs.opencv.org/4.8.0/opencv.js";

      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Script failed to load"));
        document.head.appendChild(script);

        // Timeout after 15 seconds
        setTimeout(() => reject(new Error("Script load timeout")), 15000);
      });

      // Wait for OpenCV to initialize
      const cv = (window as Window & { cv?: unknown }).cv;
      if (cv) {
        updateTest("OpenCV Script Load", {
          status: "pass",
          message: "OpenCV loaded successfully"
        });
      } else {
        updateTest("OpenCV Script Load", {
          status: "pass",
          message: "Script loaded, waiting for init..."
        });
      }
    } catch (err) {
      updateTest("OpenCV Script Load", {
        status: "fail",
        error: err instanceof Error ? err.message : String(err)
      });
    }

    // Test 6: YOLO Model
    updateTest("YOLO Model Fetch", { status: "running" });
    try {
      const response = await fetch("/models/yolov5n.onnx", { method: "HEAD" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const contentLength = response.headers.get("content-length");
      updateTest("YOLO Model Fetch", {
        status: "pass",
        message: `Model exists, size: ${contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(1)}MB` : "unknown"}`
      });
    } catch (err) {
      updateTest("YOLO Model Fetch", {
        status: "fail",
        error: err instanceof Error ? err.message : String(err)
      });
    }

    // Test 7: Geocode API
    updateTest("Geocode API", { status: "running" });
    try {
      const response = await fetch("/api/navigation/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "New York" })
      });
      const data = await response.json();
      if (data.status === "ok" && data.results?.length > 0) {
        updateTest("Geocode API", {
          status: "pass",
          message: `Found ${data.results.length} results`
        });
      } else {
        throw new Error(data.error || "No results");
      }
    } catch (err) {
      updateTest("Geocode API", {
        status: "fail",
        error: err instanceof Error ? err.message : String(err)
      });
    }

    // Test 8: Route API
    updateTest("Route API", { status: "running" });
    try {
      const response = await fetch("/api/navigation/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { lat: 40.7484, lon: -73.9857 },
          end: { lat: 40.757, lon: -73.986 }
        })
      });
      const data = await response.json();
      if (data.status === "ok" && data.route) {
        updateTest("Route API", {
          status: "pass",
          message: `Route: ${(data.route.distance / 1000).toFixed(2)}km`
        });
      } else {
        throw new Error(data.error || "No route");
      }
    } catch (err) {
      updateTest("Route API", {
        status: "fail",
        error: err instanceof Error ? err.message : String(err)
      });
    }

    // Test 9: Guidance API (OpenAI)
    updateTest("Guidance API", { status: "running" });
    try {
      const response = await fetch("/api/navigation/guidance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: "Turn left",
          distanceMeters: 100,
          turnDegrees: -45,
          destinationLabel: "Test"
        })
      });
      const data = await response.json();
      if (data.status === "ok" && data.message) {
        updateTest("Guidance API", {
          status: "pass",
          message: `OpenAI: "${data.message.slice(0, 50)}..."`
        });
      } else if (data.status === "disabled") {
        updateTest("Guidance API", {
          status: "fail",
          error: "OPENAI_API_KEY not configured in .env.local"
        });
      } else {
        throw new Error(data.error || "No message");
      }
    } catch (err) {
      updateTest("Guidance API", {
        status: "fail",
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraStream]);

  const passCount = tests.filter((t) => t.status === "pass").length;
  const failCount = tests.filter((t) => t.status === "fail").length;

  return (
    <main style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "8px" }}>
        🧪 Navigation Diagnostics
      </h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>
        This page tests all the features needed for the navigation app to work.
      </p>

      <button
        onClick={runAllTests}
        style={{
          background: "#2f7c5f",
          color: "white",
          padding: "12px 24px",
          borderRadius: "8px",
          border: "none",
          cursor: "pointer",
          fontSize: "1rem",
          fontWeight: "600",
          marginBottom: "24px"
        }}
      >
        Run All Tests
      </button>

      {(passCount > 0 || failCount > 0) && (
        <div style={{ marginBottom: "16px", display: "flex", gap: "16px" }}>
          <span style={{ color: "#22c55e" }}>✅ {passCount} passed</span>
          <span style={{ color: "#ef4444" }}>❌ {failCount} failed</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {tests.map((test) => (
          <div
            key={test.name}
            style={{
              padding: "16px",
              borderRadius: "8px",
              background:
                test.status === "pass"
                  ? "rgba(34, 197, 94, 0.1)"
                  : test.status === "fail"
                    ? "rgba(239, 68, 68, 0.1)"
                    : test.status === "running"
                      ? "rgba(59, 130, 246, 0.1)"
                      : "rgba(0, 0, 0, 0.05)",
              border: `1px solid ${
                test.status === "pass"
                  ? "rgba(34, 197, 94, 0.3)"
                  : test.status === "fail"
                    ? "rgba(239, 68, 68, 0.3)"
                    : test.status === "running"
                      ? "rgba(59, 130, 246, 0.3)"
                      : "rgba(0, 0, 0, 0.1)"
              }`
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "1.2rem" }}>
                {test.status === "pass" && "✅"}
                {test.status === "fail" && "❌"}
                {test.status === "running" && "⏳"}
                {test.status === "pending" && "⬜"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "600" }}>{test.name}</div>
                {test.message && (
                  <div style={{ fontSize: "0.85rem", color: "#22c55e", marginTop: "4px" }}>
                    {test.message}
                  </div>
                )}
                {test.error && (
                  <div style={{ fontSize: "0.85rem", color: "#ef4444", marginTop: "4px" }}>
                    {test.error}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Camera Preview */}
      <div style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", marginBottom: "8px" }}>Camera Preview</h2>
        <video
          ref={videoRef}
          style={{
            width: "100%",
            maxWidth: "400px",
            borderRadius: "8px",
            background: "#000"
          }}
          playsInline
          muted
        />
      </div>

      <div
        style={{ marginTop: "24px", padding: "16px", background: "#f0f0f0", borderRadius: "8px" }}
      >
        <h3 style={{ fontWeight: "600", marginBottom: "8px" }}>Troubleshooting</h3>
        <ul style={{ fontSize: "0.9rem", lineHeight: "1.6", paddingLeft: "20px" }}>
          <li>
            <strong>Camera fails:</strong> Must use HTTPS (or localhost). Check browser permissions.
          </li>
          <li>
            <strong>Geolocation fails:</strong> Allow location access. On iOS, check Settings →
            Safari → Location.
          </li>
          <li>
            <strong>OpenCV fails:</strong> Try a different browser. Chrome/Firefox work best.
          </li>
          <li>
            <strong>Guidance API disabled:</strong> Add OPENAI_API_KEY to .env.local (without
            NEXT_PUBLIC_)
          </li>
          <li>
            <strong>YOLO Model fails:</strong> Ensure /public/models/yolov5n.onnx exists
          </li>
        </ul>
      </div>

      <div style={{ marginTop: "16px" }}>
        <a href="/navigation" style={{ color: "#2f7c5f", textDecoration: "underline" }}>
          ← Back to Navigation
        </a>
      </div>
    </main>
  );
}