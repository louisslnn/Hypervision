import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SettingsControls } from '../components/SettingsControls';

const syncResponse = {
  id: 1,
  status: 'complete',
  player_username: 'infinitely_0',
  sync_version: 'v1',
  archives_total: 1,
  months_fetched: 1,
  months_not_modified: 0,
  games_upserted: 5,
  games_skipped: 0,
  error_message: null,
  created_at: '2025-01-01T00:00:00Z',
  finished_at: '2025-01-01T00:00:10Z',
};

const purgeResponse = {
  status: 'ok',
  deleted: {
    players: 1,
    games: 2,
  },
};

describe('SettingsControls', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'confirm', {
      writable: true,
      value: jest.fn().mockReturnValue(true),
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
    document.cookie = '';
  });

  it('toggles anonymize cookie', () => {
    render(<SettingsControls />);
    const checkbox = screen.getByLabelText(/Anonymize opponents/i);
    fireEvent.click(checkbox);
    expect(document.cookie).toContain('magnus_anonymize=true');
  });

  it('saves username and triggers sync', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => syncResponse,
    }) as jest.Mock;

    render(<SettingsControls />);
    fireEvent.change(screen.getByLabelText(/Chess.com username/i), {
      target: { value: 'infinitely_0' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & sync games/i }));

    await waitFor(() => {
      expect(screen.getByText(/Latest sync/i)).toBeInTheDocument();
    });

    expect(document.cookie).toContain('magnus_username=infinitely_0');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('purges data and shows deleted counts', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => purgeResponse,
    }) as jest.Mock;

    render(<SettingsControls />);
    fireEvent.click(screen.getByRole('button', { name: /Purge local data/i }));

    await waitFor(() => {
      expect(screen.getByText('Deleted rows')).toBeInTheDocument();
    });

    expect(screen.getByText('players')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalled();
  });
});
