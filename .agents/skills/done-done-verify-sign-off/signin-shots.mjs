// A sign-in's sheet with a long sign-in link and a long Unlocks value: the label keeps its word, the value takes the free width and wraps, and a value that cannot wrap
// cleanly (the link's host) keeps one line with an ellipsis beside a copy button that hands over the whole value.
// Driven the way it happens: a throwaway board in a temp folder, one sign-in card posted with `post --type signin` and a 150-character link, served by `serve --port 0`,
// then the sheet opened in its own headless Chromium at exact device metrics (360x800, 390x844, 445x900 at 2x as a phone; 1280x860, 1440x960 on a desk).
// Each capture is measured in the browser (signin.<cell>.txt): the sheet's right edge, every element inside it, each fact row's label width and line count,
// its value's box and whether it is clipped, the copy button's 44px tap area, and — tapped for real — the clipboard text it hands over and its Copied confirmation.
// A plain headless Chromium with no emulation also captures the 390px sheet (plain.390w.png, in the browser's own colour preference), so the same page is seen
// in a browser that is not emulated.
// It exits 1 on any failed measure. Usage: node .agents/skills/done-done-verify-sign-off/signin-shots.mjs <output> [light|dark] [360|390|445|1280|1440]
// SIGN_OFF_CLI points the board at another build's CLI (a base checkout) for the before captures.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), cliPath = resolve(process.env.SIGN_OFF_CLI ?? join(repo, 'dist/cli.js'));
const height = phone ? { 360: 800, 390: 844, 445: 900 }[width] ?? 844 : width === 1280 ? 860 : 960;
mkdirSync(out, { recursive: true });
// The board and its CLI live in a temp folder with their own HOME and XDG_*, so no board on this host is read or written.
const dir = mkdtempSync(join(tmpdir(), 'so-signin-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'),
  XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 120000, env });
const cli = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// One sign-in card: a real-looking npm sign-in link of 150 characters whose host is long enough to need the ellipsis, and the Unlocks value the owner's own card reports.
const link = 'https://login.byokit-publisher.example.com/oauth/authorize?client_id=sign-off-axi&state=4f9c2a7e1b&code_challenge=Zx9Qm2Lp7Rt4Wv1Ny6Kc3Hb8Jd5Fg0Sa2De4Ui7Ol9Pq&code_challenge_method=S256';
const unlocks = "npm 2FA approval for the 7 BYOKit packages (tick 'skip 2FA for 5 minutes' if offered)";
assert.equal(link.length, 185);
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
cli('post', board, '--type', 'signin', '--key', 'npm-trust', '--service', 'npm', '--link', link, '--unlocks', unlocks, '--waits', 'Release agent', '--expires', '2h');

const server = spawn(process.execPath, [cliPath, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');
const url = `${base}#decide/npm-trust`;

// The browser: its own headless Chromium over the DevTools protocol, its profile in a temp folder.
const prof = mkdtempSync(join(tmpdir(), 'so-signin-cdp-'));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); server.kill(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));
let port;
for (let i = 0; i < 300 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
assert.ok(port, 'Chromium did not open its DevTools port');
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pending = new Map(), errors = [];
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
  if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
  if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' ')); };
const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: base.replace(/\/$/, '') });
await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height, deviceScaleFactor: 2, mobile: true } : { width, height, deviceScaleFactor: 2, mobile: false });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
const waitFor = async (expression) => { for (let i = 0; i < 200; i++) { if (await evaluate(expression).catch(() => false)) return; await wait(100); } assert.fail(`the page did not reach: ${expression}`); };
await cdp('Page.navigate', { url: 'about:blank' }); await wait(100);
await cdp('Page.navigate', { url }); await waitFor('!!document.querySelector(".signin-ask .facts .fact")'); await wait(400);

// The measure: the sheet's box (on a desk the pane beside the list), every element inside it, each fact row's label and value, the copy button, and the page's own overflow.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter((b) => b.width > 0.5).map((b) => Math.round(b.top))).size; };
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
  const sheet = document.querySelector('.ask-sheet') ?? document.querySelector('.split-detail'), s = box(sheet);
  const rows = [...sheet.querySelectorAll('.facts .fact')].map((r) => { const label = r.querySelector('.fl') ?? r.children[1], value = r.querySelector('b'), cp = r.querySelector('.cp');
    return { label: label.textContent, labelBox: box(label), labelLines: lines(label), value: value.textContent.slice(0, 40), valueBox: box(value),
      valueLines: lines(value), clipped: value.scrollWidth > value.clientWidth + 1 || getComputedStyle(value).textOverflow === 'ellipsis' && value.scrollWidth > value.clientWidth,
      copy: cp ? { ...box(cp), name: cp.getAttribute('aria-label') } : null, rowHeight: Math.round(r.getBoundingClientRect().height) }; });
  const past = [...sheet.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > s.right + 1)
    .map((e) => e.tagName.toLowerCase() + '.' + (e.className?.baseVal ?? e.className ?? '') + ' at ' + Math.round(e.getBoundingClientRect().right));
  return { url: location.href, viewport: document.documentElement.clientWidth, sheet: s, rows, pastSheetRight: past, pageScrollWidth: document.documentElement.scrollWidth }; })()`;
const state = 'sheet', file = (ext) => join(out, `signin.${state}.${theme}.${width}w.${ext}`);
const m = await evaluate(MEASURE);
const shot = await cdp('Page.captureScreenshot', { format: 'png' });
writeFileSync(file('png'), Buffer.from(shot.data, 'base64'));

// A real tap on the copy button, then what the clipboard holds: the whole value, not its ellipsis, and the button says Copied before its own name returns.
const copy = await (async () => {
  const b = m.rows.find((r) => r.copy);
  if (!b) return null;
  const hit = await evaluate(`(() => { const r = document.querySelector('.facts .cp').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  if (phone) { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hit.x, y: hit.y }] }); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  else { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: hit.x, y: hit.y, button: 'left', clickCount: 1 }); }
  await wait(250);
  const said = await evaluate(`document.querySelector('.facts .cp').getAttribute('aria-label')`);
  const got = await evaluate('navigator.clipboard.readText()');
  const copied = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `signin.copied.${theme}.${width}w.png`), Buffer.from(copied.data, 'base64'));
  await wait(1800);
  return { hit, expected: b.value, said, got, back: await evaluate(`document.querySelector('.facts .cp').getAttribute('aria-label')`) };
})();

// A plain headless Chromium, no device emulation and no emulated media, on the same page at a 390px window.
if (width === 390) {
  const plainProf = mkdtempSync(join(tmpdir(), 'so-signin-plain-'));
  const p = spawnSync(chromium, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${plainProf}`, '--hide-scrollbars', '--window-size=390,844',
    '--virtual-time-budget=8000', `--screenshot=${join(out, 'plain.390w.png')}`, url], { encoding: 'utf8', timeout: 120000 });
  assert.equal(p.status, 0, p.stderr);
  rmSync(plainProf, { recursive: true, force: true });
}

const fail = [];
if (m.pageScrollWidth > m.viewport) fail.push(`the page scrolls sideways: ${m.pageScrollWidth} > ${m.viewport}`);
if (m.pastSheetRight.length) fail.push('past the sheet\'s right edge: ' + m.pastSheetRight.join(', '));
for (const r of m.rows) {
  if (r.labelLines !== 1 || r.labelBox.h > 26) fail.push(`the label ${r.label} is stacked: ${r.labelLines} lines, ${r.labelBox.h}px high`);
  if (r.labelBox.w < r.label.length * 6) fail.push(`the label ${r.label} is squeezed to ${r.labelBox.w}px`);
  if (r.valueBox.right > m.sheet.right - 8) fail.push(`the value ${r.value} runs to the sheet's edge: ${r.valueBox.right}`);
  if (r.copy && (r.copy.w < 44 || r.copy.h < 44)) fail.push(`the copy button is not a 44px target: ${r.copy.w}x${r.copy.h}`);
}
if (copy) {
  if (copy.said !== 'Copied') fail.push(`the copy button did not say Copied: ${copy.said}`);
  if (copy.got !== copy.expected) fail.push(`the clipboard holds ${JSON.stringify(copy.got)} not ${JSON.stringify(copy.expected)}`);
  if (copy.back !== 'Copy Where' && copy.back !== 'Copy Unlocks') fail.push(`the copy button did not return to its name: ${copy.back}`);
}
if (errors.length) fail.push('console: ' + errors.join('; '));
writeFileSync(file('txt'), JSON.stringify({ ...m, copy, console_errors: errors, fail }, null, 2) + '\n');
console.log(`${state}.${theme}.${width}w`, fail.length ? `FAIL ${fail.join('; ')}` : 'ok');

ws.close(); chrome.kill(); server.kill(); await wait(300);
rmSync(prof, { recursive: true, force: true });
run('stop', board);
rmSync(dir, { recursive: true, force: true });
if (fail.length) { console.error(JSON.stringify({ fail }, null, 2)); process.exit(1); }
