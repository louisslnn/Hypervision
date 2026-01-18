import { HealthResponse } from '@magnus/shared';

type HealthPanelProps = {
  health: HealthResponse | null;
  error: string | null;
};

export function HealthPanel({ health, error }: HealthPanelProps) {
  if (error) {
    return (
      <div className="panel" data-testid="health-error">
        <strong>API health</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="panel" data-testid="health-empty">
        <strong>API health</strong>
        <p>Unavailable</p>
      </div>
    );
  }

  return (
    <div className="panel" data-testid="health-ok">
      <strong>API health</strong>
      <span className="badge">{health.status}</span>
      <p>Database: {health.db}</p>
    </div>
  );
}
