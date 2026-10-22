/** Local-only cookie importer. Does not log in, accept passwords, or disable 2FA. */
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL, URLSearchParams } from 'node:url';

export function saveSession(path, values) {
  const cookies = ['SESSION', 'SIGNATURE'].map((key) => {
    const value = values[key];
    if (typeof value !== 'string' || value.length < 4 || value === '...'
        || value.length > 4096 || !/^[A-Za-z0-9._~%+/:=-]+$/.test(value)) {
      throw new Error('INVALID_COOKIE');
    }
    return `${key}=${value}\n`;
  });
  // Exclusive creation prevents clobbering existing credentials or following symlinks.
  writeFileSync(path, cookies.join(''), { flag: 'wx', mode: 0o600 });
}

export function createSessionServer(path) {
  const key = randomBytes(24).toString('hex');
  let origin;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // no-referrer makes browsers send Origin:null on form POSTs.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const target = new URL(req.url, origin);
    if (req.headers.host !== new URL(origin).host || target.pathname !== '/' || target.searchParams.get('key') !== key) {
      res.writeHead(403).end('Invalid setup link.'); return;
    }
    if (req.method === 'GET') {
      res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>TradingView session import</title><body><h1>TradingView session import</h1><p>Keep 2FA enabled. Sign in normally in Firefox, then use Cookie-Editor on tradingview.com to copy these two cookie values. This form saves them locally; it does not send them to GitHub.</p><form method="POST"><label>sessionid <input name="SESSION" type="password" autocomplete="off" required></label><br><label>sessionid_sign <input name="SIGNATURE" type="password" autocomplete="off" required></label><br><button>Save local session</button></form><p>Do not enter your account password. Existing credential files are never overwritten.</p></body></html>');
      return;
    }
    if (req.method !== 'POST' || req.headers.origin !== origin) { res.writeHead(403).end('Origin rejected.'); return; }
    if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) { res.writeHead(415).end('Form required.'); return; }
    let body = ''; let oversized = false;
    req.setEncoding('utf8');
    req.on('data', (part) => {
      if (oversized) return;
      body += part;
      if (body.length > 16384) { oversized = true; body = ''; res.writeHead(413).end('Form too large.'); }
    });
    req.on('end', () => {
      if (oversized) return;
      const values = new URLSearchParams(body);
      try {
        saveSession(path, { SESSION: values.get('SESSION'), SIGNATURE: values.get('SIGNATURE') });
        body = '';
        res.end('Session saved locally. Close this tab. Authentication will be checked separately.');
      } catch (error) {
        // Never reflect cookies, filesystem error text, or account response payloads.
        res.writeHead(error?.code === 'EEXIST' ? 409 : 400).end(error?.code === 'EEXIST'
          ? 'A credential file already exists; nothing was overwritten.' : 'Invalid cookie values; nothing was saved.');
      }
    });
  });
  server.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; });
  return { server, get url() { return `${origin}/?key=${key}`; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const setup = createSessionServer(resolve('.env'));
  setup.server.on('listening', () => console.log(`Open on this device: ${setup.url}`));
  const timer = setTimeout(() => { setup.server.closeAllConnections(); setup.server.close(); }, 15 * 60_000);
  timer.unref();
}
