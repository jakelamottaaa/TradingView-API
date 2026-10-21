import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { URLSearchParams } from 'node:url';
/* global fetch */
const api = await import('../scripts/dtc-session.mjs');

test('session import stores only cookies, restricts permissions and refuses overwrite', () => {
  assert.equal(typeof api.saveSession, 'function');
  const root = mkdtempSync(join(tmpdir(), 'tv-session-test-'));
  try {
    const path = join(root, '.env');
    api.saveSession(path, { SESSION: 'fictional-session', SIGNATURE: 'fictional-signature', PASSWORD: 'never-store' });
    const saved = readFileSync(path, 'utf8');
    assert.equal(saved, 'SESSION=fictional-session\nSIGNATURE=fictional-signature\n');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() => api.saveSession(path, { SESSION: 'replacement', SIGNATURE: 'replacement' }));
    assert.equal(readFileSync(path, 'utf8'), saved);
  } finally { rmSync(root, { recursive: true }); }
});

test('cookie validation rejects empty values and environment injection before writing', () => {
  assert.equal(typeof api.saveSession, 'function');
  const root = mkdtempSync(join(tmpdir(), 'tv-session-test-'));
  try {
    const path = join(root, '.env');
    for (const value of ['', 'x\nPASSWORD=secret', 'x;test', '...']) {
      assert.throws(() => api.saveSession(path, { SESSION: value, SIGNATURE: 'fictional' }));
      assert.equal(existsSync(path), false);
    }
  } finally { rmSync(root, { recursive: true }); }
});

test('local importer rejects cross-origin posts and accepts a valid one-time import', async () => {
  assert.equal(typeof api.createSessionServer, 'function');
  const root = mkdtempSync(join(tmpdir(), 'tv-session-test-'));
  const path = join(root, '.env');
  const setup = api.createSessionServer(path);
  await once(setup.server, 'listening');
  try {
    const origin = new URL(setup.url).origin;
    const body = new URLSearchParams({ SESSION: 'fictional-session', SIGNATURE: 'fictional-signature' });
    const blocked = await fetch(setup.url, { method: 'POST', headers: { origin: 'https://unrelated.example' }, body });
    assert.equal(blocked.status, 403);
    assert.equal(existsSync(path), false);
    const page = await fetch(setup.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    const allowed = await fetch(setup.url, { method: 'POST', headers: { origin }, body });
    assert.equal(allowed.status, 200);
    assert.doesNotMatch(await allowed.text(), /fictional-session|fictional-signature/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { setup.server.closeAllConnections(); await new Promise(r => setup.server.close(r)); rmSync(root, { recursive: true }); }
});
