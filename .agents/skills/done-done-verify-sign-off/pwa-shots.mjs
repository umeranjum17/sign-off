// The board as an installable app: Today's More with its Install app row at 360, 390, 445, 1280 and 1440, light and dark; the same row as Safari on an iPad has it
// (Add to Home Screen, no prompt); the manifest and the service worker as the browser reads them; and the board with its server gone: the page and the last update
// read from the device, the line "Offline, showing the last update", and a send that fails and keeps nothing.
// Driven and measured in a headless Chromium of its own over the DevTools protocol (2x). The board is served from this checkout on loopback, so no access token is in play.
// Usage: node .agents/skills/done-done-verify-sign-off/pwa-shots.mjs <output>   (after npm run build)
// Saves more-install.<theme>.<width>w.png, ipad-safari.<theme>.820w.png, offline.<theme>.390w.png, each with its .measure.json, installability.json, pwa.txt and steps.json; the run fails on any check.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve('.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-pwa-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 300000, env, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// The open More sheet: the install row's words and box, whether its value is cut, and the page checks.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const box = (e) => e.getBoundingClientRect(), r2 = (n) => Math.round(n * 100) / 100, w = document.documentElement.clientWidth, h = innerHeight;
  const sheet = document.querySelector('dialog.t-sheet[open]'), row = sheet && [...sheet.querySelectorAll('.ui-pr')].find((p) => /Install app|Add to Home Screen/.test(p.innerText));
  const value = row?.querySelector('.v > span'), b = row && box(row);
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => box(e).width && box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  return { viewport: w + 'x' + h, rows: sheet ? [...sheet.querySelectorAll('.ui-pr')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim()) : null,
    row: row ? { text: row.innerText.replace(/\\s+/g, ' ').trim(), tag: row.tagName.toLowerCase(), left: r2(b.left), top: r2(b.top), right: r2(b.right), bottom: r2(b.bottom), height: r2(b.height), valueCut: value.scrollWidth > value.clientWidth } : null,
    offline: (() => { const o = document.getElementById('offline'); return o && { hidden: o.hidden, text: o.textContent, top: r2(box(o).top), bottom: r2(box(o).bottom), shows: o.hidden ? null : getComputedStyle(o).display !== 'none' }; })(),
    bodyText: document.body.innerText.slice(0, 400), overflow: document.documentElement.scrollWidth > w, overflowing };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-pwa-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws;
const errors = [], failed = [], lines = [];
try {
  const base = sh('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir]).trim().split('\n').pop();
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
  const until = async (expression, why) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await wait(200); } assert.fail(why); };
  const view = async (theme, width) => {
    const phone = width < 1024;
    await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  };
  const save = async (shot, theme, width, m, allowFailed) => {
    writeFileSync(join(out, `${shot}.${theme}.${width}w.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    writeFileSync(join(out, `${shot}.${theme}.${width}w.measure.json`), JSON.stringify({ ...m, console_errors: [...errors], failed_requests: allowFailed ? [] : [...failed] }, null, 2) + '\n');
    assert.ok(!m.overflow && !errors.length && (allowFailed || !failed.length), `${shot} ${theme} ${width}: overflow, console errors or failed requests ${JSON.stringify({ m, errors, failed })}`);
  };
  const openMore = async () => { await evaluate(`document.querySelector('.t-more-line').click()`); await wait(600); await evaluate(`[...document.querySelectorAll('dialog.t-sheet[open] .ui-pr')].find((p) => /Install app|Add to Home Screen/.test(p.innerText)).scrollIntoView({ block: 'center' })`); await wait(300); };

  // Installable: the manifest and the worker as Chrome reads them, and Today's More with the Install app row in every width and theme.
  await view('light', 390);
  await cdp('Page.navigate', { url: base });
  await until('navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller)', 'the service worker took over the page');
  await until('!!document.querySelector(".t-more-line")', 'Today drew');
  assert.equal(await evaluate('fetch("/api/decisions").then((r) => r.status)'), 200);
  const manifest = await cdp('Page.getAppManifest'), mf = JSON.parse(manifest.data), errs = (await cdp('Page.getInstallabilityErrors')).installabilityErrors.map((e) => e.errorId);
  writeFileSync(join(out, 'installability.json'), JSON.stringify({ manifestErrors: manifest.errors, installabilityErrors: errs, name: mf.name, short_name: mf.short_name, display: mf.display, start_url: mf.start_url, scope: mf.scope,
    theme_color: mf.theme_color, background_color: mf.background_color, icons: mf.icons.map((i) => `${i.sizes} ${i.purpose}`), serviceWorkerControlled: true }, null, 2) + '\n');
  assert.deepEqual([manifest.errors, errs], [[], []]);
  assert.deepEqual([mf.name, mf.short_name, mf.display, mf.start_url], ['sign-off', 'sign-off', 'standalone', '/']);
  lines.push(`Chrome reads the manifest with no error and finds no installability error: name ${mf.name}, ${mf.display}, start ${mf.start_url}, icons ${mf.icons.map((i) => `${i.sizes} ${i.purpose}`).join(', ')}`, 'the service worker controls the page');
  for (const width of [360, 390, 445, 1280, 1440]) for (const theme of ['light', 'dark']) {
    await view(theme, width);
    await cdp('Page.navigate', { url: base });
    await until('!!document.querySelector(".t-more-line") && !!window.signOffInstall?.()', `the install row is offered at ${width} ${theme}`);
    await openMore();
    const m = await evaluate(MEASURE);
    await save('more-install', theme, width, m);
    assert.equal(m.row?.text, 'Install app On this device');
    assert.ok(m.row.height >= 44 && m.row.left >= 0 && m.row.right <= width && m.row.top >= 0 && m.row.bottom <= (width < 1024 ? 844 : 800) && !m.row.valueCut, `${width} ${theme}: the row is whole on screen ${JSON.stringify(m.row)}`);
    lines.push(`${theme} ${width}: More lists "${m.rows.join('", "')}"; the install row is ${m.row.height}px tall, whole on screen`);
  }
  // Safari on an iPad has no prompt: More says to use Share, then Add to Home Screen.
  await cdp('Emulation.setUserAgentOverride', { userAgent: IPAD, platform: 'iPad' });
  const hide = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation(), true)" });
  for (const theme of ['light', 'dark']) {
    await view(theme, 820);
    await cdp('Page.navigate', { url: base });
    await until('!!document.querySelector(".t-more-line") && !!window.signOffInstall?.()', 'the iPad row is offered');
    await openMore();
    const m = await evaluate(MEASURE);
    await save('ipad-safari', theme, 820, m);
    assert.equal(m.row?.text, 'Add to Home Screen In Share');
    assert.ok(m.row.tag === 'div' && !m.row.valueCut && m.row.right <= 820, JSON.stringify(m.row));
    lines.push(`${theme} 820, Safari on an iPad: More lists the row "${m.row.text}"`);
  }
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: hide.identifier });
  await cdp('Emulation.setUserAgentOverride', { userAgent: '' });

  // The board goes away: the page and the last update come from the device, with the line, and a send fails and leaves nothing kept.
  await view('light', 390);
  await cdp('Page.navigate', { url: base });
  await until('!!document.querySelector(".t-more-line")', 'Today drew online');
  assert.equal(await evaluate('document.getElementById("offline").hidden'), true);
  const online = await evaluate('document.body.innerText');
  sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board]);
  for (const theme of ['light', 'dark']) {
    await view(theme, 390);
    await cdp('Page.navigate', { url: base });
    await until('!document.getElementById("offline")?.hidden && !!document.querySelector(".t-more-line")', 'the board drew from the device with its line');
    const m = await evaluate(MEASURE);
    await save('offline', theme, 390, m, true);
    assert.equal(m.offline.text, 'Offline, showing the last update');
    assert.ok(m.offline.top === 0 && m.offline.bottom > 20 && m.offline.bottom < 80, JSON.stringify(m.offline));
    assert.ok(m.bodyText.includes('Today') && m.bodyText.includes('Keep the weekly digest?'), `the last update is drawn: ${m.bodyText}`);
    lines.push(`${theme} 390, server stopped: the page reloads from the device, the line reads "${m.offline.text}" and Today shows the last update`);
  }
  assert.equal(await evaluate('fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(() => "sent", () => "failed")'), 'failed');
  const kept = await evaluate('caches.open("state").then((c) => c.keys()).then((k) => k.map((r) => new URL(r.url).pathname))');
  assert.deepEqual(kept, ['/api/decisions']);
  lines.push('with the server stopped a send fails; the only request kept on the device is the board\'s state (/api/decisions), no answer or write is kept or queued');
  assert.ok(online.includes('Keep the weekly digest?'));

  writeFileSync(join(out, 'pwa.txt'), lines.join('\n') + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board for Umer with one posted item of each kind, served on loopback from this checkout, opened in a headless Chromium.',
    steps: ['Open Today at 360, 390, 445, 1280 and 1440 wide, light and dark, tap the line under the tiles to open More and find its Install app row.',
      'Open Today as Safari on an iPad (820 wide, no install prompt) and open More: it names Add to Home Screen and Share.',
      'Stop the board, reload Today at 390 in light and dark: the page and the last update appear with the line "Offline, showing the last update"; a send fails.'],
    result: 'Chrome finds the manifest and the service worker valid and no installability error; More offers Install app at every width and theme (an iPad gets Add to Home Screen, In Share); with the board stopped Today still opens from the device with the last update and the line saying so, and nothing is queued.' }, null, 2) + '\n');
  console.log(lines.join('\n'));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { sh(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board]); } catch {}
  await wait(300);
  rmSync(dir, { recursive: true, force: true });
  rmSync(prof, { recursive: true, force: true });
}
