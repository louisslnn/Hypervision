import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy reveal">
          <span className="eyebrow">HyperVision</span>
          <h1 className="hero-title">Computer vision made accessible.</h1>
          <p className="hero-lede">
            HyperVision turns cameras into real-time visual intelligence. Our local setup runs
            smoothly at ~30 FPS with OpenCV + YOLO.
          </p>
        </div>
        <div className="hero-panel reveal" style={{ animationDelay: "0.1s" }}>
          <div className="panel-card">
            <div className="panel-label">CV Pipeline</div>
            <ul className="panel-list">
              <li>
                <strong>Capture</strong> ingest video streams from any camera source
              </li>
              <li>
                <strong>Track</strong> follow objects with hybrid optical flow + visual DNA
              </li>
              <li>
                <strong>Annotate</strong> overlay insights, alerts, and guidance in real-time
              </li>
            </ul>
          </div>
          <div className="panel-card panel-dark">
            <div className="panel-label">Core stack</div>
            <p className="panel-text">
              OpenCV tracking and YOLO detection power all domains, tuned for reliable local
              performance at ~30 FPS.
            </p>
            <div className="panel-pill-group">
              <span className="pill-tag">OpenCV</span>
              <span className="pill-tag">YOLO</span>
              <span className="pill-tag">Local setup</span>
              <span className="pill-tag">30 FPS</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mission">
        <div className="section-header">
          <h2 className="section-title">The platform</h2>
          <p className="section-lede">
            One computer vision engine, deployed across multiple domains. Each application shares
            the same tracking core but delivers domain-specific intelligence.
          </p>
        </div>
        <div className="grid mission-grid">
          <div className="card mission-card reveal" style={{ animationDelay: "0.05s" }}>
            <h3 className="card-title">Universal tracking</h3>
            <p className="text-sm text-gray-700">
              Our OpenCV pipeline blends optical flow and template matching for robust tracking.
            </p>
            <ul className="list text-sm text-gray-700">
              <li>Optical flow tracking at video rate</li>
              <li>Template refresh for appearance drift</li>
              <li>Motion smoothing for stable tracks</li>
            </ul>
          </div>
          <div className="card mission-card reveal" style={{ animationDelay: "0.1s" }}>
            <h3 className="card-title">Domain adaptable</h3>
            <p className="text-sm text-gray-700">
              The same core adapts to healthcare, security, entertainment, and utilities.
            </p>
            <ul className="list text-sm text-gray-700">
              <li>Medical annotation overlays</li>
              <li>Real-time security monitoring</li>
              <li>Interactive entertainment experiences</li>
            </ul>
          </div>
          <div className="card mission-card reveal" style={{ animationDelay: "0.15s" }}>
            <h3 className="card-title">AI-enhanced</h3>
            <p className="text-sm text-gray-700">
              YOLO-powered detection adds fast, local object recognition.
            </p>
            <ul className="list text-sm text-gray-700">
              <li>Real-time object detection</li>
              <li>Class labels for tracked subjects</li>
              <li>Local inference pipeline</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="tracks">
        <div className="section-header">
          <h2 className="section-title">Domains</h2>
        </div>
        <div className="grid path-grid">
          <Link
            href="/medicine"
            className="path-card medicine reveal"
            style={{ animationDelay: "0.05s" }}
          >
            <div className="path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <h3 className="path-title">MedSync Vision</h3>
          </Link>
          <Link
            href="/security"
            className="path-card security reveal"
            style={{ animationDelay: "0.1s" }}
          >
            <div className="path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l7 4v5c0 5-3.5 9.5-7 11-3.5-1.5-7-6-7-11V7l7-4z" />
              </svg>
            </div>
            <h3 className="path-title">SecureWatch</h3>
          </Link>
          <Link
            href="/practice"
            className="path-card entertainment reveal"
            style={{ animationDelay: "0.15s" }}
          >
            <div className="path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3v4M12 17v4M4 12h4M16 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8" />
              </svg>
            </div>
            <h3 className="path-title">AR Gaming</h3>
          </Link>
          <Link
            href="/sports"
            className="path-card sports reveal"
            style={{ animationDelay: "0.2s" }}
          >
            <div className="path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M22 12h-4l-3 9-4-18-3 9H2" />
              </svg>
            </div>
            <h3 className="path-title">Motion Coach</h3>
          </Link>
          <Link
            href="/navigation"
            className="path-card navigation reveal"
            style={{ animationDelay: "0.25s" }}
          >
            <div className="path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <h3 className="path-title">Visual Navigator</h3>
          </Link>
          <Link
            href="/follow"
            className="path-card follow reveal"
            style={{ animationDelay: "0.3s" }}
          >
            <div className="path-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            </div>
            <h3 className="path-title">HoloRay Follow</h3>
          </Link>
        </div>
      </section>
    </main>
  );
}
