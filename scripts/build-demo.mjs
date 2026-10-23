// Builds the GitHub Pages site: the landing page (site/index.html) at the root and the real board on demo data at /demo/.
// One source: web/index.html is copied verbatim, then the demo seed and the
// demo shim are added only in this build. The local server never serves them.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const demo = join(web, 'demo');
const site = resolve(process.argv.flatMap((a, i) => (a === '--out' ? [process.argv[i + 1]] : [])).at(-1) ?? join(root, 'demo-dist'));
const out = join(site, 'demo');

const page = readFileSync(join(web, 'index.html'), 'utf8');
if (/SIGN_OFF_DEMO/.test(page)) throw new Error('web/index.html already contains demo hooks; the demo must be added only by this build');
const seed = JSON.parse(readFileSync(join(demo, 'seed.json'), 'utf8'));
const digest = createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 12);

mkdirSync(join(out, 'assets'), { recursive: true });
const files = {};
const add = (request, source, dest) => {
  const from = join(demo, source);
  if (!existsSync(from)) throw new Error(`demo asset missing: web/demo/${source}`);
  copyFileSync(from, join(out, dest));
  files[request] = `./${dest}`;
};
for (const d of seed.decisions) {
  for (const m of d.mocks ?? []) {
    const base = basename(m.path.split('?')[0]);
    add(`${seed.mockBase}${d.key}~${m.value}/${base}`, m.path, `assets/${d.key}-${m.value}-${base}`);
  }
  (d.media ?? []).forEach((m, i) => {
    const base = basename(m.path);
    add(`/api/media?key=${encodeURIComponent(d.key)}&i=${i}`, m.path, `assets/${d.key}-${i}-${base}`);
  });
}

const esc = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const marker = '<script>\n  let state = { decisions: [], answers: {} };';
if (!page.includes(marker)) throw new Error('web/index.html changed: demo injection marker not found');
const built = page.replace(marker, () => [
  `<script>window.SIGN_OFF_DEMO_SEED = ${esc(seed)}; window.SIGN_OFF_DEMO_FILES = ${esc(files)}; window.SIGN_OFF_DEMO_DIGEST = ${esc(digest)};</script>`,
  '<script src="./demo-shim.js"></script>',
  marker,
].join('\n'));
writeFileSync(join(out, 'index.html'), built);
copyFileSync(join(demo, 'shim.js'), join(out, 'demo-shim.js'));
for (const f of ['tokens.css', 'ui.css', 'inter.woff2', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'manifest.webmanifest']) copyFileSync(join(web, f), join(out, f));
// The landing page, with the pictures and icons it shows.
mkdirSync(join(site, 'media'), { recursive: true });
copyFileSync(join(root, 'site', 'index.html'), join(site, 'index.html'));
for (const f of ['icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'manifest.webmanifest']) copyFileSync(join(web, f), join(site, f));
for (const f of readdirSync(join(root, 'docs', 'media')).filter((n) => /^(phone|desk)-.*\.webp$/.test(n))) copyFileSync(join(root, 'docs', 'media', f), join(site, 'media', f));
console.log(`site: landing page and demo (${seed.decisions.length} items, ${Object.keys(files).length} files) -> ${site}`);
