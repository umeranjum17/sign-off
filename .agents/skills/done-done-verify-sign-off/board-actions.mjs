// One journey over every card kind (evidence, design, plan, signin, ask) on every tab: each action is found and clicked
// in the real board, Dismiss and bulk Select included, at 390 and 1280, light and dark, with done-done's look step on every
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
  // The Dismiss on a card in a list, which a card that is itself a link keeps at its corner.
  const dismissCard = (key) => cycle(`Dismiss ${key}`, card(key) && find(/^Dismiss,/, box(card(key))), () => !card(key), () => card(key), /Dismissed|dismissed/);
  const done = () => ({ missing, did });
  return { missing, did, has, until, board, reader, label, find, card, box, need, toast, back, cycle, nav, press, type, bulk, dismissCard, done, sleep };
}

// Every card kind on every tab, with the actions it must offer. A stage with `shot` is captured and looked at before the next one.
const KEYS = { plan: 'plan-kind-board', signin: 'npm', ask: 'ship', ask2: 'keep-the-weekly-digest', evidence: 'update-1', design: 'look', review: 'chat-journeys', passed: 'update-2', report: 'new-sign-in', answered: 'digest-old' };
const PAGES = [
  { name: 'today', hash: '', ready: '[id="item-update-2"]', stages: [{ run: async (h) => {
    await h.nav('Today row: Need you', h.find(/^Need you, 6$/, h.board(), 'a'), /^#waiting$/);
    for (const [what, href] of [['sign-in', '#decide/npm'], ['ask', '#decide/ship'], ['plan', '#waiting/plan-kind-board'], ['Answered', '#answered'], ['Designs', '#designs'], ['report', '#reports/new-sign-in']]) {
      await h.nav(`Today ${what} link`, h.board().querySelector(`a[href="${href}"]`), new RegExp(`^${href}$`));
    }
    await h.nav('Today passed update', h.card('update-2'), /^#evidence\/update-2$/);
    await h.dismissCard('update-2');
  } }] },
  { name: 'waiting', hash: '#waiting', ready: '[id="item-npm"]', stages: [
    { run: async (h) => {
      const links = { 'plan-kind-board': '#waiting/plan-kind-board', npm: '#decide/npm', ship: '#decide/ship', 'keep-the-weekly-digest': '#decide/keep-the-weekly-digest', look: '#decide/look', 'chat-journeys': '#designs/chat-journeys' };
      // Every row is the link to its ask; Decide groups them Sign in, Answer and Review.
      for (const [key, href] of Object.entries(links)) await h.nav(`open ${key}`, h.card(key), new RegExp(`^${href}$`));
      const heads = () => [...h.board().querySelectorAll('.dl-head')].map((e) => e.firstChild.textContent).join('|');
      h.has('groups Sign in, Answer, Review', heads() === 'Sign in|Answer|Review' && h.board().querySelector('.dl-head'));
      // More: the sort both ways, then Answer all recommended and Move all to Later, each taken back with Undo.
      const more = () => h.board().querySelector('.top .dl-more'), item = (act) => more()?.querySelector(`[data-act="${act}"]`);
      for (const order of ['Newest first', 'Oldest first']) await h.press(`More: ${order === 'Newest first' ? 'Oldest' : 'Newest'} first`, item('sort'), () => item('sort')?.textContent === order);
      await h.cycle('More: Answer all recommended', item('answer-all'), () => !h.card('ship') && !h.card('keep-the-weekly-digest'), () => h.card('ship') && h.card('keep-the-weekly-digest'), /answered with the recommended pick/);
      await h.cycle('More: Move all to Later', item('later-all'), () => [...h.board().querySelectorAll('.dl-head')].every((e) => /^Later/.test(e.textContent)), () => !h.board().querySelector('.g-later'), /to Later/);
    } },
    { run: async (h) => { const m = h.board().querySelector('.top .dl-more'); m.open = true; await h.until('menu', () => m.querySelector('.dl-menu')?.getBoundingClientRect().height); } },
    { shot: 'waiting-menu', run: async (h) => { h.board().querySelector('.top .dl-more').open = false; await h.press('More: Select', h.board().querySelector('.top .dl-more [data-act="select"]'), () => h.find(/^Cancel$/)); h.card('npm').click(); h.card('ship').click(); await h.until('picked', () => h.box(h.card('ship')).classList.contains('picked')); } },
    { shot: 'waiting-select', run: async (h) => {
      await h.press('Cancel', h.find(/^Cancel$/), () => h.board().querySelector('.top .dl-more'));
      await h.press('More: Select again', h.board().querySelector('.top .dl-more [data-act="select"]'), () => h.find(/^Cancel$/));
      await h.press('pick npm', h.card('npm'), () => h.box(h.card('npm')).classList.contains('picked'));
      await h.cycle('Dismiss 1 selected', h.find(/^Dismiss 1$/), () => !h.card('npm'), () => h.card('npm'), /1 dismissed/);
    } },
  ] },
  ...[['npm', 'signin', []], ['ship', 'ask', ['^Friday', '^Next week']], ['look', 'design', ['^A: one column', '^B: two columns']]].map(([key, kind, options]) => ({
    name: `decide-${key}`, hash: `#decide/${key}`, ready: '.decide', stages: [{ data: { options, key, kind }, run: async (h, { options, key, kind }) => {
      const bar = () => h.board().querySelector('.decide-bar');
      if (kind === 'signin') await h.need('Open the npm sign-in', h.find(/^Open the npm sign-in$/, h.board()));
      for (const o of options) await h.press(`option ${o}`, h.find(new RegExp(o), h.board().querySelector('.pick-list, .choices, .decide')), () => true);
      // The first ask has no previous and the last has no next: the pager shows that end as a dimmed mark, not a link.
      const [at, of] = h.board().querySelector('.pager .of').textContent.split(' of ').map(Number);
      for (const [what, end] of [['Previous ask', at === 1], ['Next ask', at === of]]) {
        const step = h.find(new RegExp(`^${what}$`), h.board().querySelector('.pager'), 'a, span.step');
        if (end) h.has(`${what} (dimmed at the end)`, step?.getAttribute('aria-disabled') === 'true' && step); else await h.nav(what, step, /^#decide\//);
      }
      // One Answer button and one More beside it: More holds Ask me later, Write my own answer, Ask for another round and Dismiss.
      h.has('More', bar()?.querySelector('.dl-more > summary'));
      if (options.length) {
        await h.press('Write my own answer', h.find(/^Write my own answer$/, bar()), () => /^Send your answer/.test(bar().querySelector('.answer').textContent));
        await h.press(`option ${options[0]} again`, h.find(new RegExp(options[0]), h.board().querySelector('.pick-list')), () => /^Answer /.test(bar().querySelector('.answer').textContent));
      }
      await h.cycle('Ask me later', h.find(/^Ask me later$/, bar()), () => location.hash === '#waiting' && h.board().querySelector('.g-later'), () => h.board().querySelector('.decide'), /Moved to Later/);
      if (options.length) {
        await h.cycle(`Answer ${key}`, h.find(/^Answer /, bar()), () => location.hash !== `#decide/${key}` || !h.board().querySelector('.decide-bar .answer'), () => h.board().querySelector('.decide-bar .answer'), /Saved/);
      }
      // Another ask opens after a dismiss; the last sign-in leaves its page saying nothing is left to decide.
      await h.cycle(`Dismiss ${key}`, h.find(/^Dismiss,/, bar()), () => location.hash !== `#decide/${key}` || /Nothing to decide/.test(h.board().textContent), () => h.find(/^Dismiss,/, h.board().querySelector('.decide-bar')), /Dismissed/);
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
    await h.nav('Open design', h.find(/^Open design,/), /^#designs\/chat-journeys$/);
    await h.dismissCard('chat-journeys');
    await h.bulk('chat-journeys');
  } }] },
  { name: 'evidence', hash: '#evidence', ready: '[id="item-update-2"]', stages: [{ run: async (h) => {
    await h.nav('Open update', h.card('update-2'), /^#evidence\/update-2$/);
    await h.dismissCard('update-2');
    await h.bulk('update-2');
  } }] },
  // On a desk the update opens in the shell's pane beside the list, which needs no way back; on a phone it opens over the board with ‹ Evidence.
  { name: 'evidence-update', hash: '#evidence/update-2', ready: ':is(#reader, .split-detail) :is(.choices, [aria-label^="Pass"])', stages: [{ run: async (h) => {
    const pane = () => document.querySelector('.split-detail') ?? h.reader(), r = pane();
    for (const verdict of ['Pass', 'Fail', 'Needs work']) {
      await h.cycle(`${verdict} verdict`, h.find(new RegExp(`^${verdict},`), pane()), () => h.find(new RegExp(`^${verdict},`), pane())?.getAttribute('aria-pressed') === 'true', () => true, /Saved/);
    }
    if (r === h.reader()) await h.nav('Back to Evidence', h.find(/Evidence$/, r, 'a'), /^#evidence$/);
    await h.cycle('Dismiss update 2', h.find(/^Dismiss,/, pane()), () => location.hash === '#evidence' || !document.getElementById('err-update-2'), () => h.find(/^Pass,/, pane()), /Dismissed/);
  } }] },
  { name: 'reports', hash: '#reports', ready: '[id="item-new-sign-in"]', stages: [{ run: async (h) => {
    // More: Mark all as read while the report is new, then opening it (which reads it), Select (pick, Dismiss 1, Undo; Cancel) and Archive all, each taken back with Undo.
    const more = () => h.board().querySelector('.top .dl-more'), item = (act) => more()?.querySelector(`[data-act="${act}"]`), bar = () => h.board().querySelector('.bulk');
    // Opening it from Today read it: a finger's swipe right marks it unread again, and its dot comes back.
    const swipe = async (key, dx) => { const f = h.card(key), r = f.getBoundingClientRect(), y = r.top + 30, o = (x) => ({ bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y });
      f.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 40))); for (let i = 1; i <= 8; i++) { await h.sleep(16); f.dispatchEvent(new PointerEvent('pointermove', o(r.left + 40 + dx * i / 8))); } f.dispatchEvent(new PointerEvent('pointerup', o(r.left + 40 + dx))); };
    if (!item('read-all')) { await swipe('new-sign-in', 300); await h.until('swipe right to mark it unread', () => h.box(h.card('new-sign-in'))?.querySelector('.new')); h.did.push('Swipe right: mark unread'); }
    await h.cycle('More: Mark all as read', item('read-all'), () => !h.box(h.card('new-sign-in')).querySelector('.new'), () => h.box(h.card('new-sign-in'))?.querySelector('.new'), /marked read/);
    await h.nav('Open report', h.card('new-sign-in'), /^#reports\/new-sign-in$/);
    await h.press('More: Select', item('select'), () => h.find(/^Cancel$/, bar()));
    await h.press('pick new-sign-in', h.card('new-sign-in'), () => h.box(h.card('new-sign-in')).classList.contains('picked'));
    await h.cycle('Dismiss 1 selected', h.find(/^Dismiss 1$/, bar()), () => !h.card('new-sign-in'), () => h.card('new-sign-in'), /1 dismissed/);
    await h.press('More: Select again', item('select'), () => h.find(/^Cancel$/, bar()));
    await h.press('Cancel', h.find(/^Cancel$/, bar()), () => more());
    await h.cycle('More: Archive all', item('archive-all'), () => !h.card('new-sign-in'), () => h.card('new-sign-in'), /archived/);
  } }] },
  { name: 'report', hash: '#reports/new-sign-in', ready: '#reader iframe', stages: [{ run: async (h) => {
    await h.nav('Back to Reports', h.find(/Reports$/, h.reader(), 'a'), /^#reports$/);
    await h.cycle('Dismiss report', h.find(/^Dismiss,/, h.reader()), () => location.hash === '#reports', () => h.reader().querySelector('iframe'), /Dismissed/);
  } }] },
  { name: 'answered', hash: '#answered', ready: '[id="item-digest-old"]', stages: [{ run: async (h) => {
    const row = h.card('digest-old');
    await h.cycle('Change answer to No', h.find(/^No:/, row), () => h.find(/^No:/, h.card('digest-old'))?.getAttribute('aria-pressed') === 'true', () => true, /Saved/);
    await h.dismissCard('digest-old');
    await h.bulk('digest-old');
  } }] },
  // Last, because these cannot be taken back: a comment, another round, a reply, and the design's own verdict.
  { name: 'messages', hash: '#decide/keep-the-weekly-digest', ready: '.decide', stages: [{ run: async (h) => {
    const other = () => h.board().querySelector('.decide-other'), say = (text) => { const t = other().querySelector('textarea'); t.closest('details').open = true; h.board().querySelector('.decide-bar .dl-more').open = true; h.type(t, text); };
    if (!h.need('Add a comment', other()?.querySelector('summary'))) return;
    say('Keep it short.');
    await h.press('Ask for another round', h.find(/^Ask for another round,/), () => /1 round asked/.test(other().querySelector('summary').textContent));
    say('Keep it short.');
    await h.press('Write my own answer', h.find(/^Write my own answer$/), () => /^Send your answer/.test(h.board().querySelector('.decide-bar .answer').textContent));
    await h.cycle('Send your answer', h.board().querySelector('.decide-bar .answer'), () => location.hash !== '#decide/keep-the-weekly-digest', () => true, /Saved/);
  } }] },
  { name: 'design-review', hash: '#designs/chat-journeys', ready: '#reader .design-review', stages: [
    { shot: 'design-approved', run: async (h) => {
      const r = h.reader(), change = () => [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Change' && !b.closest('dialog')), status = () => r.querySelector('.design-review .eyebrow').textContent;
      h.has('Open full preview', h.find(/^Open full preview$/, r));
      await h.press('Review full screen', h.find(/^Review full screen$/, r), () => r.querySelector('dialog[open]'));
      const viewer = r.querySelector('dialog[open]');
      for (const name of ['Approve screen', 'Request change', 'Previous screen', 'Next screen']) h.has(name, h.find(new RegExp(`^${name}$`), viewer));
      await h.press('Close viewer', h.find(/^Close viewer$/, viewer), () => !r.querySelector('dialog[open]') && change());
      await h.press('Change with no note', change(), () => /Add a note/.test(r.querySelector('.design-review .err').textContent));
      h.type(r.querySelector('.design-review textarea'), 'Tighten the spacing.');
      await h.press('Change', change(), () => status() === 'Changes requested');
      await h.press('Approve', h.find(/^Approve$/, r, 'button'), () => status() === 'Approved');
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
