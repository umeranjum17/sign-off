// The version the board runs, where a person sees it: at the sidebar's foot under the name on a desk (1280x800) and as the last row of Today's More on a phone (390x844),
// light and dark, served from this checkout (a dev build: <version>-dev), and the sidebar once more served by this build packed and installed the way npm installs it
// (no .git: the version as published). Driven and measured in a headless Chromium of its own over the DevTools protocol with exact device metrics (2x).
// The CLI's own words go beside them: --version and the help header from this checkout and from the installed copy, each matching what its board shows.
// Usage: node .agents/skills/done-done-verify-sign-off/version-shots.mjs <output>   (after npm run build)
// Saves sidebar.<theme>.1280w.png, more.<theme>.390w.png, sidebar-installed.light.1280w.png, each with its .measure.json, version.txt and steps.json; the run fails on any check.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve('.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-version-')), board = join(dir, 'board.json'), app = join(dir, 'app');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 300000, env, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const published = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;

// Where the version sits and what it says: the sidebar's line under the name (on the name's left edge, inside the screen) or More's last row, plus the page checks.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const box = (e) => e.getBoundingClientRect(), r2 = (n) => Math.round(n * 100) / 100, w = document.documentElement.clientWidth;
  const sheet = document.querySelector('dialog.t-sheet[open]'), ver = sheet ? [...sheet.querySelectorAll('.ui-pr')].at(-1) : document.querySelector('.side .ver');
  const name = document.querySelector('.side .me > span'), c = ver && getComputedStyle(ver);
  // The words' own box, not the line's: the version starts where the name does.
  const r = ver && (() => { const t = document.createRange(); t.selectNodeContents(ver); return t.getBoundingClientRect(); })();
  const rows = sheet ? [...sheet.querySelectorAll('.ui-pr')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim()) : undefined;
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => box(e).width && box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  return { viewport: innerWidth + 'x' + innerHeight, text: ver?.innerText.replace(/\\s+/g, ' ').trim() ?? null, box: r && { left: r2(r.left), top: r2(r.top), bottom: r2(r.bottom), right: r2(r.right) },
    nameLeft: name && !sheet ? r2(box(name).left) : undefined, nameBottom: name && !sheet ? r2(box(name.parentElement).bottom) : undefined, color: c?.color, size: c?.fontSize, rows,
    moreLine: document.querySelector('.t-more-line')?.innerText.trim(), overflow: document.documentElement.scrollWidth > w, overflowing };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-version-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws, server;
const errors = [], failed = [], lines = [];
try {
  const base = sh('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir]).trim().split('\n').pop();
  // The CLI's words from this checkout: --version and the help header's first line.
  const devV = sh(process.execPath, [join(repo, 'dist/cli.js'), '--version']).trim(), devHead = sh(process.execPath, [join(repo, 'dist/cli.js'), '--help']).split('\n')[0];
  lines.push(`this checkout: sign-off-axi --version prints ${devV}`, `this checkout: sign-off-axi --help starts "${devHead}"`);
  assert.equal(devV, `${published}-dev`, 'a git checkout ahead of its release is a dev build');
  assert.equal(devHead, `version: ${devV}`);

  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) failed.push({ url: x.params.response.url, status: x.params.response.status }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Page.enable');
  const capture = async (url, shot, theme, width) => {
    const phone = width < 1024;
    await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await cdp('Page.navigate', { url }); await wait(1200);
    // On a phone More opens from the line under Today's tiles, as a tap would.
    if (phone) { await evaluate(`document.querySelector('.t-more-line').click()`); await wait(600); await evaluate(`(() => { const s = document.querySelector('dialog.t-sheet[open]'); s.scrollTop = s.scrollHeight; })()`); await wait(300); }
    const m = await evaluate(MEASURE);
    writeFileSync(join(out, `${shot}.${theme}.${width}w.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    writeFileSync(join(out, `${shot}.${theme}.${width}w.measure.json`), JSON.stringify({ ...m, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    assert.ok(m.box && m.box.top >= 0 && m.box.bottom <= (phone ? 844 : 800) && m.box.right <= width, `${shot} ${theme}: the version is on screen ${JSON.stringify(m)}`);
    assert.ok(!m.overflow && !errors.length && !failed.length, `${shot} ${theme}: overflow, console errors or failed requests ${JSON.stringify({ m, errors, failed })}`);
    if (!phone) assert.ok(Math.abs(m.box.left - m.nameLeft) <= 0.5 && m.box.top >= m.nameBottom, `${shot} ${theme}: the version sits under the name, on its left edge ${JSON.stringify(m)}`);
    return m;
  };
  for (const theme of ['light', 'dark']) {
    const side = await capture(base, 'sidebar', theme, 1280), more = await capture(base, 'more', theme, 390);
    assert.equal(side.text, `Version ${devV}`); assert.equal(more.text, `Version ${devV}`);
    lines.push(`${theme} 1280: the sidebar's foot reads "${side.text}" under the name Umer`, `${theme} 390: Today's More ("${more.moreLine}") ends on the row "${more.text}"`);
  }

  // The live copy: this build packed and installed as npm installs it, serving the same board.
  const tarball = sh('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: repo }).trim().split('\n').pop();
  mkdirSync(app); sh('npm', ['init', '-y'], { cwd: app }); sh('npm', ['install', '--no-audit', '--no-fund', join(dir, tarball)], { cwd: app });
  const installed = join(app, 'node_modules/sign-off-axi/dist/cli.js');
  const liveV = sh(process.execPath, [installed, '--version']).trim(), liveHead = sh(process.execPath, [installed, '--help']).split('\n')[0];
  lines.push(`installed from npm pack: sign-off-axi --version prints ${liveV}`, `installed from npm pack: sign-off-axi --help starts "${liveHead}"`);
  assert.equal(liveV, published, 'an installed copy shows its version as published'); assert.equal(liveHead, `version: ${published}`);
  sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board]);
  server = spawn(process.execPath, [installed, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  const live = await new Promise((ok, no) => { server.stdout.on('data', (b) => { const u = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(b)); if (u) ok(u[0]); }); server.once('exit', () => no(new Error('the installed copy did not serve'))); });
  const shown = await capture(live, 'sidebar-installed', 'light', 1280);
  assert.equal(shown.text, `Version ${published}`);
  lines.push(`installed copy, light 1280: the sidebar's foot reads "${shown.text}"`);

  writeFileSync(join(out, 'version.txt'), lines.join('\n') + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: published }, start: 'A throwaway board for Umer with one posted item of each kind, served from this git checkout, then by this build installed from npm pack.',
    steps: ['Open Today at 1280 by 800 in light, then dark, and read the line under Umer at the sidebar\'s foot.', 'Open Today at 390 by 844 in light, then dark, tap the line under the tiles to open More and read its last row.',
      'Run sign-off-axi --version and --help from the checkout, then pack and install this build, run them again and open its board at 1280 in light.'],
    result: `Served from a git checkout the board says Version ${devV}, a dev build, at the sidebar's foot under Umer on a computer and as More's last row on a phone, in light and dark, and the CLI prints ${devV} for --version and leads its help with it; the copy npm installs says Version ${published} and prints ${published}.` }, null, 2) + '\n');
  console.log(lines.join('\n'));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board]); } catch {}
  if (server && server.exitCode === null) await new Promise((ok) => { server.once('exit', ok); setTimeout(() => { server.kill(); ok(); }, 5000); });
  await wait(300);
  rmSync(dir, { recursive: true, force: true });
  rmSync(prof, { recursive: true, force: true });
}
