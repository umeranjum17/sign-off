// A design review's screen preview, one theme and width per run, with chrome-devtools-axi.
// Usage: node .agents/skills/done-done-verify-sign-off/design-preview-shots.mjs <output> [light|dark]
// DESIGN_WIDTH=390 or 1280 (default 390). A throwaway board (its own HOME and XDG_*) holds a design review whose one screen has phone and computer views of
// design-preview-sample/dash.html, a prototype that fills its viewport and prints the viewport it sees. Saves preview (the review page's inline preview),
// resized (the same preview after the window narrows) and viewer (Review full screen), each <state>.<theme>.<width>w.png, and
// design-preview.<theme>.<width>w.json: each box, the frame's viewport and what the prototype printed. Exits non-zero when a check fails.
// DESIGN_SIDE=before SIGN_OFF_REPO=<built base checkout> captures the same states from that build without the checks, for the before.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.env.DESIGN_WIDTH ?? 390);
assert.ok([390, 1280].includes(width) && ['light', 'dark'].includes(theme));
mkdirSync(out, { recursive: true });
const before = process.env.DESIGN_SIDE === 'before', repo = resolve(process.env.SIGN_OFF_REPO ?? resolve(import.meta.dirname, '../../..'));
const dir = mkdtempSync(join(tmpdir(), 'so-design-')), board = join(dir, 'board.json'), cell = `${theme}.${width}w`;
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state'), SIGN_OFF_FILER: 'verify' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-design-${process.pid}` };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const so = (...args) => run(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env });
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const settle = (ms = 900) => browser('eval', `() => new Promise((r) => setTimeout(() => r(1), ${ms}))`);
const shot = (state) => browser('screenshot', join(out, `${state}.${cell}.png`));
const viewport = (w, h) => browser('emulate', '--viewport', `${w}x${h}x${w < 600 ? '2,mobile,touch' : '1'}`, '--color-scheme', theme);
// What the prototype printed at the bottom of its viewport, read from the accessibility snapshot, which reaches into the sandboxed frame.
const printed = () => /Viewport (\d+ x \d+)/.exec(browser('snapshot'))?.[1] ?? null;
// A frame's box and the box it sits in, the viewport its page gets, and the column's width (a desk's open design's picture area, else the note box, which spans the column).
const measure = (frame, holder) => `() => { const f = document.querySelector(${JSON.stringify(frame)}), h = f && (${holder}); if (!f) return JSON.stringify(null);
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const fb = box(f), hb = box(h), cs = getComputedStyle(f);
  return JSON.stringify({ frame: fb, box: hb, viewport: [parseFloat(cs.width), parseFloat(cs.height)], blankBelow: hb.y + hb.h - (fb.y + fb.h), blankRight: hb.x + hb.w - (fb.x + fb.w),
    column: Math.round((document.querySelector('.dz-fill') ?? document.querySelector('.design-review textarea'))?.getBoundingClientRect().width ?? 0), sameFrame: window.__frame === f.contentWindow,
    overflow: document.documentElement.scrollWidth > innerWidth }); }`;
let server;
const record = {};
try {
  mkdirSync(join(dir, 'design'), { recursive: true });
  copyFileSync(join(import.meta.dirname, 'design-preview-sample', 'dash.html'), join(dir, 'design', 'dash.html'));
  copyFileSync(join(repo, 'docs/media/phone-light.webp'), join(dir, 'design', 'preview.webp'));
  const views = Object.fromEntries(['phone_light', 'phone_dark', 'computer_light', 'computer_dark'].map((v) => [v, 'design/dash.html']));
  writeFileSync(join(dir, 'design-message.json'), JSON.stringify({ contract: 1, kind: 'design', schema: 1, key: 'dash', title: 'Review the fleet dashboard',
    about: 'One screen for Umer to check lanes and runs.', group: 'Fleet', filed: '2026-10-23T10:00:00Z', status: 'in_review', preview: 'design/preview.webp',
    journeys: [{ id: 'fleet', title: 'Fleet', screens: [{ id: 'home', title: 'Home', views }] }] }));
  so('post', board, '--kind', 'design', '--from', join(dir, 'design-message.json'));
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(Error(`Server exited ${code}`))); });
  const [w, h] = width === 390 ? [390, 844] : [1280, 800];
  browser('open', base);
  viewport(w, h);
  browser('open', `${base}#designs/dash`);
  browser('eval', `async () => { for (let i = 0; i < 80 && !document.querySelector('iframe.design-review-preview'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; }`);
  settle(1500);
  const inline = measure('iframe.design-review-preview', "f.closest('.design-preview-window')");
  // The review page from its top: its title, then the preview, which fits the screen under it at every size here.
  browser('eval', `() => { window.__frame = document.querySelector('iframe.design-review-preview').contentWindow; return 1; }`);
  record.preview = { ...read(inline), printed: printed() }; shot('preview');
  // The window narrows: the same page scales again, never loads again.
  const [nw, nh] = width === 390 ? [360, 780] : [1100, 800];
  viewport(nw, nh); settle();
  record.resized = { at: [nw, nh], ...read(inline), printed: printed() }; shot('resized');
  viewport(w, h); settle();
  // Review full screen: the screen in the stage, beside the note on a desk and above it on a phone.
  browser('eval', `() => { document.querySelector('[data-design="dash"]').click(); return 1; }`);
  settle(1500);
  record.viewer = { ...read(measure('.design-stage iframe', "document.querySelector('.design-stage')")), printed: printed() }; shot('viewer');
  writeFileSync(join(out, `design-preview.${cell}.json`), JSON.stringify(record, null, 2) + '\n');
  if (!before) {
    const [vw, vh] = width === 390 ? [390, 844] : [1280, 800], { preview: p, resized: r, viewer: v } = record;
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`);
    // The page gets the device's own viewport, and its scaled box is the whole preview: nothing blank under it or beside it.
    assert.deepEqual([p.viewport, p.printed, r.viewport, r.printed, v.viewport, v.printed], [[vw, vh], `${vw} x ${vh}`, [vw, vh], `${vw} x ${vh}`, [vw, vh], `${vw} x ${vh}`]);
    for (const [s, what] of [[p, 'preview'], [r, 'resized']]) {
      near(s.frame.w, s.box.w, `${what} frame width`); near(s.frame.h, s.box.h, `${what} frame height`); near(s.blankBelow, 0, `${what} blank below`);
      near(s.box.h, s.box.w * vh / vw, `${what} keeps the device's shape`);
      assert.ok(s.box.w <= s.column + 1, `${what} fits the column`); assert.equal(s.overflow, false);
    }
    if (width === 1280) near(p.box.w, p.column, 'a desk preview spans the column');
    assert.ok(r.box.w < p.box.w, 'the narrower window scales the preview down'); assert.equal(r.sameFrame, true, 'the page did not load again');
    // In the viewer the scaled page fits the stage, centred across it.
    assert.ok(v.frame.w <= v.box.w + 1 && v.frame.h <= v.box.h + 1, 'the viewer frame fits the stage'); near(v.blankRight, v.frame.x - v.box.x, 'the viewer frame is centred');
    writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
      start: 'A throwaway board holding a design review whose one screen has phone and computer views of a fleet dashboard prototype that fills its viewport and prints the viewport it sees.',
      steps: ['The board is opened on the design review, once per cell: 390 px (a phone) and 1280 px (a desk), each in light and dark.',
        'On the desk (1280) the review page shows the screen\'s desktop preview: the prototype runs in a 1280 by 800 viewport, scaled to fit the open design's picture area, and the preview box ends where the scaled page ends, with no empty band under it.',
        'On the phone (390) the review page shows the screen\'s phone preview: the prototype runs in a 390 by 844 viewport, scaled to fit, with no empty band under it.',
        'The window narrows (to 360 on the phone, 1100 on the desk, still a desk, where the open design narrows): the same page scales down again without loading again.',
        'The person taps Review full screen: the same viewport shows whole and centred in the stage.'],
      result: `The prototype runs in a ${vw} by ${vh} viewport scaled to the column, the preview box ends where the page ends, a narrower window scales the same page without loading it again, and Review full screen shows it whole and centred.` }, null, 2) + '\n');
  }
} finally {
  server?.kill();
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
