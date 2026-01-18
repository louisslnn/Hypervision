'use client';

import { useState } from 'react';
import Link from 'next/link';

import type { TimeInsightsResponse } from '@magnus/shared';

import { generateTimeInsights } from '../lib/api';

type CriticalMoment = {
  move_id: number;
  game_id: number;
  ply: number;
  move_san: string;
  classification: string;
  cpl: number | null;
  clock_remaining_ms: number | null;
  time_spent_ms: number | null;
  phase: string;
  is_tactical: boolean;
};

type TimeManagement = {
  avg_time_per_move_ms: number | null;
  opening_avg_time_ms: number | null;
  middlegame_avg_time_ms: number | null;
  endgame_avg_time_ms: number | null;
  games_with_time_trouble: number;
  total_games: number;
  time_trouble_rate: number;
  avg_ply_entering_time_trouble: number | null;
  blunders_in_time_trouble: number;
  blunders_total: number;
  time_trouble_blunder_rate: number;
  avg_cpl_fast_moves: number | null;
  avg_cpl_normal_moves: number | null;
  avg_cpl_slow_moves: number | null;
  fastest_blunders: CriticalMoment[];
};

type GameAnalysis = {
  game_id: number;
  result: string;
  time_control: string | null;
  time_trouble_entered_at: number | null;
  total_moves: number;
  blunders: number;
  mistakes: number;
  phases: Record<string, {
    phase: string;
    moves: number;
    avg_time_spent_ms: number | null;
    time_trouble_moves: number;
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
};

type Props = {
  username: string;
  gameLimit: number;
  timeManagement: TimeManagement;
  gameAnalyses: GameAnalysis[];
  phaseTrends: Record<string, PhaseTrend>;
};

export function TimeManagementClient({ username, gameLimit, timeManagement, gameAnalyses, phaseTrends }: Props) {
  const [coachReport, setCoachReport] = useState<TimeInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateCoach = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await generateTimeInsights(username, gameLimit);
      setCoachReport(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate time insights.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ms: number | null): string => {
    if (ms === null) return 'n/a';
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = seconds / 60;
    return `${minutes.toFixed(1)}m`;
  };

  const timeTroublePercent = (timeManagement.time_trouble_rate * 100).toFixed(0);
  const ttBlunderPercent = (timeManagement.time_trouble_blunder_rate * 100).toFixed(0);

  return (
    <>
      {/* Time Management Overview */}
      <section className="card">
        <h3>Time Management Overview</h3>
        <p className="muted">Aggregate time statistics across {timeManagement.total_games} games.</p>
        
        <div className="grid">
          <div className="panel">
            <strong>Time Trouble Rate</strong>
            <p className={`stat-value ${getTimeTroubleClass(timeManagement.time_trouble_rate)}`}>
              {timeTroublePercent}%
            </p>
            <p className="muted">{timeManagement.games_with_time_trouble} of {timeManagement.total_games} games</p>
          </div>
          <div className="panel">
            <strong>Avg Entry Ply</strong>
            <p className="stat-value">
              {timeManagement.avg_ply_entering_time_trouble?.toFixed(0) ?? 'n/a'}
            </p>
            <p className="muted">Move when time trouble typically starts</p>
          </div>
          <div className="panel">
            <strong>Time Trouble Blunders</strong>
            <p className={`stat-value ${getTTBlunderClass(timeManagement.time_trouble_blunder_rate)}`}>
              {ttBlunderPercent}%
            </p>
            <p className="muted">{timeManagement.blunders_in_time_trouble} of {timeManagement.blunders_total} blunders</p>
          </div>
        </div>
      </section>

      {/* Phase-by-Phase Time Usage */}
      <section className="card">
        <h3>Time Usage by Phase</h3>
        <p className="muted">Average time spent per move in each game phase.</p>
        
        <div className="phase-time-grid">
          <div className="phase-time-card opening">
            <div className="phase-icon">🎯</div>
            <h4>Opening</h4>
            <p className="phase-time">{formatTime(timeManagement.opening_avg_time_ms)}</p>
            <p className="muted">per move</p>
          </div>
          <div className="phase-time-card middlegame">
            <div className="phase-icon">⚔️</div>
            <h4>Middlegame</h4>
            <p className="phase-time">{formatTime(timeManagement.middlegame_avg_time_ms)}</p>
            <p className="muted">per move</p>
          </div>
          <div className="phase-time-card endgame">
            <div className="phase-icon">🏁</div>
            <h4>Endgame</h4>
            <p className="phase-time">{formatTime(timeManagement.endgame_avg_time_ms)}</p>
            <p className="muted">per move</p>
          </div>
        </div>
      </section>

      {/* Speed vs Quality Analysis */}
      <section className="card">
        <h3>Speed vs Quality</h3>
        <p className="muted">How move speed correlates with move quality (CPL = centipawn loss).</p>
        
        <div className="grid">
          <div className="panel">
            <strong>Fast Moves (&lt;3s)</strong>
            <p className={`stat-value ${getCplClass(timeManagement.avg_cpl_fast_moves)}`}>
              {timeManagement.avg_cpl_fast_moves?.toFixed(1) ?? 'n/a'} CPL
            </p>
            <p className="muted">Quick decisions</p>
          </div>
          <div className="panel">
            <strong>Normal Moves (3-30s)</strong>
            <p className={`stat-value ${getCplClass(timeManagement.avg_cpl_normal_moves)}`}>
              {timeManagement.avg_cpl_normal_moves?.toFixed(1) ?? 'n/a'} CPL
            </p>
            <p className="muted">Deliberate thinking</p>
          </div>
          <div className="panel">
            <strong>Slow Moves (&gt;30s)</strong>
            <p className={`stat-value ${getCplClass(timeManagement.avg_cpl_slow_moves)}`}>
              {timeManagement.avg_cpl_slow_moves?.toFixed(1) ?? 'n/a'} CPL
            </p>
            <p className="muted">Deep calculation</p>
          </div>
        </div>
        
        <div className="speed-insight" style={{ marginTop: '16px' }}>
          {getSpeedInsight(timeManagement)}
        </div>
      </section>

      {/* Fastest Blunders */}
      <section className="card">
        <h3>Impulsive Blunders</h3>
        <p className="muted">Blunders made quickly — these often indicate pattern recognition failures.</p>
        
        {timeManagement.fastest_blunders.length > 0 ? (
          <div className="critical-list">
            {timeManagement.fastest_blunders.map((blunder, idx) => (
              <div key={`${blunder.game_id}-${blunder.move_id}-${idx}`} className="critical-card">
                <div>
                  <strong>{blunder.move_san}</strong>
                  <span className={`tag tag-${blunder.classification}`}>{blunder.classification}</span>
                  {blunder.is_tactical ? <span className="tag tag-tactical">tactical</span> : null}
                  <p className="muted">
                    {blunder.phase} phase · Move {Math.ceil(blunder.ply / 2)}
                  </p>
                </div>
                <div className="critical-meta">
                  <span className="time-spent">{formatTime(blunder.time_spent_ms)}</span>
                  <span className="clock-remaining">
                    {blunder.clock_remaining_ms ? `${formatTime(blunder.clock_remaining_ms)} left` : ''}
                  </span>
                  <Link href={`/games/${blunder.game_id}?move_id=${blunder.move_id}`} className="link">
                    Review
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No impulsive blunders found. Good time discipline!</p>
        )}
      </section>

      {/* Game-by-Game Time Trouble */}
      <section className="card">
        <h3>Time Trouble History</h3>
        <p className="muted">Games where time pressure affected performance.</p>
        
        {(() => {
          const timeTroubleGames = gameAnalyses.filter(g => g.time_trouble_entered_at !== null);
          
          if (timeTroubleGames.length === 0) {
            return <p className="muted">No time trouble instances in recent games. Excellent clock management!</p>;
          }
          
          return (
            <div className="time-trouble-list">
              {timeTroubleGames.map((game) => (
                <div key={game.game_id} className="time-trouble-card">
                  <div>
                    <strong>Game #{game.game_id}</strong>
                    <span className={`result-badge ${game.result}`}>{game.result}</span>
                    <p className="muted">
                      {game.time_control} · Time trouble from move {Math.ceil((game.time_trouble_entered_at ?? 0) / 2)}
                    </p>
                  </div>
                  <div className="time-trouble-stats">
                    <span className="error-count">
                      {game.blunders + game.mistakes} errors after
                    </span>
                    <Link href={`/games/${game.game_id}`} className="link">
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
        <h3>AI Time Coach</h3>
        <p className="muted">
          Get elite-level time management analysis and personalized recommendations.
        </p>
        
        <button 
          className="button" 
          onClick={handleGenerateCoach} 
          disabled={loading}
        >
          {loading ? 'Analyzing time patterns…' : 'Generate Time Analysis'}
        </button>
        
        {error ? <p className="muted" style={{ marginTop: '12px' }}>{error}</p> : null}
        
        {coachReport ? (
          <div className="coach-report" style={{ marginTop: '20px' }}>
            <div className="panel">
              <strong>Time Management Assessment</strong>
              <p>{coachReport.report.time_management_assessment}</p>
            </div>
            
            <div className="grid" style={{ marginTop: '16px' }}>
              <div className="panel">
                <strong>Time Trouble Frequency</strong>
                <p>{coachReport.report.time_trouble_frequency}</p>
              </div>
              <div className="panel">
                <strong>Error Correlation</strong>
                <p>{coachReport.report.correlation_with_errors}</p>
              </div>
            </div>
            
            <div className="panel" style={{ marginTop: '16px' }}>
              <strong>Phase Usage Analysis</strong>
              <div className="phase-analysis">
                <p><strong>Opening:</strong> {coachReport.report.opening_time_usage}</p>
                <p><strong>Middlegame:</strong> {coachReport.report.middlegame_time_usage}</p>
                <p><strong>Endgame:</strong> {coachReport.report.endgame_time_usage}</p>
              </div>
            </div>
            
            {coachReport.report.impulsive_move_patterns.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Impulsive Move Patterns</strong>
                <ul>
                  {coachReport.report.impulsive_move_patterns.map((p, i) => (
                    <li key={`imp-${i}`}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            
            {coachReport.report.overthinking_patterns.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Overthinking Patterns</strong>
                <ul>
                  {coachReport.report.overthinking_patterns.map((p, i) => (
                    <li key={`over-${i}`}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            
            {coachReport.report.strategy_recommendations.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Strategy Recommendations</strong>
                <div className="critical-list" style={{ marginTop: '12px' }}>
                  {coachReport.report.strategy_recommendations.map((rec, i) => (
                    <div key={`rec-${i}`} className="guideline-card">
                      <div>
                        <strong>{rec.phase}</strong>
                        <p className="muted">Current: {rec.current_pattern}</p>
                        <p><strong>Change:</strong> {rec.recommended_change}</p>
                        <p className="muted">Benefit: {rec.expected_benefit}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            
            {coachReport.report.clock_management_drills.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Clock Management Drills</strong>
                <ul>
                  {coachReport.report.clock_management_drills.map((d, i) => (
                    <li key={`drill-${i}`}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            
            {coachReport.report.psychological_observations.length > 0 ? (
              <div className="panel" style={{ marginTop: '16px' }}>
                <strong>Psychological Observations</strong>
                <ul>
                  {coachReport.report.psychological_observations.map((o, i) => (
                    <li key={`psych-${i}`}>{o}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            
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
        .stat-value {
          font-size: 1.8rem;
          font-weight: 600;
          margin: 8px 0;
        }
        .tt-good { color: #2d6a4f; }
        .tt-warning { color: #e09f3e; }
        .tt-bad { color: #c8553d; }
        .cpl-good { color: #2d6a4f; }
        .cpl-ok { color: #3a7ca5; }
        .cpl-bad { color: #c8553d; }
        .phase-time-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-top: 16px;
        }
        .phase-time-card {
          text-align: center;
          padding: 20px;
          border-radius: 16px;
          border: 1px solid var(--border);
          background: #fff;
        }
        .phase-time-card.opening { border-left: 4px solid #3a7ca5; }
        .phase-time-card.middlegame { border-left: 4px solid #e09f3e; }
        .phase-time-card.endgame { border-left: 4px solid #2d6a4f; }
        .phase-icon {
          font-size: 2rem;
          margin-bottom: 8px;
        }
        .phase-time {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 8px 0 4px;
        }
        .speed-insight {
          padding: 12px 16px;
          background: var(--highlight);
          border-radius: 12px;
          border: 1px solid var(--border);
        }
        .time-spent {
          font-weight: 600;
          color: var(--accent);
        }
        .clock-remaining {
          font-size: 0.85rem;
          color: var(--muted);
        }
        .time-trouble-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 16px;
        }
        .time-trouble-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--card);
        }
        .time-trouble-stats {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .error-count {
          color: var(--accent);
          font-weight: 600;
        }
        .result-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          margin-left: 8px;
        }
        .result-badge.win { background: #d4edda; color: #155724; }
        .result-badge.loss { background: #f8d7da; color: #721c24; }
        .result-badge.draw { background: #d1ecf1; color: #0c5460; }
        .tag-tactical {
          background: #6c757d;
          color: #fff;
          border-color: #6c757d;
        }
        .phase-analysis p {
          margin: 8px 0;
        }
        @media (max-width: 720px) {
          .phase-time-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}

function getTimeTroubleClass(rate: number): string {
  if (rate <= 0.2) return 'tt-good';
  if (rate <= 0.4) return 'tt-warning';
  return 'tt-bad';
}

function getTTBlunderClass(rate: number): string {
  if (rate <= 0.2) return 'tt-good';
  if (rate <= 0.4) return 'tt-warning';
  return 'tt-bad';
}

function getCplClass(cpl: number | null): string {
  if (cpl === null) return '';
  if (cpl <= 20) return 'cpl-good';
  if (cpl <= 40) return 'cpl-ok';
  return 'cpl-bad';
}

function getSpeedInsight(tm: {
  avg_cpl_fast_moves: number | null;
  avg_cpl_normal_moves: number | null;
  avg_cpl_slow_moves: number | null;
}): string {
  const fast = tm.avg_cpl_fast_moves;
  const normal = tm.avg_cpl_normal_moves;
  const slow = tm.avg_cpl_slow_moves;
  
  if (fast === null || normal === null) {
    return 'Not enough data to analyze speed-quality correlation.';
  }
  
  if (fast > normal * 1.5) {
    return '⚠️ Fast moves are significantly worse than deliberate moves. Consider slowing down on critical positions.';
  }
  
  if (fast < normal * 0.8) {
    return '✅ Your quick pattern recognition is strong. Fast moves are actually better than deliberate ones.';
  }
  
  if (slow !== null && slow > normal * 1.3) {
    return '💡 Overthinking may be hurting you. Slow moves are worse than normal-paced ones.';
  }
  
  return '📊 Move speed shows expected correlation with quality. Normal time management.';
}

