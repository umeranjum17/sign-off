// A long document report reads like a document: its own headings are the outline (a rail on a desk, a Sections sheet on a phone), each section folds, the answer is open on the first screen
// and the rest are folded, a search hides the sections without the words and marks the words, and a section a person never opened is never counted as read.
// The report is a synthetic public one: 8 sections, one with 14 blocks and one with a 40-row table (both past the guided limits), posted through the real CLI as layout "document".
// A headless Chromium of its own over the DevTools protocol with exact device metrics (390 phone or 1280 desk, 2x), its profile in a temp folder; HOME and XDG_* in a temp folder.
// States (one PNG and one measured .txt each): reader-first, reader-outline, reader-search, reader-table. It exits 1 on any failed measure.
// Usage: node .agents/skills/done-done-verify-sign-off/document-reader-shots.mjs <output> [light|dark] [390|1280]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { reportFromPage } from './reference-report.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-dr-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER;
const cli = (...args) => { const r = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const name = (state) => `${state}.${theme}.${width}w`;

// The report: a research document an agent filed, its words and order kept. Section 3 has a table of 40 rows and section 7 has 14 blocks.
const text = (t, level) => ({ type: 'text', text: t, ...(level && { level }) });
const heads = ['Overview', '1. Answer (five lines)', '2. What was asked', '3. Prior art and options', '4. Findings', '5. Risks and mitigations', '6. Not checked', '7. Sources and evidence'];
const sources = Array.from({ length: 40 }, (_, i) => [`S-${i + 1}`, i % 2 ? 'Project documentation' : 'Source code', `Checked 2026-11-${String(1 + (i % 9)).padStart(2, '0')}`]);
const body = [
  [text('Task `pick-a-sync-engine`. Standard research, 11 November 2026. No code changed and nothing installed.')],
  [text('A hosted sync engine fits the phone app best, because nobody on the team has to run a server.\n\nThe three engines read within a second of each other; setup and upkeep decide it. Adopt the hosted one and keep the open-source one as the exit.')],
  [text('Pick a sync engine for the phone app. Compare three real options, check each licence and say what to adopt.\n\nDone when the report names the pick and one acceptance test.')],
  [text('Three engines compared, from their own documentation.'), { type: 'table', columns: ['Option', 'Licence', 'What it does', 'Fit'], rows: [
    ['Hosted engine', 'Proprietary service', 'Runs the server and the sync for you', 'Best: nothing to run'], ['Open-source engine', 'MIT', 'You run the server; the client is small', 'Good exit if the vendor changes terms'], ['Peer sync', 'Apache-2.0', 'No server; devices sync directly', 'Too slow on a cold start']] }],
  [text('1. Latency is the same for all three, within 800 ms at the 95th percentile.\n\n2. Upkeep differs most: the open-source server needs an owner for updates.\n\n3. Only the hosted engine has a free tier that covers the beta.')],
  [{ type: 'table', columns: ['Risk', 'Mitigation'], rows: [['The vendor raises prices', 'Keep the open-source client; the export is one command'], ['An outage during the beta', 'The app reads its local copy and syncs later']] }],
  Array.from({ length: 14 }, (_, i) => text(`Not checked ${i + 1}: how the engine behaves with more than 10,000 records on a low-end phone.`)),
  [text('Every source was read on the day named; the table lists each one.'), { type: 'table', columns: ['Id', 'Kind', 'Read'], rows: sources }],
];
const report = { contract: 1, kind: 'report', schema: 5, layout: 'document', purpose: 'other', key: 'sync-engine', filer: 'research-agent', project: 'Sign-off', title: 'Which sync engine for the phone app',
  about: 'A hosted engine fits best. The report keeps its sections, folded, with search.', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  actions: { role: 'Reviewer', recommended: 'approve', first_pull_request: '2026-12-01' },
  sections: heads.map((h, n) => ({ id: `s${n + 1}`, stage: 'found', heading: h, body: '', blocks: body[n] })) };
writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
cli('post', board, '--kind', 'report', '--from', join(dir, 'report.json'));
// One block too many and one row too many are refused with the limit named.
const tooMany = (what, sections) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--kind', 'report', '--from', '-'], { encoding: 'utf8', env, input: JSON.stringify({ ...report, key: what, sections }) });
const blocksRefused = tooMany('too-many-blocks', [{ ...report.sections[0], blocks: Array.from({ length: 41 }, (_, i) => text(`Block ${i}`)) }]);
const rowsRefused = tooMany('too-many-rows', [{ ...report.sections[0], blocks: [{ type: 'table', columns: ['A'], rows: Array.from({ length: 101 }, (_, i) => [`${i}`]) }] }]);

const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let base = '';
server.stdout.on('data', (b) => { base ||= /url: "?(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b))?.[1] ?? ''; });
for (let i = 0; i < 100 && !base; i++) await wait(100);
assert.ok(base, 'the board did not start');

const prof = mkdtempSync(join(tmpdir(), 'so-dr-cdp-'));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMPDIR: prof } });
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
await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 900, deviceScaleFactor: 2, mobile: false });
await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
const go = async (hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(100); await cdp('Page.navigate', { url: base + hash }); await wait(1800); };
const tap = async (selector) => { assert.ok(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.click(); return !!e; })()`), `nothing to tap at ${selector}`); await wait(450); };
const type = (selector, value) => evaluate(`(() => { const i = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length) ?? document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`).then(() => wait(450));
const show = (selector, block = 'start') => evaluate(`(() => { document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: ${JSON.stringify(block)} }); })()`).then(() => wait(350));
// What the person sees: the outline (rail or sheet), which sections are open, where the answer sits, the search line, and the usual page checks.
const MEASURE = `(async () => { await document.fonts.ready; const fail = [], vh = innerHeight, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const secs = [...document.querySelectorAll('.gd-sec')], rail = [...document.querySelectorAll('.gd-rail nav a, #sheet .gd-outline a')].filter(vis);
  const answer = document.querySelector('.gd-sec:not(.folded) .gk')?.closest('.gd-sec'), head = answer?.querySelector('.gd-foldbtn');
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth) fail.push('sideways overflow');
  for (const e of [...document.querySelectorAll('.gd-foldbtn, .gd-find, .gd-foldall button')].filter(vis)) if (e.scrollWidth > e.clientWidth + 1) fail.push('cut: ' + e.textContent.slice(0, 40));
  const bad = document.body.innerText.match(/\\b(?:undefined|NaN|\\[object)\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  return { url: location.href, outline: rail.map((a) => a.querySelector('.gt').textContent.trim()), sections: secs.length, shown: secs.filter((c) => !c.hidden).length, open: secs.filter((c) => !c.hidden && !c.classList.contains('folded')).map((c) => c.querySelector('.gd-foldbtn')?.textContent.trim()),
    answer: answer ? { heading: head?.textContent.trim(), kicker: answer.querySelector('.gk')?.textContent, top: Math.round(head?.getBoundingClientRect().top ?? -1), bodyBottom: Math.round(answer.querySelector('.gd-fold')?.getBoundingClientRect().bottom ?? -1), viewport: vh } : null,
    found: document.querySelector('.gd-found:not(:empty)')?.textContent ?? '', marks: CSS.highlights?.get('gd-hit')?.size ?? 0, howto: !!document.querySelector('.gd-top .howto'), fail }; })()`;
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
const record = [];
try {
  record.push('$ sign-off-axi post --kind report   (41 blocks in one section)', (blocksRefused.stdout + blocksRefused.stderr).trim(), `(exit ${blocksRefused.status})`, '',
    '$ sign-off-axi post --kind report   (a table of 101 rows)', (rowsRefused.stdout + rowsRefused.stderr).trim(), `(exit ${rowsRefused.status})`, '');
  assert.equal(blocksRefused.status, 2); assert.match(blocksRefused.stdout, /must list 1 to 40 blocks/);
  assert.equal(rowsRefused.status, 2); assert.match(rowsRefused.stdout, /must list 1 to 100 rows/);

  // First screen: the answer is open and marked, in view without scrolling past a long header; every other section is folded; no guided-report banner.
  await go('#reports/sync-engine');
  await capture('reader-first', (m) => {
    assert.equal(m.sections, heads.length); assert.deepEqual(m.open, ['1. Answer (five lines)']);
    assert.equal(m.answer.kicker, 'The answer'); assert.equal(m.howto, false);
    assert.ok(m.answer.top >= 0 && m.answer.top < m.answer.viewport * 0.6, `the answer starts at ${m.answer.top} of ${m.answer.viewport}`);
  });
  // A section nobody opened is not read: after the answer has been in view for a while, the board has read the answer and nothing that is folded.
  await wait(2200);
  const reads = Object.keys((await (await fetch(new URL('/api/decisions', base))).json()).reads ?? {}).filter((k) => k.startsWith('sync-engine/')).sort();
  record.push('Reads after the first screen:', JSON.stringify(reads), '');
  assert.ok(reads.includes('sync-engine/s2'), 'the open answer was not read'); assert.ok(!reads.some((k) => ['s4', 's5', 's6', 's7', 's8'].some((s) => k.endsWith(`/${s}`))), `a folded section was read: ${reads}`);

  // The outline lists every heading, in the document's own words: the rail on a desk, the Sections sheet on a phone.
  if (phone) await tap('.gd-progress button.now');
  await capture('reader-outline', (m) => { assert.deepEqual(m.outline, heads); });
  // A heading folds and unfolds its section; Expand all opens every section, Collapse all closes them.
  if (phone) await tap('#sheet header button');
  await show('.gd-sec[data-part="s3"] .gd-foldbtn');
  await tap('.gd-sec[data-part="s3"] .gd-foldbtn');
  assert.equal(await evaluate(`document.querySelector('.gd-sec[data-part="s3"] .gd-foldbtn').getAttribute('aria-expanded')`), 'true');
  if (phone) await tap('.gd-progress button.now');
  await tap('.gd-foldall button:last-child');
  assert.equal((await evaluate(MEASURE)).open.length, 0, 'Collapse all left a section open');
  await tap('.gd-foldall button:first-child');
  assert.equal((await evaluate(MEASURE)).open.length, heads.length, 'Expand all left a section folded');
  await tap('.gd-foldall button:last-child');

  // Search: only the sections with the words stay, they open, the words are marked and the line says how many match; clearing brings every section back.
  await type('.gd-find', 'licence');
  await capture('reader-search', (m) => {
    assert.match(m.found, /^2 sections of 8 match$/); assert.equal(m.shown, 2); assert.ok(m.marks >= 2, `marked ${m.marks}`);
    assert.deepEqual(m.outline.length, 2);
  });
  await type('.gd-find', 'no such words anywhere');
  assert.match((await evaluate(MEASURE)).found, /No section has those words/);
  await type('.gd-find', '');
  assert.equal((await evaluate(MEASURE)).shown, heads.length);

  // A table past the guided limits: the 40-row sources table is whole, and a jump from the outline opens its folded section.
  if (phone) await tap('#sheet header button');
  await evaluate(`document.querySelector('.gd-sec[data-part="s8"] .gd-foldbtn').getAttribute('aria-expanded') === 'true' || document.querySelector('.gd-sec[data-part="s8"] .gd-foldbtn').click()`);
  await show('.gd-sec[data-part="s8"] .kt-table', 'start');
  await capture('reader-table', async () => {});
  assert.equal(await evaluate(`document.querySelectorAll('.gd-sec[data-part="s8"] .kt-table tbody tr').length`), 40);
  // Side by side: when ARTIFACT_REF names a reference report page (a host path, never kept in the repo), the same report is posted to the board and both are captured first screen
  // and with a table open. SIGN_OFF_REPO may name a base checkout, so the same drive records the before.
  if (process.env.ARTIFACT_REF) {
    const html = readFileSync(process.env.ARTIFACT_REF, 'utf8'), message = reportFromPage(html, { key: 'reference', filer: 'research-agent', project: 'Sign-off' });
    assert.ok(message, 'the reference page carries no markdown');
    writeFileSync(join(dir, 'reference.json'), JSON.stringify(message));
    cli('post', board, '--kind', 'report', '--from', join(dir, 'reference.json'));
    const label = process.env.COMPARE_LABEL ?? 'after', same = (state) => `${state}.${theme}.${width}w`;
    const shoot = async (state, check = () => {}) => {
      const shot = await cdp('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, `${state}.png`), Buffer.from(shot.data, 'base64'));
      const m = { state, url: await evaluate('location.href'), sideways: await evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth'), console_errors: [...errors], fail: [] };
      try { await check(m); } catch (e) { m.fail.push(e.message.split('\n')[0]); }
      results.push(m); writeFileSync(join(out, `${state}.txt`), JSON.stringify(m, null, 2) + '\n');
      console.log(state, m.fail.length || errors.length ? `FAIL ${[...m.fail, ...errors].join('; ')}` : 'ok'); errors.length = 0;
    };
    await go('#reports/reference');
    await shoot(same(`reference-first-${label}`));
    // The first table, its section opened when the board folds it.
    await evaluate(`(() => { const sec = document.querySelector('.gd-sec .kt-table').closest('.gd-sec'); if (sec.querySelector(':scope > .gd-fold')?.hidden) sec.querySelector('.gd-foldbtn').click(); })()`);
    await wait(500); await show('.gd-sec .kt-table', 'start');
    await shoot(same(`reference-table-${label}`));
    if (label === 'after') {
      // The artifact page itself, as the reference shows it, in the same window.
      await cdp('Page.navigate', { url: 'about:blank' }); await wait(100);
      await cdp('Page.navigate', { url: `file://${resolve(process.env.ARTIFACT_REF)}` }); await wait(3500);
      assert.ok(await evaluate(`!!document.querySelector('details.sec')`), 'the reference page did not draw its sections (it loads its renderer from the web)');
      await shoot(same('artifact-first'));
      await evaluate(`(() => { const d = [...document.querySelectorAll('details.sec')].find((x) => x.querySelector('table')); d.open = true; d.scrollIntoView({ block: 'start' }); })()`);
      await wait(600);
      await shoot(same('artifact-table'));
    }
  }
} finally {
  ws.close(); chrome.kill(); server.kill(); await wait(300);
  rmSync(prof, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(out, `refusals.${theme}.${width}w.txt`), record.join('\n') + '\n');
}
// The step record: each cell adds its steps to the run's steps.json, so one run over several cells keeps all of them.
const prior = existsSync(join(out, 'steps.json')) ? JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')) : null, cell = phone ? `On a phone in ${theme}` : `At ${width} px in ${theme}`;
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: 'A new board with one 8-section document report (a 14-block section and a 40-row table), served by sign-off-axi serve',
  steps: [...(prior?.steps ?? []), ...[
    'The agent posts a section of 41 blocks and a table of 101 rows, and both are refused with the limit named',
    'The person opens the report: the answer is open and marked, the other seven sections are folded',
    'The person opens the outline (the rail, or the Sections sheet on a phone) and reads every heading',
    'The person folds and unfolds a section, then taps Expand all and Collapse all',
    'The person searches for "licence": two sections stay, open, with the words marked',
    'The person opens the sources section: its 40-row table is whole'].map((x) => `${cell}: ${x}`)],
  result: [prior?.result, `${cell}: the answer is on the first screen with its section marked The answer and the rest folded; the outline lists the 8 headings; search leaves 2 sections and marks the words; the folded sections were never counted as read; the 40-row table is whole`].filter(Boolean).join(' ') }, null, 2) + '\n');
const failed = results.filter((r) => r.fail.length || r.console_errors.length);
if (failed.length) { console.error(JSON.stringify(failed.map(({ state, fail, console_errors }) => ({ state, fail, console_errors })), null, 2)); process.exit(1); }
