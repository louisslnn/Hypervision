import { HoloRayFollow } from "@hypervision/modules";
import Link from "next/link";

export default function FollowPage() {
  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Tracking Lab</span>
          <h1 className="page-title">HoloRay Follow</h1>
          <p className="page-lede">
            Click any object in the camera feed and keep it locked with real-time tracking. This is
            the core HoloRay demo used across domains for rapid, precise target following.
          </p>
          <div className="hero-actions">
            <span className="status-pill status-live">Live</span>
            <span className="status-pill status-planning">Click-to-follow</span>
          </div>
        </div>
        <div className="page-actions">
          <Link href="/" className="button hero-cta ghost">
            ← Back to domains
          </Link>
        </div>
      </section>

      <section className="card">
        <HoloRayFollow />
      </section>

      <section className="grid detail-grid">
        <div className="card">
          <h2 className="card-title">Follow features</h2>
          <ul className="list text-sm text-gray-700">
            <li>Click-to-lock target tracking</li>
            <li>Adaptive template matching with recovery</li>
            <li>Precision, balanced, and performance profiles</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">Demo behavior</h2>
          <ul className="list text-sm text-gray-700">
            <li>Single-target follow workflow</li>
            <li>Motion and quality indicators</li>
            <li>Path trail for visual debugging</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">How to use</h2>
          <p className="text-sm text-gray-700">
            Start the session, click a subject, and move your camera. The tracker stays locked until
            the target is lost or you click a new object.
          </p>
        </div>
      </section>
    </main>
  );
}
