// A screen note typed in the full-screen design viewer on an answers-only (fed) board, then Request change sent: one width per run.
// Usage: node .agents/skills/done-done-verify-sign-off/request-change-shots.mjs <output> [light|dark]
// REQUEST_WIDTH=390 or 1280 (default 390). Saves change-sent.<width>w.png, card-answered.<width>w.png (the design page after Close) and request-change.<width>w.txt (numbers: note length, button disabled, notes saved, the design's answer).
// Only result captures go in the run folder: the typed-note step is checked by numbers, not shot.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.env.REQUEST_WIDTH ?? 390);
assert.ok([390, 1280].includes(width));
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..');
const dir = mkdtempSync(join(tmpdir(), 'so-request-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state'), SIGN_OFF_FILER: 'verify' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-request-${process.pid}` };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const state = `() => { const b = [...document.querySelectorAll('.design-viewer .foot button')].find((x) => x.textContent === 'Request change'); return JSON.stringify({ requestChangeDisabled: b.disabled, noteLength: document.querySelector('.design-viewer textarea').value.length, status: document.querySelector('.design-viewer [role=status]').textContent }); }`;
let server;
try {
  cpSync(join(repo, 'fixtures/contract/design.v1/design'), join(dir, 'design'), { recursive: true });
  cpSync(join(repo, 'docs/media/phone-light.webp'), join(dir, 'design/preview.webp'));
  const message = readFileSync(join(repo, 'fixtures/contract/design.v1/valid-basic.json'), 'utf8').replace('design/preview.png', 'design/preview.webp');
  writeFileSync(join(dir, 'design-message.json'), message);
  run(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--kind', 'design', '--from', join(dir, 'design-message.json')], { env });
  // The feeding program's board: it takes answers only, which is how the live board is fed.
  writeFileSync(board, JSON.stringify({ ...JSON.parse(readFileSync(board, 'utf8')), answers_only: true }));
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(Error(`Server exited ${code}`))); });
  browser('open', base);
  browser('emulate', '--viewport', `${width}x844x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  const key = JSON.parse(message).key;
  browser('open', `${base}#designs/${key}`);
  browser('eval', `async () => { for (let i = 0; i < 50 && !document.querySelector('button[data-design]'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('button[data-design]').click(); document.querySelector('.design-viewer textarea').focus(); return 1; }`);
  const before = read(state);
  browser('type', 'Make the title clearer'); // real key events into the focused note
  const typed = read(state);
  browser('eval', `() => { [...document.querySelectorAll('.design-viewer .foot button')].find((x) => x.textContent === 'Request change').click(); return 1; }`);
  browser('eval', `() => new Promise((r) => setTimeout(r, 1500))`);
  const sent = read(state);
  browser('screenshot', join(out, `change-sent.${width}w.png`));
  browser('eval', `() => { document.querySelector('[aria-label="Close viewer"]').click(); return new Promise((r) => setTimeout(() => r(1), 1000)); }`);
  const card = read(`() => JSON.stringify(document.querySelector('.design-review [role=status]').textContent)`);
  browser('screenshot', join(out, `card-answered.${width}w.png`));
  const saved = JSON.parse(run(process.execPath, [join(repo, 'dist/cli.js'), 'answers', board, '--json'], { env }))[key], notes = saved.notes;
  writeFileSync(join(out, `request-change.${width}w.txt`), `width ${width}\nRequest change disabled before typing ${+before.requestChangeDisabled}\nnote length typed ${typed.noteLength}\nRequest change disabled after typing ${+typed.requestChangeDisabled}\nstatus after Request change ${sent.status}\nnotes saved ${notes.length}\nsaved verdict ${notes[0]?.verdict}\ndesign answer ${saved.answer} (${saved.label})\ndesign page status after Close ${card}\n`);
  assert.deepEqual([typed.requestChangeDisabled, typed.noteLength, sent.status, notes.length, notes[0].verdict, saved.answer, card], [false, 22, 'Changes requested', 1, 'change', 'change', 'Changes requested'], JSON.stringify({ before, typed, sent, saved, card }));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board, fed by another program (answers only), holding one design with a screen to review.',
    steps: [`The board is opened at ${width} px wide on the design.`, 'The person taps Review full screen, taps the screen note and types a note.', 'The person taps Request change.', 'The person taps Close.'],
    result: `At ${width} px Request change is enabled after typing, one change note is saved, the screen reads Changes requested, and the design itself is answered Changes requested.` }, null, 2) + '\n');
} finally {
  server?.kill();
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
