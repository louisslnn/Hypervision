import Link from 'next/link';
import { cookies } from 'next/headers';

import { DeepInsightsClient } from '../../components/DeepInsightsClient';
import { InsightsBulkActions } from '../../components/InsightsBulkActions';
import { fetchDeepInsightsData } from '../../lib/api';
import { USERNAME_COOKIE, decodeCookieValue } from '../../lib/preferences';

function getParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function InsightsPage({
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
      error = err instanceof Error ? err.message : 'Unable to load insights.';
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h1>Deep Insights</h1>
          <p>Elite-level analysis across your recent games with actionable training recommendations.</p>
        </div>
      </section>

      <section className="card">
        <form className="filters" method="get">
          <div className="field full">
            <strong>Player</strong>
            <p className="muted">
              Analyzing <strong>{username ?? '—'}</strong>. Update this in{' '}
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
              <option value="25">Last 25 games (max)</option>
            </select>
            <p className="muted" style={{ marginTop: '4px' }}>
              Limited to 25 games to control API costs.
            </p>
          </div>
          <div className="field full">
            <button className="button" type="submit">
              Load insights
            </button>
          </div>
        </form>
      </section>

      <InsightsBulkActions username={username ?? null} />

      {!username ? (
        <section className="card">
          <h3>Get started</h3>
          <p className="muted">Set your Chess.com username in settings to load deep insights.</p>
          <Link className="button" href="/settings">
            Go to settings
          </Link>
        </section>
      ) : error ? (
        <section className="card">
          <h3>Unable to load insights</h3>
          <p className="muted">{error}</p>
        </section>
      ) : insightsData ? (
        <DeepInsightsClient 
          username={username}
          gameLimit={gameLimit}
          data={insightsData}
        />
      ) : null}
    </div>
  );
}
