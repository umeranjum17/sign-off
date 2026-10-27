// A phone-shaped, throttled read of a board's FIRST open: what a 390 px phone moves over 4G before the first screen is painted,
// and what the whole open costs once everything the page asks for has arrived.
// Profile: 4G, 1.6 Mbps down, 750 kbps up, 150 ms RTT, 4x CPU slowdown, 390x844 at DPR 2, headless Chrome over CDP.
// usage: node first-open.mjs <url> <out-dir> <tag> [cold|warm] [light|dark]
//   Prints one JSON line (bytes before the board's own first paint, that paint in ms, the whole open) and writes <tag>-<mode>-<theme>.json
//   (every request with its bytes and whether it landed before the paint) and .png (the first screen, to look at).
//   A host under load moves the paint time, never the byte counts: compare bytes, and compare paint only against a run of the same minute.
//   It always ends within ~60 s: a watchdog closes the browser and exits 2 rather than wait on a page that never paints.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, tag, mode = 'cold', theme = 'light'] = process.argv.slice(2);
if (!url || !out || !tag) { console.error('usage: node first-open.mjs <url> <out-dir> <tag> [cold|warm] [light|dark]'); process.exit(64); }
const downloadThroughput = (1.6 * 1024 * 1024) / 8, uploadThroughput = (750 * 1024) / 8;
// A page that never paints is a failed measurement, not a wait: the judge waits on nothing.
setTimeout(() => { console.error('first-open: the board did not settle within 60 s'); process.exit(2); }, 60_000).unref();

mkdirSync(out, { recursive: true });
// The browser's own profile is scratch, never evidence: it sits in the temp folder and is gone with the run.
const profile = join(tmpdir(), `first-open-${process.pid}-${tag}-${mode}-${theme}`);
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH ?? 'chromium', ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 200 && !(existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n')); i++) await new Promise((ok) => setTimeout(ok, 50));
if (!existsSync(portFile)) throw new Error('headless Chrome never opened its debugging port');
const port = readFileSync(portFile, 'utf8').trim().split('\n')[0];

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);

let id = 0;
const waiting = new Map(), events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { const { ok, no } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? no(new Error(JSON.stringify(msg.error))) : ok(msg.result); }
  else events.push(msg);
};
await new Promise((ok) => (ws.onopen = ok));
const send = (method, params = {}) => new Promise((ok, no) => { const n = ++id; waiting.set(n, { ok, no }); ws.send(JSON.stringify({ id: n, method, params })); });
const session = (await send('Target.attachToTarget', { targetId: target.id, flatten: true })).sessionId;
const inSession = (method, params = {}) => new Promise((ok, no) => { const n = ++id; waiting.set(n, { ok, no }); ws.send(JSON.stringify({ id: n, method, params, sessionId: session })); });

await inSession('Page.enable');
await inSession('Network.enable');
await inSession('Performance.enable');
// The board's first paint: the screen element drawn, its skeleton gone. Counted by the page itself, from its own first byte.
await inSession('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  window.__paint = null;
  window.__fcp = null;
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === 'first-contentful-paint') window.__fcp = e.startTime; })).observe({ type: 'paint', buffered: true }); } catch {}
  const seen = () => {
    const board = document.getElementById('board');
    if (window.__paint === null && board && !board.hasAttribute('aria-busy') && !board.querySelector('.skel') && (board.querySelector('.ui-top, .top, h1') || board.children.length))
      window.__paint = performance.now();
  };
  new MutationObserver(seen).observe(document, { subtree: true, childList: true, attributes: true });
  addEventListener('DOMContentLoaded', seen);
})()` });
await inSession('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await inSession('Emulation.setTouchEmulationEnabled', { enabled: true });
await inSession('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
await inSession('Emulation.setCPUThrottlingRate', { rate: 4 });
await inSession('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput, uploadThroughput, connectionType: 'cellular4g' });
await inSession('Network.setCacheDisabled', { cacheDisabled: mode === 'cold' });
// Measured over the phone's network, not from the worker's own copy: the worker is bypassed so every byte and its time is the page's.
await inSession('Network.setBypassServiceWorker', { bypass: true });

const started = Date.now();
await inSession('Page.navigate', { url });
let paint = null;
for (let i = 0; i < 300 && paint === null; i++) {
  const r = await inSession('Runtime.evaluate', { expression: 'window.__paint', returnByValue: true });
  paint = r.result?.value ?? null;
  if (paint === null) await new Promise((ok) => setTimeout(ok, 100));
}
if (paint === null) { console.error('first-open: no first paint within 30 s'); chrome.kill(); process.exit(2); }
const paintedAt = Date.now();
// Let everything the first screen asks for arrive, then stop: a phone's open ends when the board is quiet.
await new Promise((ok) => setTimeout(ok, 8000));
const metrics = Object.fromEntries((await inSession('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const shot = await inSession('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(out, `${tag}-${mode}-${theme}.png`), Buffer.from(shot.data, 'base64'));

// Every request, in the order it arrived, with the bytes it really moved on the wire (compressed) and whether it landed before the first paint.
const reqs = new Map();
for (const e of events) {
  const p = e.params ?? {};
  if (e.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { url: p.request.url, start: p.timestamp, type: p.type });
  if (e.method === 'Network.responseReceived' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { status: p.response.status, mime: p.response.mimeType, enc: p.response.headers['content-encoding'] ?? '', cache: !!p.response.fromDiskCache });
  if (e.method === 'Network.loadingFinished' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { end: p.timestamp, bytes: p.encodedDataLength });
  if (e.method === 'Network.loadingFailed' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { end: p.timestamp, bytes: 0, failed: p.errorText });
}
const all = [...reqs.values()].filter((r) => r.bytes !== undefined || r.failed);
const first = Math.min(...all.map((r) => r.start));
// The page's own paint mark, read to the millisecond, not the moment a poll happened to see it.
const marks = await inSession('Runtime.evaluate', { expression: '({ paint: window.__paint, fcp: window.__fcp })', returnByValue: true });
const mark = marks.result?.value ?? {};
paint = mark.paint ?? paint;
// A request counted as "before the first paint" when its last byte landed before the board drew.
const paintTs = first + (mark.paint ?? (paintedAt - started)) / 1000;
const before = all.filter((r) => (r.end ?? Infinity) <= paintTs);
const total = (list) => Math.round(list.reduce((n, r) => n + (r.bytes ?? 0), 0));
const path = (r) => new URL(r.url).pathname.replace(/^\/mock\/[^/]+/, '/mock/<pass>') + (new URL(r.url).search || '');
const table = all.map((r) => ({ path: path(r), kb: Math.round((r.bytes ?? 0) / 102.4) / 10, enc: r.enc, cache: r.cache, beforePaint: (r.end ?? Infinity) <= paintTs, ms: Math.round(((r.end ?? r.start) - r.start) * 1000) }))
  .sort((a, b) => b.kb - a.kb);
const report = { mode, theme, tag, throttled: '4G 1.6Mbps/750kbps/150ms RTT/4x CPU/390x844 DPR2', paintMs: Math.round(paint ?? -1),
  firstContentfulPaint: Math.round(mark.fcp ?? metrics.FirstContentfulPaint ?? -1), bytesBeforePaint: total(before), requestsBeforePaint: before.length,
  bytesWhole: total(all), requestsWhole: all.length, table };
writeFileSync(join(out, `${tag}-${mode}-${theme}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ tag, mode, theme, paintMs: report.paintMs, bytesBeforePaint: report.bytesBeforePaint, requestsBeforePaint: report.requestsBeforePaint, bytesWhole: report.bytesWhole }));
ws.close();
// Chrome is still writing its profile until it has exited; removing it sooner can fail with ENOTEMPTY.
const exited = new Promise((ok) => chrome.once('exit', ok));
chrome.kill();
await exited;
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
