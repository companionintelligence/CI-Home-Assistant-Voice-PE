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
  const org = g.find((n) => n['@type'] === 'Organization');
  const app = g.find((n) => n['@type'] === 'SoftwareApplication');
  assert.equal(org.url, 'https://ci.computer');
  assert.match(org.logo, /^https:\/\//);
  assert.equal(app.url, 'https://ha.ci.computer/');
  assert.equal(app.image, 'https://ha.ci.computer/og.png');
  assert.deepEqual(app.publisher, { '@id': org['@id'] }, 'the publisher reference resolves inside the graph');
  assert.equal(app.description, read('index.html').match(/<meta name="description" content="([^"]+)">/)[1]);
});

test('the meta description fits a search result (about 155 characters)', () => {
  for (const f of pages) {
    const d = read(f).match(/<meta name="description" content="([^"]+)">/)[1];
    assert.ok(d.length >= 40 && d.length <= 158, `${f}: ${d.length} characters`);
  }
});

test('every page carries the same theme, color scheme and icon links', () => {
  for (const f of pages) {
    const h = read(f);
    assert.match(h, /<meta name="color-scheme" content="light dark">/, f);
    assert.match(h, /<meta name="theme-color" content="#041620">/, f);
    assert.match(h, /<link rel="icon" href="\/favicon\.ico" sizes="32x32">/, f);
    assert.match(h, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/, f);
    assert.match(h, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, f);
    assert.match(h, /<link rel="manifest" href="\/site\.webmanifest">/, f);
    assert.match(h, /property="og:image:width" content="1200"/, f);
    assert.match(h, /property="og:image:height" content="630"/, f);
    assert.match(h, /property="og:image:alt" content="[^"]{10,}"/, f);
  }
});

test('the web manifest and icons exist and are the sizes they claim', () => {
  const manifest = JSON.parse(read('site.webmanifest'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.theme_color, '#041620');
  assert.ok(manifest.name.length > 0 && manifest.short_name.length > 0);
  const png = manifest.icons.filter((i) => i.type === 'image/png');
  assert.deepEqual(png.map((i) => i.sizes).sort(), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const file = readFileSync(new URL(icon.src.slice(1), pub));
    if (icon.type === 'image/png') {
      const [w, h] = icon.sizes.split('x').map(Number);
      assert.equal(file.readUInt32BE(16), w, icon.src);
      assert.equal(file.readUInt32BE(20), h, icon.src);
    }
  }
  const ico = readFileSync(new URL('favicon.ico', pub));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'favicon.ico has an ICO header');
});

test('robots.txt points at the sitemap, which lists the canonical page', () => {
  assert.match(read('robots.txt'), /^Allow: \/$/m);
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/ha\.ci\.computer\/sitemap\.xml$/m);
  const x = read('sitemap.xml');
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(x, /<loc>https:\/\/ha\.ci\.computer\/<\/loc>/);
  assert.ok(!x.includes('404'));
});
