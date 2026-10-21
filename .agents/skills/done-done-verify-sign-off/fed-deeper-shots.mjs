// Real CLI -> answers-only board -> Go deeper on a report item in the browser, one theme per run.
// Usage: node .agents/skills/done-done-verify-sign-off/fed-deeper-shots.mjs <output> [light|dark]
// FED_WIDTH=390 or 1280 runs one width, so a run's steps.json holds one claim.
// Saves deeper-ask.<width>w.png and deeper-ask.<width>w.txt (numbers: asks saved before and after, errors shown) at 390 and 1280.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light';
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-fed-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state'), SIGN_OFF_FILER: 'verify' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-fed-${process.pid}` };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
let server;
try {
  const widths = process.env.FED_WIDTH ? [+process.env.FED_WIDTH] : [390, 1280];
  for (const width of widths) {
    rmSync(board, { force: true }); rmSync(join(dir, 'board.deeper.jsonl'), { force: true });
    const report = JSON.parse(readFileSync('fixtures/contract/report.v4/valid-full.json'));
    Object.assign(report, { key: 'fed-report', filed: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
    run(process.execPath, ['dist/cli.js', 'post', board, '--kind', 'report', '--from', join(dir, 'report.json')], { env });
    // The feeding program's board: it takes answers only, which is how the live board is fed.
    writeFileSync(board, JSON.stringify({ ...JSON.parse(readFileSync(board, 'utf8')), answers_only: true }));
    server = spawn(process.execPath, ['dist/cli.js', 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', b => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', code => no(Error(`Server exited ${code}`))); });
    browser('open', base);
    browser('emulate', '--viewport', `${width}x844x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    browser('open', `${base}#reports/fed-report`);
    const result = JSON.parse(JSON.parse(browser('eval', `async () => {
      for (let i = 0; i < 50 && !document.querySelector('button.deep'); i++) await new Promise(r => setTimeout(r, 100));
      const f = window.fetch, before = (await (await f('/api/decisions')).json()).deeper.length;
      const button = [...document.querySelectorAll('button.deep')][0], id = 'gd-a-this';
      button.scrollIntoView({ block: 'center' }); button.click();
      await new Promise(r => setTimeout(r, 1500));
      const panel = document.getElementById(id);
      const state = await (await f('/api/decisions')).json();
      panel?.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 300));
      return ({ before, asks: state.deeper.length, errors: document.querySelectorAll('.gd-err').length, shown: panel.innerText.replace(/\\s+/g, ' ').slice(0, 80), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth });
    }`).match(/result: (".*")/)[1]));
    const stem = `deeper-ask.${width}w`;
    browser('screenshot', join(out, `${stem}.png`));
    writeFileSync(join(out, `${stem}.txt`), `width ${width}\nasks saved before ${result.before}\nasks saved after ${result.asks}\nerrors shown ${result.errors}\nhorizontal overflow ${result.overflow ? 1 : 0}\npanel text: ${result.shown}\n`);
    assert.deepEqual([result.before, result.asks, result.errors, result.overflow], [0, 1, 0, false], JSON.stringify(result));
    server.kill(); server = undefined;
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync('package.json', 'utf8')).version }, start: 'A throwaway board, fed by another program (answers only), holding one guided report.',
    steps: [`The board is opened at ${widths.join(' and ')} px wide on the report.`, 'The person taps Go deeper on the first part.'],
    result: `Go deeper is accepted at ${widths.join(' and ')} px: one ask is saved, no error shows under the part, and nothing runs off the screen.` }, null, 2) + '\n');
} finally {
  server?.kill();
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
