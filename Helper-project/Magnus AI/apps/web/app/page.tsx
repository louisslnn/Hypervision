import { cookies } from 'next/headers';

import { HealthPanel } from '../components/HealthPanel';
import { fetchHealth } from '../lib/api';
import { USERNAME_COOKIE, decodeCookieValue } from '../lib/preferences';

export default async function Home() {
  const cookieStore = cookies();
  const usernameCookie = cookieStore.get(USERNAME_COOKIE)?.value;
  const username = decodeCookieValue(usernameCookie);
  let health = null;
  let error = null;

  try {
    health = await fetchHealth();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach API';
  }

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>Magnus AI</h1>
          <p>
            Local-first chess coaching for post-game review. Sync finished games, analyze with your
            local engine, and get grounded feedback with traceable evidence.
          </p>
          {username ? (
            <p className="muted">Personalized for {username}.</p>
          ) : (
            <p className="muted">
              Add your Chess.com username in <a className="link" href="/settings">Settings</a> to
              personalize your dashboard.
            </p>
          )}
          <div className="hero-actions">
            <a className="button" href="/games">
              Review games
            </a>
            <a className="button secondary" href="/insights">
              View insights
            </a>
          </div>
        </div>
        <div className="hero-panel">
          <div className="hero-stat">
            <span className="label">Mode</span>
            <span className="value">Post-game only</span>
          </div>
          <div className="hero-stat">
            <span className="label">Engine</span>
            <span className="value">Stockfish local</span>
          </div>
          <div className="hero-stat">
            <span className="label">Coach</span>
            <span className="value">Structured outputs</span>
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <strong>API health</strong>
          <p>Verify the backend and database connection.</p>
          <HealthPanel health={health} error={error} />
        </div>
        <div className="card">
          <strong>Active player</strong>
          <p>{username ? `Viewing ${username}` : 'No player selected yet.'}</p>
          <p className="muted">
            Set your Chess.com username in settings to scope games, insights, and reports.
          </p>
        </div>
        <div className="card">
          <strong>Next up</strong>
          <p>Sync your finished games and run the first analysis pass.</p>
          <p className="muted">
            Remember: the app is strictly post-game and not meant for live assistance.
          </p>
        </div>
      </section>
    </div>
  );
}
