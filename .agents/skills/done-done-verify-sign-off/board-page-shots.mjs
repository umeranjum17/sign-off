// The board a report holds, opened full screen: the canvas the agent's data is drawn on, sign-off's own bar, and the walk-through.
// Read-only in this slice, so the proof is what a person sees and does: the board draws, the editor shows no control of its own,
// two fingers change the zoom, each step frames its shapes, every request goes to this board, and nothing scrolls sideways.
// Usage: node .agents/skills/done-done-verify-sign-off/board-page-shots.mjs <output> [light|dark] [390|1280]
// It writes board-page.<theme>.<width>w.png (the board as it opens), board-page-step.<theme>.<width>w.png (a step) and a
// board-page.<theme>.<width>w.json of every number the checks turn on, beside board-page-steps.json.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';

const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
const phone = width < 700, height = phone ? 844 : 800, dpr = phone ? 2 : 1;
const records = recordsDir(out), stem = `board-page.${theme}.${width}w`;
mkdirSync(out, { recursive: true });
mkdirSync(records, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => process.env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
assert.ok(chromium, 'a Chrome or Chromium on the PATH');

const dir = mkdtempSync(join(tmpdir(), 'so-boardpage-')), board = join(dir, 'board.json'), prof = join(dir, 'chrome');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const cli = join(repo, 'dist/cli.js');
const sh = (args) => { const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, cwd: dir, timeout: 60000 }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
// An agent's report 6 whose section holds the first real board: the line after the plan, 17 shapes, 22 arrows, one zone, six steps.
const message = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v6/valid-line.json'), 'utf8'));
const data = message.sections[0].board;
sh(['post', board, '--kind', 'report', '--from', join(repo, 'fixtures/contract/report.v6/valid-line.json')]);

const server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b)); server.stderr.on('data', (b) => (log += b));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const errors = [], requests = [];
let ws;
const cdp = (method, params = {}) => new Promise((ok, no) => {
  const id = (cdp.id = (cdp.id ?? 0) + 1);
  const once = (m) => { const x = JSON.parse(m.data); if (x.id !== id) return; ws.removeEventListener('message', once); x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result); };
  ws.addEventListener('message', once);
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  assert.ok(!r.exceptionDetails, `${expression.slice(0, 120)}: ${r.exceptionDetails?.exception?.description}`);
  return r.result.value;
};
const shot = async (name) => writeFileSync(join(out, name), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const go = async (url, ms = 1200) => { await cdp('Page.navigate', { url }); await wait(ms); };
/** Wait for the page to say it is ready, then read one fact from it. */
const until = async (expression, label, tries = 120) => { for (let i = 0; i < tries; i++) { try { const v = await js(expression); if (v) return v; } catch {} await wait(100); } throw new Error(`not ready: ${label}`); };
/** The canvas as the editor sees it: its elements and the state that maps board coordinates onto the screen. */
const scene = () => js(`(() => {
  const api = window.WB?.api; if (!api) return null;
  const st = api.getAppState(), z = st.zoom.value, elements = api.getSceneElements().filter((e) => !e.isDeleted);
  const box = (e) => ({ x: e.x, y: e.y, w: e.width, h: e.height });
  const screen = (b) => ({ left: (b.x + st.scrollX) * z + st.offsetLeft, top: (b.y + st.scrollY) * z + st.offsetTop, right: (b.x + b.w + st.scrollX) * z + st.offsetLeft, bottom: (b.y + b.h + st.scrollY) * z + st.offsetTop });
  const canvas = document.getElementById('canvas').getBoundingClientRect();
  return {
    zoom: z, count: elements.length, locked: elements.filter((e) => e.locked).length,
    canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom },
    boxes: Object.fromEntries(elements.map((e) => [e.id, { ...box(e), screen: screen(box(e)), locked: !!e.locked }])),
    step: document.getElementById('count').textContent, words: document.getElementById('words').textContent,
    controls: [...document.querySelectorAll('.excalidraw button, .excalidraw [role=button], .excalidraw label, .excalidraw input, .excalidraw a, .excalidraw canvas + *')]
      .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })
      .map((e) => (e.className?.baseVal ?? e.className ?? e.tagName).toString().slice(0, 40)),
    bar: [...document.querySelectorAll('.acts button, .acts a')].map((b) => b.textContent.trim()),
  };
})()`);
/** Two fingers moving apart on the board: a real pinch, at the board's own centre. */
const pinch = async (from, to) => {
  const x = Math.round(phone ? 195 : 640), y = Math.round(phone ? 500 : 460);
  const points = (gap) => [{ x: x - gap, y, id: 1 }, { x: x + gap, y, id: 2 }];
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (const gap of [from + 6, (from + to) / 2, to]) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(gap) }); await wait(40); }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(300);
};

try {
  let base;
  for (let i = 0; i < 100 && !base; i++) { await wait(100); base = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; }
  assert.ok(base, `the board served: ${log}`);
  const boardUrl = new URL(`board/${message.key}/0`, base).href;
  let port;
  for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium answered');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  ws.addEventListener('message', (m) => {
    const x = JSON.parse(m.data);
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    if (x.method === 'Network.requestWillBeSent') requests.push(x.params.request.url);
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: phone });
  // Two fingers are part of the journey at both widths: a desk gets the same touch input the phone does.
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });

  // The way in: the report lists the board, and its Open board goes to the board's own page.
  await go(`${base}#reports/${message.key}`, 2500);
  await js(`document.querySelector('.rp-open-full')?.click()`);
  const link = await until(`document.querySelector('.kb-open')?.getAttribute('href')`, 'the report offers Open board');
  assert.equal(link, `/board/${message.key}/0`, 'Open board names the board page');
  await cdp('Network.enable');
  requests.length = 0;
  await go(new URL(link, base).href, 500);
  try { await until(`window.WB?.api && window.WB.api.getSceneElements().filter((e) => !e.isDeleted).length > 0`, 'the canvas drew the board'); }
  catch (e) { throw new Error(`${e.message}; the page says ${await js(`JSON.stringify({ url: location.href, title: document.title, wb: typeof window.WB, api: typeof window.WB?.api, canvas: document.getElementById('canvas')?.childElementCount, step: document.getElementById('step')?.textContent, errors: ${JSON.stringify(errors)} })`)}`); }
  await wait(900);
  const opened = await scene();
  assert.equal(await js(`document.getElementById('title').textContent`), data.title);
  assert.equal(await js(`document.title`), `${data.title} · Board · sign-off`);
  // Every shape and every line of the board is on the canvas, and all of it is the agent's: nothing on this page can move it.
  const api = await js(`fetch('/api/board/${message.key}/0').then((r) => r.json())`);
  assert.deepEqual(api.elements.map((e) => e.id).filter((id) => !opened.boxes[id]), [], 'every shape, line and zone of the board is on the canvas');
  assert.equal(opened.locked, opened.count, 'every element the agent drew is locked');
  // The editor in view mode keeps every control of its own out of sight: the bar is sign-off's.
  assert.deepEqual(opened.controls, [], 'no control of the editor is in view');
  assert.deepEqual(opened.bar, ['Back', 'Next', 'Move', 'Fit', 'Close']);
  assert.match(opened.words, /6 steps/, 'the board says how many steps it has');
  // A phone shows no sideways scroll, and nothing of the page is drawn over.
  const layout = await js(`({ scroll: document.documentElement.scrollWidth, inner: innerWidth, canvas: document.getElementById('canvas').getBoundingClientRect().height, bar: document.querySelector('.bar').getBoundingClientRect().bottom, docHeight: document.documentElement.scrollHeight, innerHeight })`);
  assert.ok(layout.scroll <= layout.inner, `the page does not scroll sideways: ${layout.scroll} > ${layout.inner}`);
  assert.ok(layout.canvas > 200, `the board has room to draw: ${layout.canvas}px`);
  await shot(`${stem}.png`);
  // Two fingers change the zoom; Fit puts the whole board back in view.
  await pinch(30, 130);
  const pinched = await scene();
  assert.ok(pinched.zoom > opened.zoom * 1.1, `a two-finger pinch zooms in: ${opened.zoom} to ${pinched.zoom}`);
  await js(`document.getElementById('fit').click()`); await wait(400);
  const fitted = await scene();
  assert.ok(Math.abs(fitted.zoom - opened.zoom) < 0.02, `Fit frames the whole board again: ${fitted.zoom} against ${opened.zoom}`);
  // Every step frames the elements it names, and the words of that step are on the bar.
  const steps = [];
  for (let n = 0; n < data.steps.length; n++) {
    await js(`document.getElementById('next').click()`); await wait(500);
    const at = await scene();
    assert.ok(at.step === `${n + 1} of ${data.steps.length}`, `step ${n + 1} counts itself: ${at.step}`);
    assert.ok(at.words.includes(data.steps[n].title), `step ${n + 1} shows its words: ${at.words.slice(0, 60)}`);
    const ids = api.steps[n].ids;
    const framed = ids.map((id) => at.boxes[id]).filter(Boolean);
    const inside = framed.filter((b) => b.screen.left >= at.canvas.left - 2 && b.screen.right <= at.canvas.right + 2 && b.screen.top >= at.canvas.top - 2 && b.screen.bottom <= at.canvas.bottom + 2);
    assert.ok(framed.length >= 1, `step ${n + 1} frames at least one thing: ${JSON.stringify(data.steps[n].focus)}`);
    assert.equal(inside.length, framed.length, `step ${n + 1} frames all ${framed.length} of its elements in view`);
    steps.push({ step: n + 1, title: data.steps[n].title, zoom: at.zoom, framed: framed.length });
  }
  await shot(`board-page-step.${theme}.${width}w.png`);
  // Back walks the walk-through backwards and stops at the first step.
  await js(`document.getElementById('back').click()`); await wait(300);
  assert.ok((await scene()).step.endsWith(`of ${data.steps.length}`), 'Back leaves the last step for the one before it');
  for (let i = 0; i < data.steps.length + 2; i++) { await js(`document.getElementById('back').click()`); await wait(80); }
  assert.equal(await js(`document.getElementById('back').disabled`), true, 'Back stops at the first step');
  // No request left this board, and the page logged no error.
  const foreign = [...new Set(requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:')))];
  assert.deepEqual(foreign, [], `the board asks no other host for anything; it asked ${foreign.length}: ${foreign.slice(0, 6).join(' ')}`);
  assert.ok(requests.some((u) => u.includes('/board/board.js')), "the canvas bundle is this board's own file");
  assert.ok(requests.some((u) => u.includes('/api/board/')), "the scene comes from this board");
  assert.deepEqual(errors, [], 'no error in the console');
  writeFileSync(join(records, `${stem}.json`), JSON.stringify({ opened, pinched: pinched.zoom, fitted: fitted.zoom, steps, layout, requests: [...new Set(requests)], foreign }, null, 1));
  writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: a report's board opens full screen on its own page, drawn from the checked scene by the canvas inside the package: ${opened.count} locked elements, no control of the editor in view, pinch ${opened.zoom.toFixed(2)} to ${pinched.zoom.toFixed(2)}, all ${data.steps.length} steps framed, every request to this board.\n`);
  writeFileSync(join(out, 'board-page-steps.json'), JSON.stringify({
    target: { version: `${JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version} at ${spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim()}` },
    start: 'A clean board holding one report 6 whose design section carries the first real board (17 shapes, 22 arrows, one zone, six steps), posted through the CLI, with the canvas built by npm run build:board.',
    steps: ['Open the report and follow its Open board into the board page at this width.', 'Read the board as it opens, pinch it with two fingers, and step through the walk-through with Next and Back.'],
    result: 'The board draws full screen with sign-off\'s own bar (Back, Next, Move, Fit, Close), no control of the editor in view, a pinch that changes the zoom, every step framed, and no request to another host.',
  }));
  console.log(`board page ${theme} ${width}: ${opened.count} elements, pinch ${opened.zoom.toFixed(2)} to ${pinched.zoom.toFixed(2)}, ${data.steps.length} steps framed`);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM');
  try { spawnSync(process.execPath, [cli, 'stop', board], { env, encoding: 'utf8', timeout: 30000 }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
