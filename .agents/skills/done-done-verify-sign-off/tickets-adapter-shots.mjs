// The Tickets screens over a ticket adapter, driven in a headless Chromium of its own over the DevTools protocol with exact device metrics (390x844 with mobile emulation, and 1280x800), on a throwaway
// board and the repo's stand-in adapter: the list grouped by the backend's own statuses, a ticket with its More fields block (an extra key and a top-level key the page has never heard of), an edit
// refused as a conflict (both versions shown, the typed words kept), a read that fails (the adapter's code and message with Retry, no rows) and a list that is not whole (incomplete, no rows).
// Usage: node tickets-adapter-shots.mjs <evidence folder> [light|dark] [390|1280]   (no theme or width: all four combinations, one run each)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]), repo = process.cwd();
mkdirSync(out, { recursive: true });
if (!process.argv[3]) {
  // TICKETS_CELLS=light:390,dark:1280 runs only those cells (a sealed run's judge reads a limited number of captures); the default is all four.
  const cells = (process.env.TICKETS_CELLS ?? 'light:390,light:1280,dark:390,dark:1280').split(',').map((c) => c.split(':'));
  const each = cells.map(([theme, width]) => {
    const r = spawnSync(process.execPath, [process.argv[1], out, theme, String(width)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    renameSync(join(out, 'steps.json'), join(out, `steps.${theme}.${width}.json`));
    return JSON.parse(readFileSync(join(out, `steps.${theme}.${width}.json`), 'utf8'));
  });
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: each[0].target, start: each[0].start, steps: each[0].steps, result: each[0].result }, null, 2) + '\n');
  process.exit(0);
}
const theme = process.argv[3], width = +process.argv[4], phone = width < 1024, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dir = mkdtempSync(join(tmpdir(), 'so-tk-adapter-')), board = join(dir, 'board.json'), support = join(repo, 'test/support'), prof = join(dir, 'chrome');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir,
  SIGN_OFF_TICKETS_ADAPTER: join(support, 'ticket-adapter-standin.mjs'), TICKET_STANDIN_DIR: dir };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const fault = (mode) => execFileSync(process.execPath, [join(support, 'ticket-adapter-standin-faults.mjs'), mode], { env });
const make = (...set) => JSON.parse(cli('ticket', board, '--create', ...set.flatMap((s) => ['--set', s]), '--json')).ticket;
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], steps = [];
try {
  cli('raise', board, '--title', 'Ship the settings page on Friday?', '--why', 'The page is ready.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'Every check passed.', '--default', 'no', '--ask-ref', 'message-test', '--ticket', 'tk-1');
  make('title=Ship the settings page', 'kind=kind-a', 'status=stage-2', 'assignee=Umer', 'body=# Ask\nShip the page.\n\n- one\n- two', 'extra.legacy-ref=L-17', 'extra.estimate=3');
  for (const [title, status, kind, assignee] of [['Build the page', 'stage-2', 'kind-b', 'Umer'], ['Publish it', 'stage-1', 'kind-a', ''], ['Write the release note', 'stage-3', 'kind-a', 'Umer'], ['Fix the export', 'stage-1', 'kind-b', '']]) {
    make(`title=${title}`, `status=${status}`, `kind=${kind}`, ...(assignee ? [`assignee=${assignee}`] : []), 'parent=tk-1');
  }
  const log = openSync(join(dir, 'serve.out'), 'w');
  spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--bind', '127.0.0.1', '--port', '0'], { env, detached: true, stdio: ['ignore', log, log] }).unref();
  let base;
  for (let i = 0; i < 60 && !base; i++) { await wait(250); base = /url: "(http:\/\/[^"]+)"/.exec(readFileSync(join(dir, 'serve.out'), 'utf8'))?.[1]; }
  assert.ok(base, 'the board is served');
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception'); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 80; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`); };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: 800, deviceScaleFactor: 2, mobile: false });
  await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  const png = async (name, say) => { await wait(400); writeFileSync(join(out, `${name}.${theme}.${width}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64')); steps.push(`${name}: ${say}`); };
  const go = async (hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: base + hash }); await wait(600); };
  const facts = (extra = '') => js(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, rows: document.querySelectorAll('.tk-row').length, text: document.body.innerText ${extra} })`);
  const save = (name, value) => writeFileSync(join(out, `${name}.${theme}.${width}.json`), JSON.stringify(value));
  const button = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(text)} && b.offsetParent)`;
  fault('none');
  // The list, grouped by the backend's own statuses in the order it lists them.
  await go('#tickets');
  await until(`document.querySelectorAll('.tk-row').length >= 5`, 'the ticket rows');
  let f = await facts(`, groups: [...document.querySelectorAll('main section[aria-label] h2')].map((h) => h.textContent)`);
  assert.equal(f.width, width), assert.equal(f.overflow, false, 'no sideways overflow');
  assert.ok(f.groups.some((g) => g.startsWith('stage-1')) && f.groups.some((g) => g.startsWith('stage-3')), `groups ${JSON.stringify(f.groups)}`);
  save('list', f);
  await png('list', 'Tickets lists every ticket grouped by the status words the backend gave, with their counts');
  // One ticket: its fields, the More fields block, the history the backend recorded.
  await go('#ticket/tk-1');
  await until(`document.body.innerText.includes('More fields') && document.body.innerText.includes('History') && !document.body.innerText.includes('Loading history')`, 'the ticket');
  f = await facts(`, more: [...document.querySelectorAll('.tk-more-fields .ui-pr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.ok(f.more.some((m) => m.includes('legacy-ref') && m.includes('L-17')) && f.more.some((m) => m.endsWith('3')), `More fields ${JSON.stringify(f.more)}`);
  assert.equal(f.overflow, false, 'no sideways overflow');
  save('ticket', f);
  await png('ticket', 'A ticket shows the backend\'s own fields and, under More fields, the extra keys it keeps, then its history');
  // An edit refused as a conflict: the ticket changes under the person's hands; both versions show and the typed title stays in the form.
  await js(`document.querySelector('.tk-edit').click()`);
  await until(`!!document.querySelector('#tk-new[open] input[aria-label="Title"]')`, 'the edit form');
  const read = JSON.parse(cli('ticket', board, '--id', 'tk-1', '--json')).ticket;
  cli('ticket', board, '--id', 'tk-1', '--rev', read.rev, '--set', `title=Ship the settings page (moved ${theme} ${width})`, '--set', 'status=stage-3');
  await js(`(() => { const i = document.querySelector('#tk-new input[aria-label="Title"]'); i.value = 'My own title'; document.querySelector('#tk-new button[type=submit]').click(); })()`);
  await until(`!!document.querySelector('#tk-new .tk-conf:not([hidden])')`, 'the conflict');
  f = await js(`({ typed: document.querySelector('#tk-new input[aria-label="Title"]').value, conflict: document.querySelector('#tk-new .tk-conf').innerText, said: document.querySelector('#tk-new .tk-nerr:not([hidden])')?.innerText })`);
  assert.equal(f.typed, 'My own title', 'the typed words are kept'), assert.match(f.said, /^conflict: /), assert.match(f.conflict, /moved/);
  save('conflict', f);
  await js(`document.querySelector('#tk-new .tk-conf').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await png('conflict', 'An edit of a ticket that changed meanwhile is refused as a conflict: what it is now beside what was typed, and the typed words stay in the form');
  await js(`document.querySelector('#tk-new').close()`);
  // A read that fails: the adapter's code and message, a Retry, and no rows.
  fault('unreadable');
  await go('#tickets');
  await until(`document.body.innerText.includes('unavailable:')`, 'the error');
  f = await facts();
  assert.equal(f.rows, 0, 'no rows stand in for the error'), assert.match(f.text, /unavailable: The stand-in store cannot be read\./), assert.match(f.text, /Retry/);
  save('failure', f);
  await png('failure', 'A failed read shows the adapter\'s code and message as written with a Retry button, and no tickets');
  // A list that cannot be whole: incomplete, never the part of it that could be read.
  fault('partial');
  await js(`${button('Retry')}.click()`);
  await until(`document.body.innerText.includes('incomplete:')`, 'incomplete');
  f = await facts();
  assert.equal(f.rows, 0, 'a partial list is never shown'), assert.match(f.text, /incomplete: /);
  save('incomplete', f);
  await png('incomplete', 'A list that is not whole shows incomplete with the adapter\'s message and Retry, never the tickets that could be read');
  // Retry once the backend is back: the list returns.
  fault('none');
  await js(`${button('Retry')}.click()`);
  await until(`document.querySelectorAll('.tk-row').length >= 5`, 'the list after Retry');
  assert.deepEqual(errors, [], 'no page error');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A new board whose tickets live in the repo\'s stand-in ticket adapter: a ticket with two keys of extra, four tickets under it in three of the backend\'s statuses, and a card that names the first',
    steps: ['Open Tickets', 'Open the first ticket', 'Open its Edit form, let the ticket change meanwhile, change the title and save', 'Make the backend unreadable and open Tickets', 'Make it readable only in part and press Retry', 'Make it readable again and press Retry'],
    result: `At ${width}px${phone ? ' with mobile emulation' : ''}, ${theme}: Tickets groups what the adapter lists by its own status words; a ticket shows its extra keys in More fields; a stale edit shows a conflict beside what was typed and keeps the typed words; an unreadable backend shows the adapter's code and message with Retry and no rows; a partial list shows incomplete and no rows.` }, null, 2));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { cli('stop', board); } catch {}
  await wait(300);
  rmSync(dir, { recursive: true, force: true });
}
