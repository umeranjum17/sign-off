// Tickets' See all on a phone, one theme and width per run (360, 390 or 445 wide on a phone; 1280 or 1440 on a desk), in a headless Chromium of its own over the DevTools protocol.
// The board has your asks only, in four lists of seven, eight, six and seven rows. On a phone: On hold is expanded (8 · Show fewer, captured as `sections`), then a real touch goes down on To do's See all, the list moves 60px under the finger before the tap lands (as a redraw or a settling page moves it), and the
// finger lifts: To do expands and no ticket opens (`expanded`). Each other section is then tapped the same way after each one expanded, and each must expand. A desk's lists scroll inside
// their cards and have no See all, so it saves the one `desk` frame, with no row opened and no sideways overflow.
// Usage: node .agents/skills/done-done-verify-sign-off/tickets-seeall-shots.mjs <output> [light|dark] [360|390|445|1280|1440]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), side = process.env.SEEALL_SIDE ?? 'after';
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-seeall-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const cli = (...args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const metrics = phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: width >= 1440 ? 900 : 800, deviceScaleFactor: 2, mobile: false };
const name = (state) => `${state}.${side}.${theme}.${width}w`;
const prof = mkdtempSync(join(tmpdir(), 'so-seeall-chrome-'));
let server, chrome, ws;
try {
  cli('raise', board, '--key', 'seed', '--title', 'Ship the page?', '--why', 'Seeds the board.', '--outcome', 'yes=Ships', '--outcome', 'no=Waits', '--recommend', 'yes', '--default', 'no', '--ask-ref', 'seed', '--recommend-reason', 'It is ready.');
  const T = (id, title, ...flags) => cli('ticket', board, '--id', id, '--title', title, '--asked', 'yes', ...flags);
  const lists = [['mv', 'In progress', 7, ['--progress', '30']], ['hold', 'On hold', 8, ['--hold', 'yes']], ['todo', 'To do', 6, []], ['done', 'Done', 7, ['--progress', '100']]];
  for (const [key, label, n, flags] of lists) for (let i = 0; i < n; i++) T(`${key}${i}`, `${label} ticket ${i + 1}`, '--priority', ['P1', 'P2', 'P3'][i % 3], ...flags);
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  const url = await new Promise((ok, no) => { server.stdout.on('data', (d) => { const m = /url: "(\S+)"/.exec(String(d)); if (m) ok(m[1]); }); server.on('exit', () => no(new Error('serve exited'))); });
  chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception'); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', metrics); await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const png = async (state) => { await wait(400); writeFileSync(join(out, `${name(state)}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
  const fresh = async () => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: `${url}#tickets` }); await wait(1200);
    for (let i = 0; i < 60 && !(await js(`document.querySelectorAll('main section[aria-label] .tk-row, main .tk-card').length > 3`)); i++) await wait(100); };
  const read = () => js(`({ hash: location.hash, rows: Object.fromEntries([...document.querySelectorAll('main section[aria-label]')].map((s) => [s.getAttribute('aria-label'), s.querySelectorAll('a.tk-row').length])),
    buttons: Object.fromEntries([...document.querySelectorAll('main section[aria-label]')].map((s) => [s.getAttribute('aria-label'), s.querySelector('.ui-sec .see')?.textContent ?? null])), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
  const centre = (label) => js(`(() => { const e = document.querySelector('main section[aria-label="${label}"] .ui-sec .see'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const touch = async ([x, y], shift) => {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    if (shift) await js(`document.querySelector('main').style.paddingTop = 'calc(' + getComputedStyle(document.querySelector('main')).paddingTop + ' + ${shift}px)'`);
    await wait(60); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(400);
    if (shift) await js(`document.querySelector('main').style.paddingTop = ''`);
  };
  const sizes = Object.fromEntries(lists.map(([, label, n]) => [label, n])), result = {};
  if (phone) {
    // Every other section, tapped with the list moving under the finger, after each one was expanded.
    for (const [, open] of lists) for (const [, other] of lists.filter(([, l]) => l !== open)) {
      await fresh();
      await touch(await centre(open), 0);
      assert.equal((await read()).rows[open], sizes[open], `${open} expands`);
      await touch(await centre(other), 60);
      const now = await read();
      assert.equal(now.hash, '#tickets', `${open} expanded, See all on ${other} opened ${now.hash}`);
      assert.equal(now.rows[other], sizes[other], `See all on ${other} expands it`);
    }
    await fresh();
    await touch(await centre('On hold'), 0);
    await js(`document.querySelector('main section[aria-label="On hold"] h2').scrollIntoView({ block: 'start' }); scrollBy(0, -16)`);
    await png('sections'); result.sections = await read();
    await touch(await centre('To do'), 60);
    await js(`scrollTo(0, scrollY)`);
    result.expanded = await read();
    assert.equal(result.expanded.hash, '#tickets'); assert.equal(result.expanded.rows['To do'], 6); assert.equal(result.expanded.rows['On hold'], 8);
    await js(`document.querySelector('main section[aria-label="To do"] h2').scrollIntoView({ block: 'start' }); scrollBy(0, -16)`);
    await png('expanded');
  } else {
    await fresh(); await png('desk'); result.desk = await read();
    assert.equal(result.desk.hash, '#tickets'); assert.equal(result.desk.overflow, false);
    assert.equal(await js(`document.querySelectorAll('main .ui-sec .see').length`), 0);
  }
  assert.deepEqual(errors, [], 'no console error');
  writeFileSync(join(out, `facts.${side}.${theme}.${width}w.json`), JSON.stringify(result, null, 2) + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with 28 of your asks written through sign-off-axi ticket, in four lists of seven (In progress), eight (On hold), six (To do) and seven (Done), each with a priority.',
    steps: phone ? [`Open Tickets at ${width}x844 (2x), ${theme}, in a headless Chromium of its own.`, 'Tap On hold 3 · See all: it expands to 8 rows with Show fewer.', 'Scroll to On hold\'s head and capture it: 8 · Show fewer.',
      'Put a real finger down on To do\'s See all, move the list 60px under it before the finger lifts, then lift it.', 'Capture Tickets: To do shows all six rows and no ticket opened.', 'Repeat for every other pair: expand one section, then tap See all on each other one.']
      : [`Open Tickets at ${width}x${metrics.height} (2x), ${theme}, in a headless Chromium of its own.`, 'Capture it and count the See all buttons (none: each list scrolls inside its card).'],
    result: phone ? `${theme}, on a phone (${width} px wide): Tickets first shows On hold open with its eight rows and Show fewer in its head, then, after a tap on To do's See all while the list moved under the finger, To do lists all six of its rows with Show fewer in its head and no ticket sheet is open.`
      : `${theme}, at ${width} px: Tickets shows In progress, On hold and To do as cards with no See all and no row opened.` }, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  try { ws?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  try { server?.kill(); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
