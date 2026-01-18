'use client';

import { useState } from 'react';
import Link from 'next/link';

import type { DeepInsightsDataResponse, DeepInsightsCoachResponse } from '@magnus/shared';

import { generateDeepInsightsCoach } from '../lib/api';

type Props = {
  username: string;
  gameLimit: number;
  data: DeepInsightsDataResponse;
};

export function DeepInsightsClient({ username, gameLimit, data }: Props) {
  const [coachReport, setCoachReport] = useState<DeepInsightsCoachResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'games' | 'coach'>('overview');

  const handleGenerateCoach = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await generateDeepInsightsCoach(username, gameLimit);
      setCoachReport(response);
      setActiveTab('coach');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate deep insights.');
    } finally {
      setLoading(false);
    }
  };

  const { overall_stats, game_analyses, opening_analyses, time_management, phase_trends, improvement_signals, regression_signals } = data;

  return (
    <>
      {/* Performance Overview */}
      <section className="card">
        <h3>Performance Overview</h3>
        <p className="muted">Aggregate statistics across {overall_stats.games} analyzed games.</p>
        
        <div className="stats-grid">
          <div className="stat-card primary">
            <span className="stat-label">Win Rate</span>
            <span className={`stat-value ${getWinRateClass(overall_stats.win_rate)}`}>
              {(overall_stats.win_rate * 100).toFixed(0)}%
            </span>
            <span className="stat-detail">
              {overall_stats.wins}W - {overall_stats.draws}D - {overall_stats.losses}L
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg CPL</span>
            <span className={`stat-value ${getCplClass(overall_stats.avg_cpl)}`}>
              {overall_stats.avg_cpl?.toFixed(1) ?? 'n/a'}
            </span>
            <span className="stat-detail">Elite: &lt;15</span>
          </div>
          <div className="stat-card warning">
            <span className="stat-label">Total Blunders</span>
            <span className="stat-value">{overall_stats.total_blunders}</span>
            <span className="stat-detail">
              {(overall_stats.total_blunders / overall_stats.games).toFixed(1)} per game
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Total Mistakes</span>
            <span className="stat-value">{overall_stats.total_mistakes}</span>
            <span className="stat-detail">
              {(overall_stats.total_mistakes / overall_stats.games).toFixed(1)} per game
            </span>
          </div>
          <div className="stat-card success">
            <span className="stat-label">Excellent Moves</span>
            <span className="stat-value">{overall_stats.total_excellent}</span>
            <span className="stat-detail">
              {(overall_stats.total_excellent / overall_stats.games).toFixed(1)} per game
            </span>
          </div>
        </div>
      </section>

      {/* Signals */}
      {(improvement_signals.length > 0 || regression_signals.length > 0) && (
        <section className="card">
          <h3>Performance Signals</h3>
          <p className="muted">Detected patterns in your recent play.</p>
          
          <div className="signals-grid">
            {improvement_signals.length > 0 && (
              <div className="signals-column improvement">
                <h4>📈 Improvement Signals</h4>
                {improvement_signals.map((signal, i) => (
                  <div key={`imp-${i}`} className="signal-card improvement">
                    <span className="signal-type">{signal.type.replace(/_/g, ' ')}</span>
                    <p>{signal.description}</p>
                  </div>
                ))}
              </div>
            )}
            {regression_signals.length > 0 && (
              <div className="signals-column regression">
                <h4>⚠️ Areas of Concern</h4>
                {regression_signals.map((signal, i) => (
                  <div key={`reg-${i}`} className="signal-card regression">
                    <span className="signal-type">{signal.type.replace(/_/g, ' ')}</span>
                    <p>{signal.description}</p>
                    {signal.game_ids && signal.game_ids.length > 0 && (
                      <div className="signal-games">
                        Games: {signal.game_ids.map((id, j) => (
                          <Link key={id} href={`/games/${id}`} className="link">
                            #{id}{j < (signal.game_ids?.length ?? 0) - 1 ? ', ' : ''}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Phase Performance */}
      <section className="card">
        <h3>Phase Performance</h3>
        <p className="muted">How you perform in each phase of the game.</p>
        
        <div className="phase-grid">
          {(['opening', 'middlegame', 'endgame'] as const).map((phase) => {
            const trend = phase_trends[phase];
            if (!trend) return null;
            return (
              <div key={phase} className={`phase-card ${phase}`}>
                <h4>{phase.charAt(0).toUpperCase() + phase.slice(1)}</h4>
                <div className="phase-stats">
                  <div className="phase-stat">
                    <span className="label">Avg CPL</span>
                    <span className={`value ${getCplClass(trend.avg_cpl)}`}>
                      {trend.avg_cpl?.toFixed(1) ?? 'n/a'}
                    </span>
                  </div>
                  <div className="phase-stat">
                    <span className="label">Error Rate</span>
                    <span className="value">{(trend.error_rate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="phase-stat">
                    <span className="label">Excellent</span>
                    <span className="value">{trend.excellent}</span>
                  </div>
                </div>
                <div className="phase-breakdown">
                  <span className="blunder">{trend.blunders} blunders</span>
                  <span className="mistake">{trend.mistakes} mistakes</span>
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="phase-links" style={{ marginTop: '16px' }}>
          <Link href="/openings" className="button secondary">Opening Analysis →</Link>
          <Link href="/time" className="button secondary">Time Analysis →</Link>
        </div>
      </section>

      {/* Quick Opening Summary */}
      <section className="card">
        <h3>Opening Repertoire Summary</h3>
        <p className="muted">Top openings by games played.</p>
        
        {opening_analyses.length > 0 ? (
          <>
            <div className="opening-summary">
              {opening_analyses.slice(0, 5).map((opening) => (
                <div key={opening.opening_name} className="opening-item">
                  <div className="opening-info">
                    <strong>{opening.opening_name}</strong>
                    <span className="pill">{opening.games} games</span>
                  </div>
                  <div className="opening-stats">
                    <span className={getWinRateClass(opening.win_rate)}>
                      {(opening.win_rate * 100).toFixed(0)}% win
                    </span>
                    <span className={getCplClass(opening.avg_cpl)}>
                      {opening.avg_cpl?.toFixed(1) ?? 'n/a'} CPL
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <Link href="/openings" className="button secondary" style={{ marginTop: '16px' }}>
              Full Opening Analysis →
            </Link>
          </>
        ) : (
          <p className="muted">No opening data available.</p>
        )}
      </section>

      {/* Time Management Summary */}
      <section className="card">
        <h3>Time Management Summary</h3>
        <p className="muted">Clock usage patterns and their impact on performance.</p>
        
        <div className="time-summary-grid">
          <div className="time-stat">
            <span className="label">Time Trouble Rate</span>
            <span className={`value ${getTimeTroubleClass(time_management.time_trouble_rate)}`}>
              {(time_management.time_trouble_rate * 100).toFixed(0)}%
            </span>
          </div>
          <div className="time-stat">
            <span className="label">Blunders in Time Trouble</span>
            <span className="value">
              {time_management.blunders_in_time_trouble} of {time_management.blunders_total}
            </span>
          </div>
          <div className="time-stat">
            <span className="label">Fast Move CPL</span>
            <span className={`value ${getCplClass(time_management.avg_cpl_fast_moves)}`}>
              {time_management.avg_cpl_fast_moves?.toFixed(1) ?? 'n/a'}
            </span>
          </div>
        </div>
        
        <Link href="/time" className="button secondary" style={{ marginTop: '16px' }}>
          Full Time Analysis →
        </Link>
      </section>

      {/* Game-by-Game Analysis */}
      <section className="card">
        <h3>Game-by-Game Breakdown</h3>
        <p className="muted">Performance summary for each analyzed game.</p>
        
        <div className="games-list">
          {game_analyses.map((game) => (
            <div key={game.game_id} className={`game-row ${game.result}`}>
              <div className="game-main">
                <div className="game-result">
                  <span className={`result-badge ${game.result}`}>{game.result.toUpperCase()}</span>
                  <span className="game-id">#{game.game_id}</span>
                </div>
                <div className="game-info">
                  <span className="opponent">
                    vs {game.opponent_username ?? 'Unknown'} 
                    {game.opponent_rating ? ` (${game.opponent_rating})` : ''}
                  </span>
                  <span className="opening-name">{game.opening?.split('/').pop() ?? 'Unknown'}</span>
                </div>
              </div>
              <div className="game-stats">
                <span className={`cpl ${getCplClass(game.avg_cpl)}`}>
                  {game.avg_cpl?.toFixed(1) ?? 'n/a'} CPL
                </span>
                <span className="errors">
                  {game.blunders > 0 && <span className="blunder">{game.blunders}?? </span>}
                  {game.mistakes > 0 && <span className="mistake">{game.mistakes}? </span>}
                  {game.excellent_moves > 0 && <span className="excellent">{game.excellent_moves}!</span>}
                </span>
                {game.time_trouble_entered_at && (
                  <span className="time-trouble-indicator">⏰ Time trouble</span>
                )}
              </div>
              <Link href={`/games/${game.game_id}`} className="game-link">Review</Link>
            </div>
          ))}
        </div>
      </section>

      {/* AI Deep Coach */}
      <section className="card">
        <h3>AI Deep Coach</h3>
        <p className="muted">
          Generate comprehensive, elite-level coaching analysis with personalized training recommendations.
        </p>
        
        <button 
          className="button" 
          onClick={handleGenerateCoach} 
          disabled={loading}
        >
          {loading ? 'Generating deep analysis…' : 'Generate Elite Coaching Report'}
        </button>
        
        {error && <p className="error-message">{error}</p>}
        
        {coachReport && (
          <div className="deep-coach-report">
            {/* Executive Summary */}
            <div className="report-section executive">
              <h4>Executive Summary</h4>
              <p className="executive-text">{coachReport.report.executive_summary}</p>
              <div className="trajectory-badge">
                <span className={`trajectory ${coachReport.report.performance_trajectory}`}>
                  {coachReport.report.performance_trajectory.toUpperCase()}
                </span>
              </div>
            </div>
            
            {/* Overall Assessment */}
            <div className="report-section">
              <h4>Overall Assessment</h4>
              <p>{coachReport.report.overall_assessment}</p>
            </div>
            
            {/* Phase Analyses */}
            <div className="report-section">
              <h4>Phase-by-Phase Analysis</h4>
              <div className="phase-analyses">
                {coachReport.report.phase_analyses.map((phase) => (
                  <div key={phase.phase} className={`phase-analysis-card ${phase.phase}`}>
                    <h5>{phase.phase.charAt(0).toUpperCase() + phase.phase.slice(1)}</h5>
                    <p>{phase.performance_summary}</p>
                    {phase.weaknesses.length > 0 && (
                      <div className="phase-section">
                        <strong>Weaknesses:</strong>
                        <ul>{phase.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    )}
                    {phase.strengths.length > 0 && (
                      <div className="phase-section">
                        <strong>Strengths:</strong>
                        <ul>{phase.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    )}
                    {phase.training_focus.length > 0 && (
                      <div className="phase-section">
                        <strong>Focus Areas:</strong>
                        <ul>{phase.training_focus.map((f, i) => <li key={i}>{f}</li>)}</ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            {/* Training Priorities */}
            {coachReport.report.training_priorities.length > 0 && (
              <div className="report-section">
                <h4>Training Priorities</h4>
                <div className="priorities-list">
                  {coachReport.report.training_priorities.map((priority, i) => (
                    <div key={i} className={`priority-card ${priority.urgency}`}>
                      <div className="priority-header">
                        <strong>{priority.title}</strong>
                        <span className={`urgency-badge ${priority.urgency}`}>{priority.urgency}</span>
                      </div>
                      <p>{priority.description}</p>
                      {priority.specific_exercises.length > 0 && (
                        <div className="exercises">
                          <strong>Exercises:</strong>
                          <ul>{priority.specific_exercises.map((e, j) => <li key={j}>{e}</li>)}</ul>
                        </div>
                      )}
                      {priority.evidence_game_ids.length > 0 && (
                        <div className="evidence">
                          Evidence: Games {priority.evidence_game_ids.map((id, j) => (
                            <Link key={id} href={`/games/${id}`} className="link">
                              #{id}{j < priority.evidence_game_ids.length - 1 ? ', ' : ''}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Game Insights */}
            {coachReport.report.game_insights.length > 0 && (
              <div className="report-section">
                <h4>Key Game Lessons</h4>
                <div className="game-insights-list">
                  {coachReport.report.game_insights.map((insight) => (
                    <div key={insight.game_id} className="game-insight-card">
                      <Link href={`/games/${insight.game_id}`} className="insight-game-link">
                        Game #{insight.game_id}
                      </Link>
                      <strong>{insight.headline}</strong>
                      <p>{insight.key_lesson}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Action Plans */}
            <div className="report-section action-plans">
              <h4>Action Plan</h4>
              <div className="plans-grid">
                <div className="plan-card immediate">
                  <h5>This Week</h5>
                  <ul>{coachReport.report.immediate_focus.map((f, i) => <li key={i}>{f}</li>)}</ul>
                </div>
                <div className="plan-card short-term">
                  <h5>Next 2-4 Weeks</h5>
                  <ul>{coachReport.report.short_term_plan.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
                <div className="plan-card long-term">
                  <h5>Next 3-6 Months</h5>
                  <ul>{coachReport.report.long_term_development.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
              </div>
            </div>
            
            {/* Recurring Patterns */}
            {coachReport.report.recurring_patterns.length > 0 && (
              <div className="report-section">
                <h4>Recurring Patterns</h4>
                <ul className="patterns-list">
                  {coachReport.report.recurring_patterns.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            
            {/* Limitations */}
            {coachReport.report.limitations.length > 0 && (
              <div className="report-section limitations">
                <h4>Limitations</h4>
                <ul className="muted">
                  {coachReport.report.limitations.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <style jsx>{`
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 16px;
          margin-top: 16px;
        }
        .stat-card {
          padding: 16px;
          border-radius: 12px;
          background: #fff;
          border: 1px solid var(--border);
          text-align: center;
        }
        .stat-card.primary { border-left: 4px solid var(--accent); }
        .stat-card.success { border-left: 4px solid #2d6a4f; }
        .stat-card.warning { border-left: 4px solid #c8553d; }
        .stat-label {
          display: block;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
        }
        .stat-value {
          display: block;
          font-size: 2rem;
          font-weight: 600;
          margin: 8px 0;
        }
        .stat-detail {
          font-size: 0.8rem;
          color: var(--muted);
        }
        .win-good { color: #2d6a4f; }
        .win-ok { color: #3a7ca5; }
        .win-bad { color: #c8553d; }
        .cpl-good { color: #2d6a4f; }
        .cpl-ok { color: #3a7ca5; }
        .cpl-bad { color: #c8553d; }
        
        .signals-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
          margin-top: 16px;
        }
        .signals-column h4 {
          margin-bottom: 12px;
        }
        .signal-card {
          padding: 12px 16px;
          border-radius: 10px;
          margin-bottom: 10px;
        }
        .signal-card.improvement {
          background: rgba(45, 106, 79, 0.1);
          border: 1px solid rgba(45, 106, 79, 0.3);
        }
        .signal-card.regression {
          background: rgba(200, 85, 61, 0.1);
          border: 1px solid rgba(200, 85, 61, 0.3);
        }
        .signal-type {
          font-weight: 600;
          text-transform: uppercase;
          font-size: 0.7rem;
          letter-spacing: 0.05em;
        }
        .signal-games {
          font-size: 0.85rem;
          margin-top: 8px;
        }
        
        .phase-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-top: 16px;
        }
        .phase-card {
          padding: 16px;
          border-radius: 12px;
          background: #fff;
          border: 1px solid var(--border);
        }
        .phase-card.opening { border-top: 4px solid #3a7ca5; }
        .phase-card.middlegame { border-top: 4px solid #e09f3e; }
        .phase-card.endgame { border-top: 4px solid #2d6a4f; }
        .phase-card h4 {
          margin: 0 0 12px;
        }
        .phase-stats {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .phase-stat {
          display: flex;
          justify-content: space-between;
        }
        .phase-stat .label {
          color: var(--muted);
          font-size: 0.85rem;
        }
        .phase-stat .value {
          font-weight: 600;
        }
        .phase-breakdown {
          display: flex;
          gap: 12px;
          margin-top: 12px;
          font-size: 0.8rem;
        }
        .phase-breakdown .blunder { color: #9e2a2b; }
        .phase-breakdown .mistake { color: #c8553d; }
        .phase-links {
          display: flex;
          gap: 12px;
        }
        
        .opening-summary {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 12px;
        }
        .opening-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .opening-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .opening-stats {
          display: flex;
          gap: 16px;
          font-size: 0.9rem;
        }
        
        .time-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-top: 16px;
        }
        .time-stat {
          text-align: center;
          padding: 16px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 10px;
        }
        .time-stat .label {
          display: block;
          font-size: 0.75rem;
          color: var(--muted);
          text-transform: uppercase;
        }
        .time-stat .value {
          display: block;
          font-size: 1.5rem;
          font-weight: 600;
          margin-top: 6px;
        }
        .tt-good { color: #2d6a4f; }
        .tt-warning { color: #e09f3e; }
        .tt-bad { color: #c8553d; }
        
        .games-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 16px;
          max-height: 400px;
          overflow-y: auto;
        }
        .game-row {
          display: grid;
          grid-template-columns: 1fr 1fr auto;
          gap: 16px;
          align-items: center;
          padding: 12px 16px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 10px;
          border-left: 4px solid transparent;
        }
        .game-row.win { border-left-color: #2d6a4f; }
        .game-row.loss { border-left-color: #c8553d; }
        .game-row.draw { border-left-color: #3a7ca5; }
        .game-main {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .game-result {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .result-badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: 600;
        }
        .result-badge.win { background: #d4edda; color: #155724; }
        .result-badge.loss { background: #f8d7da; color: #721c24; }
        .result-badge.draw { background: #d1ecf1; color: #0c5460; }
        .game-id { font-size: 0.8rem; color: var(--muted); }
        .game-info {
          display: flex;
          gap: 16px;
          font-size: 0.85rem;
        }
        .opponent { font-weight: 500; }
        .opening-name { color: var(--muted); }
        .game-stats {
          display: flex;
          flex-direction: column;
          gap: 4px;
          text-align: right;
        }
        .game-stats .cpl { font-weight: 600; }
        .game-stats .errors { font-size: 0.85rem; }
        .game-stats .blunder { color: #9e2a2b; }
        .game-stats .mistake { color: #c8553d; }
        .game-stats .excellent { color: #2d6a4f; }
        .time-trouble-indicator {
          font-size: 0.75rem;
          color: var(--accent);
        }
        .game-link {
          color: var(--accent-dark);
          text-decoration: underline;
          font-size: 0.9rem;
        }
        
        .error-message {
          color: #c8553d;
          margin-top: 12px;
        }
        
        .deep-coach-report {
          margin-top: 24px;
        }
        .report-section {
          padding: 16px 20px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          margin-bottom: 16px;
        }
        .report-section h4 {
          margin: 0 0 12px;
          color: var(--accent-dark);
        }
        .report-section.executive {
          background: linear-gradient(135deg, rgba(178, 75, 50, 0.05), rgba(255, 249, 240, 0.9));
        }
        .executive-text {
          font-size: 1.1rem;
          line-height: 1.6;
        }
        .trajectory-badge {
          margin-top: 12px;
        }
        .trajectory {
          display: inline-block;
          padding: 6px 14px;
          border-radius: 999px;
          font-weight: 600;
          font-size: 0.8rem;
        }
        .trajectory.improving { background: #d4edda; color: #155724; }
        .trajectory.declining { background: #f8d7da; color: #721c24; }
        .trajectory.stable { background: #d1ecf1; color: #0c5460; }
        .trajectory.inconsistent { background: #fff3cd; color: #856404; }
        
        .phase-analyses {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 16px;
        }
        .phase-analysis-card {
          padding: 16px;
          border-radius: 10px;
          border: 1px solid var(--border);
        }
        .phase-analysis-card.opening { border-left: 4px solid #3a7ca5; }
        .phase-analysis-card.middlegame { border-left: 4px solid #e09f3e; }
        .phase-analysis-card.endgame { border-left: 4px solid #2d6a4f; }
        .phase-analysis-card h5 {
          margin: 0 0 8px;
        }
        .phase-section {
          margin-top: 10px;
          font-size: 0.9rem;
        }
        .phase-section ul {
          margin: 4px 0 0 16px;
          padding: 0;
        }
        
        .priorities-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .priority-card {
          padding: 14px 18px;
          border-radius: 10px;
          border: 1px solid var(--border);
        }
        .priority-card.critical { border-left: 4px solid #9e2a2b; background: rgba(158, 42, 43, 0.05); }
        .priority-card.high { border-left: 4px solid #c8553d; background: rgba(200, 85, 61, 0.05); }
        .priority-card.medium { border-left: 4px solid #e09f3e; background: rgba(224, 159, 62, 0.05); }
        .priority-card.low { border-left: 4px solid #3a7ca5; }
        .priority-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .urgency-badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
        }
        .urgency-badge.critical { background: #f8d7da; color: #721c24; }
        .urgency-badge.high { background: #f8d7da; color: #721c24; }
        .urgency-badge.medium { background: #fff3cd; color: #856404; }
        .urgency-badge.low { background: #d1ecf1; color: #0c5460; }
        .exercises, .evidence {
          margin-top: 10px;
          font-size: 0.9rem;
        }
        .exercises ul {
          margin: 4px 0 0 16px;
          padding: 0;
        }
        
        .game-insights-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 12px;
        }
        .game-insight-card {
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
        }
        .insight-game-link {
          display: block;
          font-size: 0.75rem;
          color: var(--accent);
          margin-bottom: 4px;
        }
        
        .plans-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .plan-card {
          padding: 16px;
          border-radius: 10px;
          border: 1px solid var(--border);
        }
        .plan-card.immediate { border-top: 3px solid #c8553d; }
        .plan-card.short-term { border-top: 3px solid #e09f3e; }
        .plan-card.long-term { border-top: 3px solid #2d6a4f; }
        .plan-card h5 {
          margin: 0 0 10px;
        }
        .plan-card ul {
          margin: 0;
          padding-left: 18px;
        }
        
        .patterns-list {
          margin: 0;
          padding-left: 18px;
        }
        
        .limitations {
          background: #f8f8f8;
        }
        
        @media (max-width: 960px) {
          .phase-grid, .time-summary-grid, .plans-grid {
            grid-template-columns: 1fr;
          }
          .game-row {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .game-stats {
            text-align: left;
          }
        }
      `}</style>
    </>
  );
}

function getWinRateClass(winRate: number): string {
  if (winRate >= 0.55) return 'win-good';
  if (winRate >= 0.4) return 'win-ok';
  return 'win-bad';
}

function getCplClass(cpl: number | null): string {
  if (cpl === null) return '';
  if (cpl <= 15) return 'cpl-good';
  if (cpl <= 30) return 'cpl-ok';
  return 'cpl-bad';
}

function getTimeTroubleClass(rate: number): string {
  if (rate <= 0.2) return 'tt-good';
  if (rate <= 0.4) return 'tt-warning';
  return 'tt-bad';
}

