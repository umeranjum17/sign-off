// The Tickets board over a REAL ticket adapter (the one SIGN_OFF_TICKETS_ADAPTER names, with whatever environment it reads its store from), driven in a headless Chromium of its own over the
// DevTools protocol with exact device metrics (390x844 with mobile emulation, and 1440x900) on a throwaway board. This file holds no ticket, no store and no word of any backend: it asks the
// adapter itself (`describe`, `list`) what the board must show (a column for each status it lists, each card's project where it names one) and checks the board against that, then captures what the board shows for real: the board, a ticket's sheet, and the
// adapter's own error (TICKETS_REAL_BREAK=NAME=VALUE starts a second board whose adapter has that one environment variable changed, so it cannot read its store).
// The frames show the real tickets: keep them outside the repository. The run writes no ticket text into any file but those frames and the facts beside them.
// Usage: SIGN_OFF_TICKETS_ADAPTER=<adapter> [TICKETS_REAL_BREAK=NAME=VALUE] node tickets-real-shots.mjs <evidence folder> [light|dark] [390|1440]   (no theme or width: all four combinations)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { lint } from '../../../test/support/layout-lint.mjs';
const out = resolve(process.argv[2] ?? '.'), repo = process.cwd(), adapter = process.env.SIGN_OFF_TICKETS_ADAPTER;
if (!adapter) { console.error('Set SIGN_OFF_TICKETS_ADAPTER to the adapter to drive: this journey keeps no tickets of its own.'); process.exit(2); }
mkdirSync(out, { recursive: true });
if (!process.argv[3]) {
  for (const [theme, width] of ['light:390', 'light:1440', 'dark:390', 'dark:1440'].map((c) => c.split(':'))) {
    const r = spawnSync(process.execPath, [process.argv[1], out, theme, width], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    renameSync(join(out, 'steps.json'), join(out, `steps.${theme}.${width}.json`));
  }
  process.exit(0);
}
const theme = process.argv[3], width = +process.argv[4], phone = width < 1024, height = phone ? 844 : 900, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dir = mkdtempSync(join(tmpdir(), 'so-tk-real-')), prof = join(dir, 'chrome'), boards = [];
// /usr/bin comes first so the adapter's python3 is the system's: a version manager's shim reads its settings from the real HOME, which this run replaces.
const env = { ...process.env, PATH: `/usr/bin:${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], steps = [];

/** One call to the adapter itself, as the board makes it: what it answers is what the board must show. */
const ask = (op, request = {}) => JSON.parse(execFileSync(adapter, [op], { input: JSON.stringify({ interface: 1, ...request }), env: process.env, encoding: 'utf8', timeout: 120_000 }));
const listAll = () => { const all = []; for (let cursor, page; ; cursor = page.next_cursor) { page = ask('list', { limit: 500, ...(cursor && { cursor }) }); all.push(...page.tickets); if (!page.next_cursor) return all; } };
/** The words the board must show, said plainly: the adapter's label where it gave one, else the value with its _ and - as spaces and a capital first letter when it is a lowercase machine word. */
const said = (field, value) => field?.values?.find((v) => v.value === value)?.label ?? (field?.type === 'enum' && /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(value) ? value.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : value);
const shorten = (id) => (id.length > 22 ? `${id.slice(0, 15)}…${id.slice(-4)}` : id);

/** Serves a throwaway board (a file of its own) whose adapter environment is the run's own, with `change` applied; answers its address. */
async function serve(name, change = {}) {
  const log = join(dir, `${name}.out`), at = { ...env, ...change }, board = join(dir, `${name}.board.json`);
  boards.push(board);
  cli('raise', board, '--title', 'Ship the settings page on Friday?', '--why', 'The board needs one card to exist.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'Nothing depends on it.', '--default', 'no', '--ask-ref', 'message-test');
  spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--bind', '127.0.0.1', '--port', '0'], { env: at, detached: true, stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')] }).unref();
  for (let i = 0; i < 80; i++) { await wait(250); const base = /url: "(http:\/\/[^"]+)"/.exec(readFileSync(log, 'utf8'))?.[1]; if (base) return base; }
  assert.fail(`the ${name} board did not start`);
}

try {
  const fields = ask('describe').fields, status = fields.find((f) => f.name === 'status'), kind = fields.find((f) => f.name === 'kind');
  const tickets = listAll();
  assert.ok(tickets.length > 0, 'the adapter lists at least one ticket to show');
  // What the board must show: a column for each status the adapter lists, empty or not (then any it lists a ticket under without naming it), in that order.
  const order = [...(status.values ?? []).map((v) => v.value), ...tickets.map((t) => t.status)].filter((v, i, all) => all.indexOf(v) === i);
  const expected = order.map((value) => [said(status, value), tickets.filter((t) => t.status === value).length]);
  const base = await serve('real');
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const connect = async (target, faults = []) => {
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, no) => { sock.onopen = ok; sock.onerror = no; });
    let id = 0; const pending = new Map();
    sock.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
      if (x.method === 'Runtime.exceptionThrown') faults.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception'); };
    const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); sock.send(JSON.stringify({ id: n, method, params })); });
    const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: phone });
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    return { cdp, js, sock };
  };
  const { cdp, js, sock } = await connect(await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(), errors);
  ws = sock;
  // A real store answers in seconds, not at once: the board's first read waits for it.
  const until = async (expression, what) => { for (let i = 0; i < 900; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`); };
  const png = async (name, say) => { await wait(400); writeFileSync(join(out, `${name}.${theme}.${width}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64')); steps.push(`${name}: ${say}`); };
  const go = async (to, hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: to + hash }); await wait(600); };
  const save = (name, value) => writeFileSync(join(out, `${name}.${theme}.${width}.json`), JSON.stringify(value));
  /** A capture is taken only when the board's own layout lint finds nothing in the frame it shows. */
  const check = async (name, say, scope) => { const faults = await js(lint(scope)); assert.deepEqual(faults, [], `layout faults on ${name}: ${JSON.stringify(faults)}`); await png(name, say); };

  // The board: the adapter's own tickets, each in the column of its own status, in the adapter's words made readable by the one rule.
  await go(base, '#tickets');
  // A real store answers in seconds, and on a loaded host a read can outlast the board's 20 seconds: the board then says timeout with a Retry, and a person taps it, so the run does (twice at most) and records it.
  const retries = [], retry = `[...document.querySelectorAll('button')].find((x) => x.textContent === 'Retry' && x.offsetParent)`;
  for (let tries = 0; ; tries++) {
    let seen = ''; for (let i = 0; i < 900 && !seen; i++) { seen = await js(`document.querySelectorAll('.tkb-card').length > 0 ? 'cards' : ${retry} ? 'error' : ''`); if (!seen) await wait(100); }
    if (seen === 'cards') break;
    const text = (await js(`document.querySelector('main')?.innerText ?? ''`)).replace(/\s+/g, ' ').slice(0, 300);
    // A second miss fails the run, and the frame of what the board said is kept: it is the real answer when the adapter's list cannot be read in time.
    if (seen === 'error' && tries >= 2) await png('timeout', 'The board over this adapter after two Retry taps: its list did not answer in the board\'s 20 seconds, so the board shows the adapter\'s error and no ticket');
    assert.ok(seen === 'error' && /\btimeout: /.test(text) && tries < 2, `the board did not show the tickets: ${text || 'nothing on screen'}`);
    retries.push('timeout'); await js(`${retry}.click()`);
  }
  let f = await js(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, sum: document.querySelector('.tkb-top .sum')?.textContent ?? null,
    cols: [...document.querySelectorAll('.tkb-col')].map((c) => [c.getAttribute('aria-label'), +c.querySelector('.tkb-ch .n').textContent]),
    empty: [...document.querySelectorAll('.tkb-col')].map((c) => c.querySelector('.tkb-none')?.textContent ?? null),
    cards: [...document.querySelectorAll('.tkb-card')].map((c) => ({ id: c.getAttribute('href').slice(8), shown: c.querySelector('.id').textContent, title: c.querySelector('.t').textContent, meta: c.querySelector('.m').textContent,
      project: c.querySelector('.m .proj')?.textContent ?? null, ago: c.querySelector('.m .ago')?.textContent ?? null, agoWhole: !c.querySelector('.m .ago') || (c.querySelector('.m .ago').scrollWidth <= c.querySelector('.m .ago').clientWidth && c.querySelector('.m .ago').getBoundingClientRect().right <= c.querySelector('.m').getBoundingClientRect().right + 0.5),
      whoWidth: c.querySelector('.m .who')?.getBoundingClientRect().width ?? null })) })`);
  assert.equal(f.width, width), assert.equal(f.overflow, false, 'no sideways overflow');
  assert.deepEqual(f.cols, expected, 'a column for each status the adapter lists (and each it lists a ticket under), in its order, each word readable');
  assert.deepEqual(f.empty.map((e, i) => e !== null), expected.map(([, n]) => n === 0), 'a column with no ticket says so, and only that one');
  assert.ok(f.cols.every(([name]) => !/[_]/.test(name)), 'no column says a word with an underscore');
  assert.ok(phone || f.sum === `${tickets.length} in all`, `the count ${f.sum}`);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  for (const c of f.cards) {
    const t = byId.get(c.id);
    assert.ok(t, `a card for a ticket the adapter did not list: ${c.id}`);
    assert.equal(c.shown, shorten(c.id), `the card shows the ticket's own id (${c.id})`), assert.equal(c.title, t.title, `the card shows the ticket's own title (${c.id})`);
    assert.ok(!t.assignee || c.meta.includes(t.assignee), `the card names the assignee as the adapter gave it (${c.id})`);
    assert.equal(c.project, typeof t.project === 'string' && t.project.trim() ? t.project.trim() : null, `the card's project is the adapter's own, and a ticket with none has no label (${c.id})`);
    assert.ok(c.agoWhole, `the time on the card stays whole, inside the line (${c.id}): ${c.ago}`);
    assert.ok(c.whoWidth === null || c.whoWidth >= 14, `a name keeps some room (${c.id}): ${c.whoWidth}px`);
  }
  assert.equal(f.cards.length, expected.reduce((n, [, c]) => n + Math.min(c, 20), 0), 'every ticket the adapter listed is on a card (a column shows 20, then Show more)');
  save('board', { cols: f.cols, cards: f.cards.length, listed: tickets.length, ids: f.cards.map((c) => c.id) });
  await check('board', 'Tickets shows the adapter\'s own tickets, one column for each of its statuses, each card with the ticket\'s own id and its project', '.tkb');

  // A ticket's sheet: the one with a parent and an assignee if the store has one, else any.
  const shown = new Set(f.cards.map((c) => c.id)), seen = tickets.filter((t) => shown.has(t.id));
  const pick = seen.find((t) => t.parent && t.assignee && t.project) ?? seen.find((t) => t.assignee && t.project) ?? seen.find((t) => t.parent && t.assignee) ?? seen.find((t) => t.parent) ?? seen.find((t) => t.assignee) ?? seen[0], up = pick.parent && byId.get(pick.parent);
  await js(`document.querySelector('.tkb-card[href="#ticket/${pick.id}"]').scrollIntoView({ block: 'center', inline: 'center' })`);
  await js(`document.querySelector('.tkb-card[href="#ticket/${pick.id}"]').click()`);
  await until(`!!document.querySelector('.tk-sheet .tkb-id')`, 'the sheet');
  await until(`!!document.querySelector('.tk-sheet .tkb-id') && !document.querySelector('.tk-sheet .es-loading')`, 'the history read (no loading placeholder left in the sheet)');
  await wait(500);
  f = await js(`({ chip: document.querySelector('.tkb-id code').textContent, title: document.querySelector('.tk-sheet .tk-dt').textContent, state: document.querySelector('.tkb-state').innerText.trim(), head: document.querySelector('.tk-sheet .ui-lab').textContent,
    facts: [...document.querySelectorAll('.tkb-facts > div')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()) })`);
  assert.equal(f.chip, pick.id, 'the sheet shows the whole id'), assert.equal(f.title, pick.title), assert.equal(f.state, said(status, pick.status), 'where it stands, in the adapter\'s status word made readable');
  assert.equal(f.head, said(kind, pick.kind), 'the kind, as the adapter gave it made readable');
  assert.ok(f.facts.some((r) => r === `Assignee ${pick.assignee ?? 'Unassigned'}`), `the assignee as the adapter gave it: ${JSON.stringify(f.facts)}`);
  assert.equal(f.facts.some((r) => r.startsWith('Project ')), !!pick.project, 'the sheet names the project where the adapter has one, and has no Project fact where it has none');
  assert.ok(!pick.project || f.facts[0] === `Project ${pick.project}`, `the project, in the adapter's word for it: ${JSON.stringify(f.facts)}`);
  assert.ok(!pick.parent || f.facts.some((r) => r === `Part of ${up ? up.title : pick.parent}`), 'the parent it sits under');
  save('sheet', { id: pick.id, status: f.state, head: f.head, withParent: !!pick.parent, withAssignee: !!pick.assignee, withProject: !!pick.project });
  await check('sheet', 'A ticket opens as a sheet over the board: its whole id, its title, where it stands, its project, its assignee, its kind and the ticket it sits under, as the adapter gave them', '.tk-sheet');
  await js(`document.querySelector('.tk-sheet .x').click()`);
  await until(`!document.querySelector('.tk-sheet')`, 'the sheet closes');

  // The adapter's own error: a second board whose adapter cannot read its store shows its code and message with a Retry and no card.
  if (process.env.TICKETS_REAL_BREAK) {
    const [name, ...rest] = process.env.TICKETS_REAL_BREAK.split('='), broken = await serve('broken', { [name]: rest.join('=') });
    await go(broken, '#tickets');
    await until(`/\\b(unavailable|timeout|internal): /.test(document.body.innerText)`, 'the error');
    f = await js(`({ cards: document.querySelectorAll('.tkb-card').length, text: document.querySelector('main')?.innerText ?? document.body.innerText, retry: [...document.querySelectorAll('button')].some((b) => b.textContent === 'Retry' && b.offsetParent) })`);
    assert.equal(f.cards, 0, 'no card stands in for the error'), assert.ok(f.retry, 'Retry is offered');
    save('failure', { cards: f.cards, retry: f.retry });
    await check('failure', 'A store the adapter cannot read shows the adapter\'s own code and message as written with a Retry button, and no tickets', 'main');
  }
  assert.deepEqual(errors, [], 'no page error');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A new board whose tickets live in a real ticket adapter and its own store, read only',
    steps: ['Open Tickets', ...retries.map(() => 'Tap Retry after the first read timed out'), 'Open a ticket', ...(process.env.TICKETS_REAL_BREAK ? ['Open Tickets on a board whose adapter cannot read its store'] : [])],
    result: `At ${width}px${phone ? ' with mobile emulation' : ''}, ${theme}: the board shows ${tickets.length} tickets the adapter listed, in ${expected.length} columns (${expected.map(([n, c]) => `${n} ${c}`).join(', ')}), each card with its own id and project, a ticket's sheet with its whole id, status, project, kind, assignee and parent${process.env.TICKETS_REAL_BREAK ? ', and an unreadable store shows the adapter\'s error with Retry and no cards' : ''}.` }, null, 2));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  for (const b of boards) try { cli('stop', b); } catch {}
  await wait(300);
  rmSync(dir, { recursive: true, force: true });
}
