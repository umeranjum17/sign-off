// The feedback trail: each thing the person sends on a card (an answer, its note, a design's change notes) and how far it got with its agent, Sent, Delivered, Read and Replied,
// on the card, in its Activity, as a badge in the lists and, for a reply not opened yet, in Today's Replies. Driven the way it happens: the person answers in the board,
// a wait hands an answer over (delivered), the agent's own wait takes one (read), and the agent runs `sign-off-axi feedback <key> --reply ... --link ...` (replied).
// A headless Chromium of its own over the DevTools protocol with exact device metrics (390x844 or 1280x800, 2x), its profile in a temp folder.
// States: today (Replies over Waiting on you), decide (the answered rows with their badges), designs (the design row's badge), sent, delivered, read, replied (an ask's sheet:
// the track and, when replied, the reply and its link, and the Activity), design (the design's review: what you said, the track and the reply), today-seen (after the reply is opened).
// Each capture is measured in the browser: the track's four steps on one line inside the card's content edges, no sideways overflow, no text cut, and no console error.
// Usage: node .agents/skills/done-done-verify-sign-off/trail-shots.mjs <output> [light|dark] [390|1280]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-trail-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const cli = (...args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const name = (state) => `${state}.${theme}.${width}w`;
// TRAIL_LONG=1: long titles and notes, the case a badge must survive (journey trail-badge captures only Decide's answered rows, at 360, 390 and 445).
const long = process.env.TRAIL_LONG === '1', more = (t) => (long ? { 'Keep the weekly digest?': 'Keep sending the weekly digest to every reader of every project?', 'Turn on the CSV export?': 'Turn on the CSV export for all the teams that asked?',
  'Ship the new settings page Friday?': 'Ship the new settings page on Friday with every setting in place?', 'Open the beta to every team?': 'Open the beta to every team, including the ones who left?' }[t] : t);

// The board: four asks from two agents and a design, each sent something by the person and left at another step.
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
const ask = (filer, key, title, why, yes, no, ...more) => cli('post', board, '--filer', filer, '--ask-ref', 'message-demo', '--key', key, '--title', title, '--why', why,
  '--outcome', `yes=${yes}`, '--outcome', `no=${no}`, '--recommend', 'yes', '--recommend-reason', 'It is the safer pick.', '--default', 'yes', ...more);
ask('release-agent', 'digest', more('Keep the weekly digest?'), 'The paid plan renews Monday.', 'It keeps going out.', 'It stops this week.');
ask('release-agent', 'export', more('Turn on the CSV export?'), 'Two teams asked for it this month.', 'It ships Friday.', 'It waits a release.');
ask('settings-agent', 'ship', more('Ship the new settings page Friday?'), 'No new bug reports for three weeks.', 'The page ships Friday.', 'It waits a week.');
ask('settings-agent', 'beta', more('Open the beta to every team?'), 'The first ten teams found no blockers.', 'Every team gets it Monday.', 'It stays with ten teams.');
ask('release-agent', 'waiting', 'Move the release to Thursday?', 'The store review takes two days this week.', 'It ships Thursday.', 'It ships Friday as planned.');
mkdirSync(join(dir, 'design'));
// The design's screen is the README's own phone shot of the board, so the review shows a picture a person can read.
for (const f of ['phone-today.webp', 'phone-today-dark.webp', 'desk-today.webp']) copyFileSync(join(repo, 'docs/media', f), join(dir, 'design', f));
// A guided report the person asks Go deeper on, and a ticket the person commented on in the fleet dashboard.
const report = { ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'), 'utf8')), filed: new Date(Date.now() - 150 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z') };
writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
cli('ticket', board, '--id', 'T-1', '--title', 'Ship the CSV export', '--project', 'Settings', '--progress', '40');
writeFileSync(join(dir, 'design.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/design.v1/valid-basic.json'), 'utf8')), key: 'dashboard', title: 'Fleet dashboard, the whole redesign',
  preview: 'design/phone-today.webp', journeys: [{ id: 'dashboard', title: 'Dashboard', screens: [{ id: 'today', title: 'Today', views: { phone_light: 'design/phone-today.webp', phone_dark: 'design/phone-today-dark.webp', computer_light: 'design/desk-today.webp' } }] }],
  filer: 'dashboard-agent', group: 'Dashboard', filed: new Date(Date.now() - 3 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z') }));
cli('post', board, '--kind', 'design', '--from', join(dir, 'design.json'));

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');
const api = async (path, body) => { const r = await fetch(base + path.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200, await r.text()); };
// Sent: answered, and nothing has taken it.
await api('/api/answers', { key: 'digest', answer: 'yes', note: long ? 'It is the only thing most of the readers open on a Monday, so it stays.' : '' });
// Delivered: a wait (a hook or a poller, not the agent's own) hands the answer over.
const handing = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'wait', board, '--key', 'export', '--timeout', '30'], { env, stdio: 'ignore' });
await wait(800);
await api('/api/answers', { key: 'export', answer: 'yes', note: 'Only the admin role should see it.' });
await new Promise((ok) => handing.once('exit', ok));
// Read: the agent's own wait takes it.
await api('/api/answers', { key: 'ship', answer: 'yes', note: long ? 'Three quiet weeks are enough, so ship it.' : '' });
cli('wait', board, '--filer', 'settings-agent', '--timeout', '5');
// Replied: the agent took it, then says what it did, with the pull request.
await api('/api/answers', { key: 'beta', answer: 'no', note: 'Wait until the import bug is fixed.' });
cli('wait', board, '--filer', 'settings-agent', '--timeout', '5');
cli('feedback', 'beta', board, '--reply', 'Kept it to the ten teams. The import fix is in review; I will ask again once it lands.', '--link', 'https://github.com/example/settings/pull/245');
// The report: Go deeper on what it found, taken by the author's own wait and answered.
const state0 = JSON.parse(await (await fetch(base + 'api/decisions')).text()), rp = state0.decisions.find((d) => d.key === report.key);
const part = rp.sections.find((x) => x.stage === 'found').id;
await api('/api/engagement', { version: 1, id: 'ask-trail-1', key: report.key, ...rp.engagement, part, action: 'deeper' });
cli('wait', board, '--filer', report.filer, '--timeout', '5');
cli('deeper', board, '--filer', report.filer, '--id', 'ask-trail-1', '--text', 'The code now comes with the password, so the second screen is gone.');
// The ticket comment, as the fleet dashboard hands its record over: sent, picked up by the lead, answered.
const sec = Math.floor(Date.now() / 1000);
cli('ticket', board, '--id', 'T-1', '--comment', JSON.stringify({ id: '3f9a1c2e7b6d4a10', at: sec - 50 * 60, text: 'Is the export in this release?', to: 'release-agent', error: null, picked: sec - 45 * 60,
  replies: [{ at: sec - 8 * 60, text: 'Yes, it ships Friday with the release.', by: 'release-agent' }] }));
// The design: change notes, read, then the new version's pull request.
await api('/api/answers', { key: 'dashboard', verdict: 'change', notes: [{ note: 'Looks good, but the colours look a bit off and the rows need polishing.' }] });
cli('feedback', 'dashboard', board, '--read');
cli('feedback', 'dashboard', board, '--reply', 'Colours now come from the new tokens, and the rows sit on the 4px grid.', '--link', 'https://github.com/example/dashboard/pull/88');
// The board's times as they would fall over a morning: each step moved back from now by its minutes (posted, sent, delivered, read, replied), so the shots read as a real day.
const AGO = { digest: [70, 52], export: [65, 40, 39], ship: [240, 180, 176, 176], beta: [200, 120, 118, 115, 25], dashboard: [180, 100, 99, 90, 12], waiting: [30] };
const ago = (key, step) => new Date(Date.now() - AGO[key][step] * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
const lines = (file, fix) => existsSync(file) && writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.stringify(fix(JSON.parse(l)))).join('\n') + '\n');
const sent = (x) => (x.key in AGO ? ago(x.key, 1) : x.at);
lines(join(dir, 'board.answers.jsonl'), (a) => ({ ...a, at: sent(a) }));
lines(join(dir, 'board.seen.jsonl'), (a) => ({ ...a, at: sent(a), seen: ago(a.key, 3) }));
lines(join(dir, 'board.trail.jsonl'), (m) => ({ ...m, at: ago(m.key, { delivered: 2, read: 3, reply: 4 }[m.op]) }));
const items = JSON.parse(readFileSync(board, 'utf8'));
// The asks only: a design's time is part of its round, so moving it would make the answer one on an earlier round.
for (const d of items.items ?? items) if (d.key in AGO && d.kind !== 'design') d.filed = ago(d.key, 0);
writeFileSync(board, JSON.stringify(items));
writeFileSync(join(out, `trail.${theme}.${width}w.json`), JSON.stringify(JSON.parse(await (await fetch(base + 'api/decisions')).text()).trail, null, 2));

// The browser.
const prof = mkdtempSync(join(tmpdir(), 'so-trail-cdp-'));
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
const go = async (hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(100); await cdp('Page.navigate', { url: base + hash }); await wait(1200); };
// The measure: the track's steps on one line inside its card, the words a user reads, overflow and console errors.
const MEASURE = `(async () => { await document.fonts.ready; const fail = [], w = document.documentElement.clientWidth, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const tracks = [...document.querySelectorAll('.ui-trail')].filter(vis).map((t) => { const li = [...t.querySelectorAll('li')].map((l) => l.getBoundingClientRect()), r = t.getBoundingClientRect();
    return { steps: [...t.querySelectorAll('li')].map((l) => (l.classList.contains('on') ? '+' : '-') + l.querySelector('b').textContent + ' ' + l.querySelector('time').textContent).join(' | '), oneLine: new Set(li.map((x) => Math.round(x.top))).size === 1,
      inside: li.every((x) => x.left >= r.left - 0.5 && x.right <= r.right + 0.5), cut: [...t.querySelectorAll('b')].some((b) => b.scrollWidth > b.clientWidth + 1), said: t.querySelector('.tr-said')?.innerText ?? '' }; });
  tracks.forEach((t, i) => { if (!t.oneLine || !t.inside || t.cut) fail.push('track ' + i + ' ' + JSON.stringify(t)); });
  const badges = [...document.querySelectorAll('.ui-tb')].filter(vis).map((b) => ({ row: b.closest('.ui-row')?.querySelector('.t')?.textContent ?? '', badge: b.textContent, ink: b.classList.contains('new'), h: Math.round(b.getBoundingClientRect().height), lines: b.getClientRects().length, clear: (() => { const m = b.closest('.ui-row')?.querySelector('.meta'); return !m || m.getBoundingClientRect().right <= b.getBoundingClientRect().left + 0.5; })(),
    note_cut_by_ellipsis: (() => { const m = b.closest('.ui-row')?.querySelector('.meta'); return !!m && m.scrollWidth > m.clientWidth; })(),
    at_end_of_second_line: (() => { const row = b.closest('.ui-row'), m = row?.querySelector('.meta'), x = b.getBoundingClientRect(), y = m?.getBoundingClientRect(), z = row?.getBoundingClientRect(); return !!m && Math.abs(x.top + x.height / 2 - (y.top + y.height / 2)) < 4 && z.right - x.right < 24; })() }));
  badges.forEach((b) => { if (b.h !== 20 || b.lines !== 1 || !b.clear) fail.push('badge ' + JSON.stringify(b)); });
  const replies = [...document.querySelectorAll('.t-replies .ui-row')].map((r) => r.innerText.replace(/\\n+/g, ' / '));
  const activity = [...document.querySelectorAll('.thread li')].filter(vis).map((p) => p.innerText.replace(/\\n+/g, ' / '));
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  const words = document.body.innerText, bad = words.match(/\\b(?:answer|round):[\\w.-]+:|\\btrail\\.jsonl\\b|undefined|NaN/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  return { url: location.href, viewport_width: window.innerWidth, tracks, badges, replies, activity, fail }; })()`;
const results = [];
const capture = async (state, hash, before) => {
  errors.length = 0;
  await go(hash);
  if (before) { await evaluate(before); await wait(600); }
  const m = await evaluate(MEASURE);
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name(state)}.png`), Buffer.from(shot.data, 'base64'));
  results.push({ state, ...m, console_errors: [...errors] });
  writeFileSync(join(out, `${name(state)}.txt`), JSON.stringify({ state, ...m, console_errors: [...errors] }, null, 2) + '\n');
  console.log(state, m.fail.length ? `FAIL ${m.fail.join('; ')}` : 'ok');
};
// Scroll the open sheet or pane so the track and the Activity under it are in view.
// Scroll the open card so what was sent leads: the label over the answer (Your answer, What you said or What you sent), the track and the reply under it.
const toTrack = `(() => { const t = document.querySelector('.ui-trail'); let h = t; for (let e = t; e; e = e.previousElementSibling) if (e.matches?.('.ui-dl') && /^(Your answer|What you said|What you sent)$/.test(e.textContent)) { h = e; break; }
  if (h === t && t?.closest('.decide')) h = [...t.closest('.decide').querySelectorAll('.ui-dl')].find((e) => e.textContent === 'Your answer') ?? t;
  h?.scrollIntoView({ block: 'start' }); })()`;
try {
  if (!long) await capture('today', '#');
  await capture('decide', '#waiting', `(() => { const h = [...document.querySelectorAll('h2, .ui-sec, .dl-h')].find((x) => /Answered/.test(x.textContent)); h?.scrollIntoView({ block: 'start' }); })()`);
  if (!long) {
  await capture('designs', '#designs');
  await capture('sent', '#decide/digest', toTrack);
  await capture('delivered', '#decide/export', toTrack);
  await capture('read', '#decide/ship', toTrack);
  await capture('replied', '#decide/beta', toTrack);
  await capture('design', '#designs/dashboard', toTrack);
  await capture('report', `#reports/${report.key}`, `(() => { const g = document.querySelector('.gask'); const panel = g?.closest('[hidden]'); if (panel) panel.hidden = false; g?.scrollIntoView({ block: 'center' }); })()`);
  await capture('ticket', '#ticket/T-1', `document.querySelector('.tk-said')?.scrollIntoView({ block: 'center' })`);
  await capture('today-seen', '#');
  }
} finally {
  ws.close(); chrome.kill(); server.kill(); await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
}
// The step record: each cell adds its steps to the run's steps.json, so one run over four cells keeps all of them.
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, cell = `On a ${phone ? 'phone' : `${width} px desk`} in ${theme}`;
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: long ? 'A new board with four answered asks with long titles and notes, served by sign-off-axi serve' : 'A new board with four answered asks from two agents, a design with change notes, a guided report and a ticket, served by sign-off-axi serve',
  steps: [...(prior?.steps ?? []), ...(long ? [
    'The person answers four asks in the board, each with a long title and some with a long note; a plain wait hands one answer over; the agents own waits take two; the settings agent replies with feedback --reply and a pull request link',
    'The person opens Decide and scrolls to Answered'] : [
    'The person answers four asks in the board; a plain wait hands one answer over; the agents own waits take two; the settings agent replies with feedback --reply and a pull request link',
    'The person sends change notes on the design; its agent runs feedback --read, then feedback --reply with the new version pull request',
    'The person taps Go deeper on the report; its author takes it with wait --filer and answers it; the fleet dashboard hands over a ticket comment with the lead pickup and reply',
    'The person opens Today, Decide, Designs, each answered ask, the design, the report and the ticket, then Today again']).map((x) => `${cell}: ${x}`)],
  result: [prior?.result, `${cell}: ` + (long ? 'each answered row in Decide ends its second line with its badge (four small marks and Sent, Delivered, Read or Replied) on one line, and the long words before it end in an ellipsis; nothing wraps or overlaps.'
    : 'Today lists the replies above Waiting on you; each answered row carries its badge (Sent, Delivered, Read, Replied); each card shows its four-step track with times, the reply and its link, and its Activity; the report ask and the ticket comment show the same track; once opened, the replies leave Today.')].filter(Boolean).join(' ') }, null, 2) + '\n');
const failed = results.filter((r) => r.fail.length || r.console_errors.length);
if (failed.length) { console.error(JSON.stringify(failed.map(({ state, fail, console_errors }) => ({ state, fail, console_errors })), null, 2)); process.exit(1); }
