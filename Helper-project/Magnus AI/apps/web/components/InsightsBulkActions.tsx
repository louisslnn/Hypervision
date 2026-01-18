'use client';

import { useState } from 'react';

import type { AnalyzeAllResponse } from '@magnus/shared';

import { analyzeAllGames } from '../lib/api';

type InsightsBulkActionsProps = {
  username: string | null;
};

export function InsightsBulkActions({ username }: InsightsBulkActionsProps) {
  const [maxPlies, setMaxPlies] = useState('');
  const [result, setResult] = useState<AnalyzeAllResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    if (!username) {
      setError('Set your Chess.com username in settings before running analysis.');
      return;
    }
    const trimmed = maxPlies.trim();
    const parsed = trimmed ? Number(trimmed) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError('Max plies must be a positive number.');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await analyzeAllGames(username, parsed ?? undefined);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run bulk analysis.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="card">
      <h3>Analyze all games</h3>
      <p className="muted">
        Run Stockfish analysis across every synced game to unlock full Insights and coach notes.
      </p>
      <div className="filters">
        <div className="field">
          <label htmlFor="max-plies">Max plies (optional)</label>
          <input
            id="max-plies"
            inputMode="numeric"
            value={maxPlies}
            onChange={(event) => setMaxPlies(event.target.value)}
            placeholder="Leave blank for full games"
          />
        </div>
        <div className="field full">
          <button className="button" type="button" onClick={handleRun} disabled={running}>
            {running ? 'Analyzing…' : 'Analyze all games'}
          </button>
        </div>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      {result ? (
        <div className="panel">
          <strong>Analysis run complete</strong>
          <p className="muted">
            {result.games_analyzed} analyzed · {result.games_skipped} skipped ·{' '}
            {result.games_failed} failed
          </p>
          <p className="muted">
            {result.moves_analyzed} moves analyzed · {result.moves_skipped} cached
          </p>
          <button className="button secondary" type="button" onClick={() => window.location.reload()}>
            Refresh insights
          </button>
        </div>
      ) : null}
    </section>
  );
}
