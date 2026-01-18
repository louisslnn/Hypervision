import { SecureWatch } from "@hypervision/modules";
import Link from "next/link";

export default function SecurityPage() {
  // Get OpenAI API key from environment variable (server-side)
  const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  const signalServerUrl = process.env.NEXT_PUBLIC_SECUREWATCH_SIGNAL_URL;

  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Security Domain</span>
          <h1 className="page-title">SecureWatch</h1>
          <p className="page-lede">
            Real-time computer vision for security monitoring. Track individuals, detect motion, and
            maintain situational awareness with live camera feeds and persistent annotations.
          </p>
          <div className="hero-actions">
            <span className="status-pill status-live">Live</span>
            <span className="status-pill status-planning">CV-powered</span>
          </div>
        </div>
        <div className="page-actions">
          <Link href="/" className="button hero-cta ghost">
            ← Back to domains
          </Link>
        </div>
      </section>

      <section className="card">
        <SecureWatch openaiApiKey={openaiApiKey} signalServerUrl={signalServerUrl} />
      </section>

      <section className="grid detail-grid">
        <div className="card">
          <h2 className="card-title">Monitoring features</h2>
          <ul className="list text-sm text-gray-700">
            <li>Real-time person and object tracking</li>
            <li>Click-to-lock multi-subject tracking</li>
            <li>Motion detection with alerting</li>
            <li>Zone monitoring overlays</li>
            <li>Precision and performance profiles</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">CV capabilities</h2>
          <ul className="list text-sm text-gray-700">
            <li>Adaptive template matching</li>
            <li>Velocity estimation</li>
            <li>Confidence scoring</li>
            <li>Trajectory analysis</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">How to use</h2>
          <p className="text-sm text-gray-700">
            Choose a video source (camera, demo clip, upload, or WebRTC). Start monitoring, then
            click on subjects to track. Adjust the tracking profile as needed for precision versus
            performance.
          </p>
        </div>
      </section>
    </main>
  );
}
