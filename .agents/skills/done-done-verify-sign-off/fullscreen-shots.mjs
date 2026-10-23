// Open full screen on a design pick and on an interactive page, one theme and width per run, with chrome-devtools-axi.
// Usage: node .agents/skills/done-done-verify-sign-off/fullscreen-shots.mjs <output> [light|dark]
// FULL_WIDTH=390 or 1280 (default 390). A throwaway board (its own HOME and XDG_*) holds a two-option fleet dashboard prototype (fullscreen-sample/a and b:
// pages that link to each other, a tab switcher, a stylesheet beside them) and an interactive tour (fullscreen-sample/tour).
// Saves card, full, nav (the prototype's own link and tab clicked), size (the other size), reference, closed and tour (the interactive page after its own Next),
// each <state>.<theme>.<width>w.png, and fullscreen.<theme>.<width>w.json: what each step measured. Exits non-zero when a check fails.
// FULL_SIDE=before SIGN_OFF_REPO=<built base checkout> captures only the card from that build, for the before.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.env.FULL_WIDTH ?? 390);
assert.ok([390, 1280].includes(width) && ['light', 'dark'].includes(theme));
mkdirSync(out, { recursive: true });
const before = process.env.FULL_SIDE === 'before', repo = resolve(process.env.SIGN_OFF_REPO ?? resolve(import.meta.dirname, '../../..')), sample = join(import.meta.dirname, 'fullscreen-sample');
const dir = mkdtempSync(join(tmpdir(), 'so-full-')), board = join(dir, 'board.json'), cell = `${theme}.${width}w`;
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state'), SIGN_OFF_FILER: 'verify' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-full-${process.pid}` };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const so = (...args) => run(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env });
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const settle = (ms = 700) => browser('eval', `() => new Promise((r) => setTimeout(() => r(1), ${ms}))`);
const shot = (state) => browser('screenshot', join(out, `${state}.${cell}.png`));
const press = (selector) => browser('eval', `() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; }`);
// A real click on an element inside the sandboxed frame: its uid from the page's accessibility snapshot, which reaches into the frame.
const clickIn = (name) => {
  const snap = browser('snapshot'); if (process.env.FULL_DEBUG) writeFileSync(join(process.env.FULL_DEBUG, `${name}.snap.txt`), snap);
  const line = snap.split('\n').find((l) => l.includes(`"${name}"`) && /\b(link|button|tab)\b/.test(l));
  assert.ok(line, `no "${name}" in the snapshot`);
  browser('click', `@${/uid=(\S+)/.exec(line)?.[1] ?? /@(\S+)/.exec(line)[1]}`);
};
const seen = (text) => browser('snapshot').includes(text);
// The full screen's layout, read from the page: the dialog, each frame's box and scale, the controls the bar shows.
const measure = `() => { const d = document.querySelector('dialog.proto-full[open]'); if (!d) return JSON.stringify({ open: false, focused: document.activeElement?.className ?? '' });
  const box = (e) => { if (!e || e.closest('[hidden]')) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const ports = [...d.querySelectorAll('.pf-frame:not([hidden]) .pf-port')].map((p) => ({ ...box(p), view: Math.round(parseFloat(p.style.getPropertyValue('--vw'))), scale: +(+p.style.getPropertyValue('--s')).toFixed(3) }));
  return JSON.stringify({ open: true, viewport: [innerWidth, innerHeight], dialog: box(d), mode: d.querySelector('.pf-stage').dataset.mode, ports,
    size: d.querySelector('.pf-size [aria-pressed=true]')?.dataset.size, shown: d.querySelector('.pf-pick')?.value ?? null, reference: d.querySelector('.pf-ref') ? d.querySelector('.pf-ref').getAttribute('aria-pressed') : 'none',
    captions: [...d.querySelectorAll('.pf-frame:not([hidden]) figcaption')].filter((c) => c.offsetParent).map((c) => c.textContent), live: d.querySelector('.pf-live:not([hidden])')?.href ?? null,
    overflow: document.documentElement.scrollWidth > innerWidth || d.scrollWidth > d.clientWidth }); }`;
let server;
const record = {};
try {
  cpSync(join(sample, 'a'), join(dir, 'mocks/fleet/a'), { recursive: true });
  cpSync(join(sample, 'b'), join(dir, 'mocks/fleet/b'), { recursive: true });
  cpSync(join(sample, 'tour'), join(dir, 'mocks/tour'), { recursive: true });
  so('post', board, '--ask-ref', 'message-demo', '--type', 'design', '--key', 'fleet', '--title', 'Which fleet dashboard should we build?', '--option', 'a=A: Table', '--option', 'b=B: Cards',
    '--mock', 'a=mocks/fleet/a/index.html', '--mock', 'b=mocks/fleet/b/index.html', '--link', 'b=https://example.com/fleet-cards', '--tradeoff', 'A shows more lanes at once; B reads faster on a phone.', '--recommend', 'b');
  so('post', board, '--ask-ref', 'message-demo', '--type', 'interactive', '--key', 'tour', '--title', 'Does the sign-in tour feel right?', '--view', 'mocks/tour/index.html',
    '--option', 'yes=Yes', '--option', 'no=Needs work', '--recommend', 'yes');
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(Error(`Server exited ${code}`))); });
  browser('open', base);
  browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1', '--color-scheme', theme);
  browser('open', `${base}#decide/fleet`);
  browser('eval', `async () => { for (let i = 0; i < 80 && !document.querySelector('.decide .mock iframe'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; }`);
  settle(1200);
  // The base build has no full screen: its card is the before.
  steps: {
    if (before) { shot('card'); break steps; }
    record.card = read(`() => JSON.stringify({ button: document.querySelector('.decide .full-open')?.textContent, frames: document.querySelectorAll('.decide .mock iframe').length })`);
    shot('card');

    // Open full screen: the recommended option first, at the size that matches the screen.
    press('.decide .full-open'); settle(1200);
    record.full = read(measure); shot('full');
    // The prototype's own navigation: B's Done tab (its script), then A's Lanes link (a page beside it, with its stylesheet).
    clickIn('Done'); settle();
    record.tab = { doneShown: seen('Done · 07:55') };
    browser('eval', `() => { const s = document.querySelector('.pf-pick'); s.value = 'a'; s.dispatchEvent(new Event('change')); return 1; }`); settle(1000);
    clickIn('Lanes'); settle(1000);
    record.nav = { lanesPage: seen('Three lanes running for Umer'), ...read(measure) }; shot('nav');
    // The other size, framed and centred.
    press(`.pf-size [data-size="${width === 390 ? 'desktop' : 'phone'}"]`); settle();
    record.size = { ...read(measure), stillOnLanes: seen('Three lanes running for Umer') }; shot('size');
    // Reference: the other option, beside the prototype where two fit, else over it.
    press('.pf-ref'); settle(1000);
    record.reference = read(measure); shot('reference');
    press('.pf-ref'); settle();
    record.referenceOff = read(measure);
    // Close: back on the card, with the focus on what opened it.
    press('.pf-close'); settle();
    record.closed = { ...read(measure), hash: read('() => JSON.stringify(location.hash)') }; shot('closed');

    // An interactive page: it has no reference, so the bar has no Reference; its own Next works.
    browser('open', `${base}#decide/tour`);
    browser('eval', `async () => { for (let i = 0; i < 80 && !document.querySelector('.decide .full-open'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; }`);
    settle();
    press('.decide .full-open'); settle(1200);
    if (width === 390) press('.pf-size [data-size="phone"]'), settle();
    clickIn('Next'); settle();
    record.tour = { ...read(measure), step2: seen('Enter the code') }; shot('tour');
    press('.pf-close'); settle();

    writeFileSync(join(out, `fullscreen.${cell}.json`), JSON.stringify(record, null, 2) + '\n');
    const other = width === 390 ? 1280 : 390, beside = width === 1280;
    assert.equal(record.card.button, 'Open full screen');
    assert.deepEqual([record.full.open, record.full.dialog, record.full.size, record.full.shown, record.full.reference, record.full.overflow],
      [true, { x: 0, y: 0, w: width, h: record.full.viewport[1] }, width === 390 ? 'phone' : 'desktop', 'b', 'false', false]);
    assert.equal(record.full.ports[0].view, width); assert.equal(record.full.live, 'https://example.com/fleet-cards');
    assert.equal(record.tab.doneShown, true); assert.equal(record.nav.lanesPage, true); assert.equal(record.nav.live, null);
    assert.deepEqual([record.size.size, record.size.ports[0].view, record.size.stillOnLanes, record.size.overflow], [width === 390 ? 'desktop' : 'phone', other, true, false]);
    assert.ok(Math.abs(record.size.ports[0].x * 2 + record.size.ports[0].w - width) <= 2, 'the frame is centred');
    assert.equal(record.reference.reference, 'true'); assert.equal(record.reference.mode, beside ? 'beside' : 'over');
    assert.deepEqual(record.reference.captions, ['PrototypeA: Table', 'ReferenceB: Cards']);
    assert.equal(record.referenceOff.mode, 'one');
    assert.deepEqual([record.closed.open, record.closed.hash], [false, '#decide/fleet']);
    assert.deepEqual([record.tour.open, record.tour.reference, record.tour.step2, record.tour.overflow], [true, 'none', true, false]);
    writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
      start: 'A throwaway board holding a design pick between two fleet dashboard prototypes (pages that link to each other, a tab switcher, a stylesheet beside them) and an interactive sign-in tour.',
      steps: ['The board is opened on the design pick, once per cell: 390 px (a phone) and 1280 px (a desk), each in light and dark.', 'The person taps Open full screen.', "The person taps the prototype's own Done tab, picks option A and taps its own Lanes link.",
        'The person taps the other size: Desktop on the phone, Phone on the desk.', 'The person taps Reference, then Reference again.', 'The person taps Close.', "The person opens the interactive tour full screen and taps the tour's own Next."],
      result: 'In every cell the prototype fills the screen under one bar, its own tab and link work, the other size is drawn at its width and centred, the reference shows over it at 390 and beside it at 1280, Close returns to the card, and the interactive page has no Reference.' }, null, 2) + '\n');
  }
} finally {
  server?.kill();
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
