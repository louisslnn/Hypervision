import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy reveal">
          <span className="eyebrow">HyperVision CV</span>
          <h1 className="hero-title">Computer vision for every domain.</h1>
          <p className="hero-lede">
            HyperVision is a modular computer vision platform that transforms cameras into
            intelligent assistants. From healthcare to security to entertainment, we deliver
            real-time visual understanding without the complexity.
          </p>
          <div className="hero-footnote">
            On-device processing. Privacy-first design. One core engine, infinite applications.
          </div>
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
            <div className="panel-label">Core engine</div>
            <p className="panel-text">
              HoloRay tracking powers all domains—same robust foundation, domain-specific overlays.
            </p>
            <div className="panel-pill-group">
              <span className="pill-tag">Real-time</span>
              <span className="pill-tag">Re-identification</span>
              <span className="pill-tag">AI Labels</span>
              <span className="pill-tag">60+ FPS</span>
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
              Our HoloRay engine uses adaptive template matching with predictive search for robust
              tracking.
            </p>
            <ul className="list text-sm text-gray-700">
              <li>Multi-scale search with confidence scoring</li>
              <li>Template refresh for appearance drift</li>
              <li>Motion smoothing with recovery windows</li>
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
              Integrated AI labeling identifies objects automatically with GPT-4o vision.
            </p>
            <ul className="list text-sm text-gray-700">
              <li>One-click object identification</li>
              <li>Context-aware labeling</li>
              <li>Continuous learning pipeline</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="tracks">
        <div className="section-header">
          <h2 className="section-title">Application domains</h2>
          <p className="section-lede">
            Choose a domain. Each application is built on the same computer vision core with
            domain-specific intelligence.
          </p>
        </div>
        <div className="grid path-grid">
          <Link
            href="/medicine"
            className="path-card medicine reveal"
            style={{ animationDelay: "0.05s" }}
          >
            <div className="path-head">
              <span className="status-pill status-live">Live</span>
              <span className="path-kicker">Medicine</span>
            </div>
            <h3 className="path-title">MedSync Vision</h3>
            <p className="path-desc">
              Annotate medical imagery and procedures with persistent tracking overlays for clinical
              workflows.
            </p>
            <span className="path-link">Open MedSync →</span>
          </Link>
          <Link
            href="/security"
            className="path-card security reveal"
            style={{ animationDelay: "0.1s" }}
          >
            <div className="path-head">
              <span className="status-pill status-live">Live</span>
              <span className="path-kicker">Security</span>
            </div>
            <h3 className="path-title">SecureWatch</h3>
            <p className="path-desc">
              Real-time monitoring with object tracking, AI identification, and situational
              awareness.
            </p>
            <span className="path-link">Open SecureWatch →</span>
          </Link>
          <Link
            href="/practice"
            className="path-card entertainment reveal"
            style={{ animationDelay: "0.15s" }}
          >
            <div className="path-head">
              <span className="status-pill status-live">Live</span>
              <span className="path-kicker">Entertainment</span>
            </div>
            <h3 className="path-title">AR Gaming</h3>
            <p className="path-desc">
              Interactive AR experiences with hand tracking, real-time overlays, and immersive
              feedback.
            </p>
            <span className="path-link">Open experience →</span>
          </Link>
          <Link
            href="/sports"
            className="path-card sports reveal"
            style={{ animationDelay: "0.2s" }}
          >
            <div className="path-head">
              <span className="status-pill status-live">Live</span>
              <span className="path-kicker">Health</span>
            </div>
            <h3 className="path-title">Motion Coach</h3>
            <p className="path-desc">
              Posture analysis, movement tracking, and guided exercises with real-time visual
              feedback.
            </p>
            <span className="path-link">Open coach →</span>
          </Link>
          <Link
            href="/navigation"
            className="path-card navigation reveal"
            style={{ animationDelay: "0.25s" }}
          >
            <div className="path-head">
              <span className="status-pill status-live">Live</span>
              <span className="path-kicker">Utilities</span>
            </div>
            <h3 className="path-title">Visual Navigator</h3>
            <p className="path-desc">
              Camera-assisted navigation with obstacle detection and accessibility routing.
            </p>
            <span className="path-link">Open navigator →</span>
          </Link>
          <Link
            href="/follow"
            className="path-card follow reveal"
            style={{ animationDelay: "0.3s" }}
          >
            <div className="path-head">
              <span className="status-pill status-live">Live</span>
              <span className="path-kicker">Tracking Lab</span>
            </div>
            <h3 className="path-title">HoloRay Follow</h3>
            <p className="path-desc">
              Click any object to lock tracking and follow it through motion with real-time
              overlays.
            </p>
            <span className="path-link">Open follow demo →</span>
          </Link>
        </div>
      </section>
    </main>
  );
}