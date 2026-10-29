// Reopen: an agent takes back the answer on a card the person already answered, to ask again on the same key. The card returns to the list it belongs to, the person's answer and note
// stay in the answers log and in the card's thread (Your earlier answer, and its Activity: the answer, then the agent reopened it), and the next answer records normally.
// Driven the way it happens: the person answers in the board, the agent runs `sign-off-axi reopen`, the same ask is refused when open, then the person's page shows the open ask again.
// A headless Chromium of its own over the DevTools protocol with exact device metrics (360, 390, 445 phones or 1280, 1440 desks, 2x), its profile in a temp folder; HOME and XDG_* in a temp folder.
// State: reopened (the reopened ask's page, scrolled so the earlier answer and the start of its Activity are both in view). The capture is measured in the browser (reopened.<cell>.txt):
// no sideways overflow, no cut words, the ask open again with its choices, the earlier answer and its note shown, Activity listing the answer before the reopen, no raw codes, no console error.
// The agent's side is saved as agent.<cell>.txt: the reopen, the refusals, the answers file as it stands and the reopen event. It exits 1 on any failed measure.
// Usage: node .agents/skills/done-done-verify-sign-off/reopen-shots.mjs <output> [light|dark] [360|390|445|1280|1440]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-reopen-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const run = (...args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env });
const cli = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const name = (state) => `${state}.${theme}.${width}w`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

// The board: three asks from two agents; the release day is the one the person answers and the agent then reopens.
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
const ask = (filer, key, title, why, options, recommend) => cli('post', board, '--filer', filer, '--ask-ref', 'message-demo', '--key', key, '--title', title, '--why', why,
  ...options.flatMap(([value, label, outcome]) => ['--option', `${value}=${label}`, '--outcome', `${value}=${outcome}`]), '--recommend', recommend, '--recommend-reason', 'It is the safer pick.', '--default', recommend);
ask('release-agent', 'release-day', 'Which day should the release ship?', 'Two fixes are still in review.', [['today', 'Today', 'It ships now without the two fixes.'], ['friday', 'Friday', 'It ships with both fixes.']], 'friday');
ask('release-agent', 'digest', 'Keep the weekly digest?', 'The paid plan renews Monday.', [['yes', 'Yes', 'It keeps going out.'], ['no', 'No', 'It stops this week.']], 'yes');
ask('settings-agent', 'beta', 'Open the beta to every team?', 'The first ten teams found no blockers.', [['yes', 'Yes', 'Every team gets it Monday.'], ['no', 'No', 'It stays with ten teams.']], 'no');

const agent = [];
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// The browser.
const prof = mkdtempSync(join(tmpdir(), 'so-reopen-cdp-'));
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
// A tap from the page, as an emulated one can miss in a sheet; each step waits for the page to settle.
const tap = async (selector) => { assert.ok(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.click(); return !!e; })()`), `nothing to tap at ${selector}`); await wait(450); };
const MEASURE = `(async () => { await document.fonts.ready; const fail = [], w = document.documentElement.clientWidth, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labels = [...document.querySelectorAll('.ui-dl')].filter(vis).map((e) => e.textContent), earlier = document.querySelector('.ans-card'), note = earlier?.querySelector('q')?.textContent ?? '';
  const choices = [...document.querySelectorAll('.pick-list li')].filter(vis).map((e) => e.innerText.split('\\n')[0]);
  const steps = [...document.querySelectorAll('.thread .ui-act li')].map((li) => li.innerText.replace(/\\n+/g, ' / '));
  const box = (el) => el && el.getBoundingClientRect(), bottom = box(document.querySelector('.thread .ui-act li:last-child'));
  for (const e of [...document.querySelectorAll('main h1, .ans-card b, .ans-meta, .ui-act li b, .pick-list li, .dl-more summary')].filter(vis)) if (e.scrollWidth > e.clientWidth + 1) fail.push('cut: ' + e.textContent.slice(0, 40));
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  const bad = document.body.innerText.match(/\\b(?:reopened\\.jsonl|undefined|NaN|\\[object)\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  return { url: location.href, labels, earlier: earlier?.innerText.replace(/\\n+/g, ' / ') ?? '', note, choices, steps, meta: document.querySelector('.ans-meta')?.textContent ?? '',
    activityInView: !!bottom && bottom.bottom <= (${phone} ? box(document.querySelector('.ask-bar, .dc-actions, main ~ div button, [class*=bar] button'))?.top ?? innerHeight : innerHeight) && bottom.top >= 0, fail }; })()`;
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
try {
  // The person answers in the board, in their own note.
  const said = await post('api/answers', { key: 'release-day', answer: 'today', note: 'Today: the fixes can follow in a patch.' });
  assert.equal(said.status, 200);
  await wait(1100);
  // The agent takes the answer back. Run twice: the second time the card is open and the command refuses.
  const first = run('reopen', 'release-day', board), again = run('reopen', 'release-day', board), unknown = run('reopen', 'no-such-card', board);
  agent.push('$ sign-off-axi reopen release-day', first.stdout.trim(), `(exit ${first.status})`, '', '$ sign-off-axi reopen release-day  (it is open now)', (again.stdout + again.stderr).trim(), `(exit ${again.status})`, '',
    '$ sign-off-axi reopen no-such-card', (unknown.stdout + unknown.stderr).trim(), `(exit ${unknown.status})`, '');
  assert.equal(first.status, 0); assert.match(first.stdout, /release-day/); assert.notEqual(again.status, 0); assert.match(again.stdout + again.stderr, /already open/); assert.notEqual(unknown.status, 0);
  const answers = readFileSync(join(dir, 'board.answers.jsonl'), 'utf8').trim(), event = readFileSync(join(dir, 'board.reopened.jsonl'), 'utf8').trim();
  agent.push('The answers file, as it stands (the person\'s answer is still there):', answers, '', 'The reopen, its own line beside it:', event, '',
    '$ sign-off-axi answers --key release-day --json  (no answer: the card waits again)', run('answers', board, '--key', 'release-day', '--json').stdout.trim());
  assert.match(answers, /Today: the fixes can follow in a patch\./);
  // The person's page: the ask is open again in Decide, with what they said before.
  await go('#decide/release-day');
  // Scroll so the end of the Activity (the reopen) clears the bottom bar; the earlier answer is in the Activity and, where the screen is tall enough, above it too.
  await evaluate(`(() => { let e = document.querySelector('.thread .ui-act li:last-child'); while (e && !(e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement; (e ?? document.scrollingElement).scrollTop = 1e6; })()`);
  await wait(300);
  await capture('reopened', (m) => {
    assert.ok(m.labels.includes('Your earlier answer'), `labels: ${m.labels.join()}`);
    assert.match(m.earlier, /Today/); assert.equal(m.note, 'Today: the fixes can follow in a patch.'); assert.match(m.meta, /^Reopened by release-agent/);
    assert.deepEqual(m.choices.slice(0, 2), ['Today', 'Friday']);
    assert.equal(m.steps.filter((s) => /Your answer: Today/.test(s)).length, 1, m.steps.join(' | '));
    assert.ok(m.steps.findIndex((s) => /reopened this question/.test(s)) > m.steps.findIndex((s) => /Your answer: Today/.test(s)), m.steps.join(' | '));
    assert.ok(m.activityInView, 'the end of the Activity is not in the frame');
  });
  // The next answer records normally and names the one it replaces.
  assert.equal((await post('api/answers', { key: 'release-day', answer: 'friday', note: 'Friday: both fixes ship together.' })).status, 200);
  const after = JSON.parse(run('answers', board, '--key', 'release-day', '--json').stdout)['release-day'];
  agent.push('', 'The next answer, from the same key:', JSON.stringify(after, null, 2));
  assert.equal(after.answer, 'friday'); assert.equal(after.replaces.label, 'Today');
} finally {
  ws.close(); chrome.kill(); server.kill(); await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(out, `agent.${theme}.${width}w.txt`), agent.join('\n') + '\n');
}
// The step record: each cell adds its steps to the run's steps.json, so one run over ten cells keeps all of them.
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, cell = phone ? `On a ${width} px phone in ${theme}` : `On a ${width} px desk in ${theme}`;
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: 'A new board with three asks from two agents, served by sign-off-axi serve',
  steps: [...(prior?.steps ?? []), ...[
    'The person answers the release-day ask with Today and a note',
    'The agent runs sign-off-axi reopen release-day; running it again, and on a key that is not on the board, is refused',
    'The person opens the release-day ask in Decide',
    'The person answers it again with Friday'].map((x) => `${cell}: ${x}`)],
  result: [prior?.result, `${cell}: the reopened ask waits in Decide again with its choices; Your earlier answer shows Today and the note, and its Activity lists the answer and then the agent's reopen; the answers file still holds the first answer; the next answer names Today as the one it replaces`].filter(Boolean).join('\n') }, null, 2) + '\n');
const failed = results.filter((r) => r.fail.length || r.console_errors.length);
if (failed.length) { console.error(JSON.stringify(failed.map(({ state, fail, console_errors }) => ({ state, fail, console_errors })), null, 2)); process.exit(1); }
