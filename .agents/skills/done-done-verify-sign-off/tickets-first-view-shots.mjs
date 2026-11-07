// The first view of Tickets reads only what it shows, driven over CDP in a headless Chromium of its own: #tickets on a fresh page reads /api/decisions?view=story (the Story's
// figures and its rows) and never the whole roll-up, at 390 and 1280 in light and dark; All tickets then reads the roll-up when it opens. payload.json holds the measured read
// before (the whole roll-up, view=tickets, which the first view read until now) and after (view=story), in rows and bytes. Usage: node tickets-first-view-shots.mjs <evidence folder>
// With TICKETS_FIRST_VIEW_BOARD=<folder holding board.json and its sidecars> it serves a fresh copy of that board (the folder itself is never written); without it a throwaway
// board is seeded with the CLI. CDP rather than chrome-devtools-axi: its screenshot of a 5,714-ticket board sometimes never returns.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]), repo = process.cwd(), source = process.env.TICKETS_FIRST_VIEW_BOARD;
mkdirSync(out, { recursive: true });
const dir = mkdtempSync('/tmp/signoff-tickets-first-'), board = join(dir, 'board.json'), prof = mkdtempSync(join(tmpdir(), 'so-first-view-cdp-'));
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir };
delete env.SIGN_OFF_FLEET_HOME;
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome;
try {
  let base;
  if (source) {
    cpSync(resolve(source), dir, { recursive: true });
    // serve stays in the foreground, so it starts detached with its words in a file; the run reads the address from there and stops it by name at the end.
    const log = openSync(join(dir, 'serve.out'), 'w');
    spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--bind', '127.0.0.1', '--port', '0'], { env, detached: true, stdio: ['ignore', log, log] }).unref();
    for (let i = 0; i < 120 && !base; i++) { await wait(250); base = /url: "(http:\/\/[^"]+)"/.exec(readFileSync(join(dir, 'serve.out'), 'utf8'))?.[1]; }
    assert.ok(base, 'the board copy is served');
  } else {
    base = execFileSync('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { env, encoding: 'utf8' }).match(/http:\/\/127\.0\.0\.1:\d+\//g).at(-1);
    for (const [id, state] of [['one', 'in progress'], ['two', 'queued'], ['three', 'done']]) cli('ticket', board, '--id', id, '--description', `Umer's step ${id} of the sync.`, '--title', `Umer's step ${id}`, '--project', 'Beacon', '--release', '0.2.0', '--state', state, ...(state === 'done' ? ['--progress', '100'] : state === 'in progress' ? ['--progress', '40'] : []));
  }
  // The read before (the whole roll-up the first view used to fetch) and after (the Story's own read), measured on this board as the page asks for them.
  const read = async (view) => { const res = await fetch(`${base}api/decisions?view=${view}`), bytes = Buffer.from(await res.arrayBuffer()); return { rows: JSON.parse(bytes).tickets.length, bytes: bytes.length }; };
  const payload = { before: { read: '/api/decisions?view=tickets', ...(await read('tickets')) }, after: { read: '/api/decisions?view=story', ...(await read('story')) } };
  assert.ok(payload.after.bytes < payload.before.bytes / 10, 'the first view reads a tenth of the bytes or less');
  const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
  chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let port; for (let i = 0; i < 300 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 600; i++) { if (await evaluate(expression)) return; await wait(100); } throw new Error(`not seen: ${what}`); };
  const shot = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const reads = `performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/decisions?view=story') || e.name.includes('/api/decisions?view=tickets')).map((e) => ({ read: e.name.replace(location.origin, ''), bytes: e.decodedBodySize }))`;
  const frames = [];
  for (const [width, theme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
    // A fresh page each time, so its resource timing holds only this open's reads; the width is the page's own, set as a device.
    await cdp('Page.navigate', { url: 'about:blank' }); await wait(200);
    await cdp('Emulation.setDeviceMetricsOverride', width === 390 ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp('Emulation.setTouchEmulationEnabled', width === 390 ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await cdp('Page.navigate', { url: `${base}#tickets` });
    await until(`document.body?.innerText.includes('Shipped this week')`, 'the Story');
    await evaluate(`try { localStorage.setItem('so-theme', '${theme}'); } catch {} location.reload()`).catch(() => {});
    await wait(500);
    await until(`document.body?.innerText.includes('Shipped this week')`, 'the Story after the theme');
    await wait(800);
    const seen = await evaluate(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, head: document.querySelector('.tk-total')?.textContent ?? '', grid: !!document.querySelector('.tk-dots'), reads: ${reads} })`);
    assert.equal(seen.width, width, `the Story is drawn ${width} px wide`);
    assert.equal(seen.overflow, false);
    assert.equal(seen.grid, false, 'no square grid');
    assert.ok(seen.reads.some((r) => r.read.includes('view=story')) && !seen.reads.some((r) => r.read.includes('view=tickets')), `the first view reads the Story only: ${JSON.stringify(seen.reads)}`);
    const name = `story.${theme}.${width}.png`;
    await shot(join(out, name));
    frames.push({ frame: name, ...seen });
  }
  // All tickets is one tap away and reads the whole roll-up when it opens.
  await evaluate(`location.hash = '#tickets/all'`);
  await until(`[...document.querySelectorAll('section[aria-label]')].some((s) => s.getAttribute('aria-label') === 'In progress') && performance.getEntriesByType('resource').some((e) => e.name.includes('view=tickets'))`, 'All tickets');
  await wait(1500);
  const all = await evaluate(`({ width: innerWidth, rows: document.querySelectorAll('.tk-row').length, reads: ${reads} })`);
  assert.ok(all.reads.some((r) => r.read.includes('view=tickets')), 'All tickets reads the roll-up');
  await shot(join(out, 'all.dark.1280.png'));
  frames.push({ frame: 'all.dark.1280.png', ...all });
  ws.close();
  writeFileSync(join(out, 'payload.json'), JSON.stringify({ ...payload, frames }, null, 2) + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: source ? 'A fresh copy of the fleet board, served by sign-off-axi serve' : 'A new board of three tickets in one release, served by sign-off-axi serve',
    steps: ['Open Tickets on a fresh page', 'Open All tickets'],
    result: `On a phone and on a desk, in light and in dark, Tickets opens on the Story and its first read is the Story's own: ${payload.after.rows} rows and ${payload.after.bytes} bytes, where the whole roll-up it read before is ${payload.before.rows} rows and ${payload.before.bytes} bytes. All tickets reads the roll-up when it opens.` }, null, 2) + '\n');
} finally {
  // Each stop is its own step, so one that fails never hides the error of the capture itself.
  try { chrome?.kill(); } catch {}
  try { cli('stop', board); } catch {}
  rmSync(dir, { recursive: true, force: true });
  rmSync(prof, { recursive: true, force: true });
}
