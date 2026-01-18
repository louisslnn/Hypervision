'use client';

import { useState } from 'react';
import Link from 'next/link';

import type { OpeningInsightsResponse } from '@magnus/shared';

import { generateOpeningInsights } from '../lib/api';

type OpeningAnalysis = {
  opening_name: string;
  eco_url: string | null;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  avg_cpl: number | null;
  avg_cpl_opening_phase: number | null;
  common_mistakes: Array<{
    move_id: number;
    game_id: number;
    ply: number;
    move_san: string;
    classification: string;
    cpl: number | null;
    phase: string;
  }>;
  best_games: number[];
  worst_games: number[];
};

type GameAnalysis = {
  game_id: number;
  result: string;
  opening: string | null;
  phases: Record<string, {
    phase: string;
    moves: number;
    avg_cpl: number | null;
    blunders: number;
    mistakes: number;
  }>;
};

type PhaseTrend = {
  avg_cpl: number | null;
  blunders: number;
  mistakes: number;
  excellent: number;
  moves: number;
  error_rate: number;
  excellence_rate: number;
};

type Props = {
  username: string;
  gameLimit: number;
  openingAnalyses: OpeningAnalysis[];
  gameAnalyses: GameAnalysis[];
  phaseTrends: Record<string, PhaseTrend>;
};

export function OpeningsClient({ username, gameLimit, openingAnalyses, gameAnalyses, phaseTrends }: Props) {
  const [coachReport, setCoachReport] = useState<OpeningInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateCoach = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await generateOpeningInsights(username, gameLimit);
      setCoachReport(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate opening insights.');
    } finally {
      setLoading(false);
    }
  };

  const openingPhase = phaseTrends.opening;
  const totalOpeningErrors = (openingPhase?.blunders ?? 0) + (openingPhase?.mistakes ?? 0);

  return (
    <>
      {/* Opening Phase Overview */}
      <section className="card">
        <h3>Opening Phase Performance</h3>
        <p className="muted">Aggregate statistics for the first 8 full moves across {gameAnalyses.length} games.</p>
        
        <div className="grid">
          <div className="panel">
            <strong>Average CPL</strong>
            <p className="stat-value">{openingPhase?.avg_cpl?.toFixed(1) ?? 'n/a'}</p>
            <p className="muted">Lower is better. Elite: &lt;10</p>
          </div>
          <div className="panel">
            <strong>Total Moves</strong>
            <p className="stat-value">{openingPhase?.moves ?? 0}</p>
          </div>
          <div className="panel">
            <strong>Errors</strong>
            <p className="stat-value">{totalOpeningErrors}</p>
            <p className="muted">{openingPhase?.blunders ?? 0} blunders, {(openingPhase?.mistakes ?? 0)} mistakes</p>
          </div>
          <div className="panel">
            <strong>Excellent Moves</strong>
            <p className="stat-value">{openingPhase?.excellent ?? 0}</p>
            <p className="muted">{((openingPhase?.excellence_rate ?? 0) * 100).toFixed(0)}% excellence rate</p>
          </div>
        </div>
      </section>

      {/* Opening Repertoire Table */}
      <section className="card">
        <h3>Opening Repertoire</h3>
        <p className="muted">Performance breakdown by opening. Click to see game details.</p>
        
        {openingAnalyses.length > 0 ? (
          <div className="opening-table">
            <div className="opening-header">
              <span>Opening</span>
              <span>Games</span>
              <span>W-D-L</span>
              <span>Win Rate</span>
              <span>Avg CPL</span>
              <span>Opening CPL</span>
              <span>Status</span>
            </div>
            {openingAnalyses.map((opening) => {
              const status = getOpeningStatus(opening);
              return (
                <div key={opening.opening_name} className="opening-row">
                  <span className="opening-name">
                    {opening.eco_url ? (
                      <a href={opening.eco_url} target="_blank" rel="noopener noreferrer" className="link">
                        {opening.opening_name}
                      </a>
                    ) : (
                      opening.opening_name
                    )}
                  </span>
                  <span className="pill">{opening.games}</span>
                  <span>{opening.wins}-{opening.draws}-{opening.losses}</span>
                  <span className={getWinRateClass(opening.win_rate)}>
                    {(opening.win_rate * 100).toFixed(0)}%
                  </span>
                  <span className={getCplClass(opening.avg_cpl)}>
                    {opening.avg_cpl?.toFixed(1) ?? 'n/a'}
                  </span>
                  <span className={getCplClass(opening.avg_cpl_opening_phase)}>
                    {opening.avg_cpl_opening_phase?.toFixed(1) ?? 'n/a'}
                  </span>
                  <span className={`status-badge ${status.type}`}>{status.label}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">No opening data available. Sync and analyze games first.</p>
        )}
      </section>

      {/* Opening Mistakes */}
      <section className="card">
        <h3>Critical Opening Mistakes</h3>
        <p className="muted">Significant errors made in the opening phase. Review these positions for improvement.</p>
        
        {(() => {
          const allMistakes = openingAnalyses.flatMap(o => 
            o.common_mistakes.map(m => ({ ...m, opening: o.opening_name }))
          );
          allMistakes.sort((a, b) => (b.cpl ?? 0) - (a.cpl ?? 0));
          const topMistakes = allMistakes.slice(0, 8);
          
          if (topMistakes.length === 0) {
            return <p className="muted">No significant opening errors found. Excellent opening play!</p>;
          }
          
          return (
            <div className="critical-list">
              {topMistakes.map((mistake, idx) => (
                <div key={`${mistake.game_id}-${mistake.move_id}-${idx}`} className="critical-card">
                  <div>
                    <strong>{mistake.move_san}</strong>
                    <span className={`tag tag-${mistake.classification}`}>{mistake.classification}</span>
                    <p className="muted">
                      {mistake.opening} · Move {Math.ceil(mistake.ply / 2)}
                    </p>
                  </div>
                  <div className="critical-meta">
                    <span className="cpl-value">CPL {mistake.cpl ?? '?'}</span>
                    <Link href={`/games/${mistake.game_id}?move_id=${mistake.move_id}`} className="link">
                      Review
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* AI Coach Analysis */}
      <section className="card">
        <h3>AI Opening Coach</h3>
        <p className="muted">
          Get elite-level opening analysis and repertoire recommendations from the AI coach.
        </p>
        
        <button 
          className="button" 
          onClick={handleGenerateCoach} 
          disabled={loading}
        >
          {loading ? 'Analyzing openings…' : 'Generate Opening Analysis'}
        </button>
        
        {error ? <p className="muted" style={{ marginTop: '12px' }}>{error}</p> : null}
        
        {coachReport ? (
          <div className="coach-report" style={{ marginTop: '20px' }}>
            <div className="panel">
              <strong>Repertoire Health</strong>
              <p>{coachReport.report.repertoire_health}</p>
            </div>
            
            <div className="grid" style={{ marginTop: '16px' }}>
              <div className="panel">
                <strong>Strongest Openings</strong>
                <ul>
                  {coachReport.report.strongest_openings.map((o, i) => (
                    <li key={`strong-${i}`}>{o}</li>
                  ))}
                </ul>
              </div>
              <div className="panel">
                <strong>Weakest Openings</strong>
                <ul>
                  {coachReport.report.weakest_openings.map((o, i) => (
                    <li key={`weak-${i}`}>{o}</li>
                  ))}
                </ul>
              </div>
            </div>
            
            {coachReport.report.opening_recommendations.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Recommendations</strong>
                <div className="critical-list" style={{ marginTop: '12px' }}>
                  {coachReport.report.opening_recommendations.map((rec, i) => (
                    <div key={`rec-${i}`} className="guideline-card">
                      <div>
                        <strong>{rec.opening_name}</strong>
                        <span className={`status-badge ${rec.recommendation}`}>
                          {rec.recommendation}
                        </span>
                        <p className="muted">{rec.reasoning}</p>
                        <p><strong>Current:</strong> {rec.current_performance}</p>
                        {rec.suggested_improvements.length > 0 ? (
                          <ul>
                            {rec.suggested_improvements.map((imp, j) => (
                              <li key={`imp-${j}`}>{imp}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            
            {coachReport.report.opening_error_patterns.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Error Patterns</strong>
                <ul>
                  {coachReport.report.opening_error_patterns.map((pattern, i) => (
                    <li key={`pattern-${i}`}>{pattern}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            
            <div className="grid" style={{ marginTop: '16px' }}>
              <div className="panel">
                <strong>Immediate Study Priorities</strong>
                <ul>
                  {coachReport.report.immediate_study_priorities.map((p, i) => (
                    <li key={`priority-${i}`}>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="panel">
                <strong>Theory Gaps</strong>
                <ul>
                  {coachReport.report.theory_gaps.map((g, i) => (
                    <li key={`gap-${i}`}>{g}</li>
                  ))}
                </ul>
              </div>
            </div>
            
            {coachReport.report.limitations.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Limitations</strong>
                <ul className="muted">
                  {coachReport.report.limitations.map((l, i) => (
                    <li key={`limit-${i}`}>{l}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <style jsx>{`
        .opening-table {
          margin-top: 16px;
        }
        .opening-header, .opening-row {
          display: grid;
          grid-template-columns: 1.8fr 0.5fr 0.8fr 0.6fr 0.6fr 0.7fr 0.7fr;
          gap: 12px;
          align-items: center;
          padding: 10px 0;
        }
        .opening-header {
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          border-bottom: 1px solid var(--border);
        }
        .opening-row {
          border-bottom: 1px dashed var(--border);
        }
        .opening-name {
          font-weight: 500;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 8px 0;
        }
        .cpl-value {
          font-weight: 600;
        }
        .win-good { color: #2d6a4f; }
        .win-ok { color: #3a7ca5; }
        .win-poor { color: #c8553d; }
        .cpl-excellent { color: #2d6a4f; }
        .cpl-good { color: #3a7ca5; }
        .cpl-poor { color: #c8553d; }
        .status-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }
        .status-badge.strong { background: #d4edda; color: #155724; }
        .status-badge.keep { background: #d4edda; color: #155724; }
        .status-badge.ok { background: #d1ecf1; color: #0c5460; }
        .status-badge.study { background: #fff3cd; color: #856404; }
        .status-badge.weak { background: #f8d7da; color: #721c24; }
        .status-badge.drop { background: #f8d7da; color: #721c24; }
        .status-badge.expand { background: #d1ecf1; color: #0c5460; }
        @media (max-width: 960px) {
          .opening-header, .opening-row {
            grid-template-columns: 1fr 0.5fr 0.8fr 0.6fr;
          }
          .opening-header span:nth-child(n+5), .opening-row span:nth-child(n+5) {
            display: none;
          }
        }
      `}</style>
    </>
  );
}

function getOpeningStatus(opening: OpeningAnalysis): { type: string; label: string } {
  const cpl = opening.avg_cpl_opening_phase ?? opening.avg_cpl;
  const winRate = opening.win_rate;
  
  if (winRate >= 0.6 && (cpl === null || cpl <= 20)) {
    return { type: 'strong', label: 'Strong' };
  }
  if (winRate >= 0.45 && (cpl === null || cpl <= 35)) {
    return { type: 'ok', label: 'OK' };
  }
  if (winRate < 0.35 || (cpl !== null && cpl > 50)) {
    return { type: 'weak', label: 'Needs Work' };
  }
  return { type: 'study', label: 'Study' };
}

function getWinRateClass(winRate: number): string {
  if (winRate >= 0.6) return 'win-good';
  if (winRate >= 0.4) return 'win-ok';
  return 'win-poor';
}

function getCplClass(cpl: number | null): string {
  if (cpl === null) return '';
  if (cpl <= 15) return 'cpl-excellent';
  if (cpl <= 30) return 'cpl-good';
  return 'cpl-poor';
}

