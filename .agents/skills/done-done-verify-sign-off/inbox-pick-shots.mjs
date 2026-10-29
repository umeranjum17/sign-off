// The Inbox layout pick: each option opens full screen from its card and runs, so a tap on a conversation inside the page opens that thread.
// A throwaway board holds the pick, posted by this checkout's CLI from the option pages in fixtures/contract/design.v1/design/inbox-layout-pick/.
// Frames at 390 (phone) and 1280 (desk), light and dark: the card in Decide, then each option full screen after a real tap on its second row inside the page.
// With LIVE_BOARD_URL_FILE (a file holding the live board's link), also the live board's Designs list at 390 and 1280 and plain
// `chromium --headless --window-size=390,2400 --screenshot` of it; the link itself is never written out.
// Usage: node inbox-pick-shots.mjs <output>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo = resolve('.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-inbox-pick-'));
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.c'), XDG_DATA_HOME: join(dir, '.d'), XDG_STATE_HOME: join(dir, '.s'), XDG_CACHE_HOME: join(dir, '.k') };
const KEY = 'inbox-layout-pick', TITLE = 'Which layout should the Inbox use for every conversation?';
const OPTIONS = [['a', 'A: List and open thread, life in every row'], ['b', 'B: One feed of your messages, replies inline'], ['c', 'C: One conversation, the list as a side rail']];
const sh = (bin, args, options = {}) => spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const board = join(dir, 'board.json');
cpSync(join(repo, 'fixtures/contract/design.v1/design', KEY), join(dir, 'mocks', KEY), { recursive: true });
const posted = sh(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--type', 'design', '--key', KEY, '--title', TITLE, ...OPTIONS.flatMap(([v, l]) => ['--option', `${v}=${l}`]),
  ...OPTIONS.flatMap(([v]) => ['--mock', `${v}=mocks/${KEY}/${v}.html`]), '--tradeoff', 'A shows each message\'s progress in its row; B reads top to bottom; C keeps the chat on screen.', '--recommend', 'a'], { env });
assert.equal(posted.status, 0, posted.stdout + posted.stderr);
writeFileSync(join(out, 'post.txt'), posted.stdout);
let server, chrome, ws;
const prof = mkdtempSync(join(tmpdir(), 'so-inbox-pick-chrome-'));
const records = [];
try {
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  // A phone keeps a sandboxed frame in its own process, so the tap lands where it is drawn.
  chrome = spawn('/usr/lib/chromium/chromium', ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-features=IsolateSandboxedIframes,site-per-process', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); if (existsSync(join(prof, 'DevToolsActivePort'))) port = readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), contexts = [];
  ws.onmessage = (m) => {
    const x = JSON.parse(m.data);
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.executionContextCreated') contexts.push(x.params.context);
  };
  const cdp = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, (x) => (x.error ? j(new Error(`${method}: ${x.error.message}`)) : r(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const evalIn = async (expression, contextId) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId && { contextId }) }); assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description); return r.result.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('DOM.enable');
  const HEIGHT = { 390: 844, 1280: 800 };
  const setup = async (width, theme) => {
    const phone = width < 1024;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT[width], deviceScaleFactor: 2, mobile: phone });
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  };
  const go = async (base, hash, theme) => {
    await cdp('Page.navigate', { url: 'about:blank' }); await wait(150);
    await cdp('Page.navigate', { url: `${base}${hash}` }); await wait(1500);
    await evalIn(`localStorage.setItem('so-theme', '${theme}'); 0`); await cdp('Page.reload'); await wait(1800);
  };
  const shoot = async (file) => { const shot = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, file), Buffer.from(shot.data, 'base64')); };
  // The page's own world inside the option's frame: the frame the full-screen dialog holds.
  const frameContext = async (v) => {
    const tree = await cdp('Page.getFrameTree'), all = [];
    const walk = (n) => { all.push(n.frame); (n.childFrames ?? []).forEach(walk); };
    walk(tree.frameTree);
    const frames = all.filter((f) => f.url.includes(`/${v}.html`));
    assert.ok(frames.length, `option ${v}: a frame of ${v}.html`);
    const { executionContextId } = await cdp('Page.createIsolatedWorld', { frameId: frames.at(-1).id, worldName: `tap-${v}-${id}` });
    return executionContextId;
  };
  // A real tap: the row's box as drawn in the scaled frame, then a touch (phone) or a mouse click (desk) at its centre through the input pipeline.
  // C on a phone switches threads from its strip (rail-<n>): the row the person can see is the one tapped.
  const tap = async (ctx, n, phone) => {
    const { result } = await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('[data-testid="row-${n}"], [data-testid="rail-${n}"]')].find((e) => e.getClientRects().length)`, contextId: ctx });
    assert.ok(result.objectId, `conversation ${n} has a row on screen`);
    await cdp('DOM.scrollIntoViewIfNeeded', { objectId: result.objectId }).catch(() => {});
    const { quads } = await cdp('DOM.getContentQuads', { objectId: result.objectId });
    const q = quads[0], x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4;
    if (phone) {
      await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
    return { x: Math.round(x), y: Math.round(y) };
  };
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    const phone = width < 1024;
    await setup(width, theme);
    await go(url, `#decide/${KEY}`, theme);
    const card = await evalIn(`(document.getElementById('board')?.innerText ?? '').replace(/\\s+/g, ' ')`);
    assert.match(card, new RegExp(TITLE.replace('?', '\\?')), `${width} ${theme}: the card shows`);
    await shoot(`card.${width}.${theme}.png`);
    records.push({ file: `card.${width}.${theme}.png`, width, theme, title: true });
    for (const [v, label] of OPTIONS) {
      await go(url, `#decide/${KEY}`, theme);
      // The option's frame on the card opens it full screen, as a tap on it does.
      await evalIn(`(() => { const s = document.querySelector('[data-full="${KEY}~${v}"]'); s.scrollIntoView({ block: 'center' }); s.click(); return 1; })()`);
      await wait(1800);
      const dialog = await evalIn(`!!document.querySelector('dialog.proto-full[open]')`);
      assert.ok(dialog, `${v} ${width} ${theme}: full screen is open`);
      const ctx = await frameContext(v);
      const before = await evalIn(`({ hash: location.hash, thread: (() => { const t = document.getElementById('c2'); return !!t && t.getClientRects().length > 0 && getComputedStyle(t).visibility !== 'hidden'; })() })`, ctx);
      const at = await tap(ctx, 2, phone);
      await wait(900);
      const after = await evalIn(`({ hash: location.hash, width: innerWidth, thread: (() => { const t = document.getElementById('c2'); return !!t && t.getClientRects().length > 0 && getComputedStyle(t).visibility !== 'hidden'; })(),
        text: (document.getElementById('c2')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 200) })`, ctx);
      assert.equal(after.hash, '#c2', `${v} ${width} ${theme}: the tap opened conversation 2`);
      assert.ok(after.thread, `${v} ${width} ${theme}: the thread shows`);
      assert.match(after.text, /sign-in/i, `${v} ${width} ${theme}: it is the review thread`);
      const file = `open-${v}.${width}.${theme}.png`;
      await shoot(file);
      records.push({ file, option: label, width, theme, tap: at, before, after });
    }
  }
  writeFileSync(join(out, 'checks.json'), JSON.stringify(records, null, 2));
  let live = 'not captured';
  if (process.env.LIVE_BOARD_URL_FILE) {
    // The live board, read only: its Designs list, where the pick is listed once the board runs a build that lists picks there.
    const link = readFileSync(process.env.LIVE_BOARD_URL_FILE, 'utf8').trim(), base = link.replace(/#.*$/, '');
    for (const width of [390, 1280]) {
      await setup(width, 'light');
      await go(base, '#designs', 'light');
      const text = await evalIn(`(document.getElementById('board')?.innerText ?? '').replace(/\\s+/g, ' ')`);
      const version = await evalIn(`fetch('/api/state' + location.search).then((r) => r.json()).then((s) => s.version ?? '').catch(() => '')`);
      assert.match(text, new RegExp(TITLE.replace('?', '\\?')), `live ${width}: the pick is listed under Designs`);
      await shoot(`live-designs.${width}.light.png`);
      records.push({ file: `live-designs.${width}.light.png`, width, version, listed: true });
      live = `listed under Designs on the live board (${version || 'version not reported'})`;
    }
    sh('/usr/lib/chromium/chromium', ['--headless', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${join(prof, 'plain')}`, '--window-size=390,2400', '--virtual-time-budget=8000', `--screenshot=${join(out, 'plain-live-designs.390.png')}`, `${base}#designs`]);
    writeFileSync(join(out, 'checks.json'), JSON.stringify(records, null, 2));
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ commit: sh('git', ['rev-parse', 'HEAD']).stdout.trim(), target: { version: sh(process.execPath, [join(repo, 'dist/cli.js'), '--version']).stdout.trim() },
    start: 'A throwaway board holding the Inbox layout pick, posted by this checkout from the three option pages in fixtures/contract/design.v1/design/inbox-layout-pick/.',
    steps: ['Open the card in Decide', 'Tap each option\'s frame to open it full screen', 'Tap the second conversation inside the page', 'Capture at 390 and 1280 wide, light and dark', ...(process.env.LIVE_BOARD_URL_FILE ? ['Open the live board\'s Designs list at 390 and 1280, and once in plain headless Chromium at 390'] : [])],
    result: `every option opened the review thread after the tap; ${live}` }, null, 2));
} finally {
  try { ws?.close(); chrome?.kill(); server?.kill(); } catch {}
  await wait(400); rmSync(dir, { recursive: true, force: true }); rmSync(prof, { recursive: true, force: true });
}
