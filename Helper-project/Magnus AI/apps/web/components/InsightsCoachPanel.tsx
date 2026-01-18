'use client';

import { useEffect, useMemo, useState } from 'react';

import type { InsightsCoachResponse } from '@magnus/shared';

import { fetchInsightsCoach, generateInsightsCoach } from '../lib/api';

type InsightsCoachPanelProps = {
  username: string | null;
  thresholdMs: number;
  initialGameId?: number;
};

export function InsightsCoachPanel({ username, thresholdMs, initialGameId }: InsightsCoachPanelProps) {
  const [gameId, setGameId] = useState(initialGameId ? String(initialGameId) : '');
  const [report, setReport] = useState<InsightsCoachResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedGameId = useMemo(() => {
    const trimmed = gameId.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }, [gameId]);

  useEffect(() => {
    if (!username) {
      return;
    }
    if (parsedGameId === null) {
      return;
    }
    fetchInsightsCoach(username, parsedGameId, thresholdMs)
      .then((data) => {
        setReport(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unable to load coach guidance.');
      });
  }, [username, parsedGameId, thresholdMs]);

  const handleGenerate = async (force?: boolean) => {
    if (!username) {
      setError('Set your Chess.com username in settings to generate guidance.');
      return;
    }
    if (parsedGameId === null) {
      setError('Game ID must be a positive number.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await generateInsightsCoach(
        username,
        parsedGameId,
        thresholdMs,
        undefined,
        force,
      );
      setReport(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate coach guidance.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card">
      <h3>Coach guidance</h3>
      <p className="muted">
        Structured advice grounded in engine analysis across your history. Optionally focus on a
        specific game.
      </p>
      <div className="filters">
        <div className="field">
          <label htmlFor="insights-game-id">Focus game ID (optional)</label>
          <input
            id="insights-game-id"
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            placeholder="e.g. 412"
            inputMode="numeric"
          />
        </div>
        <div className="field full">
          <button className="button" type="button" onClick={() => handleGenerate(false)} disabled={loading}>
            {loading ? 'Generating…' : 'Generate coach guidance'}
          </button>
        </div>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      {report ? (
        <div className="coach-report">
          <div className="panel">
            <strong>Summary</strong>
            <ul>
              {report.report.summary.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
            <div className="tag-row">
              {report.report.focus_areas.map((area) => (
                <span key={area} className="pill">
                  {area}
                </span>
              ))}
            </div>
          </div>
          <div className="panel">
            <strong>Guidelines</strong>
            {report.report.guidelines.length > 0 ? (
              <div className="critical-list">
                {report.report.guidelines.map((guide) => (
                  <div key={guide.title} className="guideline-card">
                    <div>
                      <strong>{guide.title}</strong>
                      <p className="muted">{guide.description}</p>
                      <div className="tag-row">
                        {guide.focus_tags.map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="critical-meta">
                      <span className="label">Evidence</span>
                      <span>
                        {guide.evidence_game_ids.length} games · {guide.evidence_move_ids.length} moves
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No guidance yet. Analyze more games first.</p>
            )}
          </div>
          <div className="panel">
            <strong>Training plan</strong>
            <ul>
              {report.report.training_plan.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
          {report.report.limitations.length > 0 ? (
            <div className="panel">
              <strong>Limitations</strong>
              <ul>
                {report.report.limitations.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
