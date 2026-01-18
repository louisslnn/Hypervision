import {
  CprTrainerStub,
  HandHygieneTrainer,
  LabSafetyStub,
  PillAssistStub,
  PostureCoachStub
} from "@hypervision/modules";
import Link from "next/link";

export default function DemosPage() {
  return (
    <main>
      <section className="page-hero">
        <div>
          <span className="eyebrow">R&D lab</span>
          <h1 className="page-title">Exploration Modules</h1>
          <p className="page-lede">
            Exploratory modules that share the same AR + CV core. Some are live, others are staged
            for future buildout.
          </p>
          <div className="hero-actions">
            <span className="status-pill status-live">1 live</span>
            <span className="status-pill status-planning">4 staged</span>
          </div>
        </div>
        <div className="page-actions">
          <Link href="/" className="button hero-cta ghost">
            Back to overview
          </Link>
        </div>
      </section>

      <section className="grid demos-grid">
        <div className="card">
          <h2 className="card-title">Hand Hygiene Coach</h2>
          <p className="text-sm text-gray-700">
            Tracks two hands and visualizes compliance time. No recordings or uploads.
          </p>
          <div className="mt-4">
            <HandHygieneTrainer />
          </div>
        </div>
        <div className="card">
          <PostureCoachStub />
        </div>
        <div className="card">
          <PillAssistStub />
        </div>
        <div className="card">
          <CprTrainerStub />
        </div>
        <div className="card">
          <LabSafetyStub />
        </div>
      </section>
    </main>
  );
}
