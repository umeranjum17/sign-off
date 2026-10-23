// Real-clock performance run of a sign-off board in headless Chromium over CDP (no virtual time).
//   node load-perf.mjs PROFILE URL WIDTH light|dark none|slow4g OUT_PREFIX   (PROFILE: an empty throwaway folder; remove it after)
// The viewport, theme and throttling are set before the first navigation (the check-390 method). One JSON line per run:
// cold load (cache off), cold load of the Evidence list, warm reload (cache on), then scroll and tap feel on the warm page. Shots: the loaded board, Evidence, and the reloaded board with the measured bytes and requests drawn over it (-weight.png).
//   slow4g = Lighthouse's mobile profile: 150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4x slower.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [profile, url, width, theme, throttle, out] = process.argv.slice(2);
const W = +width, H = W < 600 ? 844 : 800, phone = W < 600;
if (existsSync(join(profile, 'DevToolsActivePort'))) rmSync(join(profile, 'DevToolsActivePort'));
const chrome = spawn('chromium', ['--headless', '--no-first-run', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} }
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok));
let id = 0; const waits = new Map(), listeners = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); } else for (const f of listeners) f(d); });
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const n = ++id; waits.set(n, (d) => (d.error ? no(new Error(`${method}: ${d.error.message}`)) : ok(d.result))); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });

const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: s } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const ev = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s).then((r) => r.result.value);

// Every request of the page and its frames: frames are auto-attached so their requests count too.
let reqs = new Map();
const sessions = new Set([s]);
listeners.push(async (d) => {
  if (d.method === 'Target.attachedToTarget') {
    const fs = d.params.sessionId; sessions.add(fs);
    await send('Network.enable', {}, fs).catch(() => {});
    if (throttle === 'slow4g') await send('Network.emulateNetworkConditions', NET, fs).catch(() => {});
    await send('Network.setCacheDisabled', { cacheDisabled: cold }, fs).catch(() => {});
    await send('Runtime.runIfWaitingForDebugger', {}, fs).catch(() => {});
  }
  const p = d.params;
  if (d.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { url: p.request.url, start: p.timestamp, type: p.type });
  if (d.method === 'Network.responseReceived' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { mime: p.response.mimeType, status: p.response.status, cached: p.response.fromDiskCache || p.response.fromMemoryCache, enc: p.response.headers['content-encoding'] || p.response.headers['Content-Encoding'] || '' });
  if (d.method === 'Network.loadingFinished' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { end: p.timestamp, bytes: p.encodedDataLength });
  if (d.method === 'Network.loadingFailed' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { end: p.timestamp, bytes: 0, failed: p.errorText });
  if (d.method === 'Network.requestServedFromCache' && reqs.has(p.requestId)) reqs.get(p.requestId).cached = true;
});
const NET = { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 };
let cold = true;
await send('Page.enable', {}, s);
await send('Network.enable', {}, s);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: phone ? 3 : 1, mobile: phone }, s);
if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, s);
if (throttle === 'slow4g') { await send('Network.emulateNetworkConditions', NET, s); await send('Emulation.setCPUThrottlingRate', { rate: 4 }, s); }
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s);
// Paint, largest paint, long tasks and interactions, recorded from the first byte of each document.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__perf = { paint: {}, lcp: 0, long: [], events: [] };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (__perf.paint[e.name] = e.startTime))).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (__perf.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => __perf.long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => e.interactionId && __perf.events.push([e.name, e.duration, e.processingStart - e.startTime, e.processingEnd - e.processingStart]))).observe({ type: 'event', durationThreshold: 16, buffered: true });` }, s);

/** Loads the URL and waits for the network to be quiet for 3 s (no request in flight), up to 120 s. */
async function load(how, hash = '') {
  cold = how === 'cold';
  for (const fs of sessions) await send('Network.setCacheDisabled', { cacheDisabled: cold }, fs).catch(() => {});
  await send('Page.navigate', { url: 'about:blank' }, s);
  await sleep(300);
  reqs = new Map();
  const t0 = Date.now();
  await send('Page.navigate', { url: url + hash }, s);
  let quietSince = Date.now();
  while (Date.now() - t0 < 120_000) {
    await sleep(200);
    const busy = [...reqs.values()].some((r) => r.end === undefined);
    if (busy) quietSince = Date.now();
    else if (Date.now() - quietSince > 3000 && reqs.size) break;
  }
  const all = [...reqs.values()], first = Math.min(...all.map((r) => r.start));
  const p = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, ...__perf } })()`);
  // Time to interactive, Lighthouse's way: the end of the last long task before a 5 s window with no long task and at most 2 requests in flight, not before FCP.
  const fcp = p.paint['first-contentful-paint'] ?? 0;
  const spans = all.map((r) => [(r.start - first) * 1000, ((r.end ?? r.start) - first) * 1000]);
  const inflight = (t) => spans.filter(([a, b]) => a <= t && b > t).length;
  let tti = fcp;
  for (const [st, du] of p.long) if (st + du > tti) tti = st + du;
  const lastBusy = Math.max(tti, ...spans.filter(([, b]) => inflight(b - 1) > 2).map(([, b]) => b));
  const kind = (r) => /^image\//.test(r.mime ?? '') ? 'image' : /html/.test(r.mime ?? '') ? 'html' : /json/.test(r.mime ?? '') ? 'json' : /video/.test(r.mime ?? '') ? 'video' : r.type?.toLowerCase() ?? 'other';
  const by = {};
  for (const r of all) { const k = kind(r); by[k] ??= { n: 0, bytes: 0 }; by[k].n++; by[k].bytes += r.bytes ?? 0; }
  const top = all.filter((r) => r.bytes).sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((r) => ({ path: new URL(r.url).pathname.replace(/^\/mock\/[^/]+/, '/mock/<pass>').slice(0, 90), kb: Math.round(r.bytes / 1024), ms: Math.round(((r.end ?? r.start) - r.start) * 1000), enc: r.enc }));
  return { how: how + hash, timedOut: Date.now() - t0 >= 120_000, requests: all.length, cached: all.filter((r) => r.cached).length, kb: Math.round(all.reduce((a, r) => a + (r.bytes ?? 0), 0) / 1024), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.n, kb: Math.round(v.bytes / 1024) }])),
    ttfb: Math.round(p.ttfb), fcp: Math.round(fcp), lcp: Math.round(p.lcp), dcl: Math.round(p.dcl), load: Math.round(p.load), tti: Math.round(Math.max(tti, lastBusy)), longTasks: p.long.length, longMs: Math.round(p.long.reduce((a, [, d]) => a + d, 0)),
    settled: Math.round(Math.max(...spans.map(([, b]) => b))), top };
}

/** Frame times while a real compositor scroll gesture runs, over the page's own scroller. */
async function scroll(hash) {
  await ev(`(location.hash = '${hash}', new Promise((ok) => setTimeout(ok, 1500)))`);
  await ev(`(window.__frames = [], (function f(t) { __frames.push(t); if (__frames.length < 2000) requestAnimationFrame(f); })(performance.now()), 0)`);
  await send('Input.synthesizeScrollGesture', { x: Math.round(W / 2), y: Math.round(H / 2), yDistance: -3000, speed: 2000, gestureSourceType: 'mouse', repeatCount: 1 }, s);
  await sleep(300);
  return ev(`(() => { const f = __frames; __frames = { length: 1e9 }; const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
    const sc = [...document.querySelectorAll('*')].find((e) => e.scrollTop > 0) ?? document.scrollingElement;
    return { area: '${hash}', frames: d.length, p50: +d[Math.floor(d.length * 0.5)].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1), over50: d.filter((x) => x > 50).length, scrolled: Math.round(sc.scrollTop) } })()`);
}

/** Taps (or clicks) each area in the tab bar or sidebar; the Event Timing duration is input to the next paint. */
async function taps() {
  const res = [];
  await ev(`(__perf.events = [], 0)`);
  const spots = await ev(`[...document.querySelectorAll('${phone ? '#tabs' : '#nav'} a, ${phone ? '#tabs' : '#nav'} button')].filter((a) => a.getClientRects().length).map((a) => { const r = a.getBoundingClientRect(); return [a.textContent.trim().replace(/\\d+$/, '').slice(0, 20), Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })`);
  for (const [name, x, y] of [...spots, spots[0]]) {
    const before = await ev('__perf.events.length');
    if (phone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }, s);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s);
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, s);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, s);
    }
    await sleep(1200);
    const evs = await ev(`__perf.events.slice(${before})`);
    res.push({ area: name, ms: Math.round(Math.max(0, ...evs.map((e) => e[1]))), hash: await ev('location.hash') });
  }
  return res;
}

try {
  const c = await load('cold');
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
  writeFileSync(`${out}.png`, Buffer.from(data, 'base64'));
  const e = await load('cold', '#evidence');
  const { data: shot } = await send('Page.captureScreenshot', { format: 'png' }, s);
  writeFileSync(`${out}-evidence.png`, Buffer.from(shot, 'base64'));
  const w = await load('warm');
  // A shot that shows the numbers: the browser's own network record of the three loads, drawn over the reloaded board and then removed.
  const lines = [`Measured by load-perf.mjs at ${W} px, ${throttle === 'none' ? 'no throttling' : 'slow 4G'}`, `First load: ${c.kb} KB in ${c.requests} requests, first paint ${c.fcp} ms`,
    `Evidence: ${e.kb} KB in ${e.requests} requests (${e.by.image?.n ?? 0} pictures, ${e.by.image?.kb ?? 0} KB)`, `Reload: ${w.kb} KB transferred, ${w.cached} of ${w.requests} from the browser's copy`];
  await ev(`(() => { const d = document.createElement('div'); d.id = '__weight'; d.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:2147483647;padding:14px 16px;border-radius:12px;background:#111;color:#fff;font:600 15px/1.5 system-ui;white-space:pre-line';
    d.textContent = ${JSON.stringify(lines.join('\n'))}; document.body.append(d); return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); })()`);
  const { data: weight } = await send('Page.captureScreenshot', { format: 'png' }, s);
  writeFileSync(`${out}-weight.png`, Buffer.from(weight, 'base64'));
  await ev(`document.getElementById('__weight').remove()`);
  const sc = [await scroll('#evidence'), await scroll('#reports')];
  const t = await taps();
  console.log(JSON.stringify({ run: out.split('/').pop(), width: W, theme, throttle, cold: c, evidence: e, warm: w, scroll: sc, taps: t, inp: Math.max(...t.map((x) => x.ms)) }));
} finally { await send('Browser.close').catch(() => {}); await sleep(1500); ws.close(); chrome.kill(); }
