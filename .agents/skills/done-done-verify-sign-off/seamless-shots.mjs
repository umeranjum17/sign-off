// Does the board feel seamless? One theme and width per run, a seeded board in headless Chromium over the DevTools protocol, on a phone's network (260 ms each way).
// Measured from the page: tap to response (answer, Approve, comment), a refused save taken back and said, layout shift, a new ask arriving on Decide by itself.
// Usage, after `npm run build`: node .agents/skills/done-done-verify-sign-off/seamless-shots.mjs <out folder> [light|dark] [390|1280] [--repo <built base checkout>]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const [outArg, theme = 'light', widthArg = '390', ...flags] = process.argv.slice(2);
if (!outArg) throw new Error('usage: seamless-shots.mjs <out folder> [light|dark] [390|1280] [--repo <checkout>]');
const here = join(import.meta.dirname, '../../..'), repo = resolve(flags.includes('--repo') ? flags[flags.indexOf('--repo') + 1] : here);
const out = resolve(outArg), width = Number(widthArg), desk = width >= 1280, [W, H] = desk ? [1280, 800] : [390, 844], tag = (n) => `${n}.${theme}.${width}w`;
mkdirSync(out, { recursive: true });
const cli = join(repo, 'dist/cli.js'), wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const board = mkdtempSync(join(tmpdir(), 'seamless-board-')), scratch = mkdtempSync(join(tmpdir(), 'seamless-chrome-'));
const env = { ...process.env, HOME: board, XDG_CONFIG_HOME: join(board, '.config'), XDG_DATA_HOME: join(board, '.local/share'), XDG_STATE_HOME: join(board, '.local/state'), XDG_CACHE_HOME: join(board, '.cache'), SIGN_OFF_FILER: 'verify', PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
const so = (...a) => spawnSync(process.execPath, [cli, ...a], { env, encoding: 'utf8' });
const seeded = spawnSync('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), board], { cwd: repo, encoding: 'utf8', env });
const served = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(seeded.stdout ?? '')?.[1];
if (!served) throw new Error(`seed-board.sh printed no board URL: ${seeded.stderr || seeded.stdout}`);
const guided = JSON.parse(readFileSync(join(here, 'fixtures/contract/report.v4/valid-full.json'), 'utf8'));
Object.assign(guided, { key: 'seam-report', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), filer: 'agent-41' });
writeFileSync(join(board, 'guided.json'), JSON.stringify(guided));
so('post', join(board, 'board.json'), '--kind', 'report', '--from', join(board, 'guided.json'), '--filer', 'agent-41');
// A design whose preview is a real phone screenshot (the fixture's own is one pixel), so the box it reserves can be held to the picture that fills it.
mkdirSync(join(board, 'seam-design'), { recursive: true });
for (const f of ['preview.png', 'welcome.png', 'welcome-dark.png', 'inbox.png', 'welcome.html']) writeFileSync(join(board, 'seam-design', f), readFileSync(join(here, f.endsWith('html') ? 'fixtures/contract/design.v1/design/welcome.html' : 'fixtures/evidence/sparse-screen.png')));
writeFileSync(join(board, 'seam-design.json'), readFileSync(join(here, 'fixtures/contract/design.v1/valid-basic.json'), 'utf8').replaceAll('design/', 'seam-design/').replace('chat-journeys', 'seam-design'));
so('post', join(board, 'board.json'), '--kind', 'design', '--from', join(board, 'seam-design.json'));
const browser = process.env.CHROME_PATH ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => (process.env.PATH ?? '').split(':').map((d) => join(d, b))).find(existsSync);
if (!browser) throw new Error('no Chrome or Chromium to drive: set CHROME_PATH or put one on the PATH');
const chrome = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'profile')}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMPDIR: scratch } });
const failures = [], check = (ok, what) => { if (!ok) failures.push(what); }, report = {};
try {
  const active = join(scratch, 'profile', 'DevToolsActivePort');
  for (let i = 0; i < 300 && !(existsSync(active) && readFileSync(active, 'utf8').includes('\n')); i++) await wait(100);
  const target = (await (await fetch(`http://127.0.0.1:${readFileSync(active, 'utf8').split('\n')[0]}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const replies = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (replies.has(msg.id)) { replies.get(msg.id)(msg.result); replies.delete(msg.id); } };
  const send = (method, params = {}) => new Promise((ok) => { replies.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: !desk });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 260, downloadThroughput: 1_200_000, uploadThroughput: 500_000 });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });` });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  const until = async (expression, ms = 20000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(60)) if (await evaluate(expression)) return true; return false; };
  const shot = async (name) => writeFileSync(join(out, `${tag(name)}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  // Taps the page, then reports the milliseconds to the first frame where `seen` is true (-1 when it never is), and what the page held then.
  const tap = (click, seen) => evaluate(`new Promise((ok) => { const t0 = performance.now(); ${click}; (function f() { const v = (${seen})(); if (v) return ok({ ms: Math.round(performance.now() - t0), v }); if (performance.now() - t0 > 8000) return ok({ ms: -1 }); requestAnimationFrame(f); })(); })`);
  const go = async (hash, ready, ms) => { await evaluate(`location.hash = ${JSON.stringify(hash)}`); await until(ready, ms); await wait(2500); };
  const cls = (from) => evaluate(`+(window.__cls - ${from}).toFixed(4)`);
  await send('Page.navigate', { url: `${served}${desk ? '#waiting' : ''}` });
  await until('!!document.querySelector("#board .ui-row, #board .t-up, #board .dl-row")'); await wait(2500);

  let from = await evaluate('window.__cls');
  await evaluate(`location.hash = '#designs/seam-design'`); await until('!!document.querySelector(".design-review h1, .dz-grid h1, #reader h1")');
  const skeleton = await evaluate(`!!document.querySelector('.design-preview-window.pending')`); await shot('design-loading'); await wait(2500); await shot('design-opened');
  report.design = { skeleton, shift: await cls(from) };
  const approved = await tap(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve').click()`, `() => /Approved/.test(document.querySelector('.dz-props [role=status]')?.textContent ?? '') && document.querySelector('.dz-props [role=status]').textContent`);
  await evaluate(`document.querySelector('.dz-props')?.scrollIntoView({ block: 'center', behavior: 'instant' })`); await shot('approve-pending'); await until(`!/saving/i.test(document.querySelector('.dz-props [role=status]')?.textContent ?? '')`);
  report.approve = { tapToResponse: approved.ms, shown: approved.v, confirmed: await evaluate(`document.querySelector('.dz-props [role=status]')?.textContent`) };
  await go('#decide/ship', '!!document.querySelector("#board .pick-option, #board .pick-list button")'); from = await evaluate('window.__cls');
  await evaluate(`[...document.querySelectorAll('#board button')].find((b) => b.textContent.startsWith('Friday')).click()`); await wait(400);
  const answered = await tap(`document.querySelector('.decide-bar .answer').click()`, `() => (!document.getElementById('toast').hidden && document.getElementById('toast-text').textContent) || (location.hash === '#waiting' && 'moved on')`);
  await shot('answer-pending'); await until(`!document.getElementById('toast').hidden && !/saving/i.test(document.getElementById('toast-text').textContent)`);
  report.answer = { tapToResponse: answered.ms, shown: answered.v, confirmed: await evaluate(`document.getElementById('toast-text').textContent`), shift: await cls(from) };
  from = await evaluate('window.__cls');
  await go('#reports/seam-report', '!!document.querySelector(".ra-bar")');
  await evaluate(`document.querySelector('.ra-b.cmt').click()`); await wait(700);
  await evaluate(`(() => { const t = document.querySelector('dialog[open] textarea, .ra-form textarea'); t.value = 'Looks right to me, ship it.'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const commented = await tap(`document.querySelector('.ra-form .ra-send').click()`, `() => [...document.querySelectorAll('.gd-cmt p')].some((p) => p.textContent.includes('ship it')) && 'shown'`);
  await shot('comment-pending'); await wait(2500);
  report.comment = { shift: await cls(from), tapToResponse: commented.ms, confirmed: await evaluate(`[...document.querySelectorAll('.gd-cmt')].some((c) => c.textContent.includes('ship it') && !/sending/i.test(c.textContent))`) };
  from = await evaluate('window.__cls');
  await go('#decide/keep-the-weekly-digest', '!!document.querySelector("#board .pick-option, #board .pick-list button")');
  await send('Network.setBlockedURLs', { urls: ['*api/answers*'] });
  await evaluate(`[...document.querySelectorAll('#board button')].find((b) => b.textContent.startsWith('Yes')).click()`); await wait(400);
  await evaluate(`document.querySelector('.decide-bar .answer').click()`);
  await until(`/did not save|Couldn.t save/i.test(document.getElementById('toast-text').textContent) && !document.getElementById('toast').hidden`, 6000); await wait(500); await shot('answer-reverted');
  await send('Network.setBlockedURLs', { urls: [] });
  report.revert = { shift: await cls(from), says: await evaluate(`document.getElementById('toast-text').textContent`), backOnAsk: await evaluate(`location.hash === '#decide/keep-the-weekly-digest' && !!document.querySelector('#board .decide-bar .answer')`) };
  from = await evaluate('window.__cls');
  for (let i = 0; i < 10; i++) so('raise', join(board, 'board.json'), '--key', `seam-ask-${i}`, '--ask-ref', 'seam', '--title', `Does ask ${i} wait its turn?`, '--why', 'It fills the list.', '--outcome', 'yes=Yes.', '--outcome', 'no=No.', '--recommend', 'yes', '--recommend-reason', 'It is the point.', '--default', 'no');
  const key = 'seam-ask-5';
  await go('#waiting', `!!document.querySelector('#board .dl-row[data-key="${key}"]')`, 45000);
  await evaluate(`document.querySelector('#board .dl-row[data-key="${key}"]').scrollIntoView({ block: 'start' })`); await wait(400);
  const row = `(() => { const r = document.querySelector('#board .dl-row[data-key="${key}"]'); return r ? Math.round(r.getBoundingClientRect().top) : null; })()`;
  const [top0, y0] = [await evaluate(row), await evaluate('Math.round(scrollY)')], filed = Date.now();
  so('raise', join(board, 'board.json'), '--key', 'live-ask', '--ask-ref', 'seam', '--title', 'Does a new ask arrive on its own?', '--why', 'A board that needs a refresh is not live.', '--outcome', 'yes=It arrives.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'It is the point.', '--default', 'no');
  const arrived = await until(`!!document.querySelector('#board [data-key="live-ask"]')`, 40000), ms = Date.now() - filed;
  await wait(500); await shot('live-row');
  report.live = { shift: await cls(from), arrivedAfterMs: arrived ? ms : -1, key, top0, y0, rowMoved: (await evaluate(row)) - top0, scrollMoved: (await evaluate('Math.round(scrollY)')) - y0 };
  report.totalShift = await cls(0);
  if (!flags.includes('--repo')) {
    check(report.design.shift < 0.02, `design: the page shifted ${report.design.shift} as it opened`);
    for (const k of ['approve', 'answer', 'comment']) check(report[k].tapToResponse >= 0 && report[k].tapToResponse < 150, `${k}: the board took ${report[k].tapToResponse} ms to answer the tap`);
    check(/did not save|Couldn.t save/i.test(report.revert.says) && report.revert.backOnAsk, `revert: the board said "${report.revert.says}" and was ${report.revert.backOnAsk ? '' : 'not '}back on the ask`);
    check(report.live.arrivedAfterMs > 0 && report.live.arrivedAfterMs < 8000, `live: the new ask took ${report.live.arrivedAfterMs} ms to arrive`);
    check(Math.abs(report.live.rowMoved) <= 1, `live: the row under the thumb moved ${report.live.rowMoved} px`);
  }
} finally {
  chrome.kill(); spawnSync(process.execPath, [cli, 'stop', join(board, 'board.json')], { env, encoding: 'utf8' }); await wait(800);
  for (const d of [scratch, board]) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
writeFileSync(join(out, `${tag('seamless')}.json`), `${JSON.stringify({ repo: repo === here ? 'this checkout' : 'base', width, theme, ...report }, null, 2)}\n`);
const line = (k, v) => `${k}: ${JSON.stringify(v)}`;
writeFileSync(join(out, `${tag('seamless')}.txt`), [`${width}px ${theme}, phone network 260 ms: tap to response in ms (-1 = never within 8 s), layout shift (CLS), live arrival`, ...Object.entries(report).map(([k, v]) => line(k, v)), failures.length ? `FAILED:\n- ${failures.join('\n- ')}` : 'PASSED'].join('\n'));
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board with asks, a design, a guided report and a proof, on a phone network (260 ms each way).',
  steps: ['Open a design', 'Tap Approve', 'Pick an answer on an ask and tap Answer', 'Comment on a report part and send', 'Answer an ask with the network refusing the save', 'Watch Decide while an agent files an ask'],
  result: 'Each tap shows its result at once marked saving; the refused save says it did not save and the ask is open again; a new ask arrives by itself without moving the rows in view.' }, null, 2));
console.log(JSON.stringify(report), failures.length ? `\nFAILED\n- ${failures.join('\n- ')}` : '\nPASSED');
if (failures.length) process.exitCode = 1;
