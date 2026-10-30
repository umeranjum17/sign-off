// A design pick (post --type design): it is listed under Designs, and each option opens full screen as a page that runs.
// A throwaway board holds one pick of three layouts. Side "after" (this checkout) gives each option a running prototype page; side "before"
// (SIGN_OFF_REPO=<published build>, DESIGN_PICK_SIDE=before) gives each a sheet of pictures, as the broken card had.
// Frames at 360, 390 and 445 (phone) and 1280 and 1440 (desk), light and dark: Designs, the card in Decide, and option A open full screen;
// at 390 also options B and C. A phone is also captured by plain `chromium --headless --window-size=390,2400 --screenshot`.
// Usage: node design-pick-shots.mjs <output>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const before = process.env.DESIGN_PICK_SIDE === 'before', dest = before ? join(out, 'before') : out;
mkdirSync(dest, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-pick-'));
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.c'), XDG_DATA_HOME: join(dir, '.d'), XDG_STATE_HOME: join(dir, '.s'), XDG_CACHE_HOME: join(dir, '.k') };
const OPTIONS = [['a', 'A: List and open thread'], ['b', 'B: One feed, replies inline'], ['c', 'C: Conversation with a side rail']];
// A page that runs: the layout's own screens, moved between by its buttons.
const live = (name) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>
<style>body{margin:0;font:16px system-ui;background:#f4f2ef;color:#111}header{padding:16px;font-weight:600}button{display:block;width:100%;text-align:left;padding:16px;border:0;border-bottom:1px solid #ddd;background:#fff;font:inherit}#thread{padding:16px}#thread[hidden]{display:none}</style>
<header>${name}</header><div id="list"><button>Release notes: who reads them?</button><button>Weekly digest: keep it?</button></div>
<div id="thread" hidden><p>Sent, read, acted: the life of this message.</p><button id="back">Back to the list</button></div>
<script>for(const b of document.querySelectorAll('#list button'))b.onclick=()=>{list.hidden=true;thread.hidden=false};back.onclick=()=>{list.hidden=false;thread.hidden=true}</script>`;
const sheet = (name) => `<!doctype html><meta charset="utf-8"><title>${name}</title><h2>Light</h2><figure><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="300" height="160"><figcaption>Computer</figcaption></figure>`;
const board = join(dir, 'board.json');
mkdirSync(join(dir, 'mocks/inbox-pick'), { recursive: true });
for (const [v, label] of OPTIONS) writeFileSync(join(dir, `mocks/inbox-pick/preview-${v}.html`), (before ? sheet : live)(label));
writeFileSync(board, JSON.stringify({ schema: 2, items: [{ filed: new Date().toISOString(), key: 'inbox-pick', title: 'Which layout should the Inbox use?', about: 'Three ways to hold your chats.',
  options: OPTIONS.map(([value, label]) => ({ value, label })), recommend_value: 'a', type: 'design', tradeoff: 'A shows each message\'s progress in its row; B reads top to bottom; C keeps the chat on screen.',
  mocks: OPTIONS.map(([value]) => ({ value, path: `mocks/inbox-pick/preview-${value}.html` })), filer: 'sign-off' }] }));
const sh = (bin, args, options = {}) => spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server, chrome, ws;
const prof = mkdtempSync(join(tmpdir(), 'so-pick-chrome-'));
try {
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  chrome = spawn('/usr/lib/chromium/chromium', ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); if (existsSync(join(prof, 'DevToolsActivePort'))) port = readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
  const cdp = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, (x) => (x.error ? j(new Error(`${method}: ${x.error.message}`)) : r(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const evalIn = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description); return r.result.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const HEIGHT = { 360: 780, 390: 844, 445: 960, 1280: 800, 1440: 900 }, records = [];
  const frame = async (name, width, theme, hash, act = '') => {
    const phone = width < 1024;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT[width], deviceScaleFactor: 2, mobile: phone });
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await cdp('Page.navigate', { url: 'about:blank' }); await wait(150);
    await cdp('Page.navigate', { url: `${url}${hash}` }); await wait(1500);
    await evalIn(`localStorage.setItem('so-theme', '${theme}'); 0`); await cdp('Page.reload'); await wait(1500);
    if (act) { await evalIn(act); await wait(1200); }
    const file = `${name}.${width}.${theme}.png`, shot = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dest, file), Buffer.from(shot.data, 'base64'));
    const r = await evalIn(`(() => ({ width: innerWidth, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, hash: location.hash,
      board: (document.getElementById('board')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 160), frames: [...document.querySelectorAll('iframe')].map(f => f.src.split('/').slice(-1)[0]),
      full: !!document.querySelector('.design-viewer[open], .full-view, [data-full-open]') }))()`);
    records.push({ file, ...r });
    return r;
  };
  const openFull = (n) => `(() => { const b = document.querySelector('.full-open'); b.click(); return new Promise(r => setTimeout(() => { const s = document.querySelector('.design-viewer select, select[aria-label]'); ${n ? `if (s) { s.value = s.options[${n}].value; s.dispatchEvent(new Event('change', { bubbles: true })); }` : ''} r(1); }, 700)); })()`;
  for (const width of [360, 390, 445, 1280, 1440]) for (const theme of ['light', 'dark']) {
    const list = await frame('designs', width, theme, '#designs');
    if (!before) assert.match(list.board, /Which layout should the Inbox use\?/, `${width} ${theme}: the pick is listed under Designs`);
    if (!before) assert.equal(list.overflowX, false, `${width} ${theme}: designs list has no sideways overflow`);
    await frame('decide', width, theme, '#decide');
    const full = await frame('full-a', width, theme, '#decide', openFull(0));
    assert.ok(full.frames.some((f) => f === 'preview-a.html'), `${width} ${theme}: option A opens full screen`);
  }
  if (!before) {
    for (const [i, [v]] of OPTIONS.entries()) if (i) await frame(`full-${v}`, 390, 'light', '#decide', openFull(i));
    const page = await fetch(`${url}mock/local/inbox-pick~a/preview-a.html`).then((r) => r.text()).catch(() => '');
    records.push({ file: 'mock-a-runs', runs: /<script>/.test(readFileSync(join(dir, 'mocks/inbox-pick/preview-a.html'), 'utf8')), served: page.length > 0 });
    writeFileSync(join(dir, 'mocks/inbox-pick/sheet.html'), sheet('Sheet'));
    const refused = sh(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--type', 'design', '--key', 'second', '--title', 'Which layout should the Inbox use today?', '--option', 'a=A', '--option', 'b=B', '--mock', 'a=mocks/inbox-pick/sheet.html', '--mock', 'b=mocks/inbox-pick/preview-b.html', '--recommend', 'a'], { env });
    assert.notEqual(refused.status, 0); assert.match(refused.stdout + refused.stderr, /is a sheet of pictures/);
    const twin = sh(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--type', 'design', '--key', 'second', '--title', 'Which layout should the Inbox use today?', '--option', 'a=A', '--option', 'b=B', '--option', 'c=C', '--mock', 'a=mocks/inbox-pick/preview-a.html', '--mock', 'b=mocks/inbox-pick/preview-b.html', '--recommend', 'a'], { env });
    assert.notEqual(twin.status, 0);
    writeFileSync(join(dest, 'post-refusals.txt'), `sheet of pictures:\n${refused.stdout}${refused.stderr}\nsame decision again:\n${twin.stdout}${twin.stderr}`);
  }
  writeFileSync(join(dest, 'checks.json'), JSON.stringify(records, null, 2));
  // The same board through plain headless Chromium at 390: the right edge must be visible without any emulation.
  for (const hash of ['designs', 'decide']) {
    sh('/usr/lib/chromium/chromium', ['--headless=new', '--no-sandbox', `--user-data-dir=${join(prof, 'plain')}`, '--window-size=390,2400', '--virtual-time-budget=6000', `--screenshot=${join(dest, `plain-${hash}.390.png`)}`, `${url}#${hash}`]);
  }
  writeFileSync(join(dest, 'steps.json'), JSON.stringify({ commit: sh('git', ['rev-parse', 'HEAD']).stdout.trim(), before, target: { version: sh(process.execPath, [join(repo, 'dist/cli.js'), '--version']).stdout.trim() },
    start: `A throwaway board holding one design pick of three Inbox layouts${before ? ', each option a sheet of pictures' : ', each option a page that runs'}.`,
    steps: ['Open Designs', 'Open the card in Decide', 'Open option A full screen', ...(before ? [] : ['Open options B and C full screen', 'Post a sheet of pictures as a mock, and the same pick again']), 'Capture at 360, 390, 445, 1280 and 1440 wide, light and dark'],
    result: `${before ? 'before' : 'after'} frames and checks` }, null, 2));
} finally {
  try { ws?.close(); chrome?.kill(); server?.kill(); } catch {}
  await wait(400); rmSync(dir, { recursive: true, force: true }); rmSync(prof, { recursive: true, force: true });
}
