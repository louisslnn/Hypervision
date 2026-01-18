import { CoachChat } from '../../components/CoachChat';

export default function CoachPage() {
  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h1>Coach</h1>
          <p>Ask questions grounded in your engine analysis.</p>
        </div>
      </section>

      <CoachChat />
    </div>
  );
}
