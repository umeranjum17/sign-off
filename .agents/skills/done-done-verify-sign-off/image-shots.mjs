// Light pictures: real captures posted as updates are shown from the light copy and the thumb post made, still sharp at each frame's size.
// Usage: node .agents/skills/done-done-verify-sign-off/image-shots.mjs <output> [light|dark]
// IMAGES_DIR names a folder of real captures to post (.png, .jpg, .webp; the first 6), else the repo's fixtures and README screens are posted.
// SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (IMAGES_SIDE=before names its files).
// Saves, at 390 and 1280 (2x device pixels): evidence, update and decide .<side>.<theme>.<width>w.png, each with a .json of every picture it
// shows (the URL, its pixels against the frame's, and whether it is as sharp as the original would be there) and the picture bytes the page
// loaded, and images.<side>.<theme>.txt totalling them.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light';
const side = process.env.IMAGES_SIDE ?? 'after', here = resolve(import.meta.dirname, '../../..'), repo = resolve(process.env.SIGN_OFF_REPO ?? here);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-images-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
// The browser bridge takes a port free now, so a run never lands on another session's bridge.
const free = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-images-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(free) };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, env, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const browser = (...args) => sh('chrome-devtools-axi', args, { env: browserEnv });
const evalIn = (fn) => JSON.parse(sh('chrome-devtools-axi', ['run'], { env: browserEnv, input: `console.log(JSON.stringify(await page.eval(${fn})));` }).trim().split('\n').pop());
const shots = process.env.IMAGES_DIR
  ? readdirSync(process.env.IMAGES_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().slice(0, 6).map((f) => join(process.env.IMAGES_DIR, f))
  : [join(here, 'fixtures/evidence/sparse-screen.png'), join(here, 'fixtures/evidence/product-board.png'), join(here, 'docs/media/phone-evidence.webp')];
// Every picture on screen once it has loaded: its URL, its pixels and the frame's, and the original's pixels, read by the page from the
// original's own URL. `blur` is how far the frame stretches the picture (1 or less is sharp); a copy is fine when it is no blurrier than the original there.
const probe = `async () => {
  for (let i = 0; i < 200 && [...document.images].some((im) => !im.complete); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 300));
  const dpr = devicePixelRatio, size = (url) => new Promise((ok) => { const im = new Image(); im.onload = () => ok([im.naturalWidth, im.naturalHeight]); im.onerror = () => ok([0, 0]); im.src = url; });
  const blur = (im, [w, h]) => { const r = im.getBoundingClientRect(), cover = getComputedStyle(im).objectFit === 'cover'; return Math.round((cover ? Math.max(r.width * dpr / w, r.height * dpr / h) : r.width * dpr / w) * 100) / 100; };
  // Counted before the originals are read for comparison, so the total is what the screen itself asked for.
  const loaded = performance.getEntriesByType('resource').filter((e) => /api\\/media/.test(e.name)).reduce((n, e) => n + e.encodedBodySize, 0), shown = [];
  for (const im of document.images) {
    const r = im.getBoundingClientRect();
    if (!/api\\/media/.test(im.currentSrc) || r.width < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    const original = await size(im.currentSrc.replace(/&v=\\w+/, '')), copy = [im.naturalWidth, im.naturalHeight];
    shown.push({ src: im.currentSrc.replace(location.origin, ''), loading: im.loading, frame: [Math.round(r.width), Math.round(r.height)], pixels: copy, original,
      blur: blur(im, copy), original_blur: blur(im, original) });
  }
  return { url: location.hash, dpr, shown, broken: document.querySelectorAll('.gone, .ev-missing').length, loaded_bytes: loaded, overflow: document.documentElement.scrollWidth > innerWidth };
}`;
const totals = [];
try {
  so('init', dir);
  shots.forEach((shot, n) => so('post', board, '--type', 'evidence', '--title', `Capture ${n + 1} on the board`, '--about', 'Umer checks the screen.', '--media', shot, '--link', 'https://example.com/pr/4'));
  so('post', board, '--ask-ref', 'message-demo', '--key', 'ship', '--title', 'Ship the new screen?', '--why', 'The capture shows it working.', '--outcome', 'yes=It ships today.', '--outcome', 'no=It waits.',
    '--recommend', 'yes', '--recommend-reason', 'The proof passed.', '--default', 'no', '--proof', 'update-1');
  const server = spawnSync('sh', ['-c', `"${process.execPath}" "${join(repo, 'dist/cli.js')}" open "${board}" --port 0`], { encoding: 'utf8', env });
  const base = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(server.stdout + server.stderr)?.[1];
  assert.ok(base, server.stdout + server.stderr);
  browser('open', base);
  for (const width of [390, 1280]) {
    browser('emulate', '--viewport', `${width}x${width === 390 ? 844 : 800}x2${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    for (const [stem, hash] of [['evidence', '#evidence'], ['update', '#evidence/update-1'], ['decide', '#decide/ship']]) {
      // A fresh load per screen, so the bytes counted are the ones that screen asks for.
      browser('open', 'about:blank');
      browser('open', `${base}${hash}`);
      const name = `${stem}.${side}.${theme}.${width}w`, m = { screen: stem, width, theme, side, ...evalIn(probe) };
      // Sharp: the frame stretches the picture no more than 1 (a pixel per device pixel or better), or no more than the original would be stretched there.
      for (const s of m.shown) Object.assign(s, { copy: /&v=(light|thumb)/.exec(s.src)?.[1] ?? 'original', sharp: s.blur <= Math.max(1, s.original_blur) + 0.02 });
      browser('screenshot', join(out, `${name}.png`));
      writeFileSync(join(out, `${name}.json`), JSON.stringify(m, null, 2) + '\n');
      totals.push(`${stem} ${width}w: ${m.shown.length} pictures, ${m.loaded_bytes} picture bytes loaded, ${m.shown.map((s) => `${s.pixels.join('x')} in a ${s.frame.join('x')} frame (stretch ${s.blur}, original ${s.original_blur})`).join('; ')}`);
      assert.equal(m.broken, 0, `${name}: a capture shows as missing`);
      assert.ok(m.shown.length, `${name}: no picture on screen`);
      assert.ok(m.shown.every((s) => s.pixels[0] > 0), `${name}: a picture did not load`);
      assert.equal(m.overflow, false, `${name}: the page scrolls sideways`);
      if (side === 'after') for (const s of m.shown) assert.ok(s.sharp, `${name}: ${s.src} is blurrier than its original there: ${JSON.stringify(s)}`);
    }
  }
  writeFileSync(join(out, `images.${side}.${theme}.txt`), `${side} ${theme}, posted: ${shots.map((s) => s.split('/').pop()).join(', ')}\n${totals.join('\n')}\n`);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with no items.',
    steps: [`The agent posts ${shots.length} real captures as evidence updates with sign-off-axi post --type evidence --media.`,
      `The person opens the Evidence list and the first update's screen at ${theme === 'dark' ? 'both widths in the dark theme' : 'both widths in the light theme'}, and each screen's JSON records every capture shown.`],
    result: 'Every capture on the Evidence list and the update\'s screen loads from its light or thumb copy (its address ends v=light or v=thumb) and is marked sharp: true.' }, null, 2) + '\n');
  console.log(totals.join('\n'));
} finally {
  try { browser('stop'); } catch {}
  try { so('stop', board); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
