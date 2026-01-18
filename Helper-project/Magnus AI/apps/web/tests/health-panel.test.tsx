import { render, screen } from '@testing-library/react';

import { HealthPanel } from '../components/HealthPanel';

describe('HealthPanel', () => {
  it('renders ok state', () => {
    render(<HealthPanel health={{ status: 'ok', db: 'ok' }} error={null} />);
    expect(screen.getByTestId('health-ok')).toBeInTheDocument();
    expect(screen.getByText('Database: ok')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<HealthPanel health={null} error="API down" />);
    expect(screen.getByTestId('health-error')).toBeInTheDocument();
    expect(screen.getByText('API down')).toBeInTheDocument();
  });
});
