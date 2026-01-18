import Link from "next/link";

import { ChessExperience } from "@/features/chess/ChessExperience";

export default function PracticePage() {
  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Entertainment Domain</span>
          <h1 className="page-title">AR Gaming</h1>
          <p className="page-lede">
            Computer vision for interactive entertainment. Hand tracking, real-time overlays, and
            immersive AR experiences powered by the HyperVision CV core.
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
      <section>
        <ChessExperience />
      </section>

      <section className="grid detail-grid">
        <div className="card">
          <h2 className="card-title">Entertainment features</h2>
          <ul className="list text-sm text-gray-700">
            <li>Hand gesture recognition for game control</li>
            <li>Real-time AR overlays on physical objects</li>
            <li>Interactive coaching and feedback</li>
            <li>Multi-player gesture coordination</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">CV capabilities</h2>
          <ul className="list text-sm text-gray-700">
            <li>21-point hand landmark detection</li>
            <li>Gesture classification and tracking</li>
            <li>Object recognition and board state</li>
            <li>Real-time pose estimation</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">Play now</h2>
          <p className="text-sm text-gray-700">
            Use the AR chess experience above to play with hand tracking. The system detects your
            moves and provides coaching feedback.
          </p>
        </div>
      </section>
    </main>
  );
}