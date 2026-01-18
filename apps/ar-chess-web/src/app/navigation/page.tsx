import { OutdoorAccessibilityNavigator } from "@hypervision/modules";
import Link from "next/link";

export default function NavigationPage() {
  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Utilities Domain</span>
          <h1 className="page-title">Visual Navigator</h1>
          <p className="page-lede">
            Computer vision for navigation and spatial awareness. Camera-assisted routing with
            obstacle detection, accessibility guidance, and real-time environmental mapping.
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
        <OutdoorAccessibilityNavigator />
      </section>

      <section className="grid detail-grid">
        <div className="card">
          <h2 className="card-title">Navigation features</h2>
          <ul className="list text-sm text-gray-700">
            <li>Real-time obstacle detection</li>
            <li>Accessibility-aware routing</li>
            <li>Voice-guided navigation</li>
            <li>Environmental hazard alerts</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">CV capabilities</h2>
          <ul className="list text-sm text-gray-700">
            <li>Object detection and classification</li>
            <li>Depth estimation for obstacle distance</li>
            <li>Scene understanding and context</li>
            <li>Path clearance analysis</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">Try it</h2>
          <p className="text-sm text-gray-700">
            Start navigation, search for a destination, and follow the visual guidance while the
            system detects obstacles and provides accessibility routing.
          </p>
        </div>
      </section>
    </main>
  );
}