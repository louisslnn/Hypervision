import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (!key) continue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn(`Unable to read .env: ${err.message ?? err}`);
    }
  }
}

loadEnv();

const port = process.env.API_PORT || '8000';
const host = process.env.API_HOST || '0.0.0.0';

const args = [
  'app.main:app',
  '--reload',
  '--port',
  port,
  '--host',
  host,
  '--app-dir',
  'apps/api',
];

const child = spawn('uvicorn', args, { stdio: 'inherit', shell: true });

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
