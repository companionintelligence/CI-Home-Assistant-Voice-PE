import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);
const read = (n) => readFileSync(new URL(n, pub), 'utf8');
const pages = readdirSync(pub).filter((n) => n.endsWith('.html'));

test('every page has description, Open Graph and Twitter tags, once', () => {
  for (const f of pages) {
    const h = read(f);
    for (const re of [/<meta name="description" content="[^"]{40,}">/, /property="og:title"/, /property="og:description"/, /property="og:type"/, /property="og:url" content="https:\/\/ha\.ci\.computer\//, /property="og:site_name" content="Companion Intelligence"/, /property="og:image" content="https:\/\/ha\.ci\.computer\/og\.png"/, /name="twitter:card" content="summary_large_image"/, /name="twitter:title"/, /name="twitter:description"/, /name="twitter:image" content="https:\/\/ha\.ci\.computer\/og\.png"/]) {
      assert.equal(h.match(new RegExp(re.source, 'g'))?.length, 1, `${f}: ${re}`);
    }
  }
});

test('indexable pages have a single absolute canonical; the 404 is noindex', () => {
  const h = read('index.html');
  assert.equal(h.match(/<link rel="canonical"/g).length, 1);
  assert.match(h, /<link rel="canonical" href="https:\/\/ha\.ci\.computer\/">/);
  assert.match(read('404.html'), /<meta name="robots" content="noindex">/);
});

test('og.png stays 1200x630 and under 300KB', () => {
  const b = readFileSync(new URL('og.png', pub));
  assert.ok(b.length < 300 * 1024);
  assert.equal(b.readUInt32BE(16), 1200);
  assert.equal(b.readUInt32BE(20), 630);
});

test('JSON-LD parses and names the organization and the app', () => {
  const m = read('index.html').match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  const g = JSON.parse(m[1])['@graph'];
  assert.equal(g.find((n) => n['@type'] === 'Organization').url, 'https://ci.computer');
  assert.equal(g.find((n) => n['@type'] === 'SoftwareApplication').url, 'https://ha.ci.computer/');
});

test('robots.txt points at the sitemap, which lists the canonical page', () => {
  assert.match(read('robots.txt'), /^Allow: \/$/m);
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/ha\.ci\.computer\/sitemap\.xml$/m);
  const x = read('sitemap.xml');
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(x, /<loc>https:\/\/ha\.ci\.computer\/<\/loc>/);
  assert.ok(!x.includes('404'));
});
