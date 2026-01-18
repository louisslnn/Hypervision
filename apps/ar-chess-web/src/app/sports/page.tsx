import { InclusiveSportsCoach } from "@hypervision/modules";
import Link from "next/link";

export default function SportsPage() {
  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Health Domain</span>
          <h1 className="page-title">Motion Coach</h1>
          <p className="page-lede">
            Computer vision for health and wellness. Posture analysis, movement tracking, and guided
            exercises with real-time visual feedback and adaptive coaching.
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
        <InclusiveSportsCoach />
      </section>

      <section className="grid detail-grid">
        <div className="card">
          <h2 className="card-title">Health applications</h2>
          <ul className="list text-sm text-gray-700">
            <li>Posture correction with real-time feedback</li>
            <li>Physical therapy exercise guidance</li>
            <li>Movement pattern analysis</li>
            <li>Rehabilitation progress tracking</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">CV capabilities</h2>
          <ul className="list text-sm text-gray-700">
            <li>Skeletal pose estimation</li>
            <li>Joint angle measurement</li>
            <li>Movement trajectory analysis</li>
            <li>Form quality scoring</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">Try it</h2>
          <p className="text-sm text-gray-700">
            Start a session, choose the exercise mode, and follow the visual guidance while the
            system tracks your form and provides real-time corrections.
          </p>
        </div>
      </section>
    </main>
  );
}