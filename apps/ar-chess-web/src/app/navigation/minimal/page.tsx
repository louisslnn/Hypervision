"use client";

import { useState } from "react";

// Absolutely minimal test - no external libraries, no effects
export default function MinimalNavigationPage() {
  const [count, setCount] = useState(0);
  const [sessionActive, setSessionActive] = useState(false);

  return (
    <main style={{ padding: "24px" }}>
      <h1>Minimal Navigation Test</h1>
      <p>If this page works, the crash is in a library or effect.</p>
      <p>If this page crashes too, React itself has a problem.</p>

      <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
        <button
          onClick={() => setCount((c) => c + 1)}
          style={{
            padding: "12px 24px",
            background: "#3b82f6",
            color: "white",
            borderRadius: "8px",
            border: "none"
          }}
        >
          Count: {count}
        </button>

        <button
          onClick={() => {
            console.info("Setting sessionActive to", !sessionActive);
            setSessionActive((s) => !s);
          }}
          style={{
            padding: "12px 24px",
            background: sessionActive ? "#ef4444" : "#22c55e",
            color: "white",
            borderRadius: "8px",
            border: "none"
          }}
        >
          {sessionActive ? "Stop" : "Start"} Session
        </button>
      </div>

      <div
        style={{ marginTop: "24px", padding: "16px", background: "#f5f5f5", borderRadius: "8px" }}
      >
        <p>
          <strong>Session:</strong> {sessionActive ? "Active" : "Inactive"}
        </p>
        <p>
          <strong>Count:</strong> {count}
        </p>
      </div>

      <div style={{ marginTop: "24px" }}>
        <a href="/navigation/safe">Try Safe Version</a>
        {" | "}
        <a href="/navigation">Back to Full Navigation</a>
      </div>
    </main>
  );
}

