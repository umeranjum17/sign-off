// The shared empty state, driven and measured in a headless Chromium of its own over the DevTools protocol at exact device metrics (390x844 or 1280x800, 2x), one theme and
// width per run (so a run's steps.json holds one claim). One throwaway board with no cards.
// States: Decide, Evidence, Reports, Designs and Answered with nothing, and Evidence while its pages are held and when they fail. The Tickets screens' own loading, error and
// incomplete states are proven by the tickets-adapter journey, against the ticket adapter.
// Held, failed and blanked reads go through the DevTools Fetch domain on the real board's own requests; nothing else about the page is faked.
// Each frame is measured in the browser: a visible state with a mark, a title and its words, the mark a 40px circle, one next step of 44px or more where there is one, nothing
// wider than the screen, no exclamation mark, no internal word, and no console error or failed request apart from the one read the state holds.
// Usage: node .agents/skills/done-done-verify-sign-off/empty-states-shots.mjs <output> [light|dark] [390|1280]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const side = process.env.TICKETS_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
// EMPTY_CITE=1 (the sealed run): the evidence folder holds only the pictures the claim names and steps.json; every page record and measure goes beside it in <out>.records.
const rec = process.env.EMPTY_CITE ? out + '.records' : out;
mkdirSync(out, { recursive: true }); mkdirSync(rec, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-es-')), bare = join(dir, 'bare'), rich = join(dir, 'rich');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const run = (bin, args, options = {}) => spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options });
const sh = (bin, args, options) => { const r = run(bin, args, options); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const cli = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const metrics = phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 2, mobile: false };
const name = (state) => `${state}.${side}.${theme}.${width}w`;
const prof = mkdtempSync(join(tmpdir(), 'so-es-chrome-'));
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', ...(phone ? ['--hide-scrollbars'] : []), 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

// What the browser measures: every visible empty state, and the screen around it.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r2 = (n) => Math.round(n * 100) / 100, w = document.documentElement.clientWidth;
  const states = [...document.querySelectorAll('.es')].filter(vis).map((e) => { const m = e.querySelector('.es-mark'), b = e.querySelector('b'), a = e.querySelector('.es-act'), r = box(e), mr = m && box(m);
    return { kind: [...e.classList].find((c) => /^es-(empty|loading|error)$/.test(c))?.slice(3), title: (b ?? e.querySelector('span:not(.sk)'))?.textContent ?? '', words: e.innerText.replace(/\\s+/g, ' ').trim(), role: e.getAttribute('role'),
      width: r2(r.width), height: r2(r.height), mark: mr ? r2(mr.width) + 'x' + r2(mr.height) + (getComputedStyle(m).borderRadius === '50%' ? ' round' : ' square') : null, action: a ? a.textContent + ' ' + r2(box(a).width) + 'x' + r2(box(a).height) : null,
      skeleton: e.querySelectorAll('.sk').length, inCard: !!e.closest('.ui-card:not(.es)') }; });
  const card = document.querySelector('.tk-activity'), c = card && box(card), sum = card && box(card.querySelector('summary'));
  const text = document.body.innerText, overflowing = [...document.querySelectorAll('body *')].filter((e) => vis(e) && box(e).right > w + 1 && !e.closest('.sheet, dialog:not([open])')).slice(0, 8).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  const fail = [];
  for (const s of states) {
    if (s.kind === 'empty' && (!s.mark || !s.title || !s.words.length)) fail.push('empty state without mark or words: ' + JSON.stringify(s));
    if (s.kind === 'empty' && s.mark && s.mark !== '40x40 round') fail.push('mark ' + s.mark);
    if (s.kind === 'loading' && (!s.skeleton || s.role !== 'status')) fail.push('loading without skeleton or status role: ' + JSON.stringify(s));
    if (s.kind === 'error' && (!s.action || s.role !== 'alert' || !/Try again/.test(s.action))) fail.push('error without Try again or alert role: ' + JSON.stringify(s));
    if (s.action && ${phone} && +s.action.split(' ').pop().split('x')[1] < 44) fail.push('next step under 44px: ' + s.action);
    if (s.height < 60) fail.push('collapsed state ' + s.height + 'px: ' + s.words);
    if (/!/.test(s.words) || /undefined|null|\\[object|NaN/.test(s.words)) fail.push('bad words: ' + s.words);
  }
  if (card && c.height < 60) fail.push('Activity card collapsed to ' + r2(c.height) + 'px');
  const last = card?.querySelector('.tk-last'), lr = last && box(last);
  if (last && lr.right > c.right + 1) fail.push('Activity latest line runs past its card: ' + r2(lr.right) + ' > ' + r2(c.right) + ' (' + getComputedStyle(last).overflow + ', ' + getComputedStyle(last).display + ')');
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  return { viewport: innerWidth + 'x' + innerHeight, states, activity: card && { open: card.open, height: r2(c.height), summary: r2(sum.height), words: card.querySelector('summary').innerText.replace(/\\s+/g, ' ').trim() }, fail,
    dom: { url: location.href, hash: location.hash, overflow: document.documentElement.scrollWidth > w, overflowing, words: text.replace(/\\s+/g, ' ').trim().slice(0, 600) } };
})()`;

let ws, fault = null, held = [];
// A sealed run's judge reads at most ten captures, the measure text among them: EMPTY_CITE=1 keeps the seven the sealed claim names (its records go to <out>.records).
const cited = new Set(['waiting-none', 'evidence-none', 'reports-none', 'designs-none', 'answered-none', 'evidence-loading', 'evidence-error']);
const errors = [], failed = [], report = [], problems = [], shots = [], facts = {};
const b64 = (s) => Buffer.from(s).toString('base64');
try {
  // The bare board: nothing posted.
  mkdirSync(bare, { recursive: true });
  const serve = (folder) => { const board = join(folder, 'board.json'); const child = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0', '--evidence-root', folder], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((ok, no) => { let log = ''; const on = (d) => { log += d; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok({ url: m[0], board, child }); }; child.stdout.on('data', on); child.stderr.on('data', on); child.on('exit', () => no(new Error(log))); }); };
  writeFileSync(join(bare, 'config.yaml'), 'board: board.json\nname: Umer\n');
  writeFileSync(join(bare, 'board.json'), JSON.stringify({ schema: 2, items: [] }) + '\n');
  const bareServer = await serve(bare);
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400 && !x.params.response.url.startsWith('file:')) failed.push({ url: x.params.response.url, status: x.params.response.status });
    if (x.method === 'Fetch.requestPaused') paused(x.params); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  // The real request goes through unless a state holds it, fails it, or reshapes the reply the board itself gave.
  async function paused({ requestId, request }) {
    const f = fault && fault.match.test(request.url) ? fault : null;
    if (f?.kind === 'hold') return void held.push(requestId);
    if (f?.kind === 'fail') return cdp('Fetch.fulfillRequest', { requestId, responseCode: 500, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: b64('{"error":"The board did not answer"}') }).catch((e) => console.error('fulfill', e.message));
    if (f?.kind === 'reshape') { const body = await (await fetch(request.url)).json(); return cdp('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: b64(JSON.stringify(f.fn(body))) }).catch(() => {}); }
    return cdp('Fetch.continueRequest', { requestId }).catch(() => {});
  }
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 80; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}; flags: ${await js('JSON.stringify([ticketsRead, ticketsFailed, wholeBoard, paged])')}; page says: ${await js("document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)")}`); };
  const tap = async (sel) => { const [x, y] = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    if (phone) { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); } };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Network.setBypassServiceWorker', { bypass: true });
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*view=items*' }] });
  await cdp('Emulation.setDeviceMetricsOverride', metrics); await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const png = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, f = null) => { fault = f; held = []; await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(900); };
  // `allow` names the one request a state holds on purpose, so its failure is not counted against the frame.
  const capture = async (state, allow = false) => {
    await wait(450);
    if (!process.env.EMPTY_CITE || cited.has(state)) { await png(join(out, `${name(state)}.png`)); shots.push(`${name(state)}.png`); }
    const m = await js(MEASURE); m.frame = state; 
    writeFileSync(join(rec, `${name(state)}.dom.json`), JSON.stringify({ frame: state, ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    delete m.dom;
    writeFileSync(join(rec, `${name(state)}.measure.json`), JSON.stringify(m, null, 2) + '\n');
    report.push(`${name(state)}: ${m.states.map((s) => `${s.kind} "${s.words}" ${s.width}x${s.height}${s.mark ? ` mark ${s.mark}` : ''}${s.action ? ` [${s.action}]` : ''}${s.skeleton ? ` ${s.skeleton} skeleton bars` : ''}`).join(' | ') || 'no empty state'}${m.activity ? `; Activity card ${m.activity.open ? 'open' : 'closed'} ${m.activity.height}px, summary "${m.activity.words}"` : ''}; failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
    const bad = errors.filter((e) => !(allow && /500|404|did not answer|Failed to load resource/.test(e))), badReq = failed.filter(() => !allow);
    if (m.fail.length || bad.length || badReq.length) problems.push(`${name(state)}: ${JSON.stringify({ fail: m.fail, errors: bad, failed: badReq })}`);
    errors.length = 0; failed.length = 0;
    return m;
  };
  const only = (state, kind, text) => `[...document.querySelectorAll('.es-${kind}')].some((e) => e.innerText.includes(${JSON.stringify(text)}))`;

  {
  // 4. Decide, Evidence, Reports, Designs and Answered on the bare board: each its own words.
  for (const [hash, text] of [['waiting', 'Nothing is waiting on you'], ['evidence', 'No evidence updates'], ['reports', 'Nothing to read'], ['designs', 'No designs yet'], ['answered', 'Nothing answered yet']]) {
    await go(bareServer.url + '#' + hash);
    await until(`document.body.innerText.includes(${JSON.stringify(text)}) && !document.querySelector('.es-loading')`, hash + ' empty');
    await capture(`${hash}-none`);
  }
  // Evidence while its pages are held, and when they fail, then Try again.
  await go(bareServer.url + '#evidence', { match: /view=items/, kind: 'hold' });
  await until(only('', 'loading', 'Loading the board'), 'evidence loading');
  await capture('evidence-loading', true);
  await go(bareServer.url + '#evidence', { match: /view=items/, kind: 'fail' });
  await until(only('', 'error', 'Couldn’t load the rest of the board'), 'evidence error');
  await capture('evidence-error', true);
  fault = null; await tap('.es-act'); await until(only('', 'empty', 'No evidence updates'), 'evidence retry lands on empty');
  }
  console.log(report.join('\n'));
  writeFileSync(join(rec, `${name('facts')}.json`), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(rec, `measure.${side}.${theme}.${width}w.txt`), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board with no cards.',
    steps: [`Open Decide, Evidence, Reports, Designs and Answered on the empty board at ${metrics.width}x${metrics.height} (2x), ${theme}, and Evidence with its pages held and failed, then ${phone ? 'tap' : 'click'} Try again.`],
    result: `${theme}, ${metrics.width}px: every list, feed and card with nothing in it shows one empty state (a quiet mark, what goes here, one next step where there is one), a held read shows a skeleton and a failed read says what failed with Try again.` }, null, 2) + '\n');
  if (side === 'after') assert.deepEqual(problems, [], 'every capture measures clean');
  bareServer.child.kill();
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  for (const folder of [rich, bare]) try { cli('stop', join(folder, 'board.json')); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
