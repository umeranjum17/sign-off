// The inbox, one more menu beside Today, Decide, Evidence, Reports and Tickets: every exchange with an agent as one thread in one list, whatever its kind. New replies first, then what waits on the person, then what waits
// on an agent with its trail step, then archived threads folded away (a thread archives itself once it is answered and acted on). Kind chips filter the list; a row opens its thread (beside the list on a desk).
// Driven the way it happens: the person answers in the board, the agents' own waits take the answers, and the agents run `feedback <key> --reply`.
// A headless Chromium of its own over the DevTools protocol with exact device metrics (360, 390 or 445 x 844 on a phone; 1280 or 1440 x 800 on a desk; 2x), its profile in a temp folder.
// States: inbox (unread first and the kind chips), thread (a reply that asks for a next step, its pair and its follow-up buttons), action (Your action, What was done and its link),
// answered (a follow-up tapped: the card leaves Decide for Answered), notice (a reply lands while the board is open), beside (a desk only: the ask opened beside its thread).
// Each capture is measured in the browser: the section order, no sideways overflow, no raw words, and no console error.
// Usage: node .agents/skills/done-done-verify-sign-off/inbox-shots.mjs <output> [light|dark] [360|390|445|1280|1440]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-inbox-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const cli = (...args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const name = (state) => `${state}.${theme}.${width}w`;

// The board: asks from two agents, a plan, a guided report, a design and a ticket.
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
const ask = (filer, key, title, why, yes, no) => cli('post', board, '--filer', filer, '--ask-ref', 'message-demo', '--key', key, '--title', title, '--why', why,
  '--outcome', `yes=${yes}`, '--outcome', `no=${no}`, '--recommend', 'yes', '--recommend-reason', 'It is the safer pick.', '--default', 'yes');
ask('release-agent', 'digest', 'Keep the weekly digest?', 'The paid plan renews Monday.', 'It keeps going out.', 'It stops this week.');
ask('release-agent', 'export', 'Turn on the CSV export?', 'Two teams asked for it this month.', 'It ships Friday.', 'It waits a release.');
ask('settings-agent', 'ship', 'Ship the new settings page Friday?', 'No new bug reports for three weeks.', 'The page ships Friday.', 'It waits a week.');
ask('settings-agent', 'beta', 'Open the beta to every team?', 'The first ten teams found no blockers.', 'Every team gets it Monday.', 'It stays with ten teams.');
ask('main', 'name-tool', 'What should the public tool be named?', 'The launch page needs a name.', 'The name is used.', 'We keep looking.');
ask('release-agent', 'old', 'Send the digest on Mondays?', 'Choose the weekly digest schedule.', 'It goes out Mondays.', 'It is paused.');
writeFileSync(join(dir, 'plan.json'), readFileSync(join(repo, 'fixtures/contract/plan.v1/valid-full.json'), 'utf8').replace('"page/index.html"', '"page/plan.html"'));
mkdirSync(join(dir, 'page'));
writeFileSync(join(dir, 'page/plan.html'), readFileSync(join(repo, 'fixtures/contract/plan.v1/page/index.html')));
cli('post', board, '--kind', 'plan', '--from', join(dir, 'plan.json'));
const report = { ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'), 'utf8')), filed: new Date(Date.now() - 150 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z') };
writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
cli('ticket', board, '--id', 'T-1', '--title', 'Ship the CSV export', '--project', 'Settings', '--progress', '40');

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');
const api = async (path, body) => { const r = await fetch(base + path.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200, await r.text()); };
// Waiting on an agent: answered, and the agent's own wait has read it.
await api('/api/answers', { key: 'export', answer: 'yes', note: 'Only the admin role should see it.' });
cli('wait', board, '--filer', 'release-agent', '--timeout', '5');
// An action and what was done: the person said no, the agent did it and links the pull request.
await api('/api/answers', { key: 'beta', answer: 'no', note: 'Wait until the import bug is fixed.' });
cli('wait', board, '--filer', 'settings-agent', '--timeout', '5');
cli('feedback', 'beta', board, '--reply', 'Kept it to the ten teams. The import fix is in review.', '--link', 'https://github.com/example/settings/pull/245');
// A question and a reply that asks for a next step: the person writes back instead of picking, the agent answers with two follow-ups.
await api('/api/answers', { key: 'ship', answer: 'text', note: process.env.CHAT_ONLY ? 'What does Friday need from QA? I want the page, the copy and the settings export all checked before we say yes.' : 'What does Friday need from QA?' });
cli('wait', board, '--filer', 'settings-agent', '--timeout', '5');
cli('feedback', 'ship', board, '--reply', (process.env.CHAT_ONLY ? 'QA signs off Thursday, so Friday holds. They have run the settings page on both phones and the desk, found nothing open, and the export check passed with the new columns. The copy review is the only thing left and it is booked for Thursday morning. Ship it Friday?' : 'QA signs off Thursday, so Friday holds. Ship it Friday?'), '--option', 'yes=Ship Friday', '--option', 'no=Wait a week');
// Answered, then relayed: the lead reads the answer through `answers`, with no wait of its own and no feedback line, and the thread shows Read from that.
await api('/api/answers', { key: 'name-tool', answer: 'yes', note: '' });
cli('answers', board, '--json');
// Answered and acted on: it archives itself.
await api('/api/answers', { key: 'old', answer: 'yes', note: '' });
cli('wait', board, '--filer', 'release-agent', '--timeout', '5');
cli('feedback', 'old', board, '--acted', '--link', 'https://github.com/example/digest/pull/12');
// The ticket comment, as the fleet dashboard hands its record over: sent, picked up by the lead, answered.
const sec = Math.floor(Date.now() / 1000);
cli('ticket', board, '--id', 'T-1', '--comment', JSON.stringify({ id: '3f9a1c2e7b6d4a10', at: sec - 50 * 60, text: 'Is the export in this release?', to: 'release-agent', error: null, picked: sec - 45 * 60,
  replies: [{ at: sec - 8 * 60, text: 'Yes, it ships Friday with the release.', by: 'release-agent' }] }));

// The browser.
const prof = mkdtempSync(join(tmpdir(), 'so-inbox-cdp-'));
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
const go = async (hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(100); await cdp('Page.navigate', { url: base + hash }); await wait(1500); };
// The measure: the inbox's sections and rows in order, the chips, the open thread's pairs, overflow, raw words and console errors.
const MEASURE = `(async () => { await document.fonts.ready; const fail = [], w = document.documentElement.clientWidth, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sections = [...document.querySelectorAll('.ib-sec')].filter(vis).map((s) => ({ head: s.querySelector('h2, .ib-sh')?.textContent ?? '', rows: [...s.querySelectorAll('.ib-row')].map((r) => (r.classList.contains('unread') ? '* ' : '') + r.querySelector('.t').textContent + ' / ' + (r.querySelector('.ib-kind')?.textContent ?? '')) }));
  const chips = [...document.querySelectorAll('.ib-chip')].filter(vis).map((c) => (c.getAttribute('aria-pressed') === 'true' ? '[' + c.textContent + ']' : c.textContent));
  const flts = [...document.querySelectorAll('.ib-flt')].filter(vis).map((b) => (b.getAttribute('aria-pressed') === 'true' ? '[' + b.textContent + ']' : b.textContent));
  const entries = [...document.querySelectorAll('.ib-ent')].filter(vis).map((e) => e.textContent.trim().replace(/\\s+/g, ' '));
  const marks = [...document.querySelectorAll('.ib-row')].filter(vis).map((r) => [r.querySelector('.t').textContent, r.querySelector('.ib-n')?.textContent ?? '', r.querySelector('.ib-nr')?.textContent ?? '']);
  const rail = document.querySelector('.split-list')?.getBoundingClientRect().width ?? 0;
  const dock = document.querySelector('#tabs')?.getBoundingClientRect(), foot = document.querySelector('.ib-ent:last-child');
  if (dock && dock.width > 0 && foot) { foot.scrollIntoView({ block: 'end' }); window.scrollTo(0, document.documentElement.scrollHeight); await new Promise((ok) => setTimeout(ok, 200)); if (foot.getBoundingClientRect().bottom > dock.top + 1) fail.push('the last rail entry is under the dock at the scroll end'); window.scrollTo(0, 0); }
  const thread = document.querySelector('.ib-thread');
  // The open thread as a chat: each message's side and words, how far each of the person's reached, the artifacts inline, and which side of the screen each side sits on.
  const msgs = thread ? [...thread.querySelectorAll('.ib-msg')].filter(vis).map((p) => (p.classList.contains('you') ? 'you: ' : 'agent: ') + (p.querySelector('.ib-say')?.textContent ?? '').trim()) : [];
  const rcpts = thread ? [...thread.querySelectorAll('.ib-rcpt')].filter(vis).map((r) => r.textContent.replace(/\\d\\d:\\d\\d|\\d+ \\w+/, '').replace(/\\s+/g, ' ').trim()) : [];
  const arts = thread ? [...thread.querySelectorAll('.ib-art')].filter(vis).map((a) => a.querySelector('.ib-at b').textContent + ' / ' + a.querySelector('.ib-at span').textContent) : [];
  const log = thread?.querySelector('.ib-chat')?.getBoundingClientRect(), sides = log ? { you: [...thread.querySelectorAll('.ib-msg.you .ib-say')].filter(vis).map((e) => Math.round(log.right - e.getBoundingClientRect().right)), agent: [...thread.querySelectorAll('.ib-msg:not(.you) .ib-say, .ib-msg:not(.you) .ib-art')].filter(vis).map((e) => Math.round(e.getBoundingClientRect().left - log.left)) } : null;
  // The latest message must be in view and clear of the box pinned under it.
  const lastMsg = thread ? [...thread.querySelectorAll('.ib-msg')].filter(vis).at(-1)?.getBoundingClientRect() : null, cw = thread?.querySelector('.ib-cw')?.getBoundingClientRect(), scrollers = thread ? [thread, thread.parentElement, document.scrollingElement, document.body].map((e) => [e.tagName + '.' + e.className, Math.round(e.scrollTop), e.scrollHeight, e.clientHeight, getComputedStyle(e).overflowY, Math.round(scrollY)]) : null;
  const optBox = thread ? [...thread.querySelectorAll('.tr-opt')].filter(vis).map((b) => b.getBoundingClientRect()) : [], opts_clear = optBox.length && cw ? optBox.every((r) => r.top >= 0 && r.bottom <= cw.top + 1) : null;
  const latest_clear = lastMsg && cw ? lastMsg.bottom <= cw.top + 1 && lastMsg.bottom <= window.innerHeight : null;
  const barEl = document.querySelector('.ib-bar'), barTops = [...new Set([...document.querySelectorAll('.ib-chip, .ib-flt')].filter(vis).map((b) => Math.round(b.getBoundingClientRect().top)))];
  const bar = barEl ? { rows: barTops.length, scrolls: barEl.scrollWidth > barEl.clientWidth, height: Math.round(barEl.getBoundingClientRect().height) } : null;
  const footBox = document.querySelector('.ib-foot')?.getBoundingClientRect(), first_screen = footBox ? Math.round(footBox.bottom) <= (dock && dock.width > 0 ? dock.top : window.innerHeight) : false;
  const follow = [...document.querySelectorAll('.tr-opt')].filter(vis).map((b) => b.textContent);
  const notice = [...document.querySelectorAll('.ib-note')].filter(vis).map((n) => n.innerText.replace(/\\n+/g, ' / '));
  const thread_answers = thread ? thread.querySelectorAll('.tr-opt, .tr-opts, [role=radio], input[type=radio], .pick-option, .answer').length : 0;
  const menu = [...document.querySelectorAll('#tabs a, #nav a:not(.sfind)')].filter(vis).map((a) => (a.getAttribute('aria-label') || a.textContent).replace(/,.*$|\\d+$/g, '').trim()), search = [...document.querySelectorAll('a[href="#find"]')].some(vis);
  for (const e of document.querySelectorAll('#tabs, .dock-find')) { const r = e.getBoundingClientRect(); if (r.width > 0 && (r.left < 0 || r.right > w)) fail.push('the dock leaves the screen'); }
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  const words = document.body.innerText, bad = words.match(/\\b(?:answer|round|comment):[\\w.-]+:|\\btrail\\.jsonl\\b|undefined|NaN|\\[object/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  return { url: location.href, viewport_width: window.innerWidth, flts, entries, marks, rail: Math.round(rail), title: document.title, menu, search, sections, chips, thread: thread?.querySelector('.ib-ttl')?.textContent ?? '', status: thread?.querySelector('.ib-state')?.textContent ?? '', msgs, rcpts, arts, sides, bar, first_screen, latest_clear, opts_clear, page_scroll: Math.round(scrollY), scrollers, follow, closed: document.querySelector('.ib-closed')?.innerText.replace(/\\n+/g, ' / ') ?? '', badge: [...document.querySelectorAll('#tabs a[href="#inbox"] .bd, #nav a[href="#inbox"] .n')].filter(vis).map((b) => b.textContent).join(''), notice, thread_answers, fail }; })()`;
const results = [];
// RECEIPTS_ONLY=1 captures just the relayed answer's thread (journey `answer-receipts`).
const capture = async (state, hash, before, check) => {
  if (process.env.RECEIPTS_ONLY && state !== 'relayed') return;
  if (process.env.RAIL_ONLY && !['rail', 'unread'].includes(state)) return;
  if (process.env.CHAT_ONLY && !['list', 'chat', 'pr'].includes(state)) return;
  errors.length = 0;
  if (hash !== null) await go(hash);
  if (before) { await evaluate(before); await wait(700); }
  const m = await evaluate(MEASURE);
  if (check) try { check(m); } catch (e) { m.fail.push(e.message.split('\n')[0]); }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name(state)}.png`), Buffer.from(shot.data, 'base64'));
  results.push({ state, ...m, console_errors: [...errors] });
  writeFileSync(join(out, `${name(state)}.txt`), JSON.stringify({ state, ...m, console_errors: [...errors] }, null, 2) + '\n');
  console.log(state, m.fail.length ? `FAIL ${m.fail.join('; ')}` : 'ok');
};
const heads = (m) => m.sections.map((s) => s.head.replace(/\s*\d+$/, ''));
const tap = (sel) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getBoundingClientRect().width > 0); b.scrollIntoView({ block: 'center' }); b.click(); })()`;
try {
  // RAIL_ONLY=1 (journey `inbox-rail`): the rail as the conversation's neighbour. One ask got a comment no agent has read; the rows carry the unread counts, the two unread filters count the threads, Agents and Done close the rail.
  if (process.env.RAIL_ONLY) {
    await api('/api/messages', { kind: 'comment', key: 'digest', text: 'Can you hold the digest until Monday?' });
    const check = (m) => {
      assert.deepEqual(m.flts.map((f) => f.replace(/^\[|\]$/g, '').replace(/\d+$/, '')), ['Unread from agents', 'Not read by agents'], 'both unread filters: ' + m.flts.join(', '));
      assert.deepEqual(m.entries.map((e) => e.replace(/\d+$/, '').trim()), ['Agentsread-only', 'Done'], 'the rail ends with Agents and Done: ' + m.entries.join(', '));
    };
    await capture('rail', '#inbox', '', (m) => {
      check(m);
      assert.ok(m.marks.some((r) => r[1] === '1'), 'a row carries the count of replies not opened: ' + JSON.stringify(m.marks));
      assert.ok(m.marks.some((r) => r[0].startsWith('Keep the weekly digest') && r[2] === 'Not read'), 'a row says the agent has not read it: ' + JSON.stringify(m.marks));
      assert.deepEqual(m.flts.map((f) => f.replace(/\D/g, '')), ['3', '1'], 'filter counts: ' + m.flts.join(', '));
      if (!phone) assert.ok(m.rail >= 290 && m.rail <= 330, 'the rail is about 304 px wide, not ' + m.rail);
    });
    await capture('unread', '#inbox', tap('.ib-flt[aria-pressed=false]:last-of-type'), (m) => {
      check(m);
      assert.ok(m.flts[1].startsWith('['), 'Not read by agents is on: ' + m.flts.join(', '));
      assert.deepEqual(m.marks.map((r) => r[0]), ['Keep the weekly digest?'], 'only the thread its agent has not read: ' + JSON.stringify(m.marks));
    });
  }
  if (process.env.CHAT_ONLY) {
    // One person, three screens: the Inbox list with nothing open, the thread with a long question and an agent's two choices (and a line the agent has not read) that scrolls on a phone, and the one an agent answered with a pull request.
    // Trail times are whole seconds: a second goes by first, so the line is plainly after the reply it follows and that reply does not count as answering it.
    await wait(1100);
    await api('/api/messages', { kind: 'comment', key: 'ship', text: 'Is QA booked for Thursday?' });
    await capture('list', '#inbox', '', (m) => {
      assert.equal(m.bar.rows, 1, 'the filters are one row, not ' + m.bar.rows + ': ' + JSON.stringify(m.bar));
      assert.deepEqual(m.flts.map((f) => f.replace(/\d+$/, '')), ['Unread from agents', 'Not read by agents']);
      assert.deepEqual(m.entries.map((e) => e.replace(/\d+$/, '').trim()), ['Agentsread-only', 'Done']);
      if (phone) assert.ok(m.first_screen, 'Agents and Done are on the first phone screen');
    });
    await capture('chat', '#inbox/ship', '', (m) => {
      assert.deepEqual(m.msgs.map((x) => x.split(':')[0]), ['agent', 'you', 'agent', 'you'], 'time order, agent first: ' + m.msgs.join(' | '));
      assert.match(m.msgs[1], /What does Friday need from QA/);
      assert.deepEqual(m.rcpts, ['Read', 'Sent Not read'], 'how far each of yours got: ' + m.rcpts.join(' | '));
      assert.ok(m.sides.you.every((g) => g <= 24) && m.sides.agent.every((g) => g <= 24), 'the person at the right edge, the agent at the left: ' + JSON.stringify(m.sides));
      assert.deepEqual(m.follow, ['Ship Friday', 'Wait a week']);
      assert.equal(m.latest_clear, true, 'the latest message is in view above the box: ' + JSON.stringify(m.scrollers));
      assert.equal(m.opts_clear, true, 'the choice buttons are whole and above the box: ' + JSON.stringify(m.scrollers));
      if (phone) assert.ok(m.page_scroll > 0, 'the phone thread is longer than the screen and opened at its end: ' + m.page_scroll);
    });
    await capture('pr', '#inbox/beta', '', (m) => {
      assert.deepEqual(m.msgs.map((x) => x.split(':')[0]), ['agent', 'you', 'agent'], 'time order: ' + m.msgs.join(' | '));
      assert.ok(m.arts.some((a) => /^Pull request 245/.test(a)), 'the pull request sits in the thread: ' + m.arts.join(' | '));
    });
  }
  if (!process.env.RAIL_ONLY && !process.env.CHAT_ONLY) {
  await capture('inbox', '#inbox', (m) => {
    const want = phone ? ['Today', 'Inbox', 'Decide', 'Evidence', 'Reports', 'Tickets'] : ['Today', 'Inbox', 'Decide', 'Evidence', 'Reports', 'Designs', 'Tickets', 'Channels'];
    assert.deepEqual(m.menu, want, 'every menu and the Inbox: ' + m.menu.join(', '));
    assert.ok(m.search, 'Search is one tap away');
    assert.deepEqual(heads(m), ['New', 'Waiting on agents'], 'sections in order: ' + heads(m).join(', '));
    assert.ok(m.sections[0].rows.every((r) => r.startsWith('* ')), 'every New row is unread');
    assert.deepEqual(m.chips.map((c) => c.replace(/\d+(\]?)$/, '$1')), ['[All]', 'Decisions', 'Tickets'], 'kind chips: ' + m.chips.join(', '));
  });
  // The Inbox badge counts the threads that need the person, the same ones Decide counts and the New replies: with the report read (it asks nothing), the badge is every row under New and Decide.
  await api('/api/reads', { keys: ['sign-in-faster'], read: true });
  await capture('badge', '#inbox', '', (m) => {
    const rows = (head) => m.sections.find((s) => s.head.replace(/\s*\d+$/, '') === head)?.rows.length ?? 0;
    assert.equal(rows('New'), 3, 'three New replies: ' + JSON.stringify(m.sections));
    assert.equal(m.badge, String(rows('New') + rows('Decide')), `the Inbox badge ${m.badge} is not the New and Decide rows: ` + JSON.stringify(m.sections));
  });
  // Answered and acted on (the digest on Mondays): not under New though its reply was never opened; it is under Done, behind the Done entry.
  await capture('archived', '#inbox', `(() => { document.querySelector('.ib-done').click(); document.querySelector('.ib-sec[aria-label=Done]').scrollIntoView({ block: 'end' }); })()`, (m) => {
    const rows = (head) => m.sections.find((s) => s.head.replace(/\s*\d+$/, '') === head)?.rows ?? [];
    assert.ok(!rows('New').some((r) => r.includes('Send the digest on Mondays?')), 'the acted thread is still under New');
    assert.ok(rows('Done').some((r) => r.includes('Send the digest on Mondays?')), 'the acted thread is not under Done: ' + JSON.stringify(m.sections));
  });
  await capture('thread', '#inbox/ship', `document.querySelector('.tr-opts')?.scrollIntoView({ block: 'center' })`, (m) => {
    assert.deepEqual(m.follow, ['Ship Friday', 'Wait a week']);
    assert.deepEqual(m.msgs.map((x) => x.split(':')[0]), ['agent', 'you', 'agent'], 'a question then its reply: ' + m.msgs.join(' | '));
  });
  // A relayed answer: the thread's track reads Sent and Read, and no Acted or Result, because only the relay's read was recorded.
  await capture('relayed', '#inbox/name-tool', `document.querySelector('.ib-rcpt')?.scrollIntoView({ block: 'center' })`, (m) => {
    assert.deepEqual(m.rcpts, ['Read'], 'card name-tool: the relayed answer shows ' + m.rcpts.join(', ') + ', not Read');
  });
  await capture('action', '#inbox/beta', `document.querySelector('.ib-art a')?.scrollIntoView({ block: 'center' })`, (m) => {
    assert.ok(m.msgs.some((x) => x.startsWith('you: No')) && m.arts.some((a) => /^Pull request 245/.test(a)), 'an action then what was done with its link: ' + m.msgs.join(' | ') + ' / ' + m.arts.join(' | '));
  });
  await capture('answered', '#inbox/ship', tap('.tr-opt'), (m) => {
    assert.match(m.closed, /^Answered · Yes/, 'the thread says Answered: ' + m.closed);
    assert.ok(!m.sections.some((s) => /Decide/.test(s.head) && s.rows.some((r) => r.includes('Ship the new settings page'))), 'the card left Decide');
  });
  // The card is answered: the board's own asks page no longer lists it as open.
  const asks = await (await fetch(base + 'api/decisions?view=asks&limit=50')).json();
  if (!process.env.RECEIPTS_ONLY && (asks.decisions ?? asks.asks ?? []).some((d) => d.key === 'ship')) results.at(-1).fail.push('ship is still an open ask');
  await go('#inbox');
  // A reply lands while the board is open: the page reads the board every 20 seconds, so the notice is waited for, then captured while it shows.
  cli('feedback', 'export', board, '--reply', 'The export is on for admins only; it ships Friday.', '--link', 'https://github.com/example/settings/pull/250');
  await capture('notice', null, `new Promise((ok) => { const t = Date.now(), f = () => document.querySelector('.ib-note') || Date.now() - t > 26000 ? ok() : setTimeout(f, 200); f(); })`, (m) => {
    assert.ok(m.notice.some((n) => /replied/.test(n) && /Turn on the CSV export/.test(n)), 'a notice names the reply: ' + m.notice.join(' | '));
  });
  // The ask's agent replies with its own choices: the thread beside the ask must not answer them a second time (the ask's panel does).
  await api('/api/answers', { key: 'digest', answer: 'text', note: 'Which plan renews?' });
  cli('wait', board, '--filer', 'release-agent', '--timeout', '5');
  cli('feedback', 'digest', board, '--reply', 'The paid plan renews Monday. Keep the digest?', '--option', 'yes=Keep it', '--option', 'no=Stop it');
  if (!phone) await capture('beside', '#inbox/digest/open', '', (m) => {
    assert.ok(m.thread, 'the thread sits beside the ask');
    assert.equal(m.thread_answers, 0, 'the thread beside the ask shows answer buttons: ' + m.thread_answers);
  });
  }
} finally {
  ws.close(); chrome.kill(); server.kill(); await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
}
// The step record: each cell adds its steps to the run's steps.json, so one run over several cells keeps all of them.
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, cell = `On a ${phone ? `${width} px phone` : `${width} px desk`} in ${theme}`;
const receipts = process.env.RECEIPTS_ONLY ? {
  steps: ['The person answers an ask from the lead; the lead reads the answer with sign-off-axi answers, with no wait and no feedback line', 'The person opens the ask\u2019s thread in the Inbox'],
  result: 'the thread\u2019s track reads Sent and Read, each with its time, and Acted and Result stay empty because nothing more was recorded' }
  : process.env.CHAT_ONLY ? {
  steps: ['The person answers two asks and writes on one of them; the lead\u2019s wait takes the answers; one agent replies with a question\u2019s two choices, the other with a pull request link; nobody reads the last comment', 'The person opens the Inbox', 'The person opens the thread with the choices, then the thread with the pull request'],
  result: 'the kind chips and the two unread filters are one row that scrolls sideways, Agents and Done are one short row under it above the first thread, and a thread reads as a chat in time order: the agent on the left, the person\u2019s own words as bubbles on the right with Read or Sent and Not read under them, the card and the pull request as inline cards' }
  : process.env.RAIL_ONLY ? {
  steps: ['The person answers two asks and writes on a third; the lead\u2019s wait takes the first answer and replies, and nobody reads the comment', 'The person opens the Inbox', 'The person taps Not read by agents'],
  result: 'each thread row carries the count of replies not opened and a Not read mark where its agent has not read what was sent, the two filters count the threads they list, the rail ends on Agents (read-only) and Done, and Not read by agents narrows the rail to the one thread' } : null;
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: 'A new board with five asks from two agents, a plan, a guided report and a ticket, served by sign-off-axi serve',
  steps: [...(prior?.steps ?? []), ...(receipts?.steps ?? [
    'The person answers three asks and writes back on a fourth; the agents own waits take them; one agent replies with what was done and a pull request link, the other replies with two follow-up choices',
    'The person opens the inbox, the thread with the follow-ups, and the thread with what was done',
    'The person taps the first follow-up; the inbox stays open while an agent replies on another ask',
    ...(phone ? [] : ['The person opens an ask from its thread'])]).map((x) => `${cell}: ${x}`)],
  result: [prior?.result, receipts ? `${cell}: ${receipts.result}.` : `${cell}: the inbox lists New (unread) above Decide above Waiting on agents with kind chips; a thread shows each question or action with its reply or what was done, its link, and the follow-up buttons; one tap moves the card to Answered; a reply that lands shows a notice that opens its thread${phone ? '' : '; an ask opened from the inbox sits beside its thread'}.`].filter(Boolean).join(' ') }, null, 2) + '\n');
const failed = results.filter((r) => r.fail.length || r.console_errors.length);
if (failed.length) { console.error(JSON.stringify(failed.map(({ state, fail, console_errors }) => ({ state, fail, console_errors })), null, 2)); process.exit(1); }
