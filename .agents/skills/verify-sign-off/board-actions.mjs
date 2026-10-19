// One journey over every card kind (evidence, design, plan, signin, ask) on every tab: each action is found and clicked
// in the real board, Dismiss and bulk Select included, at 390 and 1280, light and dark, with done-done's look step on every
// capture. A missing or disabled action, or a look hit, fails the run.
// Usage: node .agents/skills/verify-sign-off/board-actions.mjs <output> [light|dark] [390|1280]   (no theme or width: all four cells)
import { spawn, spawnSync } from 'node:child_process';
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
const WAITING = Object.values(KEYS).slice(0, 7);
const PAGES = [
  { name: 'today', hash: '', ready: '[id="item-update-2"]', stages: [{ run: async (h) => {
    await h.nav('Today row: Need you', h.find(/^Need you, 7$/, h.board(), 'a'), /^#waiting$/);
    for (const [what, href] of [['sign-in', '#decide/npm'], ['ask', '#decide/ship'], ['evidence', '#decide/update-1'], ['plan', '#waiting/plan-kind-board'], ['Answered', '#answered'], ['Designs', '#designs'], ['report', '#reports/new-sign-in']]) {
      await h.nav(`Today ${what} link`, h.board().querySelector(`a[href="${href}"]`), new RegExp(`^${href}$`));
    }
    await h.nav('Today passed update', h.card('update-2'), /^#evidence\/update-2$/);
    await h.dismissCard('update-2');
  } }] },
  { name: 'waiting', hash: '#waiting', ready: '[id="item-npm"]', stages: [
    { run: async (h) => {
      const links = { 'plan-kind-board': '#waiting/plan-kind-board', npm: '#decide/npm', ship: '#decide/ship', 'keep-the-weekly-digest': '#decide/keep-the-weekly-digest', 'update-1': '#decide/update-1', look: '#decide/look', 'chat-journeys': '#designs/chat-journeys' };
      for (const [key, href] of Object.entries(links)) {
        const c = h.card(key);
        await h.nav(`open ${key}`, c && (key === 'plan-kind-board' ? h.find(/^Open plan$/, h.box(c)) : c), new RegExp(`^${href}$`));
        await h.dismissCard(key);
      }
      for (const chip of ['Design pick', 'Evidence', 'Sign-in', 'Plan', 'Yes/No', 'Pick one', 'All']) {
        await h.press(`type chip ${chip}`, h.find(new RegExp(`^${chip} \\d+$`), h.board().querySelector('.chips')), () => h.find(new RegExp(`^${chip} \\d+$`), h.board().querySelector('.chips'))?.getAttribute('aria-pressed') === 'true');
      }
    } },
    { run: async (h) => { await h.need('Dismiss toast', h.find(/^Dismiss, npm$/, h.box(h.card('npm')))).click(); await h.until('toast', () => /Dismissed/.test(h.toast())); } },
    { shot: 'waiting-toast', run: async (h) => { await h.need('Undo', document.getElementById('undo')).click(); await h.until('npm back', () => h.card('npm')); } },
    { run: async (h) => { await h.need('Select', h.find(/^Select$/)).click(); await h.until('Cancel', () => h.find(/^Cancel$/)); h.card('npm').click(); h.card('ship').click(); await h.until('picked', () => h.box(h.card('ship')).classList.contains('picked')); } },
    { shot: 'waiting-select', run: async (h) => { await h.press('Cancel', h.find(/^Cancel$/), () => h.find(/^Select$/)); await h.bulk('npm'); } },
  ] },
  ...[['npm', 'signin', []], ['ship', 'ask', ['^Friday', '^Next week']], ['look', 'design', ['^A: one column', '^B: two columns']], ['update-1', 'evidence', ['^Pass$', '^Fail$', '^Needs work$']]].map(([key, kind, options]) => ({
    name: `decide-${key}`, hash: `#decide/${key}`, ready: '.decide', stages: [{ data: { options, key, kind, waiting: WAITING }, run: async (h, { options, key, kind, waiting }) => {
      const bar = () => h.board().querySelector('.decide-bar');
      if (kind === 'signin') await h.need('Open the npm sign-in', h.find(/^Open the npm sign-in$/, h.board()));
      for (const o of options) await h.press(`option ${o}`, h.find(new RegExp(o), h.board().querySelector('.pick-list, .choices, .decide')), () => true);
      // The first ask has no previous and the last has no next: the pager shows that end as a dimmed mark, not a link.
      const [at, of] = h.board().querySelector('.pager .of').textContent.split(' of ').map(Number);
      for (const [what, end] of [['Previous ask', at === 1], ['Next ask', at === of]]) {
        const step = h.find(new RegExp(`^${what}$`), h.board().querySelector('.pager'), 'a, span.step');
        if (end) h.has(`${what} (dimmed at the end)`, step?.getAttribute('aria-disabled') === 'true' && step); else await h.nav(what, step, /^#decide\//);
      }
      await h.nav('Skip for now', h.find(/^Skip for now$/, bar()), /^#decide\//);
      await h.nav('Later', h.find(/^Later$/, bar()), /^#waiting$/);
      if (options.length) {
        await h.cycle(`Answer ${key}`, h.find(/^Answer /, bar()), () => location.hash !== `#decide/${key}` || !h.board().querySelector('.decide-bar .answer'), () => h.board().querySelector('.decide-bar .answer'), /Saved/);
      }
      // Another ask opens after a dismiss; the last sign-in leaves its page saying nothing is left to decide.
      await h.cycle(`Dismiss ${key}`, h.find(/^Dismiss,/, bar()), () => location.hash !== `#decide/${key}` || /Nothing to decide/.test(h.board().textContent), () => h.find(/^Dismiss,/, h.board().querySelector('.decide-bar')), /Dismissed/);
      if (key === 'ship') {
        // Everything Waiting on you has sits under the actions: each kind's card dismisses from here too.
        for (const k of waiting.filter((k) => k !== 'ship')) await h.dismissCard(k);
        await h.bulk('npm');
      }
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
  { name: 'evidence-update', hash: '#evidence/update-2', ready: '#reader .choices, #reader [aria-label^="Pass"]', stages: [{ run: async (h) => {
    const r = h.reader();
    for (const verdict of ['Pass', 'Fail', 'Needs work']) {
      await h.cycle(`${verdict} verdict`, h.find(new RegExp(`^${verdict},`), r), () => h.find(new RegExp(`^${verdict},`), r)?.getAttribute('aria-pressed') === 'true', () => true, /Saved/);
    }
    await h.nav('Back to Evidence', h.find(/Evidence$/, r, 'a'), /^#evidence$/);
    await h.cycle('Dismiss update 2', h.find(/^Dismiss,/, r), () => location.hash === '#evidence' || !h.reader().querySelector('[aria-label^="Pass"]'), () => h.find(/^Pass,/, h.reader()), /Dismissed/);
  } }] },
  { name: 'reports', hash: '#reports', ready: '[id="item-new-sign-in"]', stages: [{ run: async (h) => {
    await h.nav('Open report', h.find(/How the new sign-in works/, h.card('new-sign-in'), 'a'), /^#reports\/new-sign-in$/);
    await h.bulk('new-sign-in');
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
    const other = () => h.board().querySelector('.decide-other'), say = (text) => { const t = other().querySelector('textarea'); t.closest('details').open = true; h.type(t, text); };
    if (!h.need('Other answer', other()?.querySelector('summary'))) return;
    say('Keep it short.');
    await h.press('Send as a comment', h.find(/^Send as a comment,/), () => /1 comment/.test(other().querySelector('summary').textContent));
    say('Keep it short.');
    await h.press('Another round', h.find(/^Another round,/), () => /1 round asked/.test(other().querySelector('summary').textContent));
    say('Keep it short.');
    await h.cycle('Send reply', h.find(/^Send reply,/), () => location.hash !== '#decide/keep-the-weekly-digest', () => true, /Saved/);
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
    const base = run('bash', [resolve('.agents/skills/verify-sign-off/seed-board.sh'), home], { env: { ...process.env, SEED_SERVE_SECONDS: '900' } }).trim().split('\n').pop();
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/$/, base);
    try {
      if (first && !process.env.SKIP_CLI_LOOK) { await cliLook(base); first = false; }
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
