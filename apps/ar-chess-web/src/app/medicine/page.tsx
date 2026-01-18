import { MedSyncVision } from "@hypervision/modules";
import Link from "next/link";

export default function MedicinePage() {
  // Get OpenAI API key from environment variable (server-side)
  const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;

  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Medicine Domain</span>
          <h1 className="page-title">MedSync Vision</h1>
          <p className="page-lede">
            Computer vision for medical imaging and clinical workflows. Annotate procedures, track
            instruments, and overlay guidance that persists through camera movement.
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
        <MedSyncVision openaiApiKey={openaiApiKey} />
      </section>

      <section className="grid detail-grid">
        <div className="card">
          <h2 className="card-title">Clinical applications</h2>
          <ul className="list text-sm text-gray-700">
            <li>Surgical procedure documentation</li>
            <li>Training video annotation</li>
            <li>Post-operative review with tracking</li>
            <li>Telemedicine consultation overlays</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">CV capabilities</h2>
          <ul className="list text-sm text-gray-700">
            <li>Optical flow tracking</li>
            <li>Occlusion detection</li>
            <li>Persistent annotations</li>
            <li>Multiple annotation styles</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">How to use</h2>
          <p className="text-sm text-gray-700">
            Load a video file, click to place tracking points, then start processing. Annotations
            will follow objects through motion and occlusion.
          </p>
        </div>
      </section>
    </main>
  );
}