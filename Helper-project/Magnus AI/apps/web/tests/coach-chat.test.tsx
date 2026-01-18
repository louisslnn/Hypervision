import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CoachChat } from '../components/CoachChat';

const sampleResponse = {
  status: 'ok',
  scope_type: 'game',
  scope_id: 1,
  analysis_version: 'v1',
  model: 'gpt-test',
  prompt_version: 'v0.1',
  schema_version: 'v0.1',
  output_id: 42,
  cached: false,
  created_at: '2025-01-01T00:00:00Z',
  report: {
    summary: ['Simplify when ahead.'],
    phase_advice: {
      opening: ['Develop quickly.'],
      middlegame: ['Avoid loose pieces.'],
      endgame: ['Convert material safely.'],
    },
    critical_moments: [],
    themes: ['time management'],
    training_plan: [],
    limitations: [],
  },
};

describe('CoachChat', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleResponse,
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('submits a coach query and renders the report', async () => {
    render(<CoachChat />);

    fireEvent.change(screen.getByLabelText(/Game ID/i), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(/Question/i), {
      target: { value: 'Summarize main mistakes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate report/i }));

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeInTheDocument();
    });

    expect(screen.getByText('Simplify when ahead.')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalled();
  });
});
