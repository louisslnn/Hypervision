import Link from 'next/link';
import { cookies } from 'next/headers';

import { fetchGames } from '../../lib/api';
import { ANON_COOKIE, USERNAME_COOKIE, decodeCookieValue } from '../../lib/preferences';

function getParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const cookieStore = cookies();
  const anonymizeCookie = cookieStore.get(ANON_COOKIE)?.value;
  const usernameCookie = cookieStore.get(USERNAME_COOKIE)?.value;
  const savedUsername = decodeCookieValue(usernameCookie);
  const anonymizeParam =
    getParam(searchParams.anonymize) ?? (anonymizeCookie === 'true' ? 'true' : undefined);
  const username = getParam(searchParams.username) ?? savedUsername;
  if (!username) {
    return (
      <div className="page">
        <section className="page-header">
          <div>
            <h1>Games</h1>
            <p>Set your Chess.com username once and your games will load automatically.</p>
          </div>
        </section>
        <section className="card">
          <p className="muted">
            No player is saved yet. Visit settings to connect your Chess.com account.
          </p>
          <Link className="button" href="/settings">
            Go to settings
          </Link>
        </section>
      </div>
    );
  }

  const query = {
    username,
    time_class: getParam(searchParams.time_class),
    result: getParam(searchParams.result),
    color: getParam(searchParams.color),
    opening: getParam(searchParams.opening),
    opponent_rating_min: getParam(searchParams.opponent_rating_min),
    opponent_rating_max: getParam(searchParams.opponent_rating_max),
    date_from: getParam(searchParams.date_from),
    date_to: getParam(searchParams.date_to),
    limit: getParam(searchParams.limit) ?? '100',
    anonymize: anonymizeParam,
  };

  const games = await fetchGames(query);
  const normalizedUsername = username?.trim().toLowerCase();
  const reviewParams = new URLSearchParams();
  if (query.anonymize) {
    reviewParams.set('anonymize', query.anonymize);
  }
  const reviewSuffix = reviewParams.toString() ? `?${reviewParams.toString()}` : '';
  const hasFilters = Boolean(
    query.time_class ||
      query.result ||
      query.color ||
      query.opening ||
      query.opponent_rating_min ||
      query.opponent_rating_max ||
      query.date_from ||
      query.date_to
  );
  const clearParams = new URLSearchParams();
  if (!savedUsername && username) {
    clearParams.set('username', username);
  }
  if (query.anonymize) {
    clearParams.set('anonymize', query.anonymize);
  }
  const clearHref = clearParams.toString() ? `/games?${clearParams.toString()}` : '/games';

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h1>Games</h1>
          <p>Filter your finished games and jump into a deep review.</p>
        </div>
      </section>

      <section className="card">
        <form className="filters" method="get">
          <div className="field full">
            <strong>Player</strong>
            <p className="muted">
              Viewing games for <strong>{username}</strong>. Update this in{' '}
              <Link className="link" href="/settings">
                Settings
              </Link>
              .
            </p>
          </div>
          <div className="field">
            <label htmlFor="time_class">Time class</label>
            <select id="time_class" name="time_class" defaultValue={query.time_class ?? ''}>
              <option value="">All</option>
              <option value="bullet">Bullet</option>
              <option value="blitz">Blitz</option>
              <option value="rapid">Rapid</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="color">Color</label>
            <select id="color" name="color" defaultValue={query.color ?? ''}>
              <option value="">Any</option>
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="result">Result</label>
            <select id="result" name="result" defaultValue={query.result ?? ''}>
              <option value="">Any</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="draw">Draw</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="opening">Opening</label>
            <input id="opening" name="opening" defaultValue={query.opening} placeholder="ECO or name" />
          </div>
          <div className="field">
            <label htmlFor="opponent_rating_min">Opp rating min</label>
            <input
              id="opponent_rating_min"
              name="opponent_rating_min"
              defaultValue={query.opponent_rating_min}
              inputMode="numeric"
            />
          </div>
          <div className="field">
            <label htmlFor="opponent_rating_max">Opp rating max</label>
            <input
              id="opponent_rating_max"
              name="opponent_rating_max"
              defaultValue={query.opponent_rating_max}
              inputMode="numeric"
            />
          </div>
          <div className="field">
            <label htmlFor="date_from">From</label>
            <input id="date_from" name="date_from" defaultValue={query.date_from} placeholder="2024-01-01" />
          </div>
          <div className="field">
            <label htmlFor="date_to">To</label>
            <input id="date_to" name="date_to" defaultValue={query.date_to} placeholder="2024-02-01" />
          </div>
          <div className="field">
            <label htmlFor="limit">Limit</label>
            <input id="limit" name="limit" defaultValue={query.limit} inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="anonymize">Anonymize opponents</label>
            <input
              id="anonymize"
              name="anonymize"
              type="checkbox"
              value="true"
              defaultChecked={query.anonymize === 'true'}
            />
          </div>
          <div className="field full">
            <button className="button" type="submit">
              Apply filters
            </button>
          </div>
        </form>
        <p className="muted">
          Filters apply to {username}. Adjust the player in settings to switch accounts.
        </p>
      </section>

      <section className="card">
        <div className="table-header">
          <span>Opponent</span>
          <span>Result</span>
          <span>Time</span>
          <span>Opening</span>
          <span>Class</span>
          <span></span>
        </div>
        {games.length === 0 ? (
          <div className="empty-state">
            <p className="muted">No games found. Try adjusting filters.</p>
            {hasFilters ? (
              <Link className="link" href={clearHref}>
                Clear filters
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="table-body">
            {games.map((game) => {
              const whiteName = game.white_username ?? undefined;
              const blackName = game.black_username ?? undefined;
              const whiteIsPlayer =
                normalizedUsername && whiteName
                  ? whiteName.toLowerCase() === normalizedUsername
                  : false;
              const blackIsPlayer =
                normalizedUsername && blackName
                  ? blackName.toLowerCase() === normalizedUsername
                  : false;
              const opponent = normalizedUsername
                ? whiteIsPlayer
                  ? blackName
                  : blackIsPlayer
                    ? whiteName
                    : blackName ?? whiteName
                : `${whiteName ?? 'White'} vs ${blackName ?? 'Black'}`;
              const result = normalizedUsername
                ? whiteIsPlayer
                  ? game.result_white
                  : blackIsPlayer
                    ? game.result_black
                    : game.result_white
                : game.result_white;
              const timeControl = game.time_control ?? game.time_class ?? 'unknown';
              return (
                <div key={game.id} className="table-row">
                  <span>{opponent ?? 'Unknown'}</span>
                  <span className="pill">{result ?? 'n/a'}</span>
                  <span>{timeControl}</span>
                  <span className="muted">{game.eco_url?.split('/').slice(-1)[0] ?? '—'}</span>
                  <span>{game.time_class ?? 'n/a'}</span>
                  <Link className="link" href={`/games/${game.id}${reviewSuffix}`}>
                    Review
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
