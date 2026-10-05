// The setup site is one of several surfaces of Companion Intelligence. Every page
// links back to https://ci.computer, to where Companion Core is bought
// (https://ci.computer/core), to where Companion is downloaded
// (https://ci.computer/download) and to the matching guide in the docs. These
// tests read the pages as shipped, so a link that is dropped in an edit turns a
// test red. They also check that internal links and anchors resolve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);
const read = (name) => readFileSync(new URL(name, pub), 'utf8');
const pages = readdirSync(pub).filter((name) => name.endsWith('.html'));

const MAIN = 'https://ci.computer';
const BUY = 'https://ci.computer/core';
const DOWNLOAD = 'https://ci.computer/download';
const DOCS = 'https://docs.ci.computer/docs/apps-available/first-party-apps/home-assistant-voice-pe';
const PRIVACY = 'https://ci.computer/privacy-policy';

/** The first element of a tag name, from its opening tag to the matching close. */
function region(html, tag, hint = '') {
  const start = html.search(new RegExp(`<${tag}\\b[^>]*${hint}`));
  assert.notEqual(start, -1, `no <${tag}${hint}>`);
  const end = html.indexOf(`</${tag}>`, start);
  return html.slice(start, end + tag.length + 3);
}

function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    return { ...attrs, text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() };
  });
}

const hrefs = (html) => links(html).map((l) => l.href);

for (const page of pages) {
  const html = read(page);

  test(`${page}: the header links to ci.computer, the docs and the Buy callout`, () => {
    const header = region(html, 'header');
    const found = links(header);
    const parent = found.find((l) => l.class === 'parent');
    assert.equal(parent?.href, MAIN);
    assert.equal(parent?.text, 'Companion Intelligence');
    assert.equal(found.find((l) => l.class === 'brand')?.href, '/', 'Companion Voice still links to its own home');
    assert.equal(found.find((l) => l.text === 'Docs')?.href, DOCS);
    assert.equal(found.find((l) => l.class === 'nav-cta')?.href, BUY);
    assert.equal(found.find((l) => l.class === 'nav-cta')?.text, 'Buy Companion Core');
  });

  test(`${page}: a band with Buy Companion Core and Download Companion sits in the main content`, () => {
    const band = region(region(html, 'main'), 'section', ' class="getit"');
    const found = links(band);
    assert.deepEqual(
      found.map((l) => [l.text, l.href]),
      [
        ['Buy Companion Core', BUY],
        ['Download Companion', DOWNLOAD],
      ],
    );
    assert.match(found[0].class, /\bprimary\b/, 'Buy is the primary action of the band');
  });

  test(`${page}: the footer links back to ci.computer, the docs, Buy and Download, and to the privacy policy`, () => {
    const footer = region(html, 'footer');
    const found = hrefs(footer);
    for (const href of [MAIN, DOCS, BUY, DOWNLOAD, PRIVACY, 'https://ci.computer/hub']) {
      assert.ok(found.includes(href), `${page} footer has no link to ${href}`);
    }
    assert.match(footer, /Google Analytics/, 'the footer says the site uses Google Analytics');
  });

  test(`${page}: links to ci.computer open in the same tab and new tabs are safe`, () => {
    for (const link of links(html)) {
      if (/^https:\/\/(docs\.)?ci\.computer(\/|$)/.test(link.href)) {
        assert.equal(link.target, undefined, `${link.href} must not open a new tab`);
      }
      if (link.target === '_blank') {
        assert.match(link.rel ?? '', /\bnoopener\b/, `${link.href} opens a new tab without rel=noopener`);
      }
    }
  });

  test(`${page}: internal links point at files that exist`, () => {
    for (const href of hrefs(html)) {
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const path = href.split(/[?#]/)[0];
      if (path === '/') continue;
      assert.ok(existsSync(new URL(path.slice(1), pub)), `${page} links to ${href}, which is not in public/`);
    }
  });
}

test('index.html: ids are unique and every in-page anchor has a target', () => {
  const html = read('index.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate ids');
  for (const href of hrefs(html)) {
    if (href.startsWith('#')) assert.ok(ids.includes(href.slice(1)), `${href} has no target`);
  }
  assert.match(html, /<a class="skip" href="#main">/);
  assert.match(html, /<main id="main"/);
});

test('the Hub store link opens the app listing, never the retired /install route', () => {
  const html = read('index.html');
  const hub = links(html).filter((l) => l.href.startsWith('https://hub.ci.computer'));
  assert.deepEqual(hub.map((l) => l.href), ['https://hub.ci.computer/store/ci-ha-voice']);
  assert.equal(hub[0].target, '_blank');
  assert.ok(!read('config.js').includes('hub.ci.computer/install'));
  assert.ok(!/rolling out/i.test(html), 'the store listing is live; the page must not say it is rolling out');
  assert.match(html, /0\.2\.41 or newer/);
});

test('index.html: the Download callout sits in the Hub path, and Home Assistant links keep the wizard open', () => {
  const html = read('index.html');
  const hubStep = region(html, 'li', ' data-step="hub-install"');
  assert.ok(hrefs(hubStep).includes(DOWNLOAD));
  for (const link of links(html).filter((l) => l.href.startsWith('https://my.home-assistant.io/'))) {
    assert.equal(link.target, '_blank', link.href);
    assert.match(link.rel, /\bnoopener\b/, link.href);
  }
});

test('index.html: every Done checkbox names its step, and only the counter is a live region', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/<li class="step" data-step="([^"]+)"[^>]*>\s*<div class="step-head">\s*<h3>([\s\S]*?)<\/h3>[\s\S]*?<input type="checkbox" data-done="([^"]+)"([^>]*)>/g)) {
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(' Optional', '').trim();
    assert.equal(m[1], m[3]);
    const label = m[4].match(/aria-label="([^"]+)"/)?.[1];
    assert.ok(label && label.replaceAll('&quot;', '"').includes(title), `step ${m[1]}: aria-label ${label}`);
  }
  assert.match(html, /<span id="progress-text" aria-live="polite">/);
  assert.ok(!/<div class="progress"[^>]*aria-live/.test(html), 'the Start over button must not sit inside a live region');
  for (const id of ['env-output', 'cmd-output', 'curl-output']) {
    assert.match(html, new RegExp(`id="${id}" tabindex="0" role="region" aria-label="[^"]+"`), id);
  }
  assert.match(html, /<noscript>/);
});

test('index.html: privacy claims are qualified and the license line links the license', () => {
  const html = read('index.html');
  assert.match(html, /in the recommended setup keeps every word inside your home/);
  assert.match(html, /openai:<\/code> sends your questions/);
  assert.ok(!/about fifteen minutes|About 15 minutes/i.test(html), 'no unsupported time claim');
  assert.ok(hrefs(html).includes('https://polyformproject.org/licenses/noncommercial/1.0.0'));
  assert.ok(hrefs(html).includes('mailto:support@companionintelligence.com'));
});
