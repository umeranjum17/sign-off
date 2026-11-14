// The board inside the report (whiteboard slice 3): the framed picture of the drawing with its Open board entry, Back to the same place in the report,
// the canvas files kept so a second open asks the server for none of them, the board still drawn with the server stopped, and a rebuilt canvas that
// drops the older cache. The browser's requests are read at a proxy in front of the board, so the counts and the 304s are the server's own answers.
// Usage: node .agents/skills/done-done-verify-sign-off/board-cache-shots.mjs <output> [light|dark] [390|1280]
// It writes board-cache-back.<theme>.<width>w.png (the report, back where the board was opened from) and board-cache-offline.<theme>.<width>w.png
// (the board drawn with the server stopped), with board-cache.<theme>.<width>w.json and .txt, beside board-cache-steps.json.
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';

const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
const phone = width < 700, height = phone ? 844 : 800, dpr = phone ? 2 : 1;
const records = recordsDir(out), stem = `board-cache.${theme}.${width}w`, cell = `${theme}.${width}w`;
mkdirSync(out, { recursive: true });
mkdirSync(records, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => process.env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
assert.ok(chromium, 'a Chrome or Chromium on the PATH');
/** A canvas file: the bundle and its chunks, the drawing font, and the page's short entries, which the page asks for again on each open. */
const CANVAS_FILE = /^\/board\/(?:chunks\/|fonts\/|board-[\w-]+\.(?:js|css)$)/;

const dir = mkdtempSync(join(tmpdir(), 'so-boardcache-')), board = join(dir, 'board.json'), prof = join(dir, 'chrome'), copy = join(dir, 'build2');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const cli = join(repo, 'dist/cli.js');
const sh = (args, at = dir) => { const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, cwd: at, timeout: 60000 }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const message = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v6/valid-line.json'), 'utf8'));
sh(['post', board, '--kind', 'report', '--from', join(repo, 'fixtures/contract/report.v6/valid-line.json')]);

/** The board, behind a proxy that keeps every request the server is asked for and the answer it gave: the counts and the 304s are read here. */
const asked = [];
let server, proxy, port, base, log = '';
const startProxy = (tries = 20) => new Promise((ok, no) => {
  proxy = createServer((req, res) => {
    const up = request({ host: '127.0.0.1', port: server.port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${server.port}` } }, (answer) => {
      asked.push({ method: req.method, url: req.url, status: answer.statusCode });
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    up.on('error', () => { asked.push({ method: req.method, url: req.url, status: 0 }); res.writeHead(502).end(); });
    req.pipe(up);
  });
  // The same port again after a stop: the browser's own origin must not change, so a listen that is a moment late is tried again.
  proxy.once('error', async (e) => { if (tries > 0 && e.code === 'EADDRINUSE') { await wait(200); startProxy(tries - 1).then(ok, no); } else no(e); });
  proxy.listen(port ?? 0, '127.0.0.1', () => { port ??= proxy.address().port; base = `http://127.0.0.1:${port}/`; ok(); });
});
const startServer = (cliPath = cli, cwd = dir) => new Promise((ok, no) => {
  log = '';
  server = spawn(process.execPath, [cliPath, 'serve', board, '--port', '0'], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (b) => (log += b)); server.stderr.on('data', (b) => (log += b));
  const found = () => { const m = /url: "http:\/\/127\.0\.0\.1:(\d+)\//.exec(log); return m ? Number(m[1]) : 0; };
  const poll = async () => { for (let i = 0; i < 200; i++) { const at = found(); if (at) return ok(at); await wait(50); } no(new Error(`the board served: ${log}`)); };
  poll();
});
const stack = async () => { const real = await startServer(); server.port = real; await startProxy(); };
const stopStack = () => new Promise((ok) => {
  if (!proxy) return ok();
  const closing = proxy;
  proxy = undefined;
  closing.close(() => {});
  if (!server || server.exitCode !== null) return ok();
  server.once('exit', () => ok());
  server.kill('SIGTERM');
});
/** A second build of the canvas from a copy of this checkout, so a rebuilt canvas is a real build and no tracked file changes. */
const rebuild = () => {
  for (const part of ['dist', 'scripts', 'web']) cpSync(join(repo, part), join(copy, part), { recursive: true });
  cpSync(join(repo, 'package.json'), join(copy, 'package.json'));
  symlinkSync(join(repo, 'node_modules'), join(copy, 'node_modules'));
  // One line more in the canvas's own entry: the rebuilt bundle is different, so every canvas file gets a new name.
  appendFileSync(join(copy, 'scripts/board/entry.js'), '\nwindow.WB_BUILD = 2;\n');
  const built = spawnSync(process.execPath, [join(copy, 'scripts/build-board.mjs')], { encoding: 'utf8', cwd: copy, env, timeout: 300000 });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const before = readFileSync(join(repo, 'web/board/board.js'), 'utf8'), after = readFileSync(join(copy, 'web/board/board.js'), 'utf8');
  assert.notEqual(after, before, 'the rebuilt canvas names a different file');
  return after.trim();
};

const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const errors = [];
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
const go = async (url, ms = 900) => { await cdp('Page.navigate', { url }); await wait(ms); };
const until = async (expression, label, tries = 200) => { for (let i = 0; i < tries; i++) { try { const v = await js(expression); if (v) return v; } catch {} await wait(100); } throw new Error(`not ready: ${label}`); };

try {
  await stack();
  let devPort;
  for (let i = 0; i < 100 && !devPort; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) devPort = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(devPort, 'Chromium answered');
  const target = await (await fetch(`http://127.0.0.1:${devPort}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  ws.addEventListener('message', (m) => {
    const x = JSON.parse(m.data);
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: phone });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });

  // 1. The report, its framed picture of the board, and one way in. The block is brought into view and the place is kept for the way back.
  await go(`${base}#reports/${message.key}`, 2600);
  const block = await until(`document.querySelector('.kb-board') && (() => {
    const pic = document.querySelector('.kb-pic'), frame = document.querySelector('.kb-frame'), open = document.querySelector('.kb-open'), box = document.querySelector('.kb-board');
    if (!pic || !open) return null;
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { pic: r(pic), frame: r(frame), open: r(open), alt: pic.alt, href: open.getAttribute('href'), label: open.textContent.trim(), natural: [pic.naturalWidth, pic.naturalHeight], board: r(box) };
  })()`, 'the board block with its picture');
  assert.match(block.href, new RegExp(`^/board/${message.key}/0$`), 'the entry opens the board page of this report');
  assert.equal(block.label, 'Open board', 'the entry says Open board');
  assert.ok(block.natural[0] > 0 && block.natural[1] > 0, `the picture drew the board: ${block.natural.join('x')}`);
  assert.ok(block.pic.y >= block.frame.y && block.pic.y + block.pic.h <= block.frame.y + block.frame.h + 1, 'the picture sits inside its frame');
  assert.ok(block.open.y >= block.frame.y, 'the entry sits with the picture');
  await js(`(() => { const s = document.querySelector('#reader .gd-scroll'), b = document.querySelector('.kb-board');
    const want = Math.min(s.scrollTop + b.getBoundingClientRect().top - s.getBoundingClientRect().top - 60, s.scrollHeight - s.clientHeight);
    s.scrollTo({ top: Math.max(0, want), behavior: 'instant' }); })()`);
  // The report settles first: a part read for a moment adds its receipt line above the board, which moves the block down.
  await wait(2200);
  const placeOf = () => js(`(() => { const s = document.querySelector('#reader .gd-scroll'), b = document.querySelector('.kb-board');
    return Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().top); })()`);
  const settled = await placeOf();
  assert.ok(settled > 24, `the block is down the report, scrolled to: ${settled}`);

  // 2. Open board: the board's own page, its canvas asked for on this first open. The place is measured in the same turn as the tap, so
  // nothing that lays out between the two can be blamed for the difference.
  asked.length = 0;
  const left = await js(`(() => { const s = document.querySelector('#reader .gd-scroll'), b = document.querySelector('.kb-board');
    const at = Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().top); document.querySelector('.kb-open').click(); return at; })()`);
  await until(`window.WB?.api && window.WB.api.getSceneElements().filter((e) => !e.isDeleted).length > 0`, 'the board drew');
  await wait(1200);
  const firstOpen = asked.filter((a) => a.url.startsWith('/board/') || a.url.startsWith('/api/board'));
  const canvasFirst = firstOpen.filter((a) => CANVAS_FILE.test(a.url.split('?')[0]));
  assert.ok(canvasFirst.length > 1, `the first open asked for the canvas files: ${canvasFirst.length}`);
  assert.equal(await js(`document.querySelectorAll('.excalidraw').length`), 1, 'the board page is what opened');
  const cachesBefore = await js(`caches.keys()`);
  const boardCache = cachesBefore.find((n) => n.startsWith('board-'));
  assert.ok(boardCache, `the worker keeps a cache for this build: ${cachesBefore.join(', ')}`);

  // 3. Back returns to the same place in the report, not to its top.
  await js(`document.getElementById('exit').click()`);
  await until(`document.querySelector('.kb-board') && document.querySelector('.kb-pic')`, 'the report again');
  await wait(900);
  const back = await placeOf();
  assert.ok(Math.abs(back - left) <= 4, `Back returns to the block it was opened from: ${back} against ${left}`);
  assert.ok(await js(`(() => { const s = document.querySelector('#reader .gd-scroll'); return s.scrollTop; })()`) > 100, 'the report itself is scrolled down, not at its top');
  await shot(`board-cache-back.${cell}.png`);

  // 4. A second open: the page, its script and the board's data are asked for again and answered 304, and no canvas file is asked for at all.
  asked.length = 0;
  await js(`document.querySelector('.kb-open').click()`);
  await until(`window.WB?.api && window.WB.api.getSceneElements().filter((e) => !e.isDeleted).length > 0`, 'the board drew again');
  await wait(1500);
  const second = asked.filter((a) => a.url.split('?')[0].startsWith('/board/') || a.url.startsWith('/api/board'));
  const canvasSecond = second.filter((a) => CANVAS_FILE.test(a.url.split('?')[0]));
  assert.deepEqual(canvasSecond.map((a) => a.url), [], `the second open asks for no canvas file; it asked for ${canvasSecond.map((a) => a.url).join(', ')}`);
  const statusOf = (path) => second.find((a) => a.url.split('?')[0] === path)?.status;
  for (const path of [`/board/${message.key}/0`, '/board/board.js', '/board/board.css']) assert.equal(statusOf(path), 304, `the second open revalidates ${path}: ${statusOf(path)}`);
  assert.equal(statusOf(`/api/board/${message.key}/0`), 304, 'the second open revalidates the board data');
  const pages = second.filter((a) => a.url.split('?')[0] === `/board/${message.key}/0`).length;
  assert.equal(pages, 1, 'the page is asked for once');

  // 5. With the board stopped, the kept copy draws: the page, its script, its canvas files and its data are all the browser's own.
  await stopStack();
  await go(`${base}board/${message.key}/0`, 1200);
  const drawnOffline = await until(`window.WB?.api && window.WB.api.getSceneElements().filter((e) => !e.isDeleted).length > 0 && window.WB.api.getSceneElements().filter((e) => !e.isDeleted).length`, 'the board drew with the server stopped', 100);
  assert.ok(drawnOffline > 10, `the board draws with the server stopped: ${drawnOffline} elements`);
  assert.equal(await js(`document.getElementById('title').textContent`), message.sections[0].board.title, 'the board says which board it is');
  await shot(`board-cache-offline.${cell}.png`);

  // 6. A rebuilt canvas: the older cache is dropped, and the files of the new build are fetched.
  const rebuilt = rebuild();                             // a real build of the canvas, from a copy of this checkout
  const next = spawn(process.execPath, [join(copy, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, cwd: copy, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  next.stdout.on('data', (b) => (said += b)); next.stderr.on('data', (b) => (said += b));
  let newPort = 0;
  for (let i = 0; i < 200 && !newPort; i++) { await wait(50); newPort = Number(/url: "http:\/\/127\.0\.0\.1:(\d+)\//.exec(said)?.[1] ?? 0); }
  assert.ok(newPort, `the rebuilt board served: ${said}`);
  server = next;
  server.port = newPort;
  await startProxy();                                    // the same origin, so the browser's own cache and worker still apply
  // The app itself is where the worker takes a new build: opening it is how the older cache is dropped on a real device too.
  await go(base, 2500);
  let cachesAfter = [];
  for (let i = 0; i < 300; i++) { cachesAfter = await js(`caches.keys()`); if (!cachesAfter.includes(boardCache)) break; await wait(100); }
  assert.ok(!cachesAfter.includes(boardCache), `the older board cache is gone: ${boardCache} in ${cachesAfter.join(', ')}`);
  asked.length = 0;
  await go(`${base}board/${message.key}/0`, 1500);
  await until(`window.WB?.api && window.WB.api.getSceneElements().filter((e) => !e.isDeleted).length > 0`, 'the board drew from the new build');
  await wait(800);
  cachesAfter = await js(`caches.keys()`);
  const newer = cachesAfter.find((n) => n.startsWith('board-'));
  assert.ok(newer && newer !== boardCache, `the new build keeps its own cache: ${newer} in ${cachesAfter.join(', ')}`);
  const fetched = asked.filter((a) => CANVAS_FILE.test(a.url.split('?')[0]) && a.status === 200).map((a) => a.url);
  assert.ok(fetched.length > 1, `the new build's files are fetched: ${fetched.slice(0, 4).join(', ')}`);
  assert.ok(fetched.some((u) => basename(u).startsWith('board-')), `the new canvas bundle is one of them: ${fetched.slice(0, 4).join(', ')}`);
  assert.ok(!fetched.some((u) => u.includes(basename(boardCache))), 'nothing of the older build is fetched');
  assert.deepEqual(errors, [], 'no error in the console');

  const record = { cell, firstOpen: firstOpen.map((a) => `${a.status} ${a.url}`), canvasFirst, second: second.map((a) => `${a.status} ${a.url}`), canvasSecond, cachesBefore, cachesAfter, rebuilt: { loader: rebuilt, fetched }, place: { left, back }, offline: drawnOffline };
  writeFileSync(join(records, `${stem}.json`), JSON.stringify(record, null, 1));
  writeFileSync(join(out, `${stem}.txt`), [
    `${width}px ${theme}: a board on a report is a framed picture of the agent's drawing with one Open board entry, and Back returns to the block it was opened from (${back}px after ${left}px).`,
    `On a second open the server was asked for no canvas file at all (${canvasSecond.length}), and the page, /board/board.js, /board/board.css and /api/board/${message.key}/0 were each answered 304.`,
    `With the board stopped the kept copy drew the whole board again: ${drawnOffline} elements.`,
    `After a real rebuild of the canvas the older cache ${boardCache} was gone, ${newer} took its place, and ${fetched.length} files of the new build were fetched.`,
  ].join('\n') + '\n');
  writeFileSync(join(out, 'board-cache-steps.json'), JSON.stringify({
    target: { version: `${JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version} at ${spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim()}` },
    start: 'A clean board holding one report 6 whose design section carries the first real board, posted through the CLI, with the canvas built by npm run build:board, served through a proxy that keeps every request and answer.',
    steps: ['Open the report: the board is a framed picture with one Open board entry, and the block is left at a known place.',
      'Open the board, then Back: the report returns to the same place, not to its top.',
      'Open the board again: no canvas file is asked for, and the page, its script, its stylesheet and the board data are answered 304.',
      'Stop the board, then open the board page: it draws from the kept copy.',
      'Rebuild the canvas from a copy of this checkout and serve it on the same origin: the older board cache is gone and the new build\'s files are fetched.'],
    result: 'The board sits where the agent explains it, opens at once the second time, draws with the board stopped, and never draws an older build after a rebuild.',
  }));
  console.log(`board cache ${theme} ${width}: back ${back}/${left}, ${canvasSecond.length} canvas requests on the second open, ${drawnOffline} elements offline, cache ${boardCache} to ${newer}`);
} finally {
  try { ws?.close(); } catch {}
  try { proxy?.close(); } catch {}
  chrome.kill('SIGTERM');
  try { if (server) server.kill('SIGTERM'); } catch {}
  try { spawnSync(process.execPath, [cli, 'stop', board], { env, encoding: 'utf8', timeout: 30000 }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
