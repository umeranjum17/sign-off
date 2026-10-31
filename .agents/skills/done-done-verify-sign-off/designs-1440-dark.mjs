// The approved requirement's capture for this change: a design pick listed under Designs, at 1440 wide in dark, from a throwaway board.
// Chrome DevTools (the same tool the other journeys drive) rather than the designs journey's own viewer, so the one board-actions run stays light.
// Usage: node .agents/skills/done-done-verify-sign-off/designs-1440-dark.mjs <output>
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? '.');
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cliJs = join(repo, 'dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'so-designs-1440-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
for (const k of Object.keys(env)) if (/^(FM_|FIRSTMATE|SIGN_OFF_)/.test(k)) delete env[k];
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
mkdirSync(join(dir, 'pick'), { recursive: true });
writeFileSync(join(dir, 'pick/a.html'), '<html><body style="margin:0;background:#F3F3F0;font:16px system-ui;color:#21211E"><p style="padding:24px">Two columns: the list and the open thread.</p></body></html>');
writeFileSync(join(dir, 'pick/b.html'), '<html><body style="margin:0;background:#F3F3F0;font:16px system-ui;color:#21211E"><p style="padding:24px">One column: the list, then the thread.</p></body></html>');
writeFileSync(join(dir, 'pick/preview.png'), readFileSync(join(repo, 'fixtures/evidence/product-small.png')));
writeFileSync(join(dir, 'design.json'), JSON.stringify({ contract: 1, kind: 'design', schema: 1, key: 'inbox-pick', title: 'Which inbox layout?', about: 'Two layouts for the same list, side by side.',
  group: 'Sign-off', filed: '2026-10-31T09:00:00Z', status: 'in_review', preview: 'pick/preview.png',
  journeys: [{ id: 'flow', title: 'Flow', screens: [{ id: 'a', title: 'Two columns', views: { phone_light: 'pick/a.html' } }, { id: 'b', title: 'One column', views: { phone_light: 'pick/b.html' } }] }],
  options: [{ value: 'a', label: 'Two columns' }, { value: 'b', label: 'One column' }], recommend: 'a' }));
run(process.execPath, [cliJs, 'post', board, '--kind', 'design', '--from', join(dir, 'design.json')], { env });
const server = spawn(process.execPath, [cliJs, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const x = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (x) ok(x[0]); }); server.stderr.on('data', (b) => { log += b; }); server.once('exit', (c) => no(new Error(`Server exited ${c}: ${log}`))); });
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-designs1440-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: String(port), CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '90000' };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const nap = (ms) => new Promise(r=>setTimeout(r,ms));\n' + script });
const evalIn = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`).trim().split('\n').pop());
try {
  browser('open', `${base}#designs`);
  browser('emulate', '--viewport', '1440x900x2', '--color-scheme', 'dark');
  browser('open', `${base}#designs`);
  drive("for (let i = 0; i < 120; i++) { if (await page.eval(() => !!document.querySelector('.dz-card')) ) break; await nap(100); }");
  const seen = evalIn(`() => ({ title: document.body.innerText.includes('Which inbox layout?'), cards: document.querySelectorAll('.dz-card').length, area: location.hash,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
  assert.equal(seen.area, '#designs'); assert.equal(seen.title, true, 'the pick is listed under Designs'); assert.equal(seen.cards, 1, 'one design card'); assert.equal(seen.overflow, false);
  browser('screenshot', join(out, 'designs.1440.dark.png'));
  writeFileSync(join(out, 'designs.1440.dark.txt'), '1440px dark: the approved design-pick-listing capture: the Designs area lists the design pick "Which inbox layout?" as one card, with its project and day, its state and Review full screen.\n');
} finally {
  try { browser('stop'); } catch {}
  await new Promise((ok) => { const stop = spawn(process.execPath, [cliJs, 'stop', board], { env, stdio: 'ignore' }); stop.once('exit', () => ok()); });
  rmSync(dir, { recursive: true, force: true });
}
