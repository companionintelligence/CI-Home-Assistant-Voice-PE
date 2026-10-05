import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject, isValidId } from '../scripts/inject-analytics.mjs';

function copyPublic() {
  const dir = mkdtempSync(join(tmpdir(), 'ga-'));
  cpSync(new URL('../public', import.meta.url), dir, { recursive: true });
  return dir;
}

test('rejects missing and malformed IDs', () => {
  for (const bad of [undefined, '', 'UA-123', 'g-abc', 'G-', 'G-ABC"><script>', 'G-ABC DEF']) {
    assert.equal(isValidId(bad), false, String(bad));
  }
  assert.equal(isValidId('G-TEST123'), true);
});

test('emits nothing without a valid ID', () => {
  const dir = copyPublic();
  assert.deepEqual(inject(dir, ''), []);
  assert.equal(existsSync(join(dir, 'ga-init.js')), false);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    assert.ok(!readFileSync(join(dir, f), 'utf8').includes('googletagmanager'));
  }
});

test('adds gtag.js to every page, once', () => {
  const dir = copyPublic();
  inject(dir, 'G-TEST123');
  inject(dir, 'G-TEST123');
  const pages = readdirSync(dir).filter((n) => n.endsWith('.html'));
  assert.ok(pages.length >= 2);
  for (const f of pages) {
    const html = readFileSync(join(dir, f), 'utf8');
    assert.equal(html.split('googletagmanager.com/gtag/js?id=G-TEST123').length, 2, f);
    assert.match(html, /<script async src="https:\/\/www\.googletagmanager\.com/);
  }
  assert.match(readFileSync(join(dir, 'ga-init.js'), 'utf8'), /gtag\('config', 'G-TEST123'\)/);
});

test('the init script is deferred and the markup stays idempotent', () => {
  const dir = copyPublic();
  inject(dir, 'G-TEST123');
  const once = readFileSync(join(dir, 'index.html'), 'utf8');
  inject(dir, 'G-TEST123');
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), once);
  assert.match(once, /<script defer src="\/ga-init\.js"><\/script>/);
  assert.equal(once.split('<!-- ga4 -->').length, 2);
});

test('outbound links send the origin as referrer, so ci.computer can see where visits come from', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.match(headers, /^\s+Referrer-Policy: strict-origin-when-cross-origin$/m);
});

test('CSP allows Google Analytics', () => {
  const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.match(csp, /script-src 'self' https:\/\/www\.googletagmanager\.com/);
  assert.match(csp, /img-src [^;]*google-analytics\.com/);
});
