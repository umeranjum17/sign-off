// A held ticket read from Beads shows what it waits on: the ticket sheet's Hold row (the reason) and, under it, a Waiting on row naming the open ticket on its blocks edge.
// Seeds an isolated board and a stand-in Beads wrapper (`list` only), then captures the sheet in the board's own page. Existing rows only: no new layout.
// Usage: node .agents/skills/done-done-verify-sign-off/beads-waiting-shots.mjs <output> <light|dark> <390|1280>
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? '.'), theme = process.argv[3] ?? 'light', width = Number(process.argv[4] ?? 390);
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-beads-wait-')), board = join(dir, 'board.json'), wrapper = join(dir, 'jg-beads.sh');
const row = (id, title, extra) => ({ id, title, status: 'open', priority: 2, issue_type: 'task', labels: ['project:Sign-off'], created_at: '2026-11-05T09:00:00Z', updated_at: '2026-11-06T09:00:00Z', ...extra });
const rows = [row('jg-10', 'Pick the new logo', { status: 'on_hold', priority: 1, description: 'Choose between the two logo drafts.', metadata: { hold_reason: 'Waiting on the owner to pick a palette', progress: 30 },
  dependencies: [{ issue_id: 'jg-10', depends_on_id: 'jg-11', type: 'blocks' }, { issue_id: 'jg-10', depends_on_id: 'jg-12', type: 'blocks' }] }),
  row('jg-11', 'Decide the brand palette', { issue_type: 'decision' }), row('jg-12', 'Old palette review', { status: 'closed', closed_at: '2026-11-04T09:00:00Z' })];
writeFileSync(wrapper, `#!/usr/bin/env node\nif (process.argv[2] === 'list') console.log(${JSON.stringify(JSON.stringify(rows))}); else process.exit(2);\n`);
chmodSync(wrapper, 0o755);
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), PATH: `/usr/bin:${process.env.PATH}`, SIGN_OFF_BEADS_DIR: join(dir, '.beads'), SIGN_OFF_BEADS_WRAPPER: wrapper };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
run(process.execPath, [cliJs, 'raise', board, '--title', 'Pick the brand palette?', '--why', 'The logo waits on it.', '--outcome', 'yes=Warm colours', '--outcome', 'no=Cool colours', '--recommend', 'yes', '--recommend-reason', 'It reads better.', '--default', 'no', '--ask-ref', 'message-test', '--ticket', 'jg-11'], { env });
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); }); server.stderr.on('data', (b) => { log += b; }); server.once('exit', (c) => no(new Error(`Server exited ${c}: ${log}`))); });
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-beadswait-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(port), CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '90000' };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\n' + script });
const evalIn = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`).trim().split('\n').pop());
try {
  const height = width < 600 ? 844 : 900;
  browser('open', `${base}#ticket/jg-10`);
  browser('emulate', '--viewport', `${width}x${height}x2`, '--color-scheme', theme);
  browser('open', `${base}#ticket/jg-10`);
  drive("for (let i = 0; i < 150; i++) { if (await page.eval(() => !!document.querySelector('.tk-why')) ) break; await nap(100); }");
  const seen = evalIn(`() => { const rows = [...document.querySelectorAll('.ui-pr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()); const w = [...document.querySelectorAll('.ui-pr a')].map((a) => a.innerText);
    return { rows, links: w, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; }`);
  const text = seen.rows.join('\n');
  assert.match(text, /Hold\s*On hold\s*Waiting on the owner to pick a palette/, 'the hold and its reason show');
  assert.deepEqual(seen.links.filter((l) => /palette/i.test(l)), ['Decide the brand palette'], 'only the open ticket is named, the closed one is not');
  assert.equal(seen.overflow, false);
  const name = `waiting.${theme}.${width}`;
  browser('screenshot', join(out, `${name}.png`));
  writeFileSync(join(out, `${name}.txt`), `${width}px ${theme}: ticket sheet of a held Beads ticket. Property rows:\n${text}\nWaiting-on links: ${seen.links.join(' | ')}\n`);
} finally {
  try { browser('stop'); } catch {}
  await new Promise((ok) => { const stop = spawn(process.execPath, [cliJs, 'stop', board], { env, stdio: 'ignore' }); stop.once('exit', () => ok()); });
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
