// One journey over every card kind (evidence, design, plan, signin, ask) on every tab: each action is found and clicked
// in the real board, Discard (with a reason) and bulk Select included, at 390 and 1280, light and dark, with done-done's look step on every
// capture. A missing or disabled action, or a look hit, fails the run.
// Usage: node .agents/skills/done-done-verify-sign-off/board-actions.mjs <output> [light|dark] [390|1280]   (no theme or width: all four cells)
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const cells = [['light', 390], ['dark', 390], ['light', 1280], ['dark', 1280]]
  .filter(([t, w]) => (!process.argv[3] || process.argv[3] === t) && (!process.argv[4] || +process.argv[4] === w));
assert.ok(cells.length, 'theme is light or dark; width is 390 or 1280');
mkdirSync(out, { recursive: true });
// Look records repeat between captures by design, so they stay out of the evidence folder.
const records = join(dirname(out), `${out.split('/').pop()}-diagnostics`);
mkdirSync(records, { recursive: true });
// done-done's own look measurement, from the install that runs this journey.
const dd = dirname(realpathSync(spawnSync('which', ['done-done'], { encoding: 'utf8' }).stdout.trim()));
const { LOOK, SQUASHED_TEXT, lookIssues } = await import(pathToFileURL(join(dd, 'dom.js')));
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options });
  assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout;
};
const session = `so-actions-${process.pid}`;
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: session };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: script });
const evalIn = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn})));`).trim().split('\n').pop());

// Runs in the page. `h` finds an action and fails loudly when it is missing; every action is clicked, and what Undo can take back is taken back.
function helpers(home, readySel) {
  const missing = [], did = [], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (what, fn, ms = 8000) => {
    for (let t = 0; t <= ms; t += 50) { const v = fn(); if (v) return v; await sleep(50); }
    throw new Error(`Timed out waiting for ${what} at ${location.hash || '#'}`);
  };
  const board = () => document.getElementById('board'), reader = () => document.getElementById('reader');
  const label = (e) => e.getAttribute('aria-label') || e.textContent.trim().replace(/\s+/g, ' ');
  const find = (re, root = board(), sel = 'button, a') => [...root.querySelectorAll(sel)].find((e) => re.test(label(e)));
  const card = (key) => board().querySelector(`[id="item-${key}"]`);
  const box = (e) => e.closest('li') ?? e.closest('.has-x, article') ?? e;
  const need = (what, e) => {
    if (!e) missing.push(`${location.hash || '#'}: ${what} is missing`); else if (e.disabled || e.getAttribute('aria-disabled') === 'true') missing.push(`${location.hash || '#'}: ${what} is disabled`); else return e;
  };
  const has = (what, e) => { if (!e) missing.push(`${location.hash || '#'}: ${what} is missing`); return e; };
  const toast = () => (document.getElementById('toast').hidden ? '' : document.getElementById('toast-text').textContent);
  const back = async () => {
    // The app draws on hashchange, which fires after this code yields: wait for it so no later step reads the old page.
    if (location.hash !== home) { const drawn = new Promise((r) => addEventListener('hashchange', r, { once: true })); location.hash = home; await drawn; await sleep(0); }
    await until(`page ${home}`, () => location.hash === home && document.querySelector(readySel));
  };
  // Click a button and wait for what it does; then Undo it when the toast offers it, and wait for the page to be as it was.
  const cycle = async (what, button, gone, restored, say) => {
    const b = need(what, button); if (!b) return;
    b.click();
    await until(`${what} to take effect`, gone);
    await until(`toast "${say}" after ${what}`, () => say.test(toast()));
    await until(`Undo after ${what} to be offered`, () => !document.getElementById('undo').hidden);
    const u = need(`Undo after ${what}`, !document.getElementById('undo').hidden && document.getElementById('undo'));
    if (!u) return;
    u.click();
    await until(`Undo of ${what} to finish`, () => /^(Back|Undone)/.test(toast()));
    await back();
    await until(`${what} undone`, restored);
    did.push(what);
  };
  const nav = async (what, link, hash) => {
    const a = need(what, link); if (!a) return;
    a.click();
    await until(`${what} to open ${hash}`, () => hash.test(location.hash));
    await back(); did.push(what);
  };
  const press = async (what, button, effect) => {
    const b = need(what, button); if (!b) return;
    b.click(); await until(`${what} to take effect`, effect); did.push(what);
  };
  const type = (box, text) => { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); };
  // Select, pick a card, Dismiss it together, Undo; Cancel; Clear all, Undo.
  const bulk = async (key) => {
    const bar = () => board().querySelector('.bulk');
    await press('Select', find(/^Select$/, bar()), () => find(/^Cancel$/, bar()));
    await press(`pick ${key}`, card(key), () => box(card(key)).classList.contains('picked'));
    await cycle('Dismiss 1 selected', find(/^Dismiss 1$/, bar()), () => !card(key), () => card(key), /1 dismissed/);
    await press('Select again', find(/^Select$/, bar()), () => find(/^Cancel$/, bar()));
    await press('Cancel', find(/^Cancel$/, bar()), () => find(/^Select$/, bar()));
    await cycle('Clear all', find(/^Clear all$/, bar()), () => !card(key), () => card(key), /cleared/);
  };
  // Discard opens the sheet of reasons; one tap on a reason discards, and Undo takes it back.
  const discard = async (what, button, gone, restored, reason = 'not-relevant') => {
    const b = need(what, button); if (!b) return;
    b.click();
    await until(`the reasons after ${what}`, () => document.getElementById('dc-sheet')?.open);
    await cycle(what, document.querySelector(`#dc-sheet [data-reason="${reason}"]`), gone, restored, /^Discarded · /);
  };
  // The Discard on a card in a list, which a card that is itself a link keeps at its corner.
  const discardCard = (key) => discard(`Discard ${key}`, card(key) && find(/^Discard,/, box(card(key))), () => !card(key), () => card(key));
  const done = () => ({ missing, did });
  return { missing, did, has, until, board, reader, label, find, card, box, need, toast, back, cycle, discard, nav, press, type, bulk, discardCard, done, sleep };
}

// Every card kind on every tab, with the actions it must offer. A stage with `shot` is captured and looked at before the next one.
const KEYS = { plan: 'plan-kind-board', signin: 'npm', ask: 'ship', ask2: 'keep-the-weekly-digest', evidence: 'update-1', design: 'look', review: 'chat-journeys', passed: 'update-2', report: 'new-sign-in', answered: 'digest-old' };
const PAGES = [
  { name: 'today', hash: '', ready: '.t-up', stages: [{ run: async (h) => {
    // Each tile opens what it counts; Up next's Details opens the sign-in ask; See all opens Decide and a Waiting on you row its ask; More links Answered and Designs.
    await h.nav('Today tile: Cleared today', h.board().querySelector('.t-tiles a[href="#answered"]'), /^#answered$/);
    await h.nav('Today tile: Proofs today', h.board().querySelector('.t-tiles a[href="#evidence"]'), /^#evidence$/);
    await h.nav('Today Up next Details', h.board().querySelector('.t-up a[href="#decide/npm"]'), /^#decide\/npm$/);
    await h.nav('Today See all', h.board().querySelector('.t-wait .see'), /^#waiting$/);
    await h.nav('Today Waiting on you row', h.board().querySelector('.t-wait .ui-row'), /^#(decide|waiting|designs)\/[\w.-]+$/);
    for (const [what, href] of [['Answered', '#answered'], ['Designs', '#designs']]) {
      h.board().querySelector('.t-more-line')?.click();
      await h.nav(`Today More: ${what}`, document.querySelector(`#t-more a[href="${href}"]`), new RegExp(`^${href}$`));
    }
    // Every menu opens its screen from the dock (a phone) or the sidebar (a desk), Inbox among them; Search opens its sheet.
    const shown = (e) => e.getBoundingClientRect().width > 0, entry = (href) => [...document.querySelectorAll('#tabs a, #nav a:not(.sfind)')].find((e) => shown(e) && e.getAttribute('href') === href);
    for (const [what, href] of [['Today', '#'], ['Inbox', '#inbox'], ['Decide', '#waiting'], ['Evidence', '#evidence'], ['Reports', '#reports'], ['Tickets', '#tickets']]) {
      await h.nav(`menu ${what}`, entry(href), new RegExp(`^${href === '#' ? '' : href}$`));
    }
    if (document.querySelector('#nav .sfind') && shown(document.querySelector('#nav'))) await h.nav('menu Designs', entry('#designs'), /^#designs$/);
    await h.press('menu Search', [...document.querySelectorAll('a[href="#find"]')].find(shown), () => document.getElementById('t-search')?.open);
    await h.press('Close Search', document.querySelector('#t-search .x'), () => !document.getElementById('t-search').open);
  } }] },
  // The Inbox, one more menu: a Decide row opens its thread; the thread's own link opens the item (beside the list on a desk, over the thread on a phone). The kind chips
  // filter the list, the two unread filters switch on and off, and the Done entry opens the finished threads.
  { name: 'inbox', hash: '#inbox', ready: '.ib-row', stages: [{ run: async (h) => {
    const row = h.need('Decide row', h.board().querySelector('.ib-sec[aria-label="Decide"] a.ib-row'));
    if (row) { row.click(); await h.until('the Decide row thread', () => /^#inbox\/[\w.~-]+$/.test(location.hash) && h.board().querySelector('.ib-thread .ib-open')); h.did.push('Inbox Decide row'); }
    await h.nav('thread Open the item', h.board().querySelector('.ib-thread .ib-open'), /^#inbox\/[\w.~-]+\/open$/);
    location.hash = '#inbox';
    await h.until('the inbox list', () => !/\/open$/.test(location.hash) && h.board().querySelector('.ib-chip'));
    const chip = (name) => h.find(new RegExp(`^${name}`), h.board(), 'button'), on = (name) => () => h.board().querySelector('.ib-chip[aria-pressed="true"]')?.textContent.startsWith(name);
    await h.press('Decisions chip', chip('Decisions'), on('Decisions'));
    await h.press('All chip', chip('All'), on('All'));
    // The answered digest question was acted on, so its thread is Done: the Done entry opens it. A report the person wrote on is read from its thread.
    location.hash = '#inbox/new-sign-in/open';
    await h.until('the report read', () => /\/open$/.test(location.hash) && h.reader()?.textContent.trim());
    location.hash = '#inbox';
    await h.until('the inbox list again', () => !/\/open$/.test(location.hash) && h.board().querySelector('.ib-chip'));
    // The rail's two unread filters, each on and off again; Agents leads to the read-only Channels room; the Done entry opens the finished threads.
    const flt = (name) => h.find(new RegExp(`^${name}`), h.board(), 'button'), fltOn = (name) => () => h.board().querySelector('.ib-flt[aria-pressed="true"]')?.textContent.startsWith(name), fltOff = () => !h.board().querySelector('.ib-flt[aria-pressed="true"]');
    for (const name of ['Unread from agents', 'Not read by agents']) {
      await h.press(`${name} filter`, flt(name), fltOn(name));
      await h.press(`${name} filter off`, flt(name), fltOff);
    }
    h.need('Agents entry', h.board().querySelector('.ib-agents[href="#channels"]'));
    const done = await h.until('the Done entry', () => h.board().querySelector('.ib-done'));
    await h.press('Done entry', done, () => h.board().querySelector('.ib-sec[aria-label="Done"]'));
  } }] },
  { name: 'waiting', hash: '#waiting', ready: '[id="item-npm"]', stages: [
    { run: async (h) => {
      const links = { 'plan-kind-board': '#waiting/plan-kind-board', npm: '#decide/npm', ship: '#decide/ship', 'keep-the-weekly-digest': '#decide/keep-the-weekly-digest' };
      // Asks hold questions and plans; design picks and reviews stay in Designs.
      for (const [key, href] of Object.entries(links)) await h.nav(`open ${key}`, h.card(key), new RegExp(`^${href}$`));
      h.has('no design pick in Asks', !h.card('look') && h.board());
      h.has('no design review in Decide', !h.card('chat-journeys') && h.board());
      const heads = () => [...h.board().querySelectorAll('.decide-list .ui-sec')].map((e) => e.firstChild.textContent).join('|');
      h.has('Asks, then Answered', heads() === 'Asks|Answered' && h.board().querySelector('.decide-list .ui-sec'));
      await h.nav('open an answered ask', h.board().querySelector('.g-done .dl-face'), /^#decide\/[\w-]+$/);
      // More, the line under the list as Today's: its sheet holds Answer all recommended and Move all to later, each taken back with Undo.
      const item = (act) => { h.board().querySelector('.decide-list .t-more-line')?.click(); return document.querySelector(`#d-more[open] [data-act="${act}"]`); };
      await h.cycle('More: Answer all recommended', item('answer-all'), () => !h.card('ship') && !h.card('keep-the-weekly-digest'), () => h.card('ship') && h.card('keep-the-weekly-digest'), /answered with the recommended pick/);
      await h.cycle('More: Move all to later', item('later-all'), () => heads() === 'Asks|Later|Answered', () => !h.board().querySelector('.dl-row[data-group=later]'), /to later/);
      // More's Select: a row picked, Discard 1 with a reason and Undo; Select all, then Cancel.
      const sel = () => h.board().querySelector('.sel-bar');
      await h.press('More: Select', item('select'), () => sel());
      await h.press('pick ship', h.card('ship'), () => h.box(h.card('ship')).querySelector('.sel-c.on'));
      await h.discard('Discard 1 selected', h.find(/^Discard 1$/, sel()), () => !h.card('ship'), () => h.card('ship'), 'replaced');
      await h.press('More: Select again', item('select'), () => sel());
      await h.press('Select all', h.board().querySelector('.sel-all'), () => /^Discard \d+$/.test(sel().querySelector('.sel-go').textContent));
      await h.press('Cancel', sel().querySelector('.sel-cancel'), () => !sel());
    } },
    { shot: 'waiting-menu', run: async (h) => { h.board().querySelector('.decide-list .t-more-line').click(); await h.until('menu', () => document.querySelector('#d-more[open] .ui-props')?.getBoundingClientRect().height); } },
  ] },
  ...[['npm', 'signin', []], ['ship', 'ask', ['^Friday', '^Next week']], ['look', 'design', ['^A: one column', '^B: two columns']]].map(([key, kind, options]) => ({
    name: `decide-${key}`, hash: `#decide/${key}`, ready: '.decide', stages: [{ data: { options, key, kind }, run: async (h, { options, key, kind }) => {
      const bar = () => h.board().querySelector('.decide-bar'), more = () => h.board().querySelector('.sh-head .dl-more, .split-bar .dl-more');
      if (kind === 'signin') await h.need('Open sign-in, npm', h.find(/^Open sign-in, npm$/, h.board()));
      // Nothing is picked until a pick: the one button waits, off, then names the pick.
      if (options.length) h.has('Pick an answer (off until a pick)', bar()?.querySelector('.answer:disabled'));
      for (const o of options) await h.press(`option ${o}`, h.find(new RegExp(o), h.board().querySelector('.pick-list, .choices, .decide')), () => true);
      // One button in the bar with Ask me later beside it (a sign-in keeps Ask me later in its More), and one More over the ask holding Discard.
      h.has('More', more()?.querySelector('summary'));
      if (options.length) {
        await h.press('Your own answer', h.find(/^Your own answer/, h.board().querySelector('.pick-list')), () => bar().querySelector('.answer').textContent === 'Send answer');
        await h.press(`option ${options[0]} again`, h.find(new RegExp(options[0]), h.board().querySelector('.pick-list')), () => /^Answer /.test(bar().querySelector('.answer').textContent));
      }
      await h.cycle('Ask me later', h.find(/^Ask me later$/, h.board().querySelector('.ask-sheet') ?? (bar()?.querySelector('.later-btn') ? bar() : more())), () => !!h.board().querySelector('.dl-row[data-group=later]'), () => h.board().querySelector('.decide'), /moved to later/);
      if (options.length) {
        await h.press(`option ${options[0]} once more`, h.find(new RegExp(options[0]), h.board().querySelector('.pick-list')), () => /^Answer /.test(bar().querySelector('.answer').textContent));
        await h.cycle(`Answer ${key}`, h.find(/^Answer /, bar()), () => location.hash !== `#decide/${key}` || !h.board().querySelector('.decide-bar .answer'), () => h.board().querySelector('.decide-bar .answer'), /\? · /);
      }
      // Another ask opens after a discard; the last sign-in leaves its page saying nothing is left to decide.
      await h.discard(`Discard ${key}`, h.find(/^Discard,/, more()), () => location.hash !== `#decide/${key}` || /Nothing to decide/.test(h.board().textContent), () => h.find(/^Discard,/, more()));
    } }] })),
  { name: 'plan', hash: '#waiting/plan-kind-board', ready: '.plan-section', stages: [{ run: async (h) => {
    const r = h.reader(), sections = [...r.querySelectorAll('.plan-section')].filter((s) => s.querySelector('.approve'));
    if (!sections.length) h.need('plan section with Approve', null);
    for (const s of sections) {
      await h.press(`Approve ${s.id}`, s.querySelector('.approve'), () => s.querySelector('.approve').textContent.includes('Approved'));
      await h.press(`Change ${s.id}`, s.querySelector('.change'), () => s.querySelector('.change[aria-pressed="true"], .change.on, textarea'));
    }
    h.has('Send back', h.find(/^Send back$/, r)); // disabled until every part is answered, so it is not clicked
    await h.nav('Back to Waiting on you', h.find(/Waiting on you$/, r, 'a'), /^#waiting$/);
  } }] },
  { name: 'designs', hash: '#designs', ready: '[id="item-chat-journeys"]', stages: [{ run: async (h) => {
    await h.nav('Open design pick', h.card('look')?.querySelector('a') ?? h.card('look'), /^#decide\/look$/);
    await h.nav('Open design', h.find(/^(Open design, )?Approve the chat app journeys\?/), /^#designs\/chat-journeys$/);
    // Select and Discard all are in the title row's More; Discard is on the design's own page too. Each Discard asks for a reason and is taken back with Undo.
    const sheet = () => document.getElementById('dz-sheet'), bar = () => h.board().querySelector('.sel-bar');
    const more = async (re) => { await h.press('More', h.board().querySelector('.dz-more'), () => sheet().open); return h.find(re, sheet(), 'button'); };
    await h.press('Select', await more(/^Select$/), () => bar());
    await h.press('pick chat-journeys', h.card('chat-journeys'), () => h.box(h.card('chat-journeys')).querySelector('.sel-c.on'));
    await h.discard('Discard 1 selected', h.find(/^Discard 1$/, bar()), () => !h.card('chat-journeys'), () => h.card('chat-journeys'), 'replaced');
    await h.press('Select again', await more(/^Select$/), () => bar());
    await h.press('Cancel', bar().querySelector('.sel-cancel'), () => !bar());
    await h.discard('Discard all', await more(/^Discard all$/), () => !h.card('chat-journeys'), () => h.card('chat-journeys'));
    location.hash = '#designs/chat-journeys';
    await h.until('the design open', () => h.find(/^Discard,/, document.body, 'button'));
    await h.discard('Discard chat-journeys', h.find(/^Discard,/, document.body, 'button'), () => !h.card('chat-journeys'), () => h.card('chat-journeys'), 'done-elsewhere');
  } }] },
  // A proof's row opens it; Select and Clear all are in the sheet the quiet line under the list opens (Discard is on the proof's own sheet).
  { name: 'evidence', hash: '#evidence', ready: '[id="item-update-2"]', stages: [{ run: async (h) => {
    const bar = () => h.board().querySelector('.bulk'), sheet = () => document.getElementById('sheet');
    const item = async (name) => { h.board().querySelector('.ev-more').click(); await h.until('the Select or clear all sheet', () => sheet().open); return h.find(new RegExp(`^${name}$`), sheet(), 'button'); };
    // On a phone a tap opens the row in place, with Open proof going on to the sheet; on a desk the row itself is the link.
    if (h.card('update-2')?.tagName === 'BUTTON') {
      await h.press('Open update in its row', h.card('update-2'), () => h.card('update-2').getAttribute('aria-expanded') === 'true' && h.find(/^Open proof/, h.board(), 'a'));
      await h.nav('Open proof', h.find(/^Open proof/, h.board(), 'a'), /^#evidence\/update-2$/);
    } else await h.nav('Open update', h.card('update-2'), /^#evidence\/update-2$/);
    await h.press('More: Select', await item('Select'), () => h.find(/^Cancel$/, bar()));
    await h.press('pick update-2', h.card('update-2'), () => h.box(h.card('update-2')).classList.contains('picked'));
    await h.cycle('Dismiss 1 selected', h.find(/^Dismiss 1$/, bar()), () => !h.card('update-2'), () => h.card('update-2'), /1 dismissed/);
    await h.press('More: Select again', await item('Select'), () => h.find(/^Cancel$/, bar()));
    await h.press('Cancel', h.find(/^Cancel$/, bar()), () => h.board().querySelector('.ev-more'));
    await h.cycle('More: Clear all', await item('Clear all'), () => !h.card('update-2'), () => h.card('update-2'), /cleared/);
  } }] },
  // On a desk the update opens in the shell's pane beside the list, which needs no way back; on a phone it opens as a sheet over the list with its Close.
  { name: 'evidence-update', hash: '#evidence/update-2', ready: ':is(#reader, .split-detail) :is(.choices, [aria-label^="Pass"])', stages: [{ run: async (h) => {
    const pane = () => document.querySelector('.split-detail') ?? h.reader(), r = pane();
    for (const verdict of ['Pass', 'Fail', 'Needs work']) {
      await h.cycle(`${verdict} verdict`, h.find(new RegExp(`^${verdict},`), pane()), () => h.find(new RegExp(`^${verdict},`), pane())?.getAttribute('aria-pressed') === 'true', () => true, / · /);
    }
    if (r === h.reader()) await h.nav('Close the proof', h.find(/^Close$/, r, 'a'), /^#evidence$/);
    await h.discard('Discard update 2', h.find(/^Discard,/, pane()), () => location.hash === '#evidence' || !document.getElementById('err-update-2'), () => h.find(/^Pass,/, pane()));
  } }] },
  { name: 'reports', hash: '#reports', ready: '[id="item-new-sign-in"]', stages: [{ run: async (h) => {
    // More (the quiet line under the list, opening a sheet): Mark all as read while the report is new, then opening it (which reads it), Select (pick, Dismiss 1, Undo; Cancel)
    // and Archive all, each taken back with Undo.
    const more = () => h.board().querySelector('.rp-more-line'), bar = () => h.board().querySelector('.bulk');
    const item = async (act) => { more().click(); await h.until('the More sheet', () => document.getElementById('rp-more').open); return document.querySelector(`#rp-more [data-act="${act}"]`); };
    const isNew = () => h.box(h.card('new-sign-in'))?.querySelector('.pct')?.textContent === '0%';
    // Opening it from Today read it: a finger's swipe right marks it unread again, and its bar empties.
    const swipe = async (key, dx) => { const f = h.card(key), r = f.getBoundingClientRect(), y = r.top + 30, o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y });
      f.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 40))); for (let i = 1; i <= 8; i++) { await h.sleep(16); f.dispatchEvent(new PointerEvent('pointermove', o(r.left + 40 + dx * i / 8))); } f.dispatchEvent(new PointerEvent('pointerup', o(r.left + 40 + dx))); };
    if (!more()?.textContent.includes('Mark all as read')) { await swipe('new-sign-in', 300); await h.until('swipe right to mark it unread', isNew); h.did.push('Swipe right: mark unread'); }
    await h.cycle('More: Mark all as read', await item('read-all'), () => !isNew(), isNew, /marked read/);
    await h.nav('Open report', h.card('new-sign-in'), /^#reports\/new-sign-in$/);
    await h.press('More: Select', await item('select'), () => h.find(/^Cancel$/, bar()));
    await h.press('pick new-sign-in', h.card('new-sign-in'), () => h.box(h.card('new-sign-in')).classList.contains('picked'));
    await h.cycle('Dismiss 1 selected', h.find(/^Dismiss 1$/, bar()), () => !h.card('new-sign-in'), () => h.card('new-sign-in'), /1 dismissed/);
    await h.press('More: Select again', await item('select'), () => h.find(/^Cancel$/, bar()));
    await h.press('Cancel', h.find(/^Cancel$/, bar()), () => more());
    await h.cycle('More: Archive all', await item('archive-all'), () => !h.card('new-sign-in'), () => h.card('new-sign-in'), /archived/);
  } }] },
  // On a phone a report opens in a sheet over the list with Close and Discard; on a desk it reads beside the list, with Mark read or unread and Archive in its bar.
  { name: 'report', hash: '#reports/new-sign-in', ready: '#reader iframe, .split-detail .read iframe', stages: [{ run: async (h) => {
    const bar = h.board().querySelector('.rp-bar'), dot = () => h.box(h.card('new-sign-in'))?.querySelector('.pct')?.textContent === '0%';
    if (bar) {
      await h.cycle('Mark unread', h.find(/^Mark unread$/, bar), dot, () => !dot(), /Marked unread/);
      await h.cycle('Archive report', h.find(/^Archive$/, bar), () => !h.card('new-sign-in'), () => h.card('new-sign-in'), /Archived/);
      return;
    }
    await h.nav('Close the report', h.find(/^Close$/, h.reader(), 'a'), /^#reports$/);
    await h.discard('Discard report', h.find(/^Discard,/, h.reader()), () => location.hash === '#reports', () => h.reader().querySelector('iframe'));
  } }] },
  { name: 'answered', hash: '#answered', ready: '[id="item-digest-old"]', stages: [{ run: async (h) => {
    const row = h.card('digest-old');
    await h.cycle('Change answer to No', h.find(/^No:/, row), () => h.find(/^No:/, h.card('digest-old'))?.getAttribute('aria-pressed') === 'true', () => true, / · /);
    await h.discardCard('digest-old');
    await h.bulk('digest-old');
  } }] },
  // Last, because these cannot be taken back: a note with a pick, an answer in your own words, and the design's own verdict.
  { name: 'messages', hash: '#decide/keep-the-weekly-digest', ready: '.decide', stages: [{ run: async (h) => {
    const page = () => h.board().querySelector('.decide'), answer = () => page().querySelector('.decide-bar .answer');
    if (!h.need('Note', page()?.querySelector('.note-box'))) return;
    h.type(page().querySelector('.note-box'), 'Keep it short.');
    await h.press('Your own answer', h.find(/^Your own answer/, page().querySelector('.pick-list')), () => answer().textContent === 'Send answer' && answer().disabled);
    h.type(page().querySelector('.own-box'), 'Keep it, but send it on Mondays.');
    await h.cycle('Send answer', answer(), () => location.hash !== '#decide/keep-the-weekly-digest', () => true, /your reply/);
  } }] },
  { name: 'design-review', hash: '#designs/chat-journeys', ready: '.design-review [data-design]', stages: [
    { shot: 'design-approved', run: async (h) => {
      // The review: in the reader on a phone, beside where it stands on a desk; a save draws it again, so each step finds it anew.
      const r = () => document.querySelector('.design-review'), viewer = () => document.querySelector('.design-viewer[open]');
      const change = () => [...r().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Change'), status = () => r().querySelector('[role=status]').textContent;
      h.has('Open full preview', h.find(/^Open full preview$/, r()));
      await h.press('Review full screen', h.find(/^Review full screen$/, r()), viewer);
      for (const name of ['Approve screen', 'Request change', 'Previous screen', 'Next screen']) h.has(name, h.find(new RegExp(`^${name}$`), viewer()));
      await h.press('Close viewer', h.find(/^Close viewer$/, viewer()), () => !viewer() && change());
      await h.press('Change with no note', change(), () => /Add a note/.test(r().querySelector('.err').textContent));
      h.type(r().querySelector('textarea'), 'Tighten the spacing.');
      await h.press('Change', change(), () => status() === 'Changes requested');
      await h.press('Approve', h.find(/^Approve$/, r(), 'button'), () => status() === 'Approved');
    } },
  ] },
];

const cliLook = async (base) => {
  // done-done's look step itself: a fresh headless phone page per URL, light, 390 wide. A hit exits 1 and fails the journey.
  for (const p of PAGES) run('done-done', ['look', `${base}${p.hash || '#'}`, '--out', join(out, `look.${p.name}.png`)]);
};

const dir = mkdtempSync(join(tmpdir(), 'so-actions-'));
const failures = [];
let first = true;
try {
  for (const [theme, width] of cells) {
    const home = join(dir, `${theme}-${width}`);
    mkdirSync(home);
    const base = run('bash', [resolve('.agents/skills/done-done-verify-sign-off/seed-board.sh'), home], { env: { ...process.env, SEED_SERVE_SECONDS: '900' } }).trim().split('\n').pop();
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/$/, base);
    // The Inbox holds the threads the person took part in, so the seed becomes a conversation first: they write on the ask that waits in Decide and on the report,
    // and the answered digest question is acted on by its agent, which archives that thread.
    const sent = (body) => fetch(`${base}api/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => assert.equal(r.status, 200));
    await sent({ kind: 'comment', key: KEYS.ask, text: 'Can QA confirm first?' });
    await sent({ kind: 'comment', key: KEYS.report, text: 'Does this cover the code step?' });
    const cli = { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: `${home}/.config`, XDG_DATA_HOME: `${home}/.local/share`, XDG_STATE_HOME: `${home}/.local/state`, XDG_CACHE_HOME: `${home}/.cache` } };
    run('node', ['dist/cli.js', 'wait', join(home, 'board.json'), '--filer', 'verify', '--timeout', '5'], cli);
    await new Promise((r) => setTimeout(r, 1100));
    run('node', ['dist/cli.js', 'feedback', KEYS.answered, join(home, 'board.json'), '--acted', '--link', 'https://example.com/pr/9', '--filer', 'verify'], cli);
    // The person opened that reply, so Today shows no Replies section ahead of its Waiting on you rows.
    assert.equal((await fetch(`${base}api/trail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEYS.answered }) })).status, 200);
    try {
      if (first) { await cliLook(base); first = false; }
      // A capture and its look: the page as a user sees it, measured by done-done's own look code.
      const capture = (name, keepToast = false) => {
        // Still: the last step's toast gone and every transition done, so the shot and the measurement see the settled page.
        evalIn(`async () => { for (let i = 0; i < 120 && ((!${keepToast} && !document.getElementById('toast').hidden) || document.getAnimations().length); i++) await new Promise((r) => setTimeout(r, 50)); return true; }`);
        const stem = `${name}.${theme}.${width}w`;
        browser('screenshot', join(out, `${stem}.png`));
        const look = evalIn(`async () => ({ url: location.href, ...(${LOOK})(), squashed_text: (${SQUASHED_TEXT})() })`);
        writeFileSync(join(records, `${stem}.dom.json`), JSON.stringify(look));
        failures.push(...lookIssues(look).map((m) => `${theme} ${width}w look: ${m}`));
      };
      browser('open', base); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1', '--color-scheme', theme);
      for (const page of PAGES) {
        browser('open', `${base}${page.hash || '#'}`);
        drive(`for (let i = 0; i < 100; i++) { if (await page.eval(${JSON.stringify(`!!document.querySelector(${JSON.stringify(page.ready)})`)})) break; await new Promise((r) => setTimeout(r, 100)); }`);
        capture(page.name);
        for (const [i, stage] of page.stages.entries()) {
          const src = `async () => { const h = (${helpers})(${JSON.stringify(page.hash)}, ${JSON.stringify(page.ready)}); try { await (${stage.run})(h, ${JSON.stringify(stage.data ?? null)}); } catch (e) { h.missing.push(location.hash + ': ' + e.message); } return h.done(); }`;
          const r = evalIn(src);
          console.log(`${theme} ${width}w ${page.name}${i ? `/${i}` : ''}: ${r.did.length} clicked${r.missing.length ? `, ${r.missing.length} MISSING` : ''}`);
          failures.push(...r.missing.map((m) => `${theme} ${width}w ${m}`));
          if (stage.shot) capture(stage.shot, /toast/.test(stage.shot));
        }
      }
    } finally {
      try { process.kill(+readFileSync(join(home, 'serve.pid'), 'utf8')); } catch {}
    }
  }
} finally {
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
console.log(`board-actions: ${cells.length} cells, every action found and clicked, no look hit`);
