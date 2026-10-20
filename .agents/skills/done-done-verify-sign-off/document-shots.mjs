// Real CLI -> sandboxed report/plan -> browser layout, both widths and themes.
// Usage: node .agents/skills/done-done-verify-sign-off/document-shots.mjs <output>
// DOCUMENT_BEFORE=1 records the old layout without asserting the repaired geometry.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-doc-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state'), SIGN_OFF_FILER: 'verify' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-doc-${process.pid}` };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const cli = (...args) => run(process.execPath, ['dist/cli.js', ...args], { env });
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: script });
let server;
try {
mkdirSync(join(dir, 'page'));
const report = JSON.parse(readFileSync('fixtures/contract/report.v2/valid-full.json'));
Object.assign(report, { key: 'release', title: 'Latest stable build: muxr 0.2.8', about: 'Public demonstration release notes. No private board content.', filed: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), group: 'Release notes' });
delete report.link; delete report.decided; delete report.video; delete report.asked_by;
writeFileSync(join(dir, 'page/preview.svg'), readFileSync('fixtures/contract/report.v2/page/preview.svg'));
writeFileSync(join(dir, 'page/index.html'), `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Release notes</title>
<style>:root{color-scheme:light dark;overflow-y:scroll}body{margin:0;font:18px/1.5 system-ui}h2,p,details{margin:0;padding:16px}svg{display:block;width:100%;height:auto;color:#1685e8}summary{cursor:pointer} @media(prefers-color-scheme:dark){body{color:#eee}}</style>
<h2>muxr 0.2.8 is the latest stable build</h2><p>The phone app and the computer package share a version. This is a public-text layout demonstration.</p>
<svg viewBox="0 0 600 220" role="img" aria-label="Latest stable muxr 0.2.8"><rect width="600" height="220" rx="24" fill="currentColor" opacity=".18"/><text x="300" y="100" text-anchor="middle" fill="currentColor" font-size="28">Latest stable</text><text x="300" y="155" text-anchor="middle" fill="currentColor" font-size="42">muxr 0.2.8</text></svg>
<button type="button" onclick="document.querySelector('details').open = !document.querySelector('details').open">Compare package versions</button><details><summary>Release details</summary><p>The release has matching package versions.</p></details>
${Array.from({ length: 90 }, (_, i) => `<h2>Release note ${i + 1}</h2><p>Keep the phone app and computer package on the same version. Read the notes before updating. This example contains only non-private text.</p>`).join('')}<script>setInterval(() => parent.postMessage({documentGeometry:{height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,scrollbar:innerWidth-document.documentElement.clientWidth,inner:[...document.querySelectorAll('body *')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).length}}, '*'), 200);</script></html>`);
writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
const plan = JSON.parse(readFileSync('fixtures/contract/plan.v1/valid-full.json', 'utf8').replaceAll('Umer', 'the reviewer'));
writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
cli('post', board, '--kind', 'plan', '--from', join(dir, 'plan.json'));
server = spawn(process.execPath, ['dist/cli.js', 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', b => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', code => no(Error(`Server exited ${code}`))); });
  browser('open', base);
  for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
    browser('emulate', '--viewport', `${width}x844x1${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    for (const [name, hash] of [['report', '#reports/release'], ['plan', '#waiting/plan-kind-board']]) {
      drive(`await page.open(${JSON.stringify(base + hash)}); for (let i=0;i<100 && !await page.eval(() => !!document.querySelector('#reader iframe'));i++) await new Promise(r=>setTimeout(r,100)); await page.eval(() => { window.documentGeometry = null; addEventListener('message', e => { if(e.source === document.querySelector('#reader iframe')?.contentWindow && e.data?.documentGeometry) window.documentGeometry = e.data.documentGeometry; }); return new Promise(r => setTimeout(r, 600)); });`);
      const geometry = JSON.parse(drive(`console.log(JSON.stringify(await page.eval(() => {
        const f = document.querySelector('#reader iframe'), p = f.closest('.read, .plan-main'), s = getComputedStyle(p);
        return { child: window.documentGeometry, frame: f.clientHeight, fitted: !!f.style.height, width: f.getBoundingClientRect().width,
          available: p.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          scrollers: [...document.querySelectorAll('#reader *')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).map(e => e.className) };
      })));`));
      if (!process.env.DOCUMENT_BEFORE) {
        assert.ok(geometry.fitted && geometry.width >= geometry.available - 1, JSON.stringify(geometry));
        assert.ok(geometry.child && geometry.frame >= geometry.child.height - 1 && geometry.child.inner === 0 && geometry.child.scrollbar === 0 && geometry.child.width <= geometry.width + 1, JSON.stringify(geometry));
        assert.equal(geometry.overflow, false); assert.deepEqual(geometry.scrollers, [name === 'report' ? 'read' : 'plan-scroll']);
      }
      const stem = `${name}.${theme}.${width}w`;
      browser('screenshot', join(out, `${stem}.png`));
      writeFileSync(join(out, `${stem}.geometry.json`), JSON.stringify(geometry, null, 2));
      assert.match(browser('console', '--type', 'error'), /no console messages found/);
    }
  }
  // Optional task-private copy for a separately locked real-phone proof; never includes browser credentials.
  if (process.env.DOCUMENT_SEED_COPY) {
    const { cpSync } = await import('node:fs');
    mkdirSync(process.env.DOCUMENT_SEED_COPY, { recursive: true });
    for (const f of ['board.json', 'page']) cpSync(join(dir, f), join(process.env.DOCUMENT_SEED_COPY, f), { recursive: true });
  }
} finally {
  if (server) {
    browser('stop');
    await new Promise((ok, no) => {
      const stop = spawn(process.execPath, ['dist/cli.js', 'stop', board], { env, stdio: 'inherit' });
      stop.once('exit', code => code === 0 ? ok() : no(Error(`stop exited ${code}`)));
    });
    await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r));
  }
  rmSync(dir, { recursive: true, force: true });
}
