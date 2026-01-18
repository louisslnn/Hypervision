import { SettingsControls } from '../../components/SettingsControls';

export default function SettingsPage() {
  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Manage privacy controls and local data.</p>
        </div>
      </section>

      <SettingsControls />
    </div>
  );
}
