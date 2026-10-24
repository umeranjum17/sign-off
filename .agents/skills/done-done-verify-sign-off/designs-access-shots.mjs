// Designs one tap away on a phone, driven only through chrome-devtools-axi: Decide's Asks and Designs with their counts, Designs lighting Decide in the dock,
// Decide's order in the round button in its head, Today's Designs to review (each design's tile a thumbnail of its first screen), and every list's end clear of the dock.
// A throwaway board of real product screens (docs/media) for Umer: the sign-off project with its own icon, three designs, asks and reports on a ticket, one proof.
// Frames at 360, 390 and 445 (phone) and 1280 and 1440 (desk), light and dark: today, decide and designs everywhere, reports-end on a phone, order at 390.
// DESIGNS_ACCESS_SIDE=before SIGN_OFF_REPO=<base build> records the same frames without asserting the new contract.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo = resolve(process.env.SIGN_OFF_REPO ?? '.'), out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const before = process.env.DESIGNS_ACCESS_SIDE === 'before', dest = before ? join(out, 'before') : out;
mkdirSync(dest, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-designs-access-'));
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'sign-off' };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `designs-access-${process.pid}`, CHROME_DEVTOOLS_AXI_USER_DATA_DIR: join(dir, 'chrome') };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env });
const axi = (...args) => sh('chrome-devtools-axi', args, { env: browserEnv });
const run = (script) => sh('chrome-devtools-axi', ['run'], { env: browserEnv, input: script });
const board = join(dir, 'board.json'), fx = (name) => JSON.parse(readFileSync(join(repo, 'fixtures/contract', name), 'utf8'));
const post = (kind, m, ...args) => { const path = join(dir, `${m.key}.json`); writeFileSync(path, JSON.stringify(m)); so('post', board, '--kind', kind, '--from', path, ...args); };
let server;
try {
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  cpSync(join(repo, 'docs/logo.svg'), join(dir, 'project.svg'));
  cpSync(join(repo, 'docs/media'), join(dir, 'media'), { recursive: true });
  so('project', board, '--name', 'sign-off', '--icon', 'project.svg');
  so('ticket', board, '--id', 'T-1', '--title', 'Designs one tap away on a phone', '--project', 'sign-off', '--progress', '40', '--priority', 'P1');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (const [i, title] of ['Which notification service fits a small team?', 'Why messages were sent twice', 'Where the weekly digest stands', 'How the board loads on a slow phone',
    'What the fleet shipped this week', 'Where design reviews wait', 'Why the dock moved', 'What a ticket rolls up'].entries())
    post('report', { ...fx('report.v5/valid-full.json'), key: `report-${i + 1}`, title, group: 'sign-off', filed: now });
  // Three designs of real board screens, newest last; each one's first screen is what its row's thumbnail shows.
  const design = (key, title, about, views) => post('design', { contract: 1, kind: 'design', schema: 1, key, title, about, group: 'sign-off', filed: now, status: 'in_review', preview: Object.values(views)[0],
    journeys: [{ id: 'screens', title: 'Screens', screens: [{ id: 'main', title, views }] }] });
  design('today-desk', 'Today on a desk, one filled screen', 'Up next, Waiting on you and the day in one window.', { computer_light: 'media/desk-today.webp', computer_dark: 'media/desk-today-dark.webp' });
  design('reports-list', 'Reports as rows with how much is read', 'A row per report with its kind and progress.', { phone_light: 'media/phone-reports.webp', phone_dark: 'media/phone-reports-dark.webp' });
  design('decide-list', 'Decide: every ask in one card', 'The asks as rows, the hero and Answered.', { phone_light: 'media/phone-decide.webp', phone_dark: 'media/phone-decide-dark.webp' });
  for (const [key, title] of [['ship', 'Ship Designs on the phone in 0.6.2?'], ['digest', 'Keep the weekly digest?'], ['icons', 'Pin the project icons for every list?']])
    so('post', board, '--ask-ref', 'message-designs-access', '--key', key, '--title', title, '--filer', 'sign-off', ...(key === 'ship' ? ['--ticket', 'T-1'] : []), '--why', 'Umer decides what ships.', '--outcome', 'yes=It goes ahead.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'It is ready.', '--default', 'no');
  so('post', board, '--type', 'evidence', '--title', 'Designs open from Decide on a phone', '--about', 'Umer reaches Designs in one tap.', '--media', join(dir, 'media/phone-decide.webp'), '--ticket', 'T-1');
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127.0.0.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', () => no(Error('server exited'))); });
  axi('open', url);
  const measures = [];
  for (const width of [360, 390, 445, 1280, 1440]) for (const theme of ['light', 'dark']) {
    const phone = width < 1024;
    axi('emulate', '--viewport', `${width}x${{ 360: 780, 390: 844, 445: 960, 1280: 800, 1440: 900 }[width]}x2${phone ? ',mobile,touch' : ''}`, '--color-scheme', theme);
    for (const state of ['today', 'decide', 'designs', ...(phone ? ['reports-end'] : []), ...(width === 390 ? ['order'] : [])]) {
      const hash = { today: '', decide: '#waiting', designs: '#designs', 'reports-end': '#reports', order: '#waiting' }[state];
      run(`await page.open(${JSON.stringify(url + hash)}); await page.eval(() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); });`);
      sh('sleep', ['0.6']);
      // Designs is reached the way a person on a phone reaches it: Decide's Designs.
      if (state === 'designs' && phone && !before) { run(`await page.open(${JSON.stringify(url + '#waiting')});`); sh('sleep', ['0.4']); run(`await page.eval(() => document.querySelector('.dl-seg button:nth-child(2)').click());`); sh('sleep', ['0.6']); }
      if (state === 'reports-end') { run(`await page.eval(() => scrollTo(0, document.documentElement.scrollHeight));`); sh('sleep', ['0.4']); }
      if (state === 'order' && !before) { run(`await page.eval(() => document.querySelector('.dl-rb').click());`); sh('sleep', ['0.6']); }
      axi('snapshot');
      const result = JSON.parse(run(`console.log(JSON.stringify(await page.eval(async () => {
        await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
        const box = (e) => e?.getBoundingClientRect(), w = document.documentElement.clientWidth, dock = document.querySelector('.tabs'), more = [...document.querySelectorAll('main .t-more-line')].pop();
        const tiles = [...document.querySelectorAll('main .ui-row .ui-icon, main .dz-card .dz-shot')].map(t => ({ row: t.closest('.ui-row, .dz-card')?.querySelector('.t, .dz-ct')?.textContent, thumb: !!t.querySelector('img.design-thumb') || t.classList.contains('dz-shot'),
          img: t.querySelector('img')?.getAttribute('src') ?? null, loaded: !!t.querySelector('img')?.naturalWidth, drawing: !!t.querySelector('svg'), letters: t.textContent.trim() }));
        const designs = document.querySelector('.t-wait[aria-label="Designs to review"]');
        return { url: location.href, width: innerWidth, colorScheme: getComputedStyle(document.documentElement).colorScheme, title: document.querySelector('#board h1')?.textContent,
          dockLit: getComputedStyle(dock).display === 'none' ? null : dock.querySelector('[aria-current]')?.getAttribute('aria-label'), sideLit: document.querySelector('#nav a[aria-current] ')?.textContent ?? null,
          seg: [...document.querySelectorAll('#board .ui-seg button')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')),
          order: document.querySelector('.dl-rb')?.getAttribute('aria-label') ?? null, orderSheet: document.getElementById('dl-sort')?.open ? [...document.querySelectorAll('#dl-sort .dl-pick')].map(b => b.textContent + (b.hasAttribute('aria-current') ? '*' : '')) : null,
          todayDesigns: designs ? [...designs.querySelectorAll('.ui-row')].map(a => [a.getAttribute('href'), a.querySelector('.t').textContent]) : null,
          moreBottom: more ? Math.round(box(more).bottom) : null, dockTop: getComputedStyle(dock).display === 'none' ? null : Math.round(box(dock).top), fade: getComputedStyle(document.body, '::after').display !== 'none' && getComputedStyle(document.body, '::after').content !== 'none',
          tiles, overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > w + 1).slice(0, 10).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')),
          squashed_text: (() => { const ctx = document.createElement('canvas').getContext('2d'); const out = []; for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\\s+/g, ' ').trim(); const s = getComputedStyle(e); const w = e.offsetWidth; const h = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((w <= 1 || h <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = w / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const words = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > w + 1) || tops.size > words) out.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words }); } return out; })() };
      })));`).trim());
      const name = `${state}.${theme}.${width}w`;
      axi('screenshot', join(dest, name + '.png'));
      result.console = axi('console', '--type', 'error'); const network = axi('network');
      result.console_errors = result.console.includes('<no console messages found>') ? [] : [result.console];
      result.failed_requests = network.split('\n').filter(l => /\[(?:[45]\d\d|failed)\]/i.test(l));
      writeFileSync(join(dest, name + '.dom.json'), JSON.stringify(result, null, 2)); measures.push(result);
      if (before) continue;
      assert.deepEqual(result.console_errors, [], name); assert.deepEqual(result.failed_requests, [], name); assert.equal(result.overflow, false, name); assert.deepEqual(result.overflowing, [], name);
      // No two-letter tile anywhere: a design shows its first screen, everything else its project's icon.
      assert.ok(result.tiles.length && result.tiles.every(t => !t.letters && t.loaded), name + ': real pictures in every tile ' + JSON.stringify(result.tiles.filter(t => t.letters || !t.loaded)));
      if (phone) {
        assert.equal(result.fade, true, name + ': the page fades under the dock');
        if (state !== 'today') assert.match(result.dockLit, state === 'reports-end' ? /^Reports/ : /^Decide/, name + ': dock');
        if (state === 'decide' || state === 'designs') {
          assert.match(result.seg.join(), state === 'decide' ? /^Asks\d+\*,Designs3$/ : /^Asks\d+,Designs3\*$/, name + ': Asks and Designs');
          assert.equal(result.title, 'Decide');
        }
        if (state === 'decide') assert.equal(result.order, 'Order: Newest');
        if (state === 'designs') assert.ok(result.tiles.length === 3 && result.tiles.every(t => t.thumb && /media%2Fdesk-today|media%2Fphone-/.test(t.img)), name + ': design thumbnails');
        if (state === 'order') assert.deepEqual(result.orderSheet, ['Newest*', 'By priority']);
        if (state === 'reports-end') assert.ok(result.moreBottom <= result.dockTop - 16, `${name}: More ends at ${result.moreBottom}, the dock starts at ${result.dockTop}`);
      } else {
        assert.equal(result.fade, false, name);
        assert.equal(result.sideLit?.replace(/\d+$/, ''), { today: 'Today', decide: 'Decide', designs: 'Designs' }[state], name + ': sidebar');
        if (state === 'decide') assert.equal(result.seg.join(), 'Newest*,By priority', name + ': a desk keeps Newest and By priority');
      }
      if (state === 'today') assert.ok(result.todayDesigns?.length === 2 && result.todayDesigns.every(([href]) => href.startsWith('#designs/')), name + ': Designs to review ' + JSON.stringify(result.todayDesigns));
    }
  }
  writeFileSync(join(dest, 'steps.json'), JSON.stringify({ commit: process.env.DESIGNS_ACCESS_COMMIT ?? sh('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim(), before, target: { version: so('--version').trim() },
    start: 'An isolated board for Umer: the sign-off project with its own icon, three designs of real board screens, three asks (one on ticket T-1) and eight reports, one proof.',
    steps: ['Open Today, Decide and Designs at 360, 390, 445, 1280 and 1440 in light and dark with chrome-devtools-axi; on a phone reach Designs by tapping Decide\'s Designs.',
      'On a phone, open Reports and scroll it to its end; at 390 tap Decide\'s round order button.', 'Read each frame in the browser: the dock or sidebar place lit, Asks and Designs with their counts, the order, Today\'s Designs to review, every tile\'s picture, the More line against the dock, overflow and console errors.'],
    result: `${measures.length} frames and DOM records; ${before ? 'baseline recorded' : 'Designs one tap from Decide with Decide lit, Today\'s Designs to review, thumbnails and project icons in every tile, the order sheet, and every phone list\'s end clear of the dock passed'}` }, null, 2));
  console.log(`${dest}: ${measures.length} frames recorded`);
} finally {
  try { axi('stop'); } catch {}
  if (server) { const exit = new Promise(ok => server.once('exit', ok)); try { so('stop', board); } catch {} await exit; }
  rmSync(dir, { recursive: true, force: true });
}
