// Channels: one channel per fleet home and one thread per task, every message with its sender, its runtime and its receipt.
// Driven from files only: a temp fleet (three home status logs, one of them pointing at a home with a task, its steering inbox and a
// recorded harness and model) plus a temp ledger, so the run never reads or writes the captain's fleet.
// A headless Chromium of its own over the DevTools protocol with exact device metrics (390x844 or 1280x800, 2x), its profile in a temp folder.
// States: channels (the list, and on a desk the newest channel's messages), thread (a worker task thread), full (a message's whole text),
// new (a line appended while the page stays open: the live marker and the new-messages pill, no reload).
// Each capture is measured in the browser (<state>.<cell>.txt): the live marker, a runtime beside its sender, honest receipts, no key in
// the words on screen, no sideways overflow and no console error. It exits 1 on any failed measure.
// Usage: node .agents/skills/done-done-verify-sign-off/channels-shots.mjs <output> [light|dark|light,dark] [390|1280]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
if (theme.includes(',')) {
  const each = theme.split(',').map((t) => {
    const r = spawnSync(process.execPath, [process.argv[1], out, t, String(width)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    const file = join(out, `steps.${t}.json`); writeFileSync(file, readFileSync(join(out, 'steps.json')));
    return JSON.parse(readFileSync(file, 'utf8'));
  });
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: each[0].target, start: each[0].start,
    steps: each.flatMap((x, i) => x.steps.map((s) => `In ${theme.split(',')[i]}: ${s}`)), result: each.map((x) => x.result).join(' ') }, null, 2) + '\n');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'so-channels-')), board = join(dir, 'board.json'), fleet = join(dir, 'fleet');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_COMMS_STATE: join(fleet, 'state'), SIGN_OFF_COMMS_LEDGER: '', SIGN_OFF_COMMS_FEED: '', SIGN_OFF_COMMS_HOMES: '', SIGN_OFF_FLEET_HOME: '' };
delete env.SIGN_OFF_FILER;
const name = (state) => `${state}.${theme}.${width}w`;
const at = (min) => Math.floor(Date.now() / 1000) - min * 60;
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// The fleet: release-home is a lead whose task has a steering order still unread; settings-home records no path, so its worker history is not recorded.
const secret = ['sk', 'AbCd0123456789AbCd0123456789'].join('-');
mkdirSync(join(fleet, 'state'), { recursive: true });
mkdirSync(join(fleet, 'release-home/state/task-export.inbox/handled'), { recursive: true });
writeFileSync(join(dir, 'config.yaml'), `board: board.json\nname: Umer\ncomms_state: ${join(fleet, 'state')}\ncomms_ledger:\ncomms_feed:\ncomms_homes: Main\n`);
writeFileSync(board, readFileSync(join(repo, 'fixtures/sample-decisions.json')));
writeFileSync(join(fleet, 'state/release-home.status'), [
  `working [at=${at(90)}]: Shipping the export; the CSV writer is done and the page is next.`,
  `blocked [at=${at(50)}]: The settings page has no room for the export control and needs a decision.`,
  `resolved [at=${at(20)}]: The export control moves under the page's own menu.`].join('\n') + '\n');
writeFileSync(join(fleet, 'state/release-home.meta'), `harness=codex\nmodel=gpt-6.1-sol\nhome=${join(fleet, 'release-home')}\n`);
writeFileSync(join(fleet, 'state/settings-home.status'), `working [at=${at(70)}]: Reading the settings tickets and cutting the first slice.\n`);
writeFileSync(join(fleet, 'state/design-home.status'), `done [at=${at(30)}]: The design pass is up for review.\n`);
writeFileSync(join(fleet, 'release-home/state/task-export.status'), [
  `working [at=${at(85)}]: Writing the CSV writer and its test.`,
  `blocked [at=${at(40)}]: Blocked on the export endpoint's shape.`].join('\n') + '\n');
writeFileSync(join(fleet, 'release-home/state/task-export.meta'), 'harness=pi\nmodel=openai-codex/gpt-6.1-sol\n');
writeFileSync(join(fleet, 'release-home/state/task-export.inbox/001.msg'),
  `schema=jg-task-inbox.v1\nat=${new Date(at(60) * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}\nkind=order\nfrom=Main\nto=release-home\n--\nPut the export control under the page's own menu, then land the slice. TOKEN=${secret}\n`);
writeFileSync(join(fleet, 'release-home/state/task-export.inbox/handled/000.msg'),
  `schema=jg-task-inbox.v1\nat=${new Date(at(120) * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}\nkind=correction\nfrom=Main\nto=release-home\n--\nCorrecting the last order: the export ships behind the beta flag.\n`);

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');

const prof = mkdtempSync(join(tmpdir(), 'so-channels-cdp-'));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { for (const p of [chrome, server]) try { p.kill(); } catch {} };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));
let port; for (let i = 0; i < 300 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
assert.ok(port, 'Chromium did not open its DevTools port');
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pending = new Map(), errors = [];
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
  if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
  if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' ')); };
const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 2, mobile: false });
await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
const until = async (expression, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await evaluate(expression)) return true; await wait(100); } return false; };
const go = async (hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(100); await cdp('Page.navigate', { url: base + hash }); await until('!!document.querySelector(".ch-row")'); };
const tap = async (selector) => { assert.ok(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.click(); return !!e; })()`), `nothing to tap at ${selector}`); await wait(600); };

// What a person reads: the live marker, each sender's runtime, the receipts, and no key anywhere in the words.
const MEASURE = `(() => { const fail = [], w = document.documentElement.clientWidth, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const live = document.querySelector('.ch-live'), said = live ? live.textContent : '';
  const rows = [...document.querySelectorAll('.ch-row')].filter(vis).map((r) => r.querySelector('strong')?.textContent ?? '');
  const messages = [...document.querySelectorAll('.ch-message')].filter(vis).map((m) => ({
    from: m.querySelector('.ch-message-meta strong')?.textContent ?? '', runtime: m.querySelector('.ch-runtime')?.textContent ?? '',
    to: [...m.querySelectorAll('.ch-message-meta span')][1]?.textContent ?? '', kind: m.querySelector('.ch-kind')?.textContent ?? '',
    receipt: m.querySelector('.ch-receipt')?.textContent ?? '', preview: m.querySelector('.ch-preview')?.textContent ?? '', open: !!m.querySelector('.ch-open') }));
  const sheet = document.querySelector('.ch-full[open]'), full = sheet ? { text: sheet.querySelector('.ch-full-text')?.textContent ?? '', source: sheet.querySelector('.ch-source')?.textContent ?? '' } : null;
  const pill = document.querySelector('.ch-new'), heads = [...document.querySelectorAll('.ch-list h2')].filter(vis).map((h) => h.textContent);
  for (const e of [...document.querySelectorAll('main h1, .ch-row-text strong, .ch-message-meta, .ch-full-text')].filter(vis)) if (e.scrollWidth > e.clientWidth + 1) fail.push('cut: ' + e.textContent.slice(0, 40));
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  const text = document.body.innerText;
  const bad = text.match(/\\b(?:undefined|NaN|\\[object Object\\])\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  if (/sk-[A-Za-z0-9-]{12,}/.test(text)) fail.push('a key reached the screen');
  return { url: location.href, live: said, rows, heads, messages, full, pill: pill ? pill.textContent : '', body: text.slice(0, 1200), fail }; })()`;
const results = [];
const capture = async (state, check = () => {}) => {
  const m = await evaluate(MEASURE);
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name(state)}.png`), Buffer.from(shot.data, 'base64'));
  try { check(m); } catch (e) { m.fail.push(e.message.split('\n')[0]); }
  results.push({ state, ...m, console_errors: [...errors] });
  writeFileSync(join(out, `${name(state)}.txt`), JSON.stringify({ state, ...m, console_errors: [...errors] }, null, 2) + '\n');
  console.log(state, m.fail.length || errors.length ? `FAIL ${[...m.fail, ...errors].join('; ')}` : 'ok');
  errors.length = 0;
};
const everyHome = (m) => {
  for (const h of ['Main', 'design-home', 'release-home', 'settings-home']) assert.ok(m.rows.includes(h), `${h} has a channel`);
  assert.deepEqual(m.heads, ['Teams · 4', 'Worker threads'], 'every home and its threads are listed');
};
const liveMarker = (m) => assert.match(m.live, /Live/, 'the live marker is shown');

try {
  // The list: every home from the files, the threads under it, and on a desk the newest channel's own messages.
  await go('#channels');
  if (!phone) await until('!!document.querySelector(".ch-message")');
  await capture('channels', (m) => { everyHome(m); liveMarker(m); if (!phone) assert.ok(m.messages.length >= 1, 'the channel on a desk shows its messages'); });

  // A worker thread: its own task's status log and the steering order still waiting in its inbox.
  await go('#channels');
  // The thread's own address, as the list builds it, so a phone reaches it without the hidden list.
  await evaluate(`(() => { const t = (s) => btoa(unescape(encodeURIComponent(s))).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
    location.hash = '#channels/t-' + t('release-home') + '.' + t('task-export'); })()`);
  await until('!!document.querySelector(".ch-message")');
  await capture('thread', (m) => {
    liveMarker(m);
    const order = m.messages.find((x) => x.kind === 'order');
    assert.ok(order, 'the steering order is in the thread');
    assert.equal(order.receipt, 'Not read · Handled not recorded', 'a moved file is read, never handled');
    assert.match(order.preview, /\[key hidden\]/, 'the key is redacted before it reaches the screen');
    assert.ok(m.messages.some((x) => x.kind === 'correction' && /Read/.test(x.receipt)), 'a handled correction reads as read');
    assert.equal(m.messages.find((x) => x.kind === 'blocker')?.receipt, 'Read not recorded · Handled not recorded', 'an absent receipt says so');
    assert.ok(m.messages.some((x) => x.runtime === 'pi · openai-codex/gpt-6.1-sol'), 'the sender carries its recorded runtime');
  });

  // One message whole: its full text, where it came from, and that keys are hidden.
  assert.ok(await evaluate(`(() => { const m = [...document.querySelectorAll('.ch-message')].find((x) => x.querySelector('.ch-kind')?.textContent === 'order'); const a = m?.querySelector('.ch-open'); a?.click(); return !!a; })()`), 'no open link on the order');
  await wait(700);
  await capture('full', (m) => {
    assert.ok(m.full, 'the full text is open');
    assert.match(m.full.text, /Put the export control under the page's own menu/, 'the whole text is there');
    assert.match(m.full.text, /\[key hidden\]/, 'the key stays hidden in the whole text');
    assert.match(m.full.source, /Keys are hidden/, 'the sheet says keys are hidden');
  });

  // Back to the thread itself, so the pill is captured over the messages and not under an open sheet.
  await evaluate(`document.querySelector('.ch-full[open] .ch-close')?.click()`);
  await until('!document.querySelector(".ch-full[open]")');
  await until('!!document.querySelector(".ch-message")');

  // A line arrives while the page stays open: the pill counts it and the page has not been reloaded.
  const before = await evaluate('document.querySelectorAll(".ch-message").length');
  appendFileSync(join(fleet, 'release-home/state/task-export.status'), `resolved [at=${Math.floor(Date.now() / 1000)}]: The export endpoint's shape is settled.\n`);
  for (let i = 0; i < 12 && !(await evaluate('!!document.querySelector(".ch-new")')); i++) await wait(600);
  await capture('new', (m) => {
    liveMarker(m);
    assert.ok(m.pill, 'the new-messages pill appeared without a reload');
    assert.match(m.pill, /1 new message/, 'the pill counts the line that arrived');
    assert.equal(m.messages.length, before, 'the newest line waits behind the pill until it is read');
  });
  assert.ok(results.every((r) => !r.fail.length && !r.console_errors.length), results.filter((r) => r.fail.length || r.console_errors.length).map((r) => `${r.state}: ${[...r.fail, ...r.console_errors].join('; ')}`).join(' | '));
} finally {
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: '1' },
    start: 'A fleet whose homes and tasks are readable as files.',
    steps: ['The person opens Channels and reads the list of every home and its threads.',
      ...(phone ? ['They tap a home to read its messages.'] : []),
      'They open a worker thread and read its status log and the steering order waiting in its inbox.',
      "They open one message to read it whole, with its source and its key hidden.",
      'A line arrives while the page stays open and the pill counts it.'],
    result: 'Channels shows every home and task thread from the fleet files, with each sender\'s runtime, honest receipts and hidden keys, at a phone and a desk, light and dark.' }, null, 2) + '\n');
  results.forEach((r) => { for (const k of ['messages', 'full']) if (Array.isArray(r[k])) r[k] = `${r[k].length} read`; });
  writeFileSync(join(out, `channels.${theme}.${width}w.json`), JSON.stringify(results, null, 2) + '\n');
  cleanup();
  rmSync(prof, { recursive: true, force: true });
  console.log(join(out, `channels.${theme}.${width}w.png`));
}
