// The inbox: every exchange with an agent as one thread in one list, whatever its kind. New replies first, then what waits on the person, then what waits
// on an agent with its trail step, then answered and done folded away. Kind chips filter the list; a row opens its thread (beside the list on a desk).
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
await api('/api/answers', { key: 'ship', answer: 'text', note: 'What does Friday need from QA?' });
cli('wait', board, '--filer', 'settings-agent', '--timeout', '5');
cli('feedback', 'ship', board, '--reply', 'QA signs off Thursday, so Friday holds. Ship it Friday?', '--option', 'yes=Ship Friday', '--option', 'no=Wait a week');
// Answered and done.
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
  const thread = document.querySelector('.ib-thread');
  const pairs = thread ? [...thread.querySelectorAll('.ib-pair')].filter(vis).map((p) => [...p.querySelectorAll('.ib-lab, .tr-lab')].map((l) => l.textContent.trim()).join(' > ')) : [];
  const follow = [...document.querySelectorAll('.tr-opt')].filter(vis).map((b) => b.textContent);
  const notice = [...document.querySelectorAll('.ib-note')].filter(vis).map((n) => n.innerText.replace(/\\n+/g, ' / '));
  const thread_answers = thread ? thread.querySelectorAll('.tr-opt, .tr-opts, [role=radio], input[type=radio], .pick-option, .answer').length : 0;
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  const words = document.body.innerText, bad = words.match(/\\b(?:answer|round|comment):[\\w.-]+:|\\btrail\\.jsonl\\b|undefined|NaN|\\[object/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  return { url: location.href, viewport_width: window.innerWidth, title: document.title, sections, chips, thread: thread?.querySelector('.ib-ttl')?.textContent ?? '', status: thread?.querySelector('.ib-state')?.textContent ?? '', pairs, follow, closed: document.querySelector('.ib-closed')?.innerText.replace(/\\n+/g, ' / ') ?? '', notice, thread_answers, fail }; })()`;
const results = [];
const capture = async (state, hash, before, check) => {
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
  await capture('inbox', '#', '', (m) => {
    assert.deepEqual(heads(m), ['New', 'Decide', 'Waiting on agents'], 'sections in order: ' + heads(m).join(', '));
    assert.ok(m.sections[0].rows.every((r) => r.startsWith('* ')), 'every New row is unread');
    assert.deepEqual(m.chips.map((c) => c.replace(/\d+(\]?)$/, '$1')), ['[All]', 'Decisions', 'Plans', 'Reports', 'Tickets'], 'kind chips: ' + m.chips.join(', '));
  });
  await capture('thread', '#inbox/ship', `document.querySelector('.tr-opts')?.scrollIntoView({ block: 'center' })`, (m) => {
    assert.deepEqual(m.follow, ['Ship Friday', 'Wait a week']);
    assert.ok(m.pairs.some((p) => /Your question > .*Reply/.test(p)), 'a question then its reply: ' + m.pairs.join(' | '));
  });
  await capture('action', '#inbox/beta', `document.querySelector('.tr-said a')?.scrollIntoView({ block: 'center' })`, (m) => {
    assert.ok(m.pairs.some((p) => /Your (answer|action)[\d:]* > .*What was done/.test(p)), 'an action then what was done: ' + m.pairs.join(' | '));
  });
  await capture('answered', '#inbox/ship', tap('.tr-opt'), (m) => {
    assert.match(m.closed, /^Answered · Yes/, 'the thread says Answered: ' + m.closed);
    assert.ok(!m.sections.some((s) => /Decide/.test(s.head) && s.rows.some((r) => r.includes('Ship the new settings page'))), 'the card left Decide');
  });
  // The card is answered: the board's own asks page no longer lists it as open.
  const asks = await (await fetch(base + 'api/decisions?view=asks&limit=50')).json();
  if ((asks.decisions ?? asks.asks ?? []).some((d) => d.key === 'ship')) results.at(-1).fail.push('ship is still an open ask');
  await go('#');
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
} finally {
  ws.close(); chrome.kill(); server.kill(); await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
}
// The step record: each cell adds its steps to the run's steps.json, so one run over several cells keeps all of them.
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, cell = `On a ${phone ? `${width} px phone` : `${width} px desk`} in ${theme}`;
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: 'A new board with five asks from two agents, a plan, a guided report and a ticket, served by sign-off-axi serve',
  steps: [...(prior?.steps ?? []), ...[
    'The person answers three asks and writes back on a fourth; the agents own waits take them; one agent replies with what was done and a pull request link, the other replies with two follow-up choices',
    'The person opens the inbox, the thread with the follow-ups, and the thread with what was done',
    'The person taps the first follow-up; the inbox stays open while an agent replies on another ask',
    ...(phone ? [] : ['The person opens an ask from its thread'])].map((x) => `${cell}: ${x}`)],
  result: [prior?.result, `${cell}: the inbox lists New (unread) above Decide above Waiting on agents with kind chips; a thread shows each question or action with its reply or what was done, its link, and the follow-up buttons; one tap moves the card to Answered; a reply that lands shows a notice that opens its thread${phone ? '' : '; an ask opened from the inbox sits beside its thread'}.`].filter(Boolean).join(' ') }, null, 2) + '\n');
const failed = results.filter((r) => r.fail.length || r.console_errors.length);
if (failed.length) { console.error(JSON.stringify(failed.map(({ state, fail, console_errors }) => ({ state, fail, console_errors })), null, 2)); process.exit(1); }
