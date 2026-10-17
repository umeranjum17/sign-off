// Builds the static demo site for GitHub Pages from the real board page.
// One source: web/index.html is copied verbatim, then the demo seed and the
// demo shim are added only in this build. The local server never serves them.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const demo = join(web, 'demo');
const out = resolve(process.argv.flatMap((a, i) => (a === '--out' ? [process.argv[i + 1]] : [])).at(-1) ?? join(root, 'demo-dist'));

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
  for (const view of [d.view, d.preview].filter(Boolean)) {
    const base = basename(view.split('?')[0]);
    add(`${seed.mockBase}${d.key}~/${base}`, view, `assets/${d.key}-view-${base}`);
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
console.log(`demo: ${seed.decisions.length} items, ${Object.keys(files).length} files -> ${out}`);
