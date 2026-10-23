// A design's new round and its preview, one theme and width per run, with chrome-devtools-axi.
// Usage: node .agents/skills/done-done-verify-sign-off/design-round-shots.mjs <output> [light|dark]
// ROUND_WIDTH=390 or 1280 (default 390). A throwaway board (its own HOME and XDG_*) holds a fleet dashboard design with a light and a dark phone page
// and a computer page per screen, and a second design whose screen page was moved away after it was posted.
// The person types a screen note with real key events and taps Change; the agent then draws the screen again in place (a new round).
// Saves preview (the new round's screen in the preview), note (the empty note box with Earlier note opened) and fallback (the design whose page is gone),
// each <state>.<theme>.<width>w.png, and design-round.<theme>.<width>w.json: what each step measured. Exits non-zero when a check fails.
// ROUND_SIDE=before SIGN_OFF_REPO=<built base checkout> takes the same shots from that build without the checks, for the before.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.env.ROUND_WIDTH ?? 390);
assert.ok([390, 1280].includes(width) && ['light', 'dark'].includes(theme));
mkdirSync(out, { recursive: true });
const before = process.env.ROUND_SIDE === 'before', repo = resolve(process.env.SIGN_OFF_REPO ?? resolve(import.meta.dirname, '../../..'));
const dir = mkdtempSync(join(tmpdir(), 'so-round-')), board = join(dir, 'board.json'), cell = `${theme}.${width}w`;
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state'), SIGN_OFF_FILER: 'design-agent' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-round-${process.pid}` };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const so = (...args) => run(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env });
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const settle = (ms = 700) => browser('eval', `() => new Promise((r) => setTimeout(() => r(1), ${ms}))`);
const shot = (state) => browser('screenshot', join(out, `${state}.${cell}.png`));
const ready = () => browser('eval', `async () => { for (let i = 0; i < 80 && !document.querySelector('.design-review textarea'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; }`);
// A fleet screen as a design agent draws it: its own colours, the lane names at the size the round asks for.
const page = (dark, size) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fleet</title>
<style>body{margin:0;font:16px/1.4 system-ui,sans-serif;background:${dark ? '#111214' : '#f5f5f7'};color:${dark ? '#f2f2f2' : '#1d1d1f'}}main{padding:24px 20px}
h1{font-size:28px;margin:0 0 4px}p{margin:0 0 20px;color:${dark ? '#a1a1a6' : '#6e6e73'}}li{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;margin:0 0 10px;border-radius:14px;background:${dark ? '#1c1c1e' : '#fff'}}
ul{list-style:none;margin:0;padding:0}b{font-size:${size}px}span{font-size:14px;padding:4px 10px;border-radius:99px;background:${dark ? '#2c2c2e' : '#e8f5ec'};color:${dark ? '#7ee2a1' : '#1a7f37'}}</style>
<main><h1>Fleet overview</h1><p>Umer's lanes, today</p><ul><li><b>sign-off</b><span>Working</span></li><li><b>muxr</b><span>Needs you</span></li><li><b>first-draft</b><span>Done</span></li></ul></main>`;
const draw = (size) => {
  writeFileSync(join(dir, 'design/overview.html'), page(false, size));
  writeFileSync(join(dir, 'design/overview-dark.html'), page(true, size));
};
const design = (key, title, views) => ({ contract: 1, kind: 'design', schema: 1, key, title, filer: 'design-agent', group: 'Fleet', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), status: 'in_review',
  about: 'The fleet overview, phone and desktop.', preview: 'design/preview.webp', journeys: [{ id: 'fleet', title: 'Fleet', screens: [{ id: 'overview', title: 'Overview', views }] }] });
const record = { width, theme, side: before ? 'before' : 'after' };
let server;
try {
  mkdirSync(join(dir, 'design'), { recursive: true });
  cpSync(join(repo, 'docs/media/phone-light.webp'), join(dir, 'design/preview.webp'));
  draw(17);
  writeFileSync(join(dir, 'design/moved.html'), page(false, 17));
  const views = { phone_light: 'design/overview.html', phone_dark: 'design/overview-dark.html', computer_light: 'design/overview.html', computer_dark: 'design/overview-dark.html' };
  writeFileSync(join(dir, 'fleet.json'), JSON.stringify(design('fleet-dashboard', 'Fleet dashboard', views)));
  so('post', board, '--kind', 'design', '--from', join(dir, 'fleet.json'));
  writeFileSync(join(dir, 'lanes.json'), JSON.stringify(design('fleet-lanes', 'Fleet lanes', { phone_light: 'design/moved.html', computer_light: 'design/moved.html' })));
  so('post', board, '--kind', 'design', '--from', join(dir, 'lanes.json'));
  rmSync(join(dir, 'design/moved.html')); // moved away after it was posted: the board cannot draw that screen
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(Error(`Server exited ${code}`))); });
  browser('open', base);
  browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1', '--color-scheme', theme);
  // Round 1: the person writes what should change on the screen and taps Change.
  browser('open', `${base}#designs/fleet-dashboard`); ready();
  browser('eval', `() => { document.querySelector('.design-review textarea').focus(); return 1; }`);
  browser('type', 'Make the lane names bigger');
  browser('eval', `() => { [...document.querySelectorAll('.design-review .foot button')].find((b) => b.textContent === 'Change').click(); return 1; }`); settle(1200);
  record.round1 = JSON.parse(so('answers', board, '--json'))['fleet-dashboard'];
  // Round 2: the agent draws the screen again in place, the lane names bigger.
  draw(22);
  browser('open', 'about:blank'); browser('open', `${base}#designs/fleet-dashboard`); ready(); settle(1500);
  const facts = `() => JSON.stringify((() => { const w = document.querySelector('.design-preview-window'), f = w?.firstElementChild, box = (e) => { const r = e?.getBoundingClientRect(); return r && [Math.round(r.width), Math.round(r.height)]; };
    const e = document.querySelector('.design-review .earlier-note');
    return { note: document.querySelector('.design-review textarea').value, earlier: e && !e.hidden ? e.querySelector('p').textContent : null, status: document.querySelector('.design-review [role=status]')?.textContent,
      preview: f?.tagName.toLowerCase(), src: decodeURIComponent(f?.getAttribute('src') ?? ''), frame: box(f), window: box(w) }; })())`;
  record.round2 = read(facts);
  browser('eval', `() => { document.querySelector('.design-preview-window').scrollIntoView({ block: 'start' }); return 1; }`); settle(900);
  shot('preview');
  browser('eval', `() => { const s = document.querySelector('.design-review .earlier-note summary'); s?.click(); document.querySelector('.design-review textarea').scrollIntoView({ block: 'center' }); return 1; }`); settle();
  record.opened = read(`() => JSON.stringify(!!document.querySelector('.design-review .earlier-note')?.open)`);
  shot('note');
  browser('eval', `() => { document.querySelector('[data-design]').click(); return 1; }`); settle();
  record.viewer = read(`() => JSON.stringify({ screen: document.querySelector('.design-viewer[open] .design-viewer-panel [role=status]')?.textContent, note: document.querySelector('.design-viewer[open] textarea')?.value })`);
  browser('eval', `() => { document.querySelector('[aria-label="Close viewer"]').click(); return 1; }`); settle();
  browser('open', 'about:blank'); browser('open', `${base}#designs/fleet-lanes`); ready(); settle(1200);
  browser('eval', `() => { document.querySelector('.design-preview-window').scrollIntoView({ block: 'start' }); return 1; }`); settle();
  record.fallback = read(`() => JSON.stringify({ text: document.querySelector('.design-preview-window')?.innerText, picture: document.querySelector('.design-preview-window img')?.naturalWidth ?? 0 })`);
  shot('fallback');
  record.answers = JSON.parse(so('answers', board, '--json'));
  writeFileSync(join(out, `design-round.${cell}.json`), JSON.stringify(record, null, 2) + '\n');
  if (!before) {
    assert.equal(record.round1?.notes?.[0]?.note, 'Make the lane names bigger', JSON.stringify(record.round1));
    assert.deepEqual([record.round2.note, record.round2.earlier], ['', 'Make the lane names bigger'], JSON.stringify(record.round2));
    assert.equal(record.round2.preview, 'iframe');
    assert.ok(record.round2.src.endsWith(theme === 'dark' ? 'overview-dark.html' : 'overview.html'), record.round2.src);
    assert.deepEqual(record.round2.frame, record.round2.window, 'the screen fills the preview window');
    assert.ok(record.round2.frame[1] > 300, JSON.stringify(record.round2));
    assert.equal(record.opened, true);
    assert.deepEqual(record.viewer, { screen: 'Not reviewed yet', note: '' });
    assert.ok(record.fallback.text.startsWith('This screen could not be shown') && record.fallback.picture > 0, JSON.stringify(record.fallback));
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board holding a fleet dashboard design with one screen, light and dark, and a second design whose screen page was moved away.',
    steps: [`The board is opened ${width === 390 ? 'on a phone' : `at ${width} px`} in ${theme} mode on the fleet dashboard design.`, 'The person types "Make the lane names bigger" in the screen note and taps Change.',
      'The design agent draws the screen again with bigger lane names (a new round) and the person opens the design again.', 'The person taps Earlier note.', 'The person opens the second design.'],
    result: `${width === 390 ? 'On a phone' : `At ${width} px`} in ${theme} mode the new round's screen fills the preview, the note box is empty with the round-one note folded under Earlier note, and the design whose page is gone shows its preview picture with a line saying so.` }, null, 2) + '\n');
} finally {
  server?.kill();
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
