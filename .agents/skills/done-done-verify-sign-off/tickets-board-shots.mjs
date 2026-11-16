// The Tickets board over a ticket adapter, driven in a headless Chromium of its own over the DevTools protocol with exact device metrics (390x844 with mobile emulation, and 1440x900),
// on a throwaway board and the repo's stand-in adapter: one column per status the backend lists (its own words made readable by one rule, its own order, and two statuses its `describe` does not list), a card for each
// ticket with the backend's own id under the title (a long hash id shortened in the middle on the card), a phone's tabs, a ticket's sheet with its whole id and the copy button (the text
// that lands on the clipboard is read back), a ticket the list does not carry, a failed read (the adapter's code and message, no cards) and a list that is not whole (incomplete, no cards).
// DEMO_PAGE=<the option-2 demo's html> also captures the demo in the same frame beside each capture, side by side in one image, so the build is looked at against what was approved.
// Usage: node tickets-board-shots.mjs <evidence folder> [light|dark] [390|1440]   (no theme or width: all four combinations, one run each)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { lint } from '../../../test/support/layout-lint.mjs';
const out = resolve(process.argv[2]), repo = process.cwd();
mkdirSync(out, { recursive: true });
if (!process.argv[3]) {
  // TICKETS_CELLS=light:390,dark:1440 runs only those cells (a sealed run's judge reads a limited number of captures); the default is all four.
  const cells = (process.env.TICKETS_CELLS ?? 'light:390,light:1440,dark:390,dark:1440').split(',').map((c) => c.split(':'));
  const each = cells.map(([theme, width]) => {
    const r = spawnSync(process.execPath, [process.argv[1], out, theme, String(width)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    renameSync(join(out, 'steps.json'), join(out, `steps.${theme}.${width}.json`));
    return JSON.parse(readFileSync(join(out, `steps.${theme}.${width}.json`), 'utf8'));
  });
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: each[0].target, start: each[0].start, steps: each[0].steps, result: each[0].result }, null, 2) + '\n');
  process.exit(0);
}
const theme = process.argv[3], width = +process.argv[4], phone = width < 1024, height = phone ? 844 : 900, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dir = mkdtempSync(join(tmpdir(), 'so-tk-board-')), board = join(dir, 'board.json'), support = join(repo, 'test/support'), prof = join(dir, 'chrome');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir,
  SIGN_OFF_TICKETS_ADAPTER: join(support, 'ticket-adapter-standin.mjs'), TICKET_STANDIN_DIR: dir };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const fault = (mode) => execFileSync(process.execPath, [join(support, 'ticket-adapter-standin-faults.mjs'), mode], { env });
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], steps = [];

/** The backend's tickets, as it holds them: ids of every length the real source gives (a short one, and a long hash one), the three statuses it lists and two it does not (one a hyphenated word, one with an underscore), and who has each. */
const LONG = 'jg-9840b11cf1f3116b33e2ef5cfbea241f';
const MIN = 60_000, seed = () => {
  const now = Date.now(), at = (ago) => new Date(now - ago).toISOString().replace(/\.\d+Z$/, 'Z');
  const rows = [
    ['jg-y1di', 'Make the Tickets screen calm: four soft columns, borderless cards, one sheet', 'kind-a', 'stage-2', 'Umer', null, 190 * MIN, 'The captain picked option 2.\n\n- every card shows the ticket number\n- the sheet copies it'],
    ['jg-z4xm', 'Tickets screen as option 2', 'kind-b', 'stage-2', 'Sam', 'jg-y1di', 14 * MIN, ''],
    ['jg-0byx', 'Show the real error when the ticket list cannot be read', 'kind-b', 'stage-2', 'Umer', 'jg-y1di', 52 * MIN, ''],
    [LONG, 'Make a ticket, pick its epic and assignee, group by epic, and see who moved a ticket on the Tickets screens', 'kind-b', 'stage-1', null, 'jg-y1di', 26 * 60 * MIN, 'A long hash id: the card shortens it in the middle, the sheet shows it whole.'],
    ['jg-k3x9', 'Keep the old settings link for a week', 'kind-b', 'stage-1', null, null, 5 * 60 * MIN, ''],
    ['jg-7q2m', 'Rename the export button to Download', 'kind-b', 'stage-1', 'Sam', null, 2 * 24 * 60 * MIN, ''],
    ['jg-m8c1', 'Sort the inbox by hand', 'kind-b', 'stage-1', 'Sam', null, 3 * 60 * MIN, ''],
    ['jg-p5d6', 'Write the release note for 0.10.4', 'kind-a', 'stage-1', 'Umer', null, 9 * MIN, ''],
    ['jg-h2v4', 'Check the save twice on a slow network', 'kind-b', 'stage-1', null, null, 40 * 60 * MIN, ''],
    ['jg-r6n0', 'Move the export to its own page', 'kind-b', 'stage-3', 'Umer', null, 6 * 60 * MIN, ''],
    ['jg-t1w8', 'Publish the plan reader', 'kind-a', 'stage-3', 'Sam', null, 20 * MIN, ''],
    ['jg-c9f3', 'Fix the sheet that opens behind the dock', 'kind-b', 'stage-3', 'Umer', null, 2 * 60 * MIN, ''],
    ['jg-e4b7', 'Wait for the vendor to answer the sign-in question', 'kind-b', 'stage-4', 'Sam', null, 30 * 60 * MIN, ''],
    ['jg-w6s5', 'Hold the export until the vendor answers', 'kind-b', 'on_hold', null, null, 4 * 60 * MIN, ''],
  ];
  const tickets = rows.map(([id, title, kind, status, assignee, parent, ago, body], i) => ({ id, rev: `r-${i + 1}`, title, body, kind, status, assignee, labels: id === 'jg-z4xm' ? ['captain-ask'] : [], parent, links: [],
    created_at: at(ago + 3 * 60 * MIN), updated_at: at(ago), extra: id === 'jg-z4xm' ? { estimate: '3' } : {} }));
  const events = { 'jg-z4xm': [
    { id: 'e-1', at: at(3 * 60 * MIN + 14 * MIN), actor: 'Sam', type: 'created', text: null, changes: [], extra: {} },
    { id: 'e-2', at: at(2 * 60 * MIN), actor: 'Sam', type: 'changed', text: null, changes: [{ field: 'status', from: 'stage-1', to: 'stage-2' }], extra: {} },
    { id: 'e-3', at: at(14 * MIN), actor: 'Umer', type: 'comment', text: 'I like option 2.', changes: [], extra: {} }] };
  writeFileSync(join(dir, 'store.json'), JSON.stringify({ counter: rows.length, tickets, events, ops: {} }));
};

try {
  // The board itself (a card, so the board file exists), then the backend's tickets.
  cli('raise', board, '--title', 'Ship the settings page on Friday?', '--why', 'The page is ready.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'Every check passed.', '--default', 'no', '--ask-ref', 'message-test', '--ticket', 'jg-z4xm');
  seed();
  const log = openSync(join(dir, 'serve.out'), 'w');
  spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--bind', '127.0.0.1', '--port', '0'], { env, detached: true, stdio: ['ignore', log, log] }).unref();
  let base;
  for (let i = 0; i < 60 && !base; i++) { await wait(250); base = /url: "(http:\/\/[^"]+)"/.exec(readFileSync(join(dir, 'serve.out'), 'utf8'))?.[1]; }
  assert.ok(base, 'the board is served');
  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  /** One DevTools session on a page of this Chromium: `cdp` sends a command, `js` runs an expression in the page and answers its value. */
  const connect = async (target, faults = [], view = { width, height, deviceScaleFactor: 2, mobile: phone }) => {
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, no) => { sock.onopen = ok; sock.onerror = no; });
    let id = 0; const pending = new Map();
    sock.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
      if (x.method === 'Runtime.exceptionThrown') faults.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception'); };
    const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); sock.send(JSON.stringify({ id: n, method, params })); });
    const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', view);
    await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    return { cdp, js, sock };
  };
  const open = async () => (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const main = await connect(await open(), errors), { cdp, js } = main;
  ws = main.sock;
  const until = async (expression, what) => { for (let i = 0; i < 80; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`); };
  // The copy button is checked against the real clipboard: the page may write it and the run may read it back.
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  const browser = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
  await new Promise((ok, no) => { browser.onopen = ok; browser.onerror = no; });
  browser.send(JSON.stringify({ id: 1, method: 'Browser.grantPermissions', params: { origin: new URL(base).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] } }));
  // A sealed run's judge reads at most `judge.max_captures` frames, the Designs one among them: each cell keeps its board, a ticket's sheet, Copied and a failed read. The phone's tab, a ticket's
  // history and an incomplete list are asserted in every run and their frames are written too when TICKETS_FRAMES=all.
  const more = process.env.TICKETS_FRAMES === 'all';
  const png = async (name, say, optional) => { if (optional && !more) return; await wait(400); writeFileSync(join(out, `${name}.${theme}.${width}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64')); steps.push(`${name}: ${say}`); };
  const go = async (hash) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: base + hash }); await wait(600); };
  const save = (name, value) => writeFileSync(join(out, `${name}.${theme}.${width}.json`), JSON.stringify(value));
  /** A capture is taken only when the board's own layout lint finds nothing in the frame it shows. */
  const check = async (name, say, scope = 'body', optional) => { const faults = await js(lint(scope)); assert.deepEqual(faults, [], `layout faults on ${name}: ${JSON.stringify(faults)}`); await png(name, say, optional); };
  /** With DEMO_PAGE set, the approved demo is opened in a page of its own at this size and theme, in the same state (its board, or its first card opened), and its frame is put beside the build's in one image. */
  const side = async (name) => {
    if (!process.env.DEMO_PAGE) return;
    const d = await connect(await open());
    await d.cdp('Page.navigate', { url: pathToFileURL(resolve(process.env.DEMO_PAGE)).href }); await wait(800);
    if (name === 'sheet') { await d.js(`document.querySelector('.card').click()`); await wait(600); }
    const demoFile = join(out, `demo-${name}.${theme}.${width}.png`);
    writeFileSync(demoFile, Buffer.from((await d.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    d.sock.close();
    const html = join(dir, 'side.html'), built = join(out, `${name}.${theme}.${width}.png`);
    writeFileSync(html, `<meta charset="utf-8"><style>body{margin:0;display:flex;gap:24px;padding:16px;background:#7a7d86;color:#fff;font:600 14px system-ui}figure{margin:0}figcaption{padding:0 0 8px}img{display:block;width:${width}px;height:${height}px}</style>`
      + `<figure><figcaption>Option 2 demo</figcaption><img src="${pathToFileURL(demoFile).href}"></figure><figure><figcaption>Built in sign-off</figcaption><img src="${pathToFileURL(built).href}"></figure>`);
    const c = await connect(await open(), [], { width: 2 * width + 24 + 32, height: height + 60, deviceScaleFactor: 1, mobile: false });
    await c.cdp('Page.navigate', { url: pathToFileURL(html).href }); await wait(600);
    writeFileSync(join(out, `side-${name}.${theme}.${width}.png`), Buffer.from((await c.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    c.sock.close();
  };
  const button = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(text)} && b.offsetParent)`;
  const page = () => js(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, cards: document.querySelectorAll('.tkb-card').length, text: document.body.innerText })`);
  fault('none');

  // The board: a column for each status the backend lists, then the two it does not list, each word made readable by the board's one rule; every card names its ticket's own id.
  await go('#tickets');
  await until(`document.querySelectorAll('.tkb-card').length >= 14`, 'the cards');
  let f = await js(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, sum: document.querySelector('.tkb-top .sum')?.textContent ?? null,
    cols: [...document.querySelectorAll('.tkb-col')].map((c) => [c.getAttribute('aria-label'), c.querySelectorAll('.tkb-card').length]),
    cards: [...document.querySelectorAll('.tkb-card')].map((c) => ({ id: c.getAttribute('href').slice(8), shown: c.querySelector('.id').textContent, title: c.querySelector('.t').textContent, label: c.getAttribute('aria-label') })) })`);
  assert.equal(f.width, width), assert.equal(f.overflow, false, 'no sideways overflow');
  assert.deepEqual(f.cols, [['Stage 1', 6], ['Stage 2', 3], ['Stage 3', 3], ['Stage 4', 1], ['On hold', 1]], 'a column for each status, in the order the backend lists them, the unlisted ones last, each word made readable by the one rule (stage-1 is Stage 1, on_hold is On hold)');
  assert.ok(phone || f.sum === '14 in all', `the count ${f.sum}`);
  for (const c of f.cards) assert.ok(c.id === c.shown || (c.id.length > 22 && c.shown === `${c.id.slice(0, 15)}…${c.id.slice(-4)}`), `the card shows the ticket's own id: ${JSON.stringify(c)}`);
  const long = f.cards.find((c) => c.id === LONG);
  assert.equal(long.shown, `${LONG.slice(0, 15)}…${LONG.slice(-4)}`), assert.match(long.label, new RegExp(LONG), 'its whole id is still in what a screen reader says');
  save('board', f);
  await check('board', 'Tickets is one column for each status the backend lists, its own words in its own order, and each card has the ticket\'s own id under its title', '.tkb');
  await side('board');
  if (phone) {
    // A phone has one column in view and a tab for each: a tap on a tab brings its column in view and the tab says its name.
    await js(`document.querySelector('.tkb-tab[data-tab="2"]').click()`);
    await until(`document.querySelector('.tkb-tab[aria-selected="true"]')?.dataset.tab === '2' && Math.abs(document.querySelector('.tkb-board').scrollLeft - 2 * document.querySelector('.tkb-board').clientWidth) < 2`, 'the third column in view');
    f = await js(`({ selected: document.querySelector('.tkb-tab[aria-selected="true"] .w').textContent, tabs: [...document.querySelectorAll('.tkb-tab')].map((t) => t.innerText.replace(/\\s+/g, ' ').trim()) })`);
    assert.equal(f.selected, 'Stage 3');
    save('tab', f);
    await check('tab', 'On a phone a tap on a tab brings that column in view, and the tab in view says its name', '.tkb', true);
    await js(`document.querySelector('.tkb-tab[data-tab="0"]').click()`);
    await until(`document.querySelector('.tkb-board').scrollLeft < 2`, 'the first column back in view');
  }

  // A ticket's sheet: its whole id first, then its title and where it stands, who has it, and its history; the open card is marked.
  await js(`document.querySelector('.tkb-card[href="#ticket/${LONG}"]').click()`);
  await until(`!!document.querySelector('.tk-sheet .tkb-id')`, 'the sheet');
  await until(`!!document.querySelector('.tk-sheet .tkb-life, .tk-sheet .tk-note, .tk-sheet .es')`, 'the history read');
  await wait(500);
  f = await js(`({ chip: document.querySelector('.tkb-id code').textContent, copyWord: document.querySelector('.tkb-id span').textContent, title: document.querySelector('.tk-sheet .tk-dt').textContent,
    state: document.querySelector('.tkb-state').innerText.trim(), facts: [...document.querySelectorAll('.tkb-facts > div')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()), hash: location.hash,
    current: document.querySelector('.tkb-card[aria-current]')?.getAttribute('href'), rect: (() => { const r = document.querySelector('.tk-sheet').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })() })`);
  assert.equal(f.chip, LONG, 'the sheet shows the whole id'), assert.equal(f.copyWord, 'Copy'), assert.equal(f.hash, `#ticket/${LONG}`), assert.equal(f.current, `#ticket/${LONG}`, 'the open ticket\'s card is marked');
  assert.ok(f.facts.some((r) => r.startsWith('Assignee') && r.includes('Unassigned')) && f.facts.some((r) => r.startsWith('Part of') && r.includes('Make the Tickets screen calm')), `the facts ${JSON.stringify(f.facts)}`);
  assert.equal(phone ? Math.round(f.rect.bottom) : Math.round(f.rect.right), phone ? height : width, 'the sheet rises from the foot on a phone and from the right edge on a desk');
  save('sheet', f);
  await check('sheet', 'A ticket opens as a sheet over the board (from the foot on a phone, from the right edge on a desk) with its whole id, a Copy button, its title, where it stands and who has it', '.tk-sheet');
  await side('sheet');
  // The copy button puts the whole id on the clipboard and says Copied.
  await js(`document.querySelector('.tkb-id').click()`);
  await until(`document.querySelector('.tkb-id span').textContent === 'Copied'`, 'Copied');
  const copied = await js(`navigator.clipboard.readText()`);
  assert.equal(copied, LONG, 'the text on the clipboard is the ticket\'s whole id');
  save('copy', { clipboard: copied, word: await js(`document.querySelector('.tkb-id span').textContent`) });
  // It says Copied for a moment and then Copy again by itself; for the frame the page's own 1.6 s timer is held, so a slow screenshot cannot catch the word after it went back.
  await until(`document.querySelector('.tkb-id span').textContent === 'Copy'`, 'Copy again');
  await js(`(() => { window.__timeout = window.setTimeout; window.setTimeout = (f, ms, ...a) => (ms === 1600 ? 0 : window.__timeout(f, ms, ...a)); })()`);
  await js(`document.querySelector('.tkb-id').click()`);
  await until(`document.querySelector('.tkb-id span').textContent === 'Copied'`, 'Copied again');
  assert.equal(await js(`navigator.clipboard.readText()`), LONG, 'the clipboard still holds the whole id');
  await png('copied', 'Copy says Copied once the whole id is on the clipboard (read back from it)');
  assert.equal(await js(`document.querySelector('.tkb-id span').textContent`), 'Copied', 'the frame was taken while the chip says Copied');
  await js(`window.setTimeout = window.__timeout`);
  // A ticket with a history and a field the page has never heard of.
  await js(`document.querySelector('.tk-sheet .x').click()`);
  await until(`!document.querySelector('.tk-sheet')`, 'the sheet closes');
  await js(`document.querySelector('.tkb-card[href="#ticket/jg-z4xm"]').click()`);
  await until(`!!document.querySelector('.tk-sheet .tkb-life')`, 'the history');
  f = await js(`({ life: [...document.querySelectorAll('.tkb-life li')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()), more: [...document.querySelectorAll('.tk-more-fields .ui-pr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()) })`);
  assert.equal(f.life.length, 3), assert.ok(f.life[2].startsWith('comment by Umer') && f.life[2].includes('I like option 2.'), `the history ${JSON.stringify(f.life)}`);
  assert.ok(f.more.some((m) => m.includes('estimate') && m.endsWith('3')), `More fields ${JSON.stringify(f.more)}`);
  save('history', f);
  await js(`document.querySelector('.tk-sheet').scrollTo(0, 99999)`);
  await check('history', 'The sheet\'s history is the events the backend recorded, oldest first, each with who and when, the latest marked', '.tk-sheet', true);
  await js(`document.querySelector('.tk-sheet .x').click()`);
  await until(`!document.querySelector('.tk-sheet')`, 'the sheet closes');
  // Escape closes it too, and an address no list carries opens a sheet that says so.
  await go('#ticket/jg-gone');
  await until(`!!document.querySelector('.tk-sheet') && document.querySelector('.tk-sheet').innerText.includes('Ticket not found')`, 'Ticket not found');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await until(`!document.querySelector('.tk-sheet') && location.hash === '#tickets'`, 'Escape closes the sheet');

  // A read that fails: the adapter's code and message, a Retry, and no cards.
  fault('unreadable');
  await go('#tickets');
  await until(`document.body.innerText.includes('unavailable:')`, 'the error');
  f = await page();
  assert.equal(f.cards, 0, 'no card stands in for the error'), assert.match(f.text, /unavailable: The stand-in store cannot be read\./), assert.match(f.text, /Retry/);
  save('failure', f);
  await png('failure', 'A failed read shows the adapter\'s code and message as written with a Retry button, and no tickets');
  // A list that cannot be whole: incomplete, never the part of it that could be read.
  fault('partial');
  await js(`${button('Retry')}.click()`);
  await until(`document.body.innerText.includes('incomplete:')`, 'incomplete');
  f = await page();
  assert.equal(f.cards, 0, 'a partial list is never shown'), assert.match(f.text, /incomplete: /);
  save('incomplete', f);
  await png('incomplete', 'A list that is not whole shows incomplete with the adapter\'s message and Retry, never the tickets that could be read', true);
  fault('none');
  await js(`${button('Retry')}.click()`);
  await until(`document.querySelectorAll('.tkb-card').length >= 14`, 'the board after Retry');
  assert.deepEqual(errors, [], 'no page error');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A new board whose tickets live in the repo\'s stand-in ticket adapter: fourteen tickets in the three statuses it lists and two it does not, with short ids and one long hash id, an epic, and two people',
    steps: ['Open Tickets', phone ? 'Tap the third column\'s tab' : 'Look across the columns', 'Open the ticket with the long id', 'Tap its id to copy it', 'Open a ticket with history', 'Open an address no list carries and press Escape', 'Make the backend unreadable and open Tickets', 'Make it readable only in part and press Retry', 'Make it readable again and press Retry'],
    result: `At ${width}px${phone ? ' with mobile emulation' : ''}, ${theme}: Tickets is a column for each status the backend lists, each card shows the ticket's own id, a ticket opens as a sheet with its whole id and a Copy button that puts exactly that on the clipboard, an unreadable backend shows the adapter's code and message with Retry and no cards, and a partial list shows incomplete and no cards.` }, null, 2));
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { cli('stop', board); } catch {}
  await wait(300);
  rmSync(dir, { recursive: true, force: true });
}
