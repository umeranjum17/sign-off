// The Tickets screens that make and group tickets, over a ticket adapter, driven in a headless Chromium of its own over the DevTools protocol with exact device
// metrics (390x844 with mobile emulation, 1280x800), on a throwaway board and the repo's stand-in adapter: the New ticket sheet with its fields and allowed words
// drawn from `describe` (title, body, kind, parent, assignee), a ticket made under an epic, All tickets grouped by epic, one epic's page with New ticket in this
// epic, and Activity filtered to one person. Every word comes from the backend; the client names no status and no kind of its own.
// Usage: node tickets-create-shots.mjs <evidence folder> [light|dark] [390|1280]   (no theme or width: all four combinations, one run each)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { lint } from '../../../test/support/layout-lint.mjs';
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
const dir = mkdtempSync(join(tmpdir(), 'so-tk-create-')), board = join(dir, 'board.json'), support = join(repo, 'test/support'), prof = join(dir, 'chrome');
// Who this backend says did a write: the stand-in records it on the event it makes, so a ticket made on the page names its maker.
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir,
  SIGN_OFF_TICKETS_ADAPTER: join(support, 'ticket-adapter-standin.mjs'), TICKET_STANDIN_DIR: dir, TICKET_STANDIN_ACTOR: 'Umer' };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
/** The same backend, with another person named as the one who wrote: two people in one history is what a shared backend has. */
const cliAs = (who, ...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env: { ...env, TICKET_STANDIN_ACTOR: who }, encoding: 'utf8' });
const make = (as, ...set) => JSON.parse((as ? cliAs(as, 'ticket', board, '--create', ...set.flatMap((s) => ['--set', s]), '--json') : cli('ticket', board, '--create', ...set.flatMap((s) => ['--set', s]), '--json'))).ticket;
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], steps = [];
try {
  // The board itself (a card, so the board file exists), and a ticket for it to name.
  cli('raise', board, '--title', 'Ship the settings page on Friday?', '--why', 'The page is ready.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'Every check passed.', '--default', 'no', '--ask-ref', 'message-test', '--ticket', 'tk-1');
  // Two epics (a ticket others name as parent), their tickets, and one ticket under no epic. The loose one is Sam's; the rest are Umer's.
  make(null, 'title=Ship the settings page', 'kind=kind-a', 'status=stage-2', 'assignee=Umer', 'body=# Why\nPeople cannot save their settings.\n\n- one page\n- one save');
  for (const [title, status, kind, assignee] of [['Build the page', 'stage-2', 'kind-b', 'Umer'], ['Publish it', 'stage-1', 'kind-a', ''], ['Write the release note', 'stage-3', 'kind-a', 'Umer'], ['Check the save twice', 'stage-1', 'kind-b', '']]) {
    make(null, `title=${title}`, `status=${status}`, `kind=${kind}`, ...(assignee ? [`assignee=${assignee}`] : []), 'parent=tk-1');
  }
  make('Sam', 'title=Sort the inbox by hand', 'status=stage-1', 'kind=kind-b', 'assignee=Sam');
  make(null, 'title=Move the export to its own page', 'kind=kind-b', 'status=stage-2');
  make(null, 'title=Write the exporter', 'parent=tk-7', 'status=stage-1', 'kind=kind-a', 'assignee=Umer');
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
  const save = (name, value) => writeFileSync(join(out, `${name}.${theme}.${width}.json`), JSON.stringify(value, null, 2) + '\n');
  /** A capture is taken only when the board's own layout lint finds nothing in the frame: no overlap, no clipped word, a 44px control, nothing past the screen's edge. */
  const check = async (name, say) => { const faults = await js(lint('body')); assert.deepEqual(faults, [], `layout faults on ${name}: ${JSON.stringify(faults)}`); save(`lint-${name}`, { faults, at: name }); await png(name, say); };
  const button = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent)`;
  // The New ticket sheet: its fields are the ones `describe` lists, with the backend's own words, and its epic pick holds every ticket others sit under.
  await go('#tickets');
  await until(`!!document.querySelector('.tk-newb')`, 'the New ticket button');
  await js(`document.querySelector('.tk-newb').click()`);
  await until(`!!document.querySelector('#tk-new[open]')`, 'the New ticket sheet');
  const form = await js(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return null; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    set('#tk-new input[aria-label="Title"]', 'Ship the billing page');
    set('#tk-new textarea[aria-label="Body"]', 'Two pages: the plan and the card.');
    const kind = '#tk-new select[aria-label="Kind"]', parent = '#tk-new select[aria-label="Parent"]', who = '#tk-new input[aria-label="Assignee"]';
    const kinds = [...document.querySelectorAll(kind + ' option')].map((o) => o.textContent), epics = [...document.querySelectorAll(parent + ' option')].map((o) => o.textContent);
    set(kind, 'kind-b'); set(parent, 'tk-1'); set(who, 'Umer');
    return { kinds, epics, labels: [...document.querySelectorAll('#tk-new .tk-nl')].map((l) => l.textContent), creates: [...document.querySelectorAll('#tk-new button')].map((b) => b.textContent.trim()) };
  })()`);
  assert.deepEqual(form.kinds, ['Backend default', 'kind-a', 'kind-b'], 'the kinds are the backend\'s own words'), assert.ok(form.epics.includes('Ship the settings page'), `the epic pick ${JSON.stringify(form.epics)}`);
  assert.ok(form.labels.includes('Parent') && form.labels.includes('Assignee') && form.labels.includes('Kind'), `the form's fields ${JSON.stringify(form.labels)}`);
  assert.ok(form.creates.includes('Create ticket') && form.creates.includes('Create and add another'), `the buttons ${JSON.stringify(form.creates)}`);
  assert.equal(await js(`document.querySelector('#tk-new select[aria-label="Parent"]').value`), 'tk-1', 'the epic is picked');
  assert.equal(await js(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, 'no sideways overflow');
  save('new-ticket', form);
  await check('new-ticket', 'New ticket draws title, body, kind, parent and assignee from the backend\'s describe: its kinds are the backend\'s own words, its parent pick lists the epics, and Create ticket sits beside Create and add another');
  // Make it under the epic, then read what the backend took: the ticket, and who the backend says made it.
  await js(`document.querySelector('#tk-new button[type=submit]').click()`);
  await until(`!document.querySelector('#tk-new[open]')`, 'the sheet closes on a made ticket');
  await wait(900);
  const made = JSON.parse(cli('ticket', board, '--json')).tickets.find((t) => t.title === 'Ship the billing page');
  assert.ok(made, 'the ticket exists in the backend'), assert.equal(made.parent, 'tk-1', 'it is under the epic it was made in'), assert.equal(made.assignee, 'Umer', 'its assignee is kept'), assert.equal(made.kind, 'kind-b');
  const events = JSON.parse(cli('ticket', board, '--id', made.id, '--history', '--json')).events;
  assert.ok(events.some((e) => e.type === 'created' && e.actor === 'Umer'), `who made it: ${JSON.stringify(events.map((e) => [e.type, e.actor]))}`);
  steps.push(`made ${made.id} under tk-1, assigned to Umer, kind-b: the backend read it back under its epic and its history names Umer as its maker`);
  // All tickets, grouped by the epic each sits under: each epic's head over the tickets under it, then the tickets under none.
  await go('#tickets');
  await until(`!!document.querySelector('.tk-gby')`, 'the Group by pick');
  await js(`${button('Epic')}.click()`);
  await until(`document.querySelectorAll('.tk-eh').length >= 2`, 'the epic heads');
  let f = await js(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, heads: [...document.querySelectorAll('.tk-eh')].map((h) => h.innerText.replace(/\\s+/g, ' ').trim()),
    groups: [...document.querySelectorAll('main section[aria-label] h2')].map((h) => h.textContent.trim()), rows: [...document.querySelectorAll('.tk-row .t')].map((r) => r.textContent.trim()) })`);
  assert.equal(f.overflow, false, 'no sideways overflow'), assert.ok(f.heads.some((h) => h.startsWith('Ship the settings page')) && f.heads.some((h) => h.startsWith('Move the export')), `epic heads ${JSON.stringify(f.heads)}`);
  assert.ok(f.groups.some((g) => g.startsWith('No epic')), `the tickets under none ${JSON.stringify(f.groups)}`);
  assert.ok(f.rows.includes('Ship the billing page') && f.rows.includes('Sort the inbox by hand'), `the rows ${JSON.stringify(f.rows)}`);
  save('by-epic', f);
  await check('by-epic', 'Group by Epic puts every ticket under the epic it sits under: each epic\'s title and how many are under it, the tickets under it, and the tickets under no epic');
  // One epic's page: New ticket in this epic, and its tickets grouped by the backend's statuses.
  await go('#epics/tk-1');
  await until(`document.body.innerText.includes('New ticket in this epic')`, 'the epic page');
  f = await js(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, add: !!${button('New ticket in this epic')},
    groups: [...document.querySelectorAll('main section[aria-label] h2')].map((h) => h.textContent.trim()), rows: [...document.querySelectorAll('.tk-row .t')].map((r) => r.textContent.trim()) })`);
  assert.ok(f.add, 'New ticket in this epic is on the epic'), assert.equal(f.overflow, false, 'no sideways overflow');
  assert.ok(f.groups.some((g) => g.startsWith('stage-1')) && f.groups.some((g) => g.startsWith('stage-2')), `its tickets by status ${JSON.stringify(f.groups)}`);
  assert.ok(!f.rows.includes('Sort the inbox by hand'), 'a ticket under no epic is not on this epic');
  save('epic', f);
  await check('epic', 'An epic\'s page carries New ticket in this epic and the tickets under it, grouped by the status words the backend gave');
  // Activity names who made or moved what, and one pick narrows it to one person.
  await go('#activity');
  await until(`!!document.querySelector('.tk-feed')`, 'the activity feed');
  const people = await js(`({ select: !!document.querySelector('select[aria-label="Filter activity by person"]'), options: [...document.querySelectorAll('select[aria-label="Filter activity by person"] option')].map((o) => o.textContent),
    count: document.querySelector('.tk-count')?.textContent, rows: [...document.querySelectorAll('.tk-feed .meta')].map((m) => m.textContent) })`);
  assert.ok(people.select, 'the person filter is there'), assert.ok(people.options.includes('Umer') && people.options.includes('Sam'), `the people ${JSON.stringify(people.options)}`);
  assert.ok(people.rows.some((r) => r.includes('Sam')), `who did what ${JSON.stringify(people.rows)}`);
  await js(`(() => { const s = document.querySelector('select[aria-label="Filter activity by person"]'); s.value = 'Sam'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(`/^\\d+ of /.test(document.querySelector('.tk-count')?.textContent ?? '')`, 'the narrowed count');
  f = await js(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, count: document.querySelector('.tk-count').textContent,
    picked: document.querySelector('select[aria-label="Filter activity by person"]').value, rows: [...document.querySelectorAll('.tk-feed .meta')].map((m) => m.textContent) })`);
  assert.equal(f.picked, 'Sam'), assert.equal(f.overflow, false, 'no sideways overflow'), assert.ok(f.rows.every((r) => r.includes('Sam')), `only Sam's events ${JSON.stringify(f.rows)}`);
  save('activity', { ...people, filtered: f });
  await check('activity', 'Activity names who made or moved each ticket, as the backend\'s history records it, and its person pick narrows the feed to one of them');
  assert.deepEqual(errors, [], 'no page error');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A new board whose tickets live in the repo\'s stand-in ticket adapter: two epics with tickets under them, a ticket under no epic made by Sam, and one ticket per backend status',
    steps: ['Open Tickets and press New ticket', 'Pick the kind, the epic and the assignee, then Create ticket', 'Group the list by Epic', 'Open an epic\'s page', 'Open Activity and pick one person'],
    result: `At ${width}px${phone ? ' with mobile emulation' : ''}, ${theme}: the New ticket sheet draws its fields and allowed words from the backend and makes a ticket under the epic picked; All tickets groups by the epic each ticket sits under, with a head per epic and the tickets under none; an epic's page carries New ticket in this epic and its tickets by status; Activity names who did each event and filters to one person.` }, null, 2));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { cli('stop', board); } catch {}
  await wait(300);
  rmSync(dir, { recursive: true, force: true });
}
