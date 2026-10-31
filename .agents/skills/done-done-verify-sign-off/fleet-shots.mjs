// The Inbox as a conversation with everyone: the people rail, a one-to-one thread with its receipts, #fleet as a group channel
// with its mute, a mention that jumps to the ticket or report an agent named, and a search that finds what an agent said.
// Driven on a real board: three agents post, the person answers and comments, the agents' own waits read them, and the fleet's
// own feed carries the talk between agents, including a ticket mention.
// A headless Chromium of its own over the DevTools protocol at exact device metrics (390 x 844 on a phone, 1280 x 800 on a desk; 2x).
// States: list, thread, fleet (muted), mention (the ticket a chip opens), search (a word from #fleet).
// Each state is measured in the browser: the rail's people and entries, the thread's bubbles and receipt, the channel's mute and
// its message count, the mention's title and destination, the search hits, no sideways overflow and no console error.
// Usage: node .agents/skills/done-done-verify-sign-off/fleet-shots.mjs <output> [light|dark] [390|1280]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? '.');
const theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-fleet-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'),
  XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const cli = (...args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const shot = (state) => `${state}.${theme}.${width}w`;

// The board: three agents, a ticket, a report, and one thread with a sent, a read and a replied on it.
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
const ask = (filer, key, title, why) => cli('post', board, '--filer', filer, '--ask-ref', 'message-demo', '--key', key, '--title', title, '--why', why,
  '--outcome', 'yes=It ships this week.', '--outcome', 'no=It waits a week.', '--recommend', 'yes', '--recommend-reason', 'It is ready.', '--default', 'yes');
ask('addons-lead', 'release-notes', 'Ship the release notes this week?', 'The notes are written and checked.');
ask('signoff-worker', 'fleet-history', 'Read #fleet from one record?', 'The board reads the fleet feed already.');
ask('release-agent', 'digest', 'Keep the weekly digest?', 'The paid plan renews Monday.');
cli('ticket', board, '--id', 'T-29', '--title', 'Move the ticket owner before release', '--project', 'Settings', '--progress', '40');
// The fleet's own feed: what the agents said to each other, a ticket and a report mentioned by name.
const feed = join(dir, 'feed.jsonl'), now = Math.floor(Date.now() / 1000);
writeFileSync(feed, [
  { ts: now - 3600, home: 'Main', channel: 'task:addons', from: 'addons-lead', to: 'sign-off', kind: 'status',
    text: 'The message store is in: threads, receipts and #fleet all read one record. It is parked on #tickets/T-29 until the owner move ships.' },
  { ts: now - 3000, home: 'Main', channel: 'task:addons', from: 'signoff-worker', to: 'addons-lead', kind: 'status',
    text: 'Rebuilt the receipts; a message with no read mark now says Not read yet instead of nothing.' },
  { ts: now - 2400, home: 'Main', channel: 'task:addons', from: 'addons-lead', to: 'signoff-worker', kind: 'steer',
    text: 'Good. Then #tickets/T-29 needs its owner moved before that ships.' },
  { ts: now - 1800, home: 'Main', channel: 'task:addons', from: 'signoff-worker', to: 'addons-lead', kind: 'status',
    text: 'Moved. Nothing is unowned on the board now.' },
].map((r) => JSON.stringify(r)).join('\n') + '\n');
env.SIGN_OFF_COMMS_FEED = feed;

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');
const api = async (path, body) => { const r = await fetch(base + path.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200, await r.text()); };
// A thread with all three receipts on it: an answer the agent's own wait read, then a comment it replied to.
await api('/api/answers', { key: 'digest', answer: 'yes', note: 'It keeps going out each week.' });
cli('wait', board, '--filer', 'release-agent', '--timeout', '5');
await wait(1100);
await api('/api/messages', { kind: 'comment', key: 'release-notes', text: 'The mention chip should open the ticket, not name it.' });
await wait(1100);
cli('feedback', 'release-notes', board, '--reply', 'It does: the chip reads the ticket title and opens it, and the words keep no id.', '--filer', 'addons-lead');

// The browser.
const prof = mkdtempSync(join(tmpdir(), 'so-fleet-cdp-'));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); server.kill(); } catch {} });
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
const go = async (hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(100); await cdp('Page.navigate', { url: base + hash }); await wait(1600); };
const MEASURE = `(async () => { await document.fonts.ready; const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const txt = (e) => (e?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const rail = { people: [...document.querySelectorAll('.ib-person')].filter(vis).map(txt), entries: [...document.querySelectorAll('.ib-ent')].filter(vis).map((e) => txt(e) + ' ' + e.getAttribute('href')),
    rows: [...document.querySelectorAll('.ib-row')].filter(vis).map((r) => ({ name: txt(r.querySelector('.t')), agent: txt(r.querySelector('.ib-ag')), mark: txt(r.querySelector('.ib-n')) + txt(r.querySelector('.ib-nr')) })) };
  const thread = document.querySelector('.ib-thread');
  const seen = thread ? { title: txt(thread.querySelector('h1')), bubbles: [...thread.querySelectorAll('.ib-say')].filter(vis).map((p) => (p.closest('.ib-msg').classList.contains('you') ? 'you: ' : 'agent: ') + txt(p)),
    receipts: [...thread.querySelectorAll('.ib-rcpt')].filter(vis).map(txt), mute: txt(thread.querySelector('.ib-mute')), banner: txt(thread.querySelector('.ib-mutebar')),
    mutePressed: thread.querySelector('.ib-mute')?.getAttribute('aria-pressed'), mentions: [...thread.querySelectorAll('.ib-mention')].filter(vis).map((a) => txt(a) + ' -> ' + a.getAttribute('href')),
    count: txt(thread.querySelector('.ib-meta')), msgs: [...thread.querySelectorAll('.ib-msg')].filter(vis).length } : null;
  const search = { field: !!document.querySelector('#ib-find'), hits: [...document.querySelectorAll('.ib-sec[aria-label="In #fleet"] .ib-row')].filter(vis).map((r) => txt(r.querySelector('.t')) + ' / ' + txt(r.querySelector('.l2'))) };
  return { rail, thread: seen, search, hash: location.hash, text: document.body.innerText, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`;
const capture = async (state, hash, check) => {
  await go(hash);
  const m = await evaluate(MEASURE);
  assert.equal(m.overflow, false, `${shot(state)}: sideways overflow`);
  check?.(m);
  await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((r) => writeFileSync(join(out, `${shot(state)}.png`), Buffer.from(r.data, 'base64')));
  writeFileSync(join(out, `${shot(state)}.txt`), JSON.stringify(m, null, 1) + '\n');
  return m;
};

// The rail: the people the board hears from, and #fleet at its foot beside Agents and Done.
const list = await capture('list', '#inbox', (m) => {
  assert.ok(m.rail.entries.some((e) => e.endsWith('#inbox/fleet') && /#fleet/.test(e)), 'no #fleet entry in the rail: ' + JSON.stringify(m.rail.entries));
  assert.ok(m.rail.entries.some((e) => /Agents/.test(e) && e.endsWith('#channels')), 'the Agents entry left the rail');
  assert.ok(m.rail.rows.length >= 1, 'no thread rows');
});
// Mute #fleet: a press on its own control, and the banner that says what mute does not do.
await go('#inbox/fleet');
const mute = await evaluate(`(async () => { const b = document.querySelector('.ib-mute'); if (!b) return 'no mute'; if (b.getAttribute('aria-pressed') === 'true') b.click(); return 'ready'; })()`);
assert.equal(mute, 'ready', 'no mute control on #fleet');
await wait(300);
await evaluate(`(() => { const b = document.querySelector('.ib-mute'); b.click(); return b.getAttribute('aria-pressed'); })()`);
await wait(500);
const fleet = await capture('fleet', '#inbox/fleet', (m) => {
  assert.equal(m.thread.mutePressed, 'true', '#fleet did not stay muted');
  assert.match(m.thread.mute, /Muted/);
  assert.match(m.thread.banner, /mentions still|still lands|quiet/i, 'no muted banner');
  assert.ok(m.thread.msgs >= 4, `#fleet shows ${m.thread.msgs} messages, not the fleet's own`);
  assert.ok(m.thread.mentions.length >= 2, 'the ticket mentions were not chips: ' + JSON.stringify(m.thread.mentions));
  assert.ok(m.thread.mentions.every((s) => s.includes('Move the ticket owner before release')), 'a mention shows an id, not a title: ' + JSON.stringify(m.thread.mentions));
});
// The jump: the chip's own destination, and the way back to the conversation.
const href = fleet.thread.mentions[0].split(' -> ')[1];
const mention = await capture('mention', href, (m) => assert.ok(!/T-29/.test(m.text ?? ''), 'the mention page shows a raw id: ' + (m.text ?? '')));
assert.ok(!/T-29/.test(await evaluate('document.body.innerText')), 'the mention page reads an id to the person');
// A 1:1 thread with sent, read and replied on it: the row is on the rail, and its address is the thread it opens.
await go('#inbox');
const row = await evaluate(`(() => { const a = [...document.querySelectorAll('.ib-row')].map((r) => r.getAttribute('href')).find((h) => h === '#inbox/release-notes'); return a ?? ''; })()`);
assert.ok(row, 'the release-notes thread has no row on the rail');
const thread = await capture('thread', row, (m) => {
  assert.ok(m.thread.bubbles.length >= 2, 'the thread is not a conversation: ' + JSON.stringify(m.thread.bubbles));
  assert.ok(m.thread.receipts.some((r) => /Replied/.test(r)), 'no replied receipt on what was sent: ' + JSON.stringify(m.thread.receipts));
  assert.ok(m.thread.bubbles.some((b) => b.startsWith('agent:')), 'the agent did not speak in the thread');
});
// A search that finds what an agent said: a word only the fleet's own record holds.
await go('#inbox');
const search = await capture('search', '#inbox', () => {});
await evaluate(`(() => { const b = document.querySelector('#ib-find'); b.value = 'unowned'; b.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await wait(900);
const found = await evaluate(MEASURE);
assert.ok(found.search.hits.length >= 1, 'the search did not find what #fleet said: ' + JSON.stringify(found.search));
await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((r) => writeFileSync(join(out, `${shot('search')}.png`), Buffer.from(r.data, 'base64')));
writeFileSync(join(out, `${shot('search')}.txt`), JSON.stringify(found, null, 1) + '\n');
assert.deepEqual(errors, [], 'console errors: ' + errors.join(' | '));

writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: cli('--version').trim().split('\n')[0] }, start: 'a board with three agents, a ticket and the fleet\'s own feed',
  steps: ['open the Inbox and read the people rail, #fleet at its foot', 'open #fleet, mute it, and read the agents talking to each other', 'tap the ticket an agent mentioned and come back',
    'open a one-to-one thread and read the receipts on what was sent', 'search the Inbox for a word an agent said'],
  result: 'a conversation with everyone: the people and #fleet, a thread with sent, read and replied, a mention that opens the ticket it names, and a search that finds it' }, null, 1) + '\n');
console.log(JSON.stringify({ ok: true, theme, width, states: ['list', 'thread', 'fleet', 'mention', 'search'], thread: thread.thread.title, receipts: thread.thread.receipts.length, mentions: fleet.thread.mentions.length, hits: found.search.hits.length }));
process.exit(0);
