import Link from 'next/link';
import { cookies } from 'next/headers';

import { OpeningsClient } from '../../components/OpeningsClient';
import { fetchDeepInsightsData } from '../../lib/api';
import { USERNAME_COOKIE, decodeCookieValue } from '../../lib/preferences';

function getParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function OpeningsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const cookieStore = cookies();
  const usernameCookie = cookieStore.get(USERNAME_COOKIE)?.value;
  const savedUsername = decodeCookieValue(usernameCookie);
  const username = getParam(searchParams.username) ?? savedUsername;
  const gameLimitRaw = getParam(searchParams.game_limit);
  const gameLimit = gameLimitRaw && !Number.isNaN(Number(gameLimitRaw)) 
    ? Math.min(Math.max(Number(gameLimitRaw), 1), 25) 
    : 10;

  let insightsData = null;
  let error = null;

  if (username) {
    try {
      insightsData = await fetchDeepInsightsData(username, gameLimit);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unable to load opening data.';
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h1>Opening Repertoire</h1>
          <p>Elite-level opening analysis with performance metrics and recommendations.</p>
        </div>
      </section>

      <section className="card">
        <form className="filters" method="get">
          <div className="field full">
            <strong>Player</strong>
            <p className="muted">
              Analyzing openings for <strong>{username ?? '—'}</strong>. Update this in{' '}
              <Link className="link" href="/settings">
                Settings
              </Link>
              .
            </p>
          </div>
          <div className="field">
            <label htmlFor="game_limit">Games to analyze</label>
            <select id="game_limit" name="game_limit" defaultValue={gameLimit}>
              <option value="5">Last 5 games</option>
              <option value="10">Last 10 games</option>
              <option value="15">Last 15 games</option>
              <option value="20">Last 20 games</option>
              <option value="25">Last 25 games</option>
            </select>
          </div>
          <div className="field full">
            <button className="button" type="submit">
              Analyze openings
            </button>
          </div>
        </form>
      </section>

      {!username ? (
        <section className="card">
          <h3>Get started</h3>
          <p className="muted">Set your Chess.com username in settings to analyze your openings.</p>
          <Link className="button" href="/settings">
            Go to settings
          </Link>
        </section>
      ) : error ? (
        <section className="card">
          <h3>Unable to load opening data</h3>
          <p className="muted">{error}</p>
        </section>
      ) : insightsData ? (
        <OpeningsClient 
          username={username} 
          gameLimit={gameLimit}
          openingAnalyses={insightsData.opening_analyses}
          gameAnalyses={insightsData.game_analyses}
          phaseTrends={insightsData.phase_trends}
        />
      ) : null}
    </div>
  );
}
