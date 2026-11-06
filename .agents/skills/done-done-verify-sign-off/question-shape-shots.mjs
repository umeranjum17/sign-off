// The question shape: every question the person is asked is one radio list with the recommended answer selected, a last Something else that opens a field for their own words,
// and one button. Selected is only what the page shows: nothing is saved, and no waiting agent wakes, until the button is pressed.
// Driven as it happens: an agent posts a pick-one ask, a guarded ask and a guided plan with an open question; the person opens each; the board files and a waiting agent are read
// before and after the page loads; then one tap on the button answers with the preselected pick.
// A headless Chromium of its own over the DevTools protocol with exact device metrics (390 phone or 1280 desk, 2x), its profile in a temp folder; HOME and XDG_* in a temp folder.
// States (one PNG and one measured .txt each): ask-preselected, ask-something-else, ask-guarded, plan-question, report-question. The board's side is saved as no-write.<cell>.txt.
// It exits 1 on any failed measure.
// Usage: node .agents/skills/done-done-verify-sign-off/question-shape-shots.mjs <output> [light|dark] [390|1280]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-qs-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const run = (...args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env });
const cli = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const name = (state) => `${state}.${theme}.${width}w`;

// The board: a pick-one ask with a recommendation, a guarded ask, and a guided plan whose open question is a typed decision.
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
cli('post', board, '--filer', 'release-agent', '--ask-ref', 'message-demo', '--key', 'release-day', '--title', 'Which day should the release ship?', '--why', 'Two fixes are still in review.',
  '--option', 'today=Today', '--outcome', 'today=It ships now without the two fixes.', '--option', 'friday=Friday', '--outcome', 'friday=It ships with both fixes.',
  '--recommend', 'friday', '--recommend-reason', 'Both fixes ship together.', '--default', 'friday');
cli('post', board, '--filer', 'ops-agent', '--ask-ref', 'message-demo', '--key', 'drop-staging', '--title', 'Delete the staging database?', '--why', 'The last restore test finished 3 days ago.',
  '--option', 'delete=Delete it', '--outcome', 'delete=The data is removed and cannot be restored.', '--option', 'keep=Keep it', '--outcome', 'keep=It stays, and the cleanup waits.',
  '--recommend', 'keep', '--recommend-reason', 'A restore test should run first.', '--default', 'keep', '--guard', 'destructive');
const plan = { contract: 1, kind: 'plan', schema: 2, key: 'ship-plan', filer: 'release-agent', project: 'Sign-off', title: 'Ship release 4.12 this week',
  about: 'Freeze the branch, run the full suite, then ship on the day you pick. One question is open before the agent starts.',
  understood: [{ label: 'You asked', text: 'Ship 4.12 this week with the two review fixes.' }, { label: 'Done when', text: '4.12 is published and the team is told.' }],
  visual: { type: 'steps', heading: 'Three steps, and one needs your answer', rows: [{ label: 'Freeze the release branch', tone: 'ok' }, { label: 'Run the full test suite', tone: 'ok' }, { label: 'Ship on the day you pick', tone: 'warn' }] },
  sections: [{ id: 'steps', stage: 'recommend', heading: 'The branch is frozen and the suite is green', body: 'Both fixes are in review; the release waits only for the ship day.' }],
  decisions: [{ key: 'ship-day', question: 'Which day should the release ship?', why: 'Two fixes are still in review.',
    options: [{ value: 'today', label: 'Today', outcome: 'It ships now without the two fixes.' }, { value: 'friday', label: 'Friday', outcome: 'It ships with both fixes.' }],
    recommend: 'friday', reason: 'Both fixes ship together.', quiet: 'The agent waits; nothing ships.' }],
  next: { heading: 'I ship on the day you pick', lines: ['I post the release note under Evidence when it is live.'] } };
writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
cli('post', board, '--kind', 'plan', '--from', join(dir, 'plan.json'));
// The same plan with its open question only as prose is refused, naming the field to add.
const prose = { ...plan, key: 'ship-plan-prose', sections: [...plan.sections, { id: 'open', stage: 'recommend', heading: 'Open questions', body: 'Which day should the release ship? Today or Friday.' }], decisions: [] };
writeFileSync(join(dir, 'prose.json'), JSON.stringify(prose, null, 2));
const refused = run('post', board, '--kind', 'plan', '--from', join(dir, 'prose.json'));
// A research report whose open question is typed: the page draws it as the same radio list and sends its answer; the same report with the question only as prose is refused.
const report = { contract: 1, kind: 'report', schema: 3, key: 'push-research', purpose: 'research', project: 'Sign-off', title: 'Which push service for the phone app',
  about: 'A hosted push service fits the phone app best. One question is open: who runs the push server.', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  understood: [{ label: 'You asked', text: 'Pick a push service for the phone app.' }],
  visual: { type: 'tiles', heading: 'Hosted push wins on setup and upkeep', rows: [{ label: 'Hosted', text: 'No server to run.', tone: 'ok' }, { label: 'Self-hosted', text: 'Needs an owner for updates.', tone: 'warn' }] },
  sections: [{ id: 'found', stage: 'found', heading: 'Both services deliver within a second', body: '3 services compared, from their own docs: setup and upkeep decide it, not speed.',
      items: [{ title: 'Firebase Cloud Messaging', text: 'Hosted, free: https://firebase.google.com/docs/cloud-messaging' },
        { title: 'OneSignal', text: 'Hosted, paid above a free tier: https://documentation.onesignal.com/docs' },
        { title: 'ntfy', text: 'Self-hosted, needs an owner: https://docs.ntfy.sh/' }] },
    { id: 'pick', stage: 'recommend', heading: 'Recommendation', body: 'I recommend a hosted service: no server to run.' },
    { id: 'open', stage: 'recommend', heading: 'Open questions', body: 'Who runs the push server.' }],
  decisions: [{ key: 'server-owner', question: 'Who runs the push server?', why: 'Self-hosting needs an owner for updates.',
    options: [{ value: 'us', label: 'We run it', outcome: 'One more service on our on-call list.' }, { value: 'vendor', label: 'The vendor runs it', outcome: 'A monthly bill, and no updates to own.' }],
    recommend: 'vendor', reason: 'No one on the team has time to own updates.' }],
  next: { heading: 'I set up the service you pick', lines: ['I post the first delivery test under Evidence.'] } };
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
writeFileSync(join(dir, 'report-prose.json'), JSON.stringify({ ...report, key: 'push-research-prose', decisions: undefined }, null, 2));
const refusedReport = run('post', board, '--kind', 'report', '--from', join(dir, 'report-prose.json'));

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');

// What is on disk next to the board: the board file's hash and every answer file's bytes.
const files = () => {
  const answers = join(dir, 'board.answers.jsonl');
  return { board_sha256: createHash('sha256').update(readFileSync(board)).digest('hex'), answers_file: existsSync(answers) ? readFileSync(answers, 'utf8') : '(none)' };
};
const answersJson = () => run('answers', board, '--json').stdout.trim();

// The browser.
const prof = mkdtempSync(join(tmpdir(), 'so-qs-cdp-'));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMPDIR: prof } }); // its own temp files go in the profile folder, removed at the end
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
const tap = async (selector) => { assert.ok(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.click(); return !!e; })()`), `nothing to tap at ${selector}`); await wait(450); };
// Brings an element into view inside whatever scrolls it (a sheet, the desk pane or the reader).
const show = (selector, block = 'center') => evaluate(`(() => { document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: ${JSON.stringify(block)} }); })()`).then(() => wait(300));
// What the person sees of the question: its radio list (each label, checked or not, and its tag), Something else's field, the button, and the usual page checks.
const MEASURE = (scope) => `(async () => { await document.fonts.ready; const fail = [], w = document.documentElement.clientWidth, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const root = document.querySelector(${JSON.stringify(scope)});
  if (!root) return { fail: ['no ${scope} on the page'] };
  const group = root.querySelector('[role=radiogroup]');
  const radios = group ? [...group.querySelectorAll('[role=radio]')].filter(vis).map((b) => ({ label: (b.querySelector('.label, .ol, strong')?.firstChild?.textContent ?? '').trim(), checked: b.getAttribute('aria-checked') === 'true',
    tag: b.querySelector('.recommend:not(.now), .gd-pick, .tag')?.textContent ?? '' })) : [];
  const field = root.querySelector('.own-box, .gd-own, .plan-other textarea'), fieldShown = !!field && vis(field) && (() => {
    // Shown means tall enough to type in once every clipping box around it is counted: a closed field folds to nothing inside its wrapper.
    let h = field.getBoundingClientRect().height; for (let p = field.parentElement; p && p !== root; p = p.parentElement) if (getComputedStyle(p).overflow !== 'visible') h = Math.min(h, p.getBoundingClientRect().height); return h > 30; })();
  const button = document.querySelector('.decide-bar .answer, .gd-btn.block');
  for (const e of [...document.querySelectorAll('[role=radio], .decide-bar .answer, .gd-btn, h1, h2, h3')].filter(vis)) if (e.scrollWidth > e.clientWidth + 1) fail.push('cut: ' + e.textContent.slice(0, 40));
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  const bad = document.body.innerText.match(/\\b(?:undefined|NaN|\\[object|answers\\.jsonl)\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  return { url: location.href, question: (root.querySelector('h2, h3')?.textContent ?? '').trim(), radios, fieldShown, fieldText: field?.value ?? '', button: button ? { text: button.textContent.trim(), disabled: button.disabled } : null,
    guard: document.querySelector('.guard-line')?.innerText ?? '', fail }; })()`;
const results = [];
const capture = async (state, scope, check = () => {}) => {
  const m = await evaluate(MEASURE(scope));
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name(state)}.png`), Buffer.from(shot.data, 'base64'));
  try { check(m); } catch (e) { m.fail.push(e.message.split('\n')[0]); }
  results.push({ state, ...m, console_errors: [...errors] });
  writeFileSync(join(out, `${name(state)}.txt`), JSON.stringify({ state, ...m, console_errors: [...errors] }, null, 2) + '\n');
  console.log(state, m.fail.length || errors.length ? `FAIL ${[...m.fail, ...errors].join('; ')}` : 'ok');
  errors.length = 0;
};
const checked = (m) => m.radios.filter((r) => r.checked).map((r) => r.label);
const record = [];
try {
  record.push('$ sign-off-axi post --kind plan --from prose.json   (the open question only as prose)', (refused.stdout + refused.stderr).trim(), `(exit ${refused.status})`, '');
  assert.equal(refused.status, 2, 'a plan whose open question is only prose must be refused');
  assert.match(refused.stdout + refused.stderr, /decisions is required/);
  record.push('$ sign-off-axi post --kind report --from report-prose.json   (the open question only as prose)', (refusedReport.stdout + refusedReport.stderr).trim(), `(exit ${refusedReport.status})`, '');
  assert.equal(refusedReport.status, 2, 'a report whose open question is only prose must be refused');
  const before = files(), beforeAnswers = answersJson();
  record.push('Before the page loads:', JSON.stringify(before, null, 2), '$ sign-off-axi answers --json', beforeAnswers, '');
  // A waiting agent: it wakes only on a saved answer, so it must time out while the page only shows a pick.
  const waiter = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'wait', board, '--key', 'release-day', '--timeout', '6'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let waited = ''; waiter.stdout.on('data', (b) => (waited += b)); waiter.stderr.on('data', (b) => (waited += b));
  const waitedExit = new Promise((ok) => waiter.on('exit', ok));

  // The ask: Friday, the recommended answer, is selected, and the button names it.
  await go('#decide/release-day');
  await show('.decide .pick-list', 'center');
  await capture('ask-preselected', '.decide', (m) => {
    assert.deepEqual(m.radios.map((r) => r.label), ['Today', 'Friday', 'Something else']);
    assert.deepEqual(checked(m), ['Friday']); assert.equal(m.radios[1].tag, 'Recommended');
    assert.deepEqual(m.button, { text: 'Answer Friday', disabled: false }); assert.equal(m.fieldShown, false);
  });
  // Something else, the last radio, opens the field; the person's words become the answer the button sends.
  await tap('.decide .own-option');
  await evaluate(`(() => { const t = document.querySelector('.decide .own-box'); t.value = 'Ship Thursday, after the fixes land.'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(300);
  await show('.decide .own-box', 'center');
  await capture('ask-something-else', '.decide', (m) => {
    assert.deepEqual(checked(m), ['Something else']); assert.equal(m.fieldShown, true); assert.equal(m.fieldText, 'Ship Thursday, after the fixes land.');
    assert.deepEqual(m.button, { text: 'Send answer', disabled: false });
  });
  // A guarded ask has the same list with nothing selected: only the person may answer it, so no pick is ever taken for them.
  await go('#decide/drop-staging');
  await show('.decide .pick-list', 'center');
  await capture('ask-guarded', '.decide', (m) => {
    assert.deepEqual(m.radios.map((r) => r.label), ['Delete it', 'Keep it', 'Something else']); assert.deepEqual(checked(m), []);
    assert.equal(m.radios[1].tag, 'Recommended'); assert.deepEqual(m.button, { text: 'Pick an answer', disabled: true }); assert.match(m.guard, /Always waits for you/);
  });
  // The plan's open question sits inline in the plan, in the same shape, with Go ahead under it.
  await go('#waiting/ship-plan');
  await show('[data-part="d:ship-day"]', 'start');
  await capture('plan-question', '[data-part="d:ship-day"]', (m) => {
    assert.equal(m.question, 'Which day should the release ship?');
    assert.deepEqual(m.radios.map((r) => r.label), ['Today', 'Friday', 'Something else']); assert.deepEqual(checked(m), ['Friday']); assert.equal(m.radios[1].tag, 'My pick');
  });

  // The report's open question, on its page, in the same shape, with its send under it.
  await go('#reports/push-research');
  if (await evaluate(`!document.querySelector('[data-part="d:server-owner"]') && !!document.querySelector('.rp-open')`)) await tap('.rp-open');
  await show('[data-part="d:server-owner"]', 'start');
  await capture('report-question', '[data-part="d:server-owner"]', (m) => {
    assert.equal(m.question, 'Who runs the push server?');
    assert.deepEqual(m.radios.map((r) => r.label), ['We run it', 'The vendor runs it', 'Something else']); assert.deepEqual(checked(m), ['The vendor runs it']);
    assert.deepEqual(m.button, { text: 'Send 1 answer', disabled: false });
  });

  // Nothing was written and nobody woke: the board files are byte for byte as before, and the waiting agent timed out.
  const code = await waitedExit, after = files(), afterAnswers = answersJson();
  record.push('After loading the ask, Something else, the guarded ask, the plan and the report (no button pressed):', JSON.stringify(after, null, 2), '$ sign-off-axi answers --json', afterAnswers, '',
    '$ sign-off-axi wait --key release-day --timeout 6   (started before the pages loaded)', waited.trim(), `(exit ${code})`, '');
  assert.deepEqual(after, before, 'loading a page with a preselected answer changed the board files');
  assert.equal(afterAnswers, beforeAnswers);
  assert.equal(code, 1); assert.match(waited, /TIMEOUT/);

  // One tap agrees: the button sends the preselected Friday.
  await go('#decide/release-day');
  await tap('.decide-bar .answer');
  await wait(1200);
  const saved = JSON.parse(run('answers', board, '--key', 'release-day', '--json').stdout)['release-day'];
  record.push('One tap on Answer Friday:', '$ sign-off-axi answers --key release-day --json', JSON.stringify(saved, null, 2));
  assert.equal(saved.answer, 'friday');
  // One tap sends the report's open question with its selected answer.
  await go('#reports/push-research');
  if (await evaluate(`!document.querySelector('[data-part="d:server-owner"]') && !!document.querySelector('.rp-open')`)) await tap('.rp-open');
  await tap('[data-part="d:server-owner"] .gd-btn.block');
  await wait(1200);
  const sent = JSON.parse(run('answers', board, '--key', 'push-research', '--json').stdout)['push-research'];
  record.push('', 'One tap on Send 1 answer under the report\'s open question:', '$ sign-off-axi answers --key push-research --json', JSON.stringify(sent, null, 2));
  assert.deepEqual(sent.decisions, { 'server-owner': 'vendor' });
} finally {
  ws.close(); chrome.kill(); server.kill(); await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(out, `no-write.${theme}.${width}w.txt`), record.join('\n') + '\n');
}
// The step record: each cell adds its steps to the run's steps.json, so one run over four cells keeps all of them.
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, cell = phone ? `On a phone in ${theme}` : `At ${width} px in ${theme}`;
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: 'A new board with a pick-one ask, a guarded ask and a guided plan with one open question, served by sign-off-axi serve',
  steps: [...(prior?.steps ?? []), ...[
    'A plan whose open question is only prose is posted, and refused',
    'The person opens the release-day ask in Decide',
    'The person picks Something else and types their own answer',
    'The person opens the guarded drop-staging ask',
    'The person opens the plan and scrolls to its open question',
    'A research report whose open question is only prose is posted, and refused; the person opens the one with a typed question',
    'The board files and a waiting agent are read before and after those page loads',
    'The person presses Answer Friday, then Send 1 answer under the report\'s question'].map((x) => `${cell}: ${x}`)],
  result: [prior?.result, `${cell}: the ask shows Today, Friday (Recommended, selected) and Something else as one radio list with Answer Friday; Something else opens its field and the button reads Send answer; the guarded ask selects nothing and says it always waits; the plan's open question sits inline with Friday (My pick) selected; the report's open question shows the same list with The vendor runs it selected and Send 1 answer; the board files are unchanged and the waiting agent timed out until the one tap saved Friday, and one tap sent the report's answer`].filter(Boolean).join('\n') }, null, 2) + '\n');
const failed = results.filter((r) => r.fail.length || r.console_errors.length);
if (failed.length) { console.error(JSON.stringify(failed.map(({ state, fail, console_errors }) => ({ state, fail, console_errors })), null, 2)); process.exit(1); }
