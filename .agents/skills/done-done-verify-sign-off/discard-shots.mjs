// Discard: on every card a sheet of three reasons, one tap each (Not relevant, Replaced by newer, Done elsewhere); the cards move to Archived and their agents are told through
// the feedback trail once Undo's 10 seconds are over; Select in Decide and Designs discards several at once; Archived lists them with the reason and Restore.
// Driven the way it happens: the person taps in the board, the agent's own `wait --filer` takes the discard, and an Undo inside the 10 seconds never reaches it.
// A headless Chromium of its own over the DevTools protocol with exact device metrics (390x844 or 1280x800, 2x), its profile in a temp folder; HOME and XDG_* in a temp folder.
// States: sheet (an ask's Discard), select-decide and select (two picked in Decide and in Designs), discarded (the list after Discard 2 with the toast's Undo),
// archived (the Archived sheet: an older discard its agent read, and the two just discarded). Each capture is measured in the browser (<state>.<cell>.txt): no sideways overflow,
// no cut title or button words, the sheet's three reasons, the bar's Cancel and Discard N, the toast's 10-second Undo, no raw reason codes, no console error.
// The agent's side is saved as agent.<cell>.txt: what `wait --filer` handed over, the trail, and that the undone discard never reached it. It exits 1 on any failed measure.
// Usage: node .agents/skills/done-done-verify-sign-off/discard-shots.mjs <output> [light|dark] [390|1280]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-discard-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const run = (...args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env });
const cli = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const name = (state) => `${state}.${theme}.${width}w`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

// The board: four asks from two agents, four designs of one dashboard (the oldest already discarded as replaced, and read by its agent), a proof and a report.
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
const ask = (filer, key, title, why, yes, no) => cli('post', board, '--filer', filer, '--ask-ref', 'message-demo', '--key', key, '--title', title, '--why', why,
  '--outcome', `yes=${yes}`, '--outcome', `no=${no}`, '--recommend', 'yes', '--recommend-reason', 'It is the safer pick.', '--default', 'yes');
ask('release-agent', 'digest', 'Keep the weekly digest?', 'The paid plan renews Monday.', 'It keeps going out.', 'It stops this week.');
ask('release-agent', 'export', 'Turn on the CSV export?', 'Two teams asked for it this month.', 'It ships Friday.', 'It waits a release.');
ask('settings-agent', 'ship', 'Ship the new settings page Friday?', 'No new bug reports for three weeks.', 'The page ships Friday.', 'It waits a week.');
ask('settings-agent', 'beta', 'Open the beta to every team?', 'The first ten teams found no blockers.', 'Every team gets it Monday.', 'It stays with ten teams.');
// The designs' screens are the README's own phone shots of the board, so a review shows a picture a person can read.
mkdirSync(join(dir, 'design'));
for (const f of ['phone-today', 'phone-decide', 'phone-evidence', 'phone-reports']) for (const t of ['', '-dark']) copyFileSync(join(repo, 'docs/media', `${f}${t}.webp`), join(dir, 'design', `${f}${t}.webp`));
const design = (key, title, min, shot) => {
  writeFileSync(join(dir, `${key}.json`), JSON.stringify({ ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/design.v1/valid-basic.json'), 'utf8')), key, title, about: 'The board in the new look, drawn on demo data.',
    preview: `design/phone-${shot}.webp`, journeys: [{ id: 'main', title: 'Main', screens: [{ id: shot, title: shot[0].toUpperCase() + shot.slice(1), views: { phone_light: `design/phone-${shot}.webp`, phone_dark: `design/phone-${shot}-dark.webp` } }] }],
    filer: 'dashboard-agent', group: 'Dashboard', filed: ago(min) }));
  cli('post', board, '--kind', 'design', '--from', join(dir, `${key}.json`));
};
design('dash-sketch', 'Ship the fleet dashboard sketch?', 5 * 24 * 60, 'reports');
design('dash-v1', 'Ship the first fleet dashboard?', 3 * 24 * 60, 'evidence');
design('dash-v2', 'Ship the fleet dashboard redesign?', 26 * 60, 'decide');
design('today-v3', 'Ship Today in the new look?', 90, 'today');
copyFileSync(join(repo, 'docs/media/phone-evidence.webp'), join(dir, 'shot.webp'));
cli('post', board, '--filer', 'settings-agent', '--type', 'evidence', '--title', 'The settings page fits a phone', '--about', 'Umer sees the whole page without scrolling sideways.', '--media', join(dir, 'shot.webp'), '--link', 'https://example.com/pr/4');
writeFileSync(join(dir, 'report.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-full.json'), 'utf8')), filed: ago(150) }));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
// The sketch was discarded two hours ago as replaced, and its agent's own wait took it.
cli('dismiss', 'dash-sketch', board, '--reason', 'replaced');
const lines = (file, fix) => writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.stringify(fix(JSON.parse(l)))).join('\n') + '\n');
lines(join(dir, 'board.dismissed.jsonl'), (x) => ({ ...x, at: ago(120) }));
const took = cli('wait', board, '--filer', 'dashboard-agent', '--timeout', '5');
assert.match(took, /dash-sketch,Replaced by newer/);
lines(join(dir, 'board.trail.jsonl'), (x) => ({ ...x, at: ago(110) }));

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');

// The browser.
const prof = mkdtempSync(join(tmpdir(), 'so-discard-cdp-'));
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
// The measure: what a user reads in the sheets, the bar and the toast, cut words, overflow, raw codes and console errors.
const MEASURE = `(async () => { await document.fonts.ready; const fail = [], w = document.documentElement.clientWidth, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const open = [...document.querySelectorAll('dialog[open]')].map((d) => d.id);
  const sheet = document.querySelector('#dc-sheet[open]'), reasons = sheet ? [...sheet.querySelectorAll('[data-reason]')].map((b) => b.textContent) : [];
  const bar = [...document.querySelectorAll('.sel-bar button')].filter(vis).map((b) => b.textContent + (b.disabled ? ' (off)' : ''));
  const checks = [...document.querySelectorAll('.sel-c')].filter(vis).map((c) => c.classList.contains('on'));
  const toast = document.getElementById('toast'), said = toast.hidden ? '' : toast.innerText.replace(/\\n+/g, ' / '), undoMs = toast.hidden ? 0 : parseInt(toast.style.getPropertyValue('--tms'));
  const archived = [...document.querySelectorAll('#ar-sheet[open] .ar-list > li')].map((li) => li.innerText.replace(/\\n+/g, ' / '));
  const title = document.querySelector('main h1')?.textContent ?? '', crumb = document.querySelector('main .crumb')?.textContent ?? '';
  for (const e of [...document.querySelectorAll('main h1, .sel-bar button, .sel-all, .dc-t, #dc-sheet .ui-pr, .ar-list .meta, #toast-text')].filter(vis)) if (e.scrollWidth > e.clientWidth + 1) fail.push('cut: ' + e.textContent.slice(0, 40));
  if (document.documentElement.scrollWidth > w) fail.push('sideways overflow');
  const bad = document.body.innerText.match(/\\b(?:not-relevant|done-elsewhere|discard:[\\w.-]+|undefined|NaN)\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  if (sheet && reasons.join() !== 'Not relevant,Replaced by newer,Done elsewhere') fail.push('reasons ' + reasons.join());
  const dock = document.querySelector('.tabs'), barBox = document.querySelector('.sel-bar')?.getBoundingClientRect();
  if (bar.length && ${phone} && dock && vis(dock)) fail.push('the dock shows under the select bar');
  if (barBox && ${phone} && (barBox.left < 16 || barBox.right > w - 16)) fail.push('the select bar leaves the 16px gutter');
  return { url: location.href, title, crumb, open, reasons, bar, checks, toast: said, undoMs, archived, fail }; })()`;
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
const agent = [];
try {
  // An ask's Discard: More on its sheet (a phone) or its pane's bar (a desk), then Discard: the reasons.
  await go('#decide/digest');
  await evaluate(`(() => { const m = [...document.querySelectorAll('.dl-more')].find((x) => x.getBoundingClientRect().width); m.open = true; })()`); await wait(300);
  await evaluate(`[...document.querySelectorAll('.dl-more[open] [aria-label^="Discard,"]')][0].click()`); await wait(450);
  await capture('sheet', (m) => assert.deepEqual(m.open, ['dc-sheet']));
  // Undo inside the 10 seconds: the agent is never told.
  await tap('#dc-sheet [data-reason="not-relevant"]');
  await tap('#undo');
  await wait(800);
  // Decide: More's Select, two asks picked.
  await go('#waiting');
  await tap('.t-more-line'); await tap('#d-more [data-act="select"]'); await tap('#item-export'); await tap('#item-ship');
  await capture('select-decide', (m) => { assert.equal(m.title, '2 selected'); assert.deepEqual(m.bar, ['Cancel', 'Discard 2']); if (!phone) assert.equal(m.crumb, 'Sign-off›Decide'); });
  await tap('.sel-cancel');
  // Designs: More's Select, the two older designs picked, Discard 2 with Replaced by newer.
  await go('#designs');
  await tap('.dz-more'); await evaluate(`[...document.querySelectorAll('#dz-sheet .ui-pr')].find((b) => b.textContent === 'Select').click()`); await wait(450);
  await tap('#item-dash-v1'); await tap('#item-dash-v2');
  await capture('select', (m) => { assert.equal(m.title, '2 selected'); assert.deepEqual(m.bar, ['Cancel', 'Discard 2']); assert.deepEqual(m.checks.filter(Boolean).length, 2); });
  await tap('.sel-go'); await tap('#dc-sheet [data-reason="replaced"]');
  await capture('discarded', (m) => { assert.match(m.toast, /Discarded · Replaced by newer \/ Undo/); assert.equal(m.undoMs, 10000); });
  // Archived: the line at the list's end (a phone) or More's Archived (a desk), after the 10 seconds and the agent's own wait.
  const handed = run('wait', board, '--filer', 'dashboard-agent', '--timeout', '30');
  agent.push(`$ sign-off-axi wait --filer dashboard-agent (exit ${handed.status})`, handed.stdout.trim());
  assert.match(handed.stdout, /dash-v1,Replaced by newer/); assert.match(handed.stdout, /dash-v2,Replaced by newer/);
  const digest = run('wait', board, '--filer', 'release-agent', '--key', 'digest', '--timeout', '2');
  agent.push(`$ sign-off-axi wait --filer release-agent --key digest, the ask discarded and undone inside 10 seconds (exit ${digest.status})`, (digest.stdout + digest.stderr).trim());
  assert.notEqual(digest.status, 0, 'the undone discard reached the agent');
  await go('#designs');
  if (phone) await tap('.ar-line');
  else { await tap('.dz-more'); await evaluate(`[...document.querySelectorAll('#dz-sheet .ui-pr')].find((b) => b.textContent.startsWith('Archived')).click()`); await wait(450); }
  await capture('archived', (m) => { assert.equal(m.archived.length, 3); assert.ok(m.archived.every((r) => /Replaced by newer/.test(r) && /Read/.test(r) && /Restore/.test(r)), m.archived.join(' | ')); });
  // Restore brings one back to Designs.
  await tap('#ar-sheet [aria-label="Restore, Ship the fleet dashboard redesign?"]');
  assert.ok(await evaluate(`!!document.getElementById('item-dash-v2')`), 'Restore did not bring the design back');
  const trail = JSON.parse(await (await fetch(base + 'api/decisions')).text()).trail.filter((t) => t.kind === 'discard');
  agent.push('The board\'s trail of discards:', JSON.stringify(trail, null, 2));
  assert.ok(!trail.some((t) => t.key === 'digest'), 'the undone discard is on the trail');
} finally {
  ws.close(); chrome.kill(); server.kill(); await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(out, `agent.${theme}.${width}w.txt`), agent.join('\n') + '\n');
}
// The step record: each cell adds its steps to the run's steps.json, so one run over four cells keeps all of them.
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, cell = phone ? `On a phone in ${theme}` : `On a ${width} px desk in ${theme}`;
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: 'A new board with four asks from two agents, four designs of one dashboard (the oldest already discarded as replaced and read by its agent), a proof and a report, served by sign-off-axi serve',
  steps: [...(prior?.steps ?? []), ...[
    'The person opens the weekly digest ask, taps More then Discard, picks Not relevant, then taps Undo inside 10 seconds',
    'The person opens Decide, taps the More line, Select, and picks two asks, then Cancel',
    'The person opens Designs, taps More then Select, picks the two older designs, taps Discard 2 and picks Replaced by newer',
    'The dashboard agent runs its own sign-off-axi wait --filer, which hands the two discards over once Undo\'s 10 seconds are over',
    'The person opens Archived on Designs and taps Restore on the whole redesign'].map((x) => `${cell}: ${x}`)],
  result: [prior?.result, `${cell}: Discard offers Not relevant, Replaced by newer and Done elsewhere; the undone discard never reaches the agent; Select shows a check on each picked row with Cancel and Discard 2; the two designs leave the list with a 10-second Undo; the agent's wait prints both with Replaced by newer; Archived lists each with its reason, Read and Restore, and Restore brings the design back.`].filter(Boolean).join(' ') }, null, 2) + '\n');
const failed = results.filter((r) => r.fail.length || r.console_errors.length);
if (failed.length) { console.error(JSON.stringify(failed.map(({ state, fail, console_errors }) => ({ state, fail, console_errors })), null, 2)); process.exit(1); }
