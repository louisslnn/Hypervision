import { HoloRayFollow } from "@hypervision/modules";
import Link from "next/link";

export default function FollowPage() {
  const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  
  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Tracking Lab</span>
          <h1 className="page-title">HoloRay Follow</h1>
          <p className="page-lede">
            Real-time object tracking with AI identification. Click any object and the camera 
            will track it with advanced optical flow, Kalman smoothing, and AI-powered re-acquisition.
          </p>
          <div className="hero-actions">
            <span className="status-pill status-live">Live Camera</span>
            <span className="status-pill status-planning">AI-Powered</span>
          </div>
        </div>
        <div className="page-actions">
          <Link href="/" className="button hero-cta ghost">
            ← Back to domains
          </Link>
        </div>
      </section>

      <section className="card">
        <HoloRayFollow openaiApiKey={openaiApiKey} />
      </section>

      <section className="grid detail-grid">
        <div className="card">
          <h2 className="card-title">Tracking features</h2>
          <ul className="list text-sm text-gray-700">
            <li>Multi-point optical flow tracking</li>
            <li>Kalman filter smoothing</li>
            <li>Forward-backward validation</li>
            <li>AI-powered object identification</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">AI capabilities</h2>
          <ul className="list text-sm text-gray-700">
            <li>Automatic object identification on click</li>
            <li>Periodic validation of tracked object</li>
            <li>Smart re-acquisition when lost</li>
            <li>Drawing annotation support</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="card-title">How to use</h2>
          <p className="text-sm text-gray-700">
            Start the camera, click objects to track them. Toggle Draw mode to annotate areas.
            The AI will identify objects and help re-acquire them when lost.
          </p>
        </div>
      </section>
    </main>
  );
}
