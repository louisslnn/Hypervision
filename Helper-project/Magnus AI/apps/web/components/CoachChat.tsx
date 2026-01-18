'use client';

import { useMemo, useState } from 'react';

import { coachQueryResponseSchema, type CoachQueryResponse } from '@magnus/shared';

const DEFAULT_API_BASE_URL = 'http://localhost:8000';

type CoachFormState = {
  gameId: string;
  analysisVersion: string;
  question: string;
  maxMoments: string;
  force: boolean;
};

export function CoachChat() {
  const [form, setForm] = useState<CoachFormState>({
    gameId: '',
    analysisVersion: '',
    question: '',
    maxMoments: '8',
    force: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CoachQueryResponse | null>(null);

  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    [],
  );

  const update = (partial: Partial<CoachFormState>) =>
    setForm((prev) => ({ ...prev, ...partial }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    const gameId = Number(form.gameId);
    const maxMoments = Number(form.maxMoments);
    if (!gameId || Number.isNaN(gameId)) {
      setError('Enter a valid game id.');
      return;
    }

    if (!form.question.trim()) {
      setError('Enter a coach question.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/coach/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: form.question,
          game_id: gameId,
          analysis_version: form.analysisVersion || null,
          force: form.force,
          max_moments: Number.isNaN(maxMoments) ? 8 : maxMoments,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed (${response.status})`);
      }

      const payload = coachQueryResponseSchema.parse(await response.json());
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach coach service.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="coach-grid">
      <form className="card" onSubmit={submit}>
        <h3>Ask the coach</h3>
        <p className="muted">
          Responses are grounded in engine evaluations and stored PGN positions.
        </p>
        <div className="filters">
          <div className="field">
            <label htmlFor="coach-game">Game ID</label>
            <input
              id="coach-game"
              inputMode="numeric"
              value={form.gameId}
              onChange={(event) => update({ gameId: event.target.value })}
              placeholder="1"
            />
          </div>
          <div className="field">
            <label htmlFor="coach-analysis">Analysis version</label>
            <input
              id="coach-analysis"
              value={form.analysisVersion}
              onChange={(event) => update({ analysisVersion: event.target.value })}
              placeholder="latest"
            />
          </div>
          <div className="field">
            <label htmlFor="coach-max">Max moments</label>
            <input
              id="coach-max"
              inputMode="numeric"
              value={form.maxMoments}
              onChange={(event) => update({ maxMoments: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="coach-force">Force refresh</label>
            <input
              id="coach-force"
              type="checkbox"
              checked={form.force}
              onChange={(event) => update({ force: event.target.checked })}
            />
          </div>
          <div className="field full">
            <label htmlFor="coach-question">Question</label>
            <textarea
              id="coach-question"
              value={form.question}
              onChange={(event) => update({ question: event.target.value })}
              placeholder="Summarize the main mistakes and what to train."
            />
          </div>
          <div className="field full">
            <button className="button" type="submit" disabled={loading}>
              {loading ? 'Analyzing…' : 'Generate report'}
            </button>
          </div>
        </div>
        {error ? <p className="muted">{error}</p> : null}
      </form>

      <section className="card">
        <h3>Coach report</h3>
        {!result ? (
          <p className="muted">Submit a question to generate a structured report.</p>
        ) : (
          <div className="coach-report">
            <div className="panel">
              <strong>Summary</strong>
              <ul>
                {result.report.summary.map((item, index) => (
                  <li key={`summary-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="panel">
              <strong>Phase advice</strong>
              <div className="phase-grid">
                <div>
                  <span className="label">Opening</span>
                  <ul>
                    {result.report.phase_advice.opening.map((item, index) => (
                      <li key={`open-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="label">Middlegame</span>
                  <ul>
                    {result.report.phase_advice.middlegame.map((item, index) => (
                      <li key={`mid-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="label">Endgame</span>
                  <ul>
                    {result.report.phase_advice.endgame.map((item, index) => (
                      <li key={`end-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div className="panel">
              <strong>Critical moments</strong>
              <div className="critical-list">
                {result.report.critical_moments.map((moment) => (
                  <div key={moment.move_id} className="critical-card">
                    <div>
                      <strong>
                        {moment.ply}. {moment.move_san}
                      </strong>
                      <p className="muted">
                        {moment.classification} · CPL {moment.cpl ?? 'n/a'}
                      </p>
                      <p className="muted">{moment.explanation}</p>
                      <p className="muted">
                        Best: {moment.evidence.best_move_uci ?? 'n/a'} · Eval before{' '}
                        {moment.evidence.eval_before_cp ?? 'n/a'}
                      </p>
                    </div>
                    <div className="critical-meta">
                      <span className="label">Train</span>
                      <span>{moment.what_to_train.join(', ') || 'n/a'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <strong>Themes</strong>
              <div className="tag-row">
                {result.report.themes.map((theme, index) => (
                  <span key={`theme-${index}`} className="pill">
                    {theme}
                  </span>
                ))}
              </div>
            </div>
            <div className="panel">
              <strong>Training plan</strong>
              <div className="grid">
                {result.report.training_plan.map((item, index) => (
                  <div key={`plan-${index}`} className="panel">
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <p className="muted">
                      {item.time_estimate_min} min · {item.focus_tags.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            {result.report.limitations.length ? (
              <div className="panel">
                <strong>Limitations</strong>
                <ul>
                  {result.report.limitations.map((item, index) => (
                    <li key={`limit-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
