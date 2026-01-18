'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  dataPurgeResponseSchema,
  syncRunSchema,
  type DataPurgeResponse,
  type SyncRun,
} from '@magnus/shared';

import { ANON_COOKIE, USERNAME_COOKIE, decodeCookieValue } from '../lib/preferences';

const DEFAULT_API_BASE_URL = 'http://localhost:8000';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const cookies = document.cookie.split(';').map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.split('=')[1] : null;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000`;
}

export function SettingsControls() {
  const [anonymize, setAnonymize] = useState(false);
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [purgeResult, setPurgeResult] = useState<DataPurgeResponse | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    [],
  );

  useEffect(() => {
    const current = readCookie(ANON_COOKIE);
    setAnonymize(current === 'true');
    const storedUsername = readCookie(USERNAME_COOKIE);
    const decoded = decodeCookieValue(storedUsername ?? undefined) ?? '';
    if (decoded) {
      setUsername(decoded);
      setSavedUsername(decoded);
    }
  }, []);

  const toggleAnonymize = (checked: boolean) => {
    setAnonymize(checked);
    writeCookie(ANON_COOKIE, checked ? 'true' : 'false');
  };

  const saveAndSync = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setSyncError('Enter a valid Chess.com username.');
      return;
    }
    setSyncing(true);
    setSyncError(null);
    setSyncRun(null);
    writeCookie(USERNAME_COOKIE, encodeURIComponent(trimmed));
    setSavedUsername(trimmed);
    try {
      const response = await fetch(`${apiBaseUrl}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed (${response.status})`);
      }
      const payload = syncRunSchema.parse(await response.json());
      setSyncRun(payload);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to sync games.');
    } finally {
      setSyncing(false);
    }
  };

  const purgeData = async () => {
    if (!window.confirm('This will delete all local data. Continue?')) {
      return;
    }
    setPurging(true);
    setPurgeError(null);
    setPurgeResult(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/data/purge`, { method: 'DELETE' });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed (${response.status})`);
      }
      const payload = dataPurgeResponseSchema.parse(await response.json());
      setPurgeResult(payload);
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : 'Unable to purge data.');
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="settings-grid">
      <section className="card">
        <h3>Player profile</h3>
        <p className="muted">
          Set your Chess.com username once and the app will automatically load your games and
          insights everywhere.
        </p>
        <div className="filters">
          <div className="field full">
            <label htmlFor="player-username">Chess.com username</label>
            <input
              id="player-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="infinitely_0"
              autoComplete="off"
            />
          </div>
          <div className="field full">
            <button className="button" type="button" onClick={saveAndSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Save & sync games'}
            </button>
          </div>
        </div>
        {savedUsername ? (
          <p className="muted">Active player: {savedUsername}</p>
        ) : (
          <p className="muted">No player saved yet.</p>
        )}
        {syncError ? <p className="muted">{syncError}</p> : null}
        {syncRun ? (
          <div className="panel">
            <strong>Latest sync</strong>
            <p className="muted">
              {syncRun.games_upserted} new · {syncRun.games_skipped} skipped ·{' '}
              {syncRun.months_fetched} months fetched
            </p>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h3>Privacy</h3>
        <div className="settings-row">
          <div>
            <strong>Anonymize opponents</strong>
            <p className="muted">Hash opponent usernames when browsing games.</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={anonymize}
              onChange={(event) => toggleAnonymize(event.target.checked)}
            />
            <span>{anonymize ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p className="muted">
          Applies to new pages immediately. Add `anonymize=true` to links to force it.
        </p>
      </section>

      <section className="card">
        <h3>Data management</h3>
        <p className="muted">Permanently delete all local games, moves, analysis, and reports.</p>
        <button className="button danger" type="button" onClick={purgeData} disabled={purging}>
          {purging ? 'Purging…' : 'Purge local data'}
        </button>
        {purgeError ? <p className="muted">{purgeError}</p> : null}
        {purgeResult ? (
          <div className="panel">
            <strong>Deleted rows</strong>
            <div className="grid">
              {Object.entries(purgeResult.deleted).map(([key, value]) => (
                <div key={key} className="panel">
                  <span className="label">{key}</span>
                  <p>{value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
