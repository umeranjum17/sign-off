// A queued Beads ticket with a live blocker reads `waiting` in its Tickets row and names the blocker in one chip (+N for more); a ticket with no blocker and a held one keep their words.
// Seeds an isolated board and a stand-in Beads wrapper (`list` only), then reads and captures the Tickets list in the board's own page.
// Usage: node .agents/skills/done-done-verify-sign-off/beads-waiting-row-shots.mjs <output> <light|dark> <390|1280>
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? '.'), theme = process.argv[3] ?? 'light', width = Number(process.argv[4] ?? 390);
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-beads-wrow-')), board = join(dir, 'board.json'), wrapper = join(dir, 'jg-beads.sh');
const row = (id, title, extra) => ({ id, title, status: 'open', priority: 2, issue_type: 'task', labels: ['project:Sign-off'], created_at: '2026-11-05T09:00:00Z', updated_at: '2026-11-06T09:00:00Z', ...extra });
const blocks = (id, ...on) => on.map((o) => ({ issue_id: id, depends_on_id: o, type: 'blocks' }));
const queued = { stage: 'queued' };
const rows = [row('jg-20', 'Ship the new logo', { priority: 1, metadata: { ...queued, key: 'JG-20' }, dependencies: blocks('jg-20', 'jg-21') }),
  row('jg-21', 'Decide the brand palette', { issue_type: 'decision', metadata: { ...queued, key: 'JG-21' } }),
  row('jg-22', 'Redraw the icons for the long title that must truncate', { metadata: queued, dependencies: blocks('jg-22', 'jg-21', 'jg-23') }),
  row('jg-23', 'Old palette review', { metadata: queued }),
  row('jg-24', 'Write the release notes', { metadata: { ...queued, key: 'JG-24' } }),
  row('jg-25', 'Pick the favicon', { status: 'on_hold', metadata: { hold_reason: 'Waiting on the owner', ...queued }, dependencies: blocks('jg-25', 'jg-21') }),
  row('jg-26', 'Retire the old palette', { metadata: queued, dependencies: blocks('jg-26', 'jg-27') }), row('jg-28', 'Wire the vendor feed', { metadata: queued, dependencies: blocks('jg-28', 'jg-23') }), row('jg-27', 'Closed palette review', { status: 'closed', closed_at: '2026-11-04T09:00:00Z' })];
writeFileSync(wrapper, `#!/usr/bin/env node\nif (process.argv[2] === 'list') console.log(${JSON.stringify(JSON.stringify(rows))}); else process.exit(2);\n`);
chmodSync(wrapper, 0o755);
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), PATH: `/usr/bin:${process.env.PATH}`, SIGN_OFF_BEADS_DIR: join(dir, '.beads'), SIGN_OFF_BEADS_WRAPPER: wrapper };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
run(process.execPath, [cliJs, 'raise', board, '--title', 'Pick the brand palette?', '--why', 'The logo waits on it.', '--outcome', 'yes=Warm colours', '--outcome', 'no=Cool colours', '--recommend', 'yes', '--recommend-reason', 'It reads better.', '--default', 'no', '--ask-ref', 'message-test', '--ticket', 'jg-21'], { env });
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); }); server.stderr.on('data', (b) => { log += b; }); server.once('exit', (c) => no(new Error(`Server exited ${c}: ${log}`))); });
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-beadswait-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(port), CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '90000' };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\n' + script });
const evalIn = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`).trim().split('\n').pop());
try {
  const height = width < 600 ? 844 : 900;
  browser('open', `${base}#tickets/all`);
  browser('emulate', '--viewport', `${width}x${height}x2`, '--color-scheme', theme);
  browser('open', `${base}#tickets/all`);
  drive("for (let i = 0; i < 150; i++) { if (await page.eval(() => !!document.querySelector('.tk-row')) ) break; await nap(100); }");
  drive("await page.eval(() => { for (const b of document.querySelectorAll('button.see')) if (b.textContent === 'See all') b.click(); }); await nap(500);");
  const seen = evalIn(`() => { const clean = (n) => n?.innerText.replace(/\\s+/g, ' ').trim(); const rows = {};
    for (const a of document.querySelectorAll('.tk-row')) rows[a.getAttribute('aria-label')] = { words: [...a.querySelectorAll('.tk-stage')].map(clean), chip: clean(a.querySelector('.l1 .tk-blocker')) ?? null, chipTitle: a.querySelector('.l1 .tk-blocker')?.title ?? null, held: /, on hold,/.test(a.getAttribute('aria-label')), l1Right: a.querySelector('.l1 .tk-blocker')?.getBoundingClientRect().right ?? 0, rowRight: a.getBoundingClientRect().right };
    return { rows, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; }`);
  const r = seen.rows, by = (title) => Object.entries(r).find(([k]) => k.includes(`: ${title},`))?.[1];
  const one = by('Ship the new logo'), many = by('Redraw the icons for the long title that must truncate'), none = by('Write the release notes'), held = by('Pick the favicon'), closedOnly = by('Retire the old palette');
  assert.ok(one && many && none && held && closedOnly, JSON.stringify(Object.keys(r)));
  assert.deepEqual(one.words, ['waiting'], 'a ticket with a live blocker reads waiting'); assert.equal(one.chip, 'JG-21', 'the blocker is named by its key');
  assert.deepEqual(many.words, ['waiting']); assert.equal(many.chip, 'JG-21 +1', 'the first blocker, +N for the rest'); assert.equal(many.chipTitle, 'Decide the brand palette, Old palette review');
  const keyless = by('Wire the vendor feed'); assert.equal(keyless.chip, 'SO-2', 'a blocker is named by its readable key (the title when it has none)'); assert.equal(keyless.chipTitle, 'Old palette review');
  assert.deepEqual(none.words, ['queued'], 'no blocker keeps queued'); assert.equal(none.chip, null);
  assert.equal(held.chip, null, 'a held ticket names no chip'); assert.ok(held.held, 'a held ticket keeps on hold');
  assert.deepEqual(closedOnly.words, ['queued'], 'a closed blocker is not live'); assert.equal(closedOnly.chip, null);
  assert.equal(seen.overflow, false);
  for (const x of [one, many]) assert.ok(x.l1Right <= x.rowRight, 'the chip stays inside its row');
  const name = `waiting-row.${theme}.${width}`;
  browser('screenshot', join(out, `${name}.png`));
  writeFileSync(join(out, `${name}.txt`), `${width}px ${theme}: Tickets list rows read in the page.\n${JSON.stringify(r, null, 1)}\n`);
} finally {
  try { browser('stop'); } catch {}
  await new Promise((ok) => { const stop = spawn(process.execPath, [cliJs, 'stop', board], { env, stdio: 'ignore' }); stop.once('exit', () => ok()); });
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
