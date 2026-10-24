// The leash acting, driven only through the CLI and chrome-devtools-axi. Built on a throwaway board for Umer: the sign-off, Crewhouse and first-draft projects with their own icons
// (LEASH_ICONS=<folder holding crewhouse.svg and first-draft.svg>, each project's real icon fetched from its repository; without it every ask is on sign-off), tickets naming them,
// and real raised asks. On Act, then tell me, the release-day raise takes its agent's pick at once. The leash then goes to When it matters, and the open board takes the digest's
// default at its silent_by. The waiting agents pick both up. The hosting ask spends money, so its own words guard it.
// Frames at 360, 390 and 445 (phone) and 1280 and 1440 (desk), light and dark: decide (the list, its leash chip, Taken without you) and leash (the chip's sheet) first, while nothing is
// opened; then default, agent and guard (each card). Last, at 390 light, Change on the agent's pick sends the person's own answer, and the agent's wait reads it with what it replaces.
// LEASH_REVIEW_ROOT=<folder outside the run> keeps the whole matrix there and copies only the decide frames into the run, for a one-screen claim.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const review = process.env.LEASH_REVIEW_ROOT ? resolve(process.env.LEASH_REVIEW_ROOT) : out, icons = process.env.LEASH_ICONS && resolve(process.env.LEASH_ICONS);
mkdirSync(out, { recursive: true }); mkdirSync(review, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-leash-'));
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache') };
delete env.SIGN_OFF_FILER; delete env.CLAUDE_CODE_SESSION_ID;
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `leash-${process.pid}`, CHROME_DEVTOOLS_AXI_USER_DATA_DIR: join(dir, 'chrome') };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env });
const axi = (...args) => sh('chrome-devtools-axi', args, { env: browserEnv });
const run = (script) => sh('chrome-devtools-axi', ['run'], { env: browserEnv, input: script });
const sleep = (s) => sh('sleep', [String(s)]);
const board = join(dir, 'board.json'), leash = (l) => writeFileSync(join(dir, 'config.yaml'), `board: board.json\nname: Umer\nleash: ${l}\n`);
const at = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19) + 'Z';
const raise = (key, filer, ticket, title, why, outcomes, extra = []) => so('raise', board, '--ask-ref', 'leash-demo', '--filer', filer, '--ticket', ticket, '--key', key, '--title', title, '--why', why,
  ...outcomes.flatMap((o) => ['--outcome', o]), ...extra);
let server;
try {
  // The projects, each with its own icon, and a ticket on each.
  cpSync(join(repo, 'docs/logo.svg'), join(dir, 'sign-off.svg'));
  so('project', board, '--name', 'sign-off', '--icon', 'sign-off.svg');
  const projects = { crew: 'sign-off', draft: 'sign-off' };
  if (icons) for (const [k, name, file] of [['crew', 'Crewhouse', 'crewhouse.svg'], ['draft', 'first-draft', 'first-draft.svg']]) { copyFileSync(join(icons, file), join(dir, file)); so('project', board, '--name', name, '--icon', file); projects[k] = name; }
  so('ticket', board, '--id', 'T-41', '--title', 'Ship the settings page', '--project', 'sign-off');
  so('ticket', board, '--id', 'T-12', '--title', 'Weekly digest', '--project', projects.crew);
  so('ticket', board, '--id', 'T-7', '--title', 'Reports export', '--project', projects.draft);
  // Act, then tell me: the raise takes the agent's own recommended pick at once and says so.
  leash('act');
  const picked = raise('release-day', 'release-agent', 'T-12', 'Which day should the release ship?', 'Two fixes are still in review: A, B or C.',
    ['a=It ships now, without the 2 fixes.', 'b=It ships with both fixes.', 'c=It waits for the redesign too.'],
    ['--option', 'a=A: Today', '--option', 'b=B: Friday', '--option', 'c=C: Next week', '--priority', 'P2', '--recommend', 'b', '--recommend-reason', 'Both fixes land by Thursday.', '--default', 'b']);
  writeFileSync(join(out, 'raise-act.txt'), `$ sign-off-axi raise --key release-day ... (leash: act)\n${picked}`);
  assert.match(picked, /release-day,picked b/);
  leash('matters');
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  const yes = ['yes=It keeps going out each Monday.', 'no=It stops after this week.'];
  raise('weekly-digest', 'digest-agent', 'T-12', 'Keep sending the weekly digest?', 'Open rate held steady at about a third for two months.', yes,
    ['--recommend', 'yes', '--recommend-reason', 'Readers still open it.', '--default', 'yes', '--silent-by', at(4000)]);
  raise('export-name', 'docs-agent', 'T-7', 'Rename Export to Download on reports?', 'Two people looked for Download first in this week\'s test.', ['yes=The button reads Download.', 'no=It keeps the name Export.'],
    ['--recommend', 'yes', '--recommend-reason', 'Both testers looked for Download.', '--default', 'yes']);
  raise('hosting-pro', 'infra-agent', 'T-41', 'Move the board\'s hosting to the Pro plan?', 'The free plan sleeps after an hour, so phone links open slowly in the morning.',
    ['yes=Hosting moves to Pro at 20 dollars a month.', 'no=It stays on the free plan.'], ['--priority', 'P2', '--recommend', 'yes', '--recommend-reason', 'Morning links open in under a second.', '--default', 'no', '--silent-by', at(-60_000)]);
  raise('ship-settings', 'release-agent', 'T-41', 'When should the new settings page ship?', 'No new bug reports for three weeks; the release train leaves at four.',
    ['friday=The page ships Friday with the release.', 'next-week=The page waits for next week\'s release.'],
    ['--option', 'friday=Friday', '--option', 'next-week=Next week', '--priority', 'P1', '--recommend', 'friday', '--recommend-reason', 'Three quiet weeks support shipping.', '--default', 'next-week', '--silent-by', at(3 * 3600_000)]);
  // The board takes the digest's default at its silent_by, and the waiting agents pick their answers up.
  const digest = so('wait', board, '--filer', 'digest-agent', '--timeout', '20');
  writeFileSync(join(out, 'wait-default.txt'), `$ sign-off-axi wait --filer digest-agent\n${digest}`);
  assert.match(digest, /weekly-digest,yes,\S+,default/);
  writeFileSync(join(out, 'wait-agent.txt'), `$ sign-off-axi wait --filer release-agent\n${so('wait', board, '--filer', 'release-agent', '--timeout', '5')}`);
  const log = readFileSync(board.replace(/\.json$/, '.answers.jsonl'), 'utf8');
  writeFileSync(join(out, 'answers-log.jsonl'), log);
  axi('open', url);
  const measures = [], frames = [];
  const shoot = (state, width, theme) => {
    const phone = width < 1024, hash = { decide: '#waiting', leash: '#waiting', default: '#decide/weekly-digest', agent: '#decide/release-day', guard: '#decide/hosting-pro', ask: '#decide/ship-settings' }[state];
    axi('emulate', '--viewport', `${width}x${{ 360: 780, 390: 844, 445: 960, 1280: 800, 1440: 900 }[width]}x2${phone ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    run(`await page.open(${JSON.stringify(url + hash)}); await page.eval(() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); });`);
    sleep(0.8);
    if (state === 'leash') { run(`await page.eval(() => document.querySelector('.leash-chip').click());`); sleep(0.6); }
    if (state === 'ask' && phone) { run(`await page.eval(() => document.querySelector('.decide .silent-line').scrollIntoView({ block: 'center' }));`); sleep(0.4); }
    if (state === 'guard' && phone) { run(`await page.eval(() => document.querySelector('.guard-line').scrollIntoView({ block: 'center' }));`); sleep(0.4); }
    const result = JSON.parse(run(`console.log(JSON.stringify(await page.eval(async () => {
      await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
      const w = document.documentElement.clientWidth, text = (s) => document.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? null;
      const section = (name) => [...document.querySelectorAll('ul.dl-list')].find((u) => u.getAttribute('aria-label') === name);
      const rows = (name) => [...(section(name)?.querySelectorAll('.dl-row') ?? [])].map((r) => ({ key: r.dataset.key, meta: r.querySelector('.meta')?.textContent, change: !!r.querySelector('.dl-chg') && getComputedStyle(r.querySelector('.dl-chg')).display !== 'none',
        icon: r.querySelector('.ui-icon img')?.getAttribute('src') ?? null, loaded: !!r.querySelector('.ui-icon img')?.naturalWidth, letters: r.querySelector('.ui-icon')?.textContent.trim() ?? '' }));
      const chip = document.querySelector('.leash-chip'), cb = chip?.getBoundingClientRect(), hero = document.querySelector('.ui-hero .chip')?.getBoundingClientRect();
      return { url: location.href, width: innerWidth, colorScheme: getComputedStyle(document.documentElement).colorScheme, chip: chip?.textContent ?? null, chipVisible: !!cb?.height,
        chipOverlapsAnswered: !!(cb?.height && hero?.height && cb.top < hero.bottom && cb.bottom > hero.top && cb.left < hero.right && cb.right > hero.left),
        sheet: document.getElementById('l-sheet')?.open ? { head: text('#l-sheet h2'), seg: [...document.querySelectorAll('#l-sheet .ui-seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')), line: text('#l-sheet .t-line') } : null,
        asks: rows('Asks'), took: rows('Taken without you'), answered: rows('Answered'),
        tookLine: text('.decide .took-line'), tookCard: [...document.querySelectorAll('.decide .ans-card.took b, .decide .ans-card.took div > span')].map((e) => e.textContent).join(' | '), tookMark: document.querySelector('.decide .ans-card.took .donek svg')?.innerHTML.includes('class="fill"') ?? null,
        firstStep: text('.decide .ui-trail li:first-child b'), change: text('.decide-bar .answer'), guardLine: text('.decide .guard-line'), quiet: text('.decide .silent-line'),
        overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')),
        squashed_text: (() => { const ctx = document.createElement('canvas').getContext('2d'); const out = []; for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\\s+/g, ' ').trim(); const s = getComputedStyle(e); const w = e.offsetWidth; const h = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((w <= 1 || h <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = w / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const words = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > w + 1) || tops.size > words) out.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words }); } return out; })() };
    })));`).trim());
    const name = `${state}.${theme}.${width}w`;
    axi('screenshot', join(review, name + '.png'));
    const console = axi('console', '--type', 'error'), network = axi('network');
    result.console_errors = console.includes('<no console messages found>') ? [] : [console];
    result.failed_requests = network.split('\n').filter(l => /\[(?:[45]\d\d|failed)\]/i.test(l));
    writeFileSync(join(review, name + '.dom.json'), JSON.stringify(result, null, 2)); measures.push(result); frames.push(name);
    assert.deepEqual(result.console_errors, [], name); assert.deepEqual(result.failed_requests, [], name); assert.equal(result.overflow, false, name); assert.deepEqual(result.overflowing, [], name);
    if (state === 'decide' || state === 'leash') {
      assert.equal(result.chip, 'Leash: When it matters', name); assert.ok(result.chipVisible && !result.chipOverlapsAnswered, name + ': the chip shows, clear of answered today');
      assert.deepEqual(result.asks.map((r) => r.key).sort(), ['export-name', 'hosting-pro', 'ship-settings'], name);
      assert.deepEqual(result.took.map((r) => [r.key, r.meta.replace(/\d\d:\d\d/, 'HH:MM'), r.change]).sort(), [['release-day', 'Agent picked B: Friday', phone], ['weekly-digest', 'Taken by default at HH:MM', phone]], name);
      assert.ok([...result.asks, ...result.took].every((r) => r.loaded && !r.letters), name + ': a project icon on every row ' + JSON.stringify([...result.asks, ...result.took]));
    }
    if (state === 'leash') assert.deepEqual(result.sheet, { head: 'Leash', seg: ['Ask first', 'When it matters*', 'Act, then tell'], line: 'At an ask\u2019s deadline the board takes its default. Money, deletes and security always wait for you.' }, name);
    if (state === 'default') { assert.match(result.tookLine, /^Taken by default at \d\d:\d\d$/, name); assert.match(result.tookCard, /^Yes \| No answer by \d\d:\d\d, so the board took the default this ask showed\.$/, name); assert.equal(result.change, 'Change', name); assert.equal(result.firstStep, 'Taken', name); }
    if (state === 'agent') { assert.equal(result.tookLine, 'Agent picked B: Friday, tell me if wrong', name); assert.equal(result.tookCard, 'B: Friday | Its pick: Both fixes land by Thursday.', name); assert.equal(result.tookMark, true, name); assert.equal(result.change, 'Change', name); assert.equal(result.firstStep, 'Picked', name); }
    if (state === 'ask') { assert.equal(result.chip, 'Leash: Ask first', name); assert.equal(result.quiet, 'Your leash is Ask me first, so the agent waits for your answer.', name); }
    if (state === 'guard') assert.equal(result.guardLine, 'Always waits for you. It spends money, so no default or agent pick is ever taken.', name);
  };
  const cells = [360, 390, 445, 1280, 1440].flatMap((width) => ['light', 'dark'].map((theme) => [width, theme]));
  // The list and the chip's sheet first: an answer the leash took stays under Taken without you until its card is opened.
  for (const [width, theme] of cells) for (const state of ['decide', 'leash']) shoot(state, width, theme);
  for (const [width, theme] of cells) for (const state of ['default', 'agent', 'guard']) shoot(state, width, theme);
  // Ask me first, set from the chip's sheet: an open ask with a silent_by now only waits, and the board takes nothing.
  axi('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', 'light');
  run(`await page.open(${JSON.stringify(url + '#waiting')}); await page.eval(() => location.reload());`); sleep(0.8);
  run(`await page.eval(() => document.querySelector('.leash-chip').click());`); sleep(0.4);
  run(`await page.eval(() => [...document.querySelectorAll('#l-sheet .ui-seg button')].find((b) => b.textContent === 'Ask first').click());`); sleep(0.8);
  assert.match(readFileSync(join(dir, 'config.yaml'), 'utf8'), /^leash: ask$/m);
  for (const [width, theme] of cells) shoot('ask', width, theme);
  // The person changes the agent's pick: Change on its card, A: Today, Answer. The agent's wait hands the change over with what it replaces.
  axi('emulate', '--viewport', '390x844x2,mobile,touch', '--color-scheme', 'light');
  run(`await page.open(${JSON.stringify(url + '#decide/release-day')}); await page.eval(() => location.reload());`);
  sleep(0.8);
  run(`await page.eval(() => document.querySelector('.decide-bar .answer').click());`); sleep(0.5);
  run(`await page.eval(() => document.querySelector('.decide .pick-option').click());`); sleep(0.3);
  run(`await page.eval(() => document.querySelector('.decide-bar .answer').click());`);
  const changed = so('wait', board, '--filer', 'release-agent', '--json', '--timeout', '20');
  writeFileSync(join(out, 'wait-changed.json'), changed);
  const now = JSON.parse(changed)['release-day'];
  assert.equal(now.answer, 'a'); assert.equal(now.taken, undefined); assert.equal(now.replaces.answer, 'b'); assert.equal(now.replaces.taken, 'agent');
  if (review !== out) for (const f of frames.filter((f) => f.startsWith('decide.'))) for (const ext of ['.png', '.dom.json']) copyFileSync(join(review, f + ext), join(out, f + ext));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ commit: process.env.LEASH_COMMIT ?? sh('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim(), target: { version: so('--version').trim() },
    start: 'An isolated board for Umer: the sign-off, Crewhouse and first-draft projects with their own icons, a ticket on each, and real raised asks.',
    steps: ['With the leash on Act, then tell me, raise release-day: the raise takes its recommended pick B at once (raise-act.txt).',
      'Set the leash to When it matters and serve the board; raise the digest ask with a silent_by 4 seconds away, a money ask (hosting-pro) past its silent_by, and two more asks.',
      'The board takes the digest default at its silent_by; the digest and release agents\' waits hand both answers over with taken default and agent (wait-default.txt, wait-agent.txt, answers-log.jsonl).',
      'Open Decide at 360, 390, 445, 1280 and 1440 in light and dark with chrome-devtools-axi: the asks, Taken without you and the Leash chip, then tap the chip for its sheet.',
      'Open the digest, release-day and hosting-pro cards at each width and theme: Taken by default at <time>, Agent picked B: Friday with its sparkle mark, and Always waits for you on the money ask.',
      'At 390 light, tap the Leash chip and pick Ask first; open the settings ask at each width and theme: Your leash is Ask me first, so the agent waits for your answer.',
      'At 390 light, tap Change on release-day, pick A: Today and answer; the release agent\'s wait reads the change with replaces taken agent (wait-changed.json).'],
    result: `${measures.length} frames and DOM records${review !== out ? '; the 10 Decide frames copied into the run for its claim, every state kept in the review folder' : ''}; the default taken at silent_by, the agent pick at raise, the money ask never taken, the chip and its sheet, Ask me first set from the sheet and shown on an open ask, project icons on every row, and the person's change reaching the agent passed` }, null, 2));
  console.log(`${out}: ${measures.length} frames recorded`);
} finally {
  try { axi('stop'); } catch {}
  if (server) { const exit = new Promise(ok => server.once('exit', ok)); try { so('stop', board); } catch {} await exit; }
  rmSync(dir, { recursive: true, force: true });
}
