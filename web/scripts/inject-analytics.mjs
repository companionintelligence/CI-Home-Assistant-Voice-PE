// Adds Google Analytics 4 (gtag.js) to every HTML page in public/.
//
// Runs in the deploy workflow just before `wrangler deploy`, with the measurement
// ID taken from the GA_MEASUREMENT_ID build value (repo variable of the same
// name). If it is unset or not shaped like G-XXXXXXXX, nothing is changed.
//
// The CSP in public/_headers only allows scripts from 'self' (plus
// googletagmanager.com), so the gtag setup lives in /ga-init.js instead of an
// inline <script>. Safe to run twice.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GA_ID_PATTERN = /^G-[A-Z0-9]+$/;
const MARKER = '<!-- ga4 -->';

export function isValidId(id) {
  return typeof id === 'string' && GA_ID_PATTERN.test(id);
}

export function initScript(id) {
  return `window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', '${id}');
`;
}

export function snippet(id) {
  return `  ${MARKER}
  <script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
  <script src="/ga-init.js"></script>
`;
}

export function injectHtml(html, id) {
  if (html.includes(MARKER) || !html.includes('</head>')) return html;
  return html.replace('</head>', () => `${snippet(id)}</head>`);
}

/** Returns the list of files written; empty when the ID is missing or invalid. */
export function inject(publicDir, id) {
  if (!isValidId(id)) return [];
  const written = [];
  for (const name of readdirSync(publicDir)) {
    if (!name.endsWith('.html')) continue;
    const file = join(publicDir, name);
    const before = readFileSync(file, 'utf8');
    const after = injectHtml(before, id);
    if (after !== before) {
      writeFileSync(file, after);
      written.push(file);
    }
  }
  writeFileSync(join(publicDir, 'ga-init.js'), initScript(id));
  written.push(join(publicDir, 'ga-init.js'));
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = (process.env.GA_MEASUREMENT_ID || '').trim();
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const files = inject(dir, id);
  console.log(files.length ? `GA4 enabled (${id}) in ${files.length} files` : 'GA4 skipped: GA_MEASUREMENT_ID unset or invalid');
}
