// A report that sets its own approve words (approve_result, approved_heading) shows them under Approve and once approved; a report that sets none keeps
// 'Starts the build.' and 'Build started'. Run on a throwaway board through the real endpoint, at 390 (mobile) and 1280, light.
// Usage: node .agents/skills/done-done-verify-sign-off/approve-words-shots.mjs <output>
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? '.');
const cells = [['light', 390], ['dark', 390], ['light', 1280], ['dark', 1280]]
  .filter(([t, w]) => (!process.argv[3] || process.argv[3] === t) && (!process.argv[4] || +process.argv[4] === w));
assert.ok(cells.length, 'theme is light or dark; width is 390 or 1280');
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-actions-dec-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const cli = (...args) => run(process.execPath, [cliJs, ...args], { env });
// Filed now: a report over a day old archives by itself, and an archived report's link opens nothing to capture.
const KEY = 'paint-budget', FILER = 'agent-41', FILED = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const message = (patch = {}) => ({ ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v5/valid-minimal.json'), 'utf8')), key: KEY, filed: FILED, filer: FILER, ...patch });
const messageFile = (name, patch = {}) => { const file = join(dir, name); writeFileSync(file, JSON.stringify(message(patch))); return file; };
const lines = (file) => { try { return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

const stop = async (proc) => { try { proc.kill(); } catch {} await new Promise((ok) => (proc.exitCode !== null ? ok() : proc.once('exit', ok))); };
const serveBoard = async (file) => {
  const proc = spawn(process.execPath, [cliJs, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (b) => { log += b; });
  proc.stderr.on('data', (b) => { log += b; });
  const base = await new Promise((ok, no) => {
    proc.stdout.on('data', () => { const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); });
    proc.once('exit', (c) => no(new Error(`Server exited ${c}: ${log}`)));
  });
  return { proc, base };
};
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-dec-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(port),
  // The bridge's own npx bootstrap is slow on a loaded host: give it a minute and a half rather than fail the proof.
  CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '90000' };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\nconst wait = async (s) => { for (let i=0;i<120;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await nap(100); } throw new Error("Not ready: " + s); };\n' + script });
const evalIn = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`).trim().split('\n').pop());
const click = (sel) => drive(`await page.eval(() => document.querySelector(${JSON.stringify(sel)}).click()); await nap(500);`);
const post = async (base, body) => { const r = await fetch(`${base}api/report-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

const shot = (name, width) => {
  drive("await page.eval(() => { const b = document.querySelector('.rda'), s = document.querySelector('.gd-scroll'); if (s) s.scrollTop += b.getBoundingClientRect().top - s.getBoundingClientRect().top - 40; else b.scrollIntoView({ block: 'center' }); }); await nap(500);");
  browser('screenshot', join(out, `${name}.${width}w.png`));
};
const open = async (base, width) => {
  browser('open', base); browser('emulate', '--viewport', width < 900 ? `${width}x844x2,mobile,touch` : '1280x860x1', '--color-scheme', 'light');
  browser('open', `${base}#reports/${KEY}`);
  drive("await wait('.rda');");
};
const text = () => evalIn(`() => document.querySelector('.rda').textContent.replace(/\\s+/g, ' ').trim()`);
const transcript = [];
try {
  for (const [name, patch, rest, started] of [
    ['words', { approve_result: 'Runs the test. Ada posts the result.', approved_heading: 'Test started' }, /Runs the test\. Ada posts the result\./, /Test started.*Its ticket is on Tickets\./],
    ['default', {}, /Starts the build\. Ada opens the first PR by Fri 6 Nov\./, /Build started.*The first pull request lands by Fri 6 Nov\./]]) {
    for (const width of [390, 1280]) {
      const b = join(dir, `${name}-${width}.json`);
      const m = message(); m.actions = { ...m.actions, ...patch };
      const f = join(dir, `${name}-${width}-m.json`); writeFileSync(f, JSON.stringify(m));
      cli('post', b, '--kind', 'report', '--from', f, '--filer', FILER);
      const { proc, base } = await serveBoard(b);
      try {
        await open(base, width);
        const res = evalIn("() => document.querySelector('.rda-a.approve .res').textContent");
        assert.match(res, rest, res);
        const wide = evalIn("() => document.documentElement.scrollWidth > document.documentElement.clientWidth");
        assert.equal(wide, false, 'no sideways scroll');
        shot(`${name}-rest`, width);
        drive("await page.eval(() => document.querySelector('.rda-a.approve').click()); await wait('.rda-closed');");
        const t = await text();
        assert.match(t, started, t);
        shot(`${name}-approved`, width);
        transcript.push(`[${name} ${width}] under Approve: "${res}"; after approval: "${t}"`);
        console.log(transcript.at(-1));
      } finally { await stop(proc); }
    }
  }
  writeFileSync(join(out, 'approve-words.log'), `${transcript.join('\n')}\n`);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board holding one report whose Actions block sets approve_result and approved_heading, and one that sets neither.',
    steps: ['The report that sets its words is opened at 390 and 1280: Approve says "Runs the test. Ada posts the result."', 'Approve is tapped: the heading reads Test started and no first-pull-request promise shows.', 'The report that sets nothing keeps "Starts the build. Ada opens the first PR by Fri 6 Nov." and "Build started".'],
    result: 'A report sets the words of its Approve control; one that sets none keeps today\'s.'
  }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
