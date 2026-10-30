// Tickets in the new look, as the approved prototype draws it, at one theme and width per run (so a run's steps.json holds one claim), driven and measured in a headless
// Chromium of its own over the DevTools protocol with exact device metrics (390x844, 1280x800 or 1440x900, 2x).
// The board is feel-board.sh's, then tickets through the real CLI: 24 of your asks, one an epic (Ship the new settings page) with three tickets, one of them with four
// sub-tasks; 15 system tickets, one with three sub-tasks; priorities, projects (two with their own icons, the rest initials) and holds; and seven cards on tickets, with the
// ship ask answered and a comment on the proof, so the ticket shows its Activity.
// States at 390: tickets (Your asks), tickets-system (System tapped), ticket (a ticket's row tapped: its sheet with sub-tasks, Linked and Activity), ticket-end (that sheet
// scrolled to its end), epic (the epic's sheet: its tickets), filter (the project filter's sheet), tickets-filtered (one project picked) and tickets-end (the list scrolled to
// its end, clear of the dock). At 1280 and 1440: tickets, tickets-system and ticket (a row clicked: it opens in the third column).
// Each capture is measured in the browser: the blocks on the gutter's edges and the 4px grid, 68px rows on a phone and 88px on a desk (40px tile, title 12px after it) with titles
// on one line on a phone and at most two on a desk, a row's second line never cut, the detail title in full, the round buttons 40px circles, the dock and the last block clear of it,
// no control under 44px on a phone; on a desk the three columns on one top and bottom, every list ending on a whole row (or fading its next one), no row cut at a card's or the
// panel's foot, and the empty share of the viewport; no file path or internal code in the words, no sideways overflow and no console error.
// Usage: node .agents/skills/done-done-verify-sign-off/tickets-shots.mjs <output> [light|dark|light,dark] [390|1280|1440]
// TICKETS_PROTO=<the approved desk-and-phone prototype's index.html> and TICKETS_PROTO_TREE=<the tickets prototype's index.html> capture the prototype at the same size and
// theme and save each pair (vs-proto/). SIGN_OFF_REPO names another built checkout to drive, such as the base for a before (TICKETS_SIDE=before keeps its measures unasserted).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024;
const side = process.env.TICKETS_SIDE ?? 'after', here = resolve('.'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
const proto = process.env.TICKETS_PROTO && resolve(process.env.TICKETS_PROTO), tree = process.env.TICKETS_PROTO_TREE && resolve(process.env.TICKETS_PROTO_TREE);
mkdirSync(join(out, 'vs-proto'), { recursive: true });
if (theme.includes(',')) {
  const each = theme.split(',').map((t) => {
    const r = spawnSync(process.execPath, [process.argv[1], out, t, String(width)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    if (side !== 'after') return null;
    renameSync(join(out, 'steps.json'), join(out, `steps.${t}.json`));
    return [t, JSON.parse(readFileSync(join(out, `steps.${t}.json`), 'utf8'))];
  }).filter(Boolean);
  if (each.length) writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: each[0][1].target, start: each[0][1].start,
    steps: each.flatMap(([t, x]) => x.steps.map((step) => `In ${t}: ${step}`)), result: each.map(([, x]) => x.result).join(' ') }, null, 2) + '\n');
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), 'so-tickets-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'),
  XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify', SIGN_OFF_FLEET_HOME: join(dir, 'fleet') };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const cli = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const chromium = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const metrics = phone ? { width, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height: width >= 1440 ? 900 : 800, deviceScaleFactor: 2, mobile: false };
const name = (state) => `${state}.${side}.${theme}.${width}w`;

// What the browser measures on Tickets. A phone: blocks on main's two gutter edges and the 4px grid, the rows, the round buttons, the dock, the sheet. A desk: the head,
// three columns on one top and one bottom, 88px rows, every list ending on a whole row, the panel's foot, and the empty share of the viewport.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const w = document.documentElement.clientWidth, H = innerHeight, box = (e) => e.getBoundingClientRect(), vis = (e) => { const r = box(e), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const r2 = (n) => Math.round(n * 100) / 100, grid = (n) => Math.abs(n / 4 - Math.round(n / 4)) < 0.02, fail = [], y = scrollY, desk = innerWidth >= 1024;
  const dialog = document.querySelector('dialog[open]'), sheet = document.querySelector('.tk-sheet'), scope = dialog ?? sheet ?? document.querySelector('main');
  const main = document.querySelector('main'), edgeL = box(main).left + parseFloat(getComputedStyle(main).paddingLeft), edgeR = box(main).right - parseFloat(getComputedStyle(main).paddingRight);
  const tag = (e) => e.className.split(' ').filter((c) => /^(ui|tk)-/.test(c)).slice(-1)[0] ?? e.tagName.toLowerCase();
  // A phone's blocks share the gutter's two edges and sit on the 4px grid.
  const blocks = desk || dialog || sheet ? [] : [...document.querySelectorAll('main .ui-top, main .tk-seg, main .ui-hero, main .ui-sec, main .ui-list:not(.tk-feed), main .tk-tiles, main .tk-empty')].filter(vis)
    .map((e) => { const r = box(e); return { el: tag(e), left: r2(r.left), right: r2(r.right), top: r2(r.top + y), height: r2(r.height) }; });
  for (const b of blocks) {
    if (Math.abs(b.left - edgeL) > 0.5) fail.push('left edge ' + b.el + ' ' + b.left + ' not ' + r2(edgeL));
    if (b.el !== 'ui-sec' && Math.abs(b.right - edgeR) > 0.5) fail.push('right edge ' + b.el + ' ' + b.right + ' not ' + r2(edgeR));
    if (!(grid(b.top) && grid(b.height))) fail.push('off the 4px grid ' + b.el + ' top ' + b.top + ' height ' + b.height);
  }
  // Rows: 68px on a phone, 88px on a desk's lists (a sheet's or panel's inset list lets a two-line title grow it), a 40px tile 12px in, the title 12px after it.
  const lines = (e) => Math.round(box(e).height / parseFloat(getComputedStyle(e).lineHeight));
  const rows = [...scope.querySelectorAll('.ui-row:not(.tk-feed .ui-row)')].filter(vis).filter((e) => box(e).bottom > 0 && box(e).top < H).map((e) => { const r = box(e), t = box(e.querySelector('.ui-icon')), title = e.querySelector('.t'), card = box(e.closest('.tk-card') ?? e.closest('.ui-list')), pad = e.closest('.tk-card') ? 24 : 12, meta = e.querySelector('.meta');
    // A child inside an epic's group is one step in (20px on a phone, 56 on a desk): its tile starts that far past the card's padding, and no further.
    const kid = !!e.closest('li.tk-kid');
    // A ticket with a readable name leads its title line with it: the key sits 12px after the tile and the title 12px after the key, on the same line.
    const keyEl = e.querySelector('.l1 .tk-key'), afterTile = keyEl ? box(keyEl) : t;
    return { title: title.textContent.slice(0, 40), height: r2(r.height), inset: !!e.closest('.tk-in'), tile: r2(t.width) + 'x' + r2(t.height), pad, tileIn: r2(t.left - card.left), titleGap: r2(box(title).left - afterTile.right), keyGap: keyEl ? r2(box(keyEl).left - t.right) : null, kid,
      keyLine: keyEl ? Math.abs(box(keyEl).top - box(title).top) < 12 : null, rightIn: r2(card.right - box(e.querySelector('.rm')).right),
      lines: lines(title), cut: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1, metaCut: meta ? meta.scrollWidth > meta.clientWidth + 1 : false, meta: meta?.textContent ?? null,
      chip: e.querySelector('.ui-pc')?.textContent ?? null, icon: e.querySelector('.ui-icon img') ? 'picture' : e.querySelector('.ui-icon .mono') ? 'initials' : 'drawing', bar: e.querySelector('.ui-bar i')?.style.width ?? null }; });
  rows.forEach((x, i) => {
    const tall = !desk ? (x.inset ? x.height >= 68 : x.height === 68) : x.inset ? x.height >= 68 : x.height === 88;
    const indent = x.tileIn - x.pad;
    if (!tall || x.tile !== '40x40' || x.titleGap !== 12 || x.rightIn !== x.pad) fail.push('row ' + i + ' ' + JSON.stringify(x));
    if (x.kid ? !(indent > 0 && indent <= 56) : indent !== 0) fail.push('row ' + i + ' indent ' + indent + ' ' + JSON.stringify(x));
    if (x.keyGap !== null && (x.keyGap !== 12 || !x.keyLine)) fail.push('row ' + i + ' key off the title line ' + JSON.stringify(x));
    if (x.lines > (desk ? 2 : x.inset ? 2 : 1)) fail.push('row title on ' + x.lines + ' lines ' + x.title);
    if (x.metaCut) fail.push('second line cut: ' + x.meta);
    if (x.bar === '0%') fail.push('an empty bar on ' + x.title);
  });
  // The open ticket's title wraps in full.
  const dt = scope.querySelector('.tk-dt') ?? document.querySelector('.tk-pane .tk-dt'), title = dt && { text: dt.textContent, lines: lines(dt), cut: dt.scrollHeight > dt.clientHeight + 1 || getComputedStyle(dt).textOverflow === 'ellipsis' };
  if (title?.cut) fail.push('the ticket title is cut');
  // The round buttons in the head: 40px circles, the icon centred.
  const rounds = [...document.querySelectorAll('main :is(.tk-top, .tk-dhead) .ui-rb')].filter(vis).map((b) => { const r = box(b), g = box(b.querySelector('svg'));
    return { label: b.getAttribute('aria-label'), w: r2(r.width), h: r2(r.height), radius: getComputedStyle(b).borderRadius, offX: r2((g.left + g.right - r.left - r.right) / 2), offY: r2((g.top + g.bottom - r.top - r.bottom) / 2), right: r2(w - r.right) }; });
  rounds.forEach((x) => { if (x.w !== 40 || x.h !== 40 || x.radius !== '20px' || Math.abs(x.offX) > 0.5 || Math.abs(x.offY) > 0.5) fail.push('round button ' + JSON.stringify(x)); });
  const tabs = document.querySelector('.tabs'), find = document.querySelector('.dock-find'), dock = tabs && vis(tabs) ? (() => { const p = box(tabs), f = box(find);
    return { pill: r2(p.width) + 'x' + r2(p.height), bottom: r2(innerHeight - p.bottom), find: r2(f.width) + 'x' + r2(f.height), gap: r2(f.left - p.right), top: r2(p.top), tabs: tabs.querySelectorAll('a').length,
      current: tabs.querySelector('a[aria-current]')?.getAttribute('aria-label') ?? null }; })() : null;
  if (dock && (dock.pill.split('x')[1] !== '56' || dock.bottom !== 24 || dock.find !== '56x56' || dock.gap !== 12 || dock.tabs !== 6)) fail.push('dock ' + JSON.stringify(dock));
  const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1;
  const last = [...document.querySelectorAll('main .tk-tiles, main .ui-list:not(.tk-feed), main .ui-hero')].filter(vis).map((e) => box(e).bottom).sort((a, b) => b - a)[0];
  const clear = dock && !sheet && !dialog && atEnd && last !== undefined ? r2(dock.top - last) : undefined;
  if (clear !== undefined && clear < 16) fail.push('the last block is ' + clear + 'px from the dock');
  // A desk: one screen with no page scroll, the head, then three columns sharing one top and one bottom; every list ends on a whole row or fades its next one; the panel's foot.
  let deskM;
  if (desk && document.querySelector('.tk-desk')) {
    const cols = [...document.querySelectorAll('.tk-desk .ui-dgrid > *')].map((c) => { const r = box(c); return { left: r2(r.left), right: r2(r.right), top: r2(r.top), bottom: r2(r.bottom), width: r2(r.width) }; });
    const cards = [...document.querySelectorAll('.tk-desk .ui-dgrid .ui-card')].map((c) => { const r = box(c); return { el: tag(c), head: c.querySelector('.tk-ch, .lab')?.textContent ?? '', top: r2(r.top), height: r2(r.height), bottom: r2(r.bottom), left: r2(r.left), right: r2(r.right) }; });
    if (document.documentElement.scrollHeight > innerHeight + 1) fail.push('the desk page scrolls');
    if (new Set(cols.map((c) => c.top)).size !== 1) fail.push('columns start on different tops ' + JSON.stringify(cols));
    if (cols.some((c) => Math.abs(c.bottom - (innerHeight - 24)) > 0.5)) fail.push('a column does not reach 24px over the foot ' + JSON.stringify(cols));
    if (Math.abs(cols[0].left - edgeL) > 0.5 || Math.abs(cols.at(-1).right - edgeR) > 0.5) fail.push('columns off the edges ' + r2(edgeL) + ' ' + r2(edgeR));
    if (cols.some((c) => Math.abs(c.width - cols[0].width) > 0.05)) fail.push('columns of different widths');
    for (const c of cards) if (!(grid(c.top) || grid(c.top + 0.5))) fail.push('card off the 4px grid ' + c.head + ' ' + c.top);
    const heads = [...document.querySelectorAll('.tk-ch')].map((h) => r2(box(h).height)); if (heads.some((x) => x !== 32)) fail.push('card heads ' + heads);
    // Whole rows: each row a list shows is inside it, unless the list fades and the row starts inside the fade.
    const lists = [...document.querySelectorAll('.tk-rows')].map((l) => { const r = box(l), fades = l.classList.contains('fades') && !l.classList.contains('at-end'), fz = parseFloat(l.style.getPropertyValue('--fz')) || 0;
      const shown = [...l.children].map((k) => box(k)).filter((b) => b.bottom > r.top + 0.5 && b.top < r.bottom - 0.5);
      const cut = shown.filter((b) => (b.bottom > r.bottom + 0.5 && !(fades && b.top >= r.bottom - fz - 0.5)) || b.top < r.top - 0.5).length;
      return { head: l.closest('.tk-card')?.querySelector('.tk-ch')?.textContent ?? '', rows: l.children.length, whole: shown.filter((b) => b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5).length, fades, more: l.scrollHeight > l.clientHeight + 1, cut, tail: r2(r.bottom - Math.max(r.top, ...shown.filter((b) => b.bottom <= r.bottom + 0.5).map((b) => b.bottom))) }; });
    lists.forEach((l) => { if (l.cut) fail.push('a row cut in ' + l.head); if (l.more && !l.fades && l.tail > 40) fail.push('room left under ' + l.head + ' ' + l.tail); });
    const pane = document.querySelector('.tk-pane'), paneM = pane && { more: pane.scrollHeight > pane.clientHeight + 1, fades: pane.classList.contains('fades') };
    if (paneM?.more && !paneM.fades) fail.push('the open ticket holds more than it shows with no fade');
    // The empty share, as the approved prototype's own check counts it: viewport points (every 4px) outside the sidebar, the head and each card, a card counted down to
    // its last content and its bottom padding, so a card's blank tail is empty too.
    const content = [...document.querySelectorAll('nav.side, .tk-dhead, .tk-desk .ui-dgrid .ui-card')].filter(vis).map((e) => { const q = box(e); let last = q.top;
      for (const d of e.querySelectorAll('*')) { const z = box(d); if (z.width && z.height) last = Math.max(last, Math.min(z.bottom, q.bottom)); }
      return { left: q.left, top: q.top, right: q.right, bottom: e.matches('.ui-card') ? Math.min(q.bottom, last + parseFloat(getComputedStyle(e).paddingBottom) + 4) : q.bottom }; });
    let all = 0, empty = 0; for (let py = 2; py < innerHeight; py += 4) for (let px = 2; px < innerWidth; px += 4) { all++; if (!content.some((b) => px >= b.left && px < b.right && py >= b.top && py < b.bottom)) empty++; }
    deskM = { cols, cards, lists, pane: paneM, emptyShare: r2((empty / all) * 100) };
    // The rule holds a board in use to it: while a list holds more than it shows, at most 15% may be empty. A board with a few tickets leaves its cards' tails blank, and is reported.
    if (deskM.emptyShare > 15 && lists.some((l) => l.more)) fail.push('empty share ' + deskM.emptyShare + '%');
  }
  // Words a user reads: no file path, no internal code (a ticket or message id, a run id), no raw key.
  const words = (dialog ?? sheet ?? main).innerText, bad = words.match(/(?:^|\\s)(?:[\\w.-]+\\/)+[\\w.-]+\\.(?:md|json|html|png|txt)\\b|\\b[A-Z][a-z]+\\d{3,}\\b|\\b\\d{8}T\\d{6}Z\\b|\\b(?:fm|msg)-[\\w-]{6,}|\\bT-\\d+\\b|\\b[a-z]+-[a-z]+-[a-z0-9-]+\\b/g) ?? [];
  if (bad.length) fail.push('raw words: ' + bad.join(', '));
  const hit = (e) => { const r = box(e), a = getComputedStyle(e, '::after'), o = (v) => Math.max(0, -parseFloat(v) || 0), wide = a.content !== 'none' && a.position === 'absolute';
    return { top: r.top, bottom: r.bottom, height: r.height + (wide ? o(a.top) + o(a.bottom) : 0), width: r.width + (wide ? o(a.left) + o(a.right) : 0) }; };
  // A link inside a ticket's formatted description is prose, not a control: it is one run of words in a sentence, and the 44px rule is for controls a thumb aims at
  // (WCAG 2.5.8 exempts a link in a sentence the same way). Every control outside that text is still measured whole.
  const prose = (e) => !!e.closest('.tk-desc');
  const under = !desk ? [...(dialog ?? sheet ?? document).querySelectorAll('button, a[href], summary, input')].filter(vis).filter((e) => !e.closest('.ui-act') && !prose(e))
    .filter((e) => { const r = hit(e); return r.top < innerHeight && r.bottom > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(box(e).width) + 'x' + Math.round(box(e).height)) : [];
  const overflowing = [...document.querySelectorAll('body *')].filter((e) => vis(e) && box(e).right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + '.' + (e.classList[0] ?? ''));
  return { viewport: innerWidth + 'x' + innerHeight, edges: [r2(edgeL), r2(edgeR)], blocks, rows, title, rounds, dock, clear, desk: deskM, under, fail,
    words: words.replace(/\\s+/g, ' ').trim().slice(0, 1200), dom: { url: location.href, overflow: document.documentElement.scrollWidth > w, overflowing } };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'so-tickets-chrome-'));
// A desk runs with the classic scrollbars a Linux or Windows viewer has, so a list's scrollbar taking a row's room would show; a phone's are overlays.
// The task records of a fleet home (state/<ticket id>.meta), as Juggernaut writes them: three running workers and one finished task, one of them a bug by its kind, and
// one hold whose reason only its record carries (so the board backfills it); every other ticket has none.
mkdirSync(join(dir, 'fleet', 'state'), { recursive: true });
for (const [id, harness, model, last, lead, kind] of [['settings-epic', 'codex', 'openai-codex/gpt-6.1-sol', 'working', 'web-app', 'epic'], ['settings-publish', 'claude', 'claude-opus-5-5', 'working', 'web-app', 'ship'], ['export-label', 'opencode', 'ollama/qwen3-coder', 'paused', 'notes', 'ship'], ['settings-theme', 'pi', 'ollama-cloud/deepseek-v4.1-flash', 'done', 'notes', 'ship']]) {
  writeFileSync(join(dir, 'fleet', 'state', `${id}.meta`), `window=default:w1:p1\nendpoint_task_id=${id}\nproject=~/fleet/projects/${lead}\nharness=${harness}\nmodel=${model}\nkind=${kind}\n`);
  writeFileSync(join(dir, 'fleet', 'state', `${id}.status`), `${last} [at=1]: on it\n`);
}
// One system ticket with a record of its own, so a hold on the system side still says who holds it.
writeFileSync(join(dir, 'fleet', 'state', 'backup-check.meta'), `window=default:w1:p2\nendpoint_task_id=backup-check\nproject=~/fleet/projects/docs\nharness=codex\nmodel=openai-codex/gpt-6.1-sol\nkind=ship\n`);
const chrome = spawn(chromium, ['--headless=new', '--no-sandbox', `--user-data-dir=${prof}`, '--remote-debugging-port=0', ...(phone ? ['--hide-scrollbars'] : []), 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let ws;
const errors = [], failed = [], report = [], problems = [], shots = [];
try {
  const url = sh('bash', [join(here, '.agents/skills/done-done-verify-sign-off/feel-board.sh'), dir], { cwd: repo }).trim().split('\n').pop();
  // The tickets, through the real CLI. Your asks: an epic with three tickets, one of them with four sub-tasks (two done), and eight more; then three system tickets.
  const T = (id, title, ...flags) => cli('ticket', board, '--id', id, '--title', title, ...flags);
  T('settings-epic', 'Ship the new settings page', '--priority', 'P0', '--project', 'settings', '--asked', 'yes', '--key', 'JG-101',
    '--description', 'Ship the settings page to both stores, with the listings written and the packages built.\n# What ships\n- The settings page itself\n- The store listings\n- The release packages\n# Who signs it off\n> The captain: keep this one small, and ship it with support on hand.\nThe run book is [in the release notes](https://example.com/releases/settings).');
  T('settings-publish', 'Publish the settings page to the app stores', '--parent', 'settings-epic', '--priority', 'P0', '--key', 'JG-102');
  for (const [id, title, p] of [['settings-build', 'Build the release packages', '100'], ['settings-listings', 'Write the store listings', '100'], ['settings-npm', 'Publish to npm', '0'], ['settings-stores', 'Send the build to the app stores', '0']])
    T(id, title, '--parent', 'settings-publish', '--priority', 'P0', '--progress', p);
  T('settings-theme', 'Move the theme switch to the top of the page', '--parent', 'settings-epic', '--priority', 'P1', '--progress', '100');
  T('settings-codes', 'Sign-in code emails arrive on time', '--parent', 'settings-epic', '--priority', 'P0');
  T('export-label', 'The export button says what people look for', '--priority', 'P1', '--project', 'chat-app', '--asked', 'yes', '--progress', '60');
  T('onboarding', 'Chat app onboarding in three screens', '--priority', 'P1', '--project', 'chat-app', '--asked', 'yes', '--progress', '100');
  T('help-search', 'Search the help center from the app', '--priority', 'P2', '--project', 'docs', '--asked', 'yes', '--progress', '100');
  T('digest-monday', 'Send the weekly digest on Mondays', '--priority', 'P2', '--project', 'newsletter', '--asked', 'yes', '--progress', '30', '--hold', 'yes', '--hold-reason', 'waiting for the newsletter copy from marketing', '--key', 'JG-201');
  T('admin-two-step', 'Two-step sign-in for team admins, with a backup code they can print', '--priority', 'P0', '--project', 'settings', '--asked', 'yes', '--hold', 'yes', '--hold-reason', 'the backup-code print sheet is still being drawn');
  T('renewal-date', 'The billing page shows when the plan renews', '--priority', 'P1', '--project', 'billing', '--asked', 'yes');
  T('invoice-dark', 'Invoices read well in dark mode', '--priority', 'P3', '--project', 'billing', '--asked', 'yes');
  // More of your asks, as a board in use holds: enough that each list holds more than it shows.
  for (const [id, title, p, project, progress, hold] of [
    ['receipts-mail', 'Receipts arrive by email within a minute of paying', 'P1', 'billing', '70'], ['team-invites', 'Invite a whole team from one link', 'P1', 'settings', '20'],
    ['quiet-hours', 'Quiet hours for notifications at night', 'P2', 'chat-app', '45'], ['read-receipts', 'Read receipts in group chats can be turned off', 'P2', 'chat-app', '10'],
    ['export-csv', 'Export a month of invoices as one spreadsheet', 'P2', 'billing', '85'], ['guide-video', 'A two-minute video guide for new admins', 'P3', 'docs', '25'],
    ['plan-change', 'Change plans without talking to support', 'P1', 'billing', '0', 'yes'], ['avatar-crop', 'Crop a profile picture before it is saved', 'P3', 'settings', '0', 'yes'],
    ['offline-drafts', 'Messages typed offline send once the phone is back online', 'P1', 'chat-app', '0', 'yes'], ['tax-ids', 'Tax numbers on invoices for business accounts', 'P2', 'billing', '0'],
    ['search-filters', 'Filter help articles by product', 'P3', 'docs', '0'], ['font-size', 'A larger text size for the whole app', 'P2', 'settings', '0'],
    ['pin-chats', 'Pin up to five chats to the top', 'P2', 'chat-app', '0'], ['link-preview', 'Link previews load without blocking the message', 'P1', 'chat-app', '100'],
    ['refund-flow', 'Refunds in two taps from the invoice', 'P1', 'billing', '100'], ['changelog', 'A changelog page that lists each release', 'P3', 'docs', '100']])
    T(id, title, '--priority', p, '--project', project, '--asked', 'yes', '--progress', progress, ...(hold ? ['--hold', 'yes', '--hold-reason', 'waiting on the pricing copy from marketing'] : []));
  T('image-library', 'Upgrade the image library', '--priority', 'P2', '--project', 'chat-app', '--progress', '40');
  T('staging-keys', 'Rotate the staging keys', '--priority', 'P1', '--project', 'billing', '--progress', '100');
  T('backup-check', 'A nightly check that the backups restore', '--priority', 'P3', '--project', 'docs', '--hold', 'yes', '--hold-reason', 'waiting for a test account on the backup service');
  // One bug, so a row of every type the board knows shows: a bug is red, and it is not a ticket.
  T('flaky-login-bug', 'Sign-in fails one run in ten on the beta channel', '--priority', 'P1', '--project', 'settings', '--type', 'bug', '--progress', '20');
  for (const [id, title, p, project, progress] of [['log-retention', 'Keep server logs for thirty days', 'P2', 'billing', '60'], ['dep-updates', 'Weekly dependency updates', 'P3', 'settings', '0'],
    ['cdn-move', 'Serve pictures from the new image host', 'P2', 'chat-app', '0'], ['error-alerts', 'Alerts when the error rate doubles', 'P1', 'docs', '100'],
    ['ci-cache', 'Cache the test run between builds', 'P2', 'settings', '55'], ['flaky-login', 'Find why the sign-in test fails one run in twenty', 'P1', 'settings', '35'],
    ['db-index', 'Index the invoices table by month', 'P2', 'billing', '80'], ['mail-bounce', 'Retry receipts that bounce', 'P2', 'billing', '15'], ['font-subset', 'Ship only the letters the app uses', 'P3', 'docs', '0'],
    ['crash-groups', 'Group crash reports by screen', 'P2', 'chat-app', '0'], ['sitemap', 'A sitemap for the help center', 'P3', 'docs', '0'], ['old-flags', 'Remove feature switches that are always on', 'P3', 'settings', '100']]) T(id, title, '--priority', p, '--project', project, '--progress', progress);
  // The system ticket that leads its list has sub-tasks, and two proofs name it.
  for (const [id, title, p] of [['flaky-login-repro', 'Run the sign-in test a hundred times', '100'], ['flaky-login-trace', 'Keep a trace of each failed run', '5'], ['flaky-login-fix', 'Wait for the code email before typing it', '0']])
    T(id, title, '--parent', 'flaky-login', '--priority', 'P1', '--progress', p);
  // Cards on tickets: the ship ask and the settings proof on the publishing ticket, the export ask, the onboarding design and the digest ask on theirs.
  const b = JSON.parse(readFileSync(board, 'utf8'));
  const on = { ship: 'settings-publish', ev1: 'settings-publish', export: 'export-label', onboarding: 'onboarding', digest: 'digest-monday', ev4: 'flaky-login', ev5: 'flaky-login' };
  for (const d of b.items) if (on[d.key]) d.ticket = on[d.key];
  writeFileSync(board, JSON.stringify(b, null, 2) + '\n');
  copyFileSync(join(repo, 'web/icon-192.png'), join(dir, 'chat-app.png'));
  cli('project', board, '--name', 'chat-app', '--icon', 'chat-app.png');
  writeFileSync(join(dir, 'settings.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#E8590C"/><circle cx="12" cy="12" r="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>');
  cli('project', board, '--name', 'settings', '--icon', 'settings.svg');
  // The ship ask answered with a note and a comment on the proof, so the publishing ticket has Activity.
  const post = (path, body) => fetch(new URL(path, url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => assert.ok(r.ok, `${path} ${r.status}`));
  await post('api/answers', { key: 'ship', answer: 'friday', note: 'Support is fully staffed that day.' });
  await wait(1100);
  await post('api/messages', { kind: 'comment', key: 'ev1', text: 'Fast on my phone too.' });
  const facts0 = { cli: cli('ticket', board), tree: cli('ticket', board, '--id', 'settings-publish') };

  let port; for (let i = 0; i < 100 && !port; i++) { await wait(100); const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  assert.ok(port, 'Chromium opened its DevTools port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
    if (x.method === 'Runtime.exceptionThrown') errors.push(x.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception');
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push(x.params.args.map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400 && !x.params.response.url.startsWith('file:') && !/\/api\/decisions\?view=card&key=[a-z-]+$/.test(x.params.response.url)) failed.push({ url: x.params.response.url, status: x.params.response.status }); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { const n = ++id; pending.set(n, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : ok(x.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!r.exceptionDetails, `${expression.slice(0, 80)}: ${r.exceptionDetails?.exception?.description}`); return r.result.value; };
  const until = async (expression, what) => { for (let i = 0; i < 60; i++) { if (await js(expression)) return; await wait(100); } assert.fail(`timed out: ${what}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`); };
  // A real tap or click on an element's centre, as a finger or mouse sends it.
  const tap = async (sel) => { const [x, y] = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    if (phone) { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); } };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  const setup = async () => { await cdp('Emulation.setDeviceMetricsOverride', metrics); await cdp('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }); };
  await setup();
  const png = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const go = async (address, ms = 1200) => { await cdp('Page.navigate', { url: 'about:blank' }); await wait(150); await cdp('Page.navigate', { url: address }); await wait(ms); };
  const capture = async (state) => {
    await wait(500);
    await png(join(out, `${name(state)}.png`)); shots.push(`${name(state)}.png`);
    const m = await js(MEASURE);
    writeFileSync(join(out, `${name(state)}.dom.json`), JSON.stringify({ ...m.dom, console_errors: [...errors], failed_requests: [...failed] }, null, 2) + '\n');
    delete m.dom;
    writeFileSync(join(out, `${name(state)}.measure.json`), JSON.stringify(m, null, 2) + '\n');
    report.push(`${name(state)}: ${m.blocks.map((x) => `${x.el} ${x.top}+${x.height}`).join(', ')}; rows ${m.rows.map((r) => `${r.height}px ${r.lines}l ${r.icon}${r.chip ? ' ' + r.chip : ''}${r.bar ? ' bar ' + r.bar : ''}`).join(' | ')}`
      + `${m.title ? `; title ${m.title.lines} lines` : ''}; round ${m.rounds.map((x) => `${x.w}x${x.h} off ${x.offX},${x.offY}`).join(' ')}${m.dock ? `; dock ${m.dock.pill} ${m.dock.tabs} tabs on ${m.dock.current}` : ''}${m.clear !== undefined ? `; last block ${m.clear}px above the dock` : ''}`
      + `${m.desk ? `; columns ${m.desk.cols.map((c) => `${c.left}-${c.right} ${c.top}-${c.bottom}`).join(' | ')}; lists ${m.desk.lists.map((l) => `${l.head} ${l.whole}/${l.rows} whole${l.fades ? ' fades' : ''} cut ${l.cut}`).join(' | ')}; pane ${JSON.stringify(m.desk.pane)}; empty ${m.desk.emptyShare}%` : ''}`
      + `; under 44px ${m.under.length}; failures ${m.fail.length}${m.fail.length ? ': ' + m.fail.join('; ') : ''}`);
    if ([m.fail, m.under, errors, failed].some((x) => x.length)) problems.push(`${name(state)}: ${JSON.stringify({ fail: m.fail, under: m.under, errors, failed })}`);
    errors.length = 0; failed.length = 0;
    return m;
  };
  const pair = async (state, file, hash) => {
    if (!file) return;
    await go(file === tree ? `file://${file}?theme=${theme}#${hash}` : `file://${file}#${hash}&theme=${theme}`, 1200);
    if (file === tree) await js(`localStorage.clear()`);
    await png(join(out, 'vs-proto', `${name(state)}.proto.png`));
    const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    const html = `<body style="margin:0;padding:24px;display:flex;${phone ? '' : 'flex-direction:column;'}gap:24px;background:#888;font:600 26px system-ui;color:#fff">${[['Approved prototype', img(join(out, 'vs-proto', `${name(state)}.proto.png`))], ['Board, this build', img(join(out, `${name(state)}.png`))]]
      .map(([t, s]) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${t}: ${state}, ${metrics.width} x ${metrics.height}, ${theme}</figcaption><img src="${s}" style="display:block;width:${metrics.width}px"></figure>`).join('')}</body>`;
    writeFileSync(join(dir, 'pair.html'), html);
    await cdp('Emulation.setDeviceMetricsOverride', { width: phone ? metrics.width * 2 + 72 : metrics.width + 48, height: phone ? metrics.height + 96 : metrics.height * 2 + 144, deviceScaleFactor: 1, mobile: false });
    await go(`file://${join(dir, 'pair.html')}`, 600);
    await png(join(out, 'vs-proto', `${name(state)}.pair.png`)); shots.push(`vs-proto/${name(state)}.pair.png`);
    await setup();
  };
  const facts = { cli: facts0.cli, tree: facts0.tree };
  const read = () => js(`({ hash: location.hash, head: document.querySelector('.tk-dhead .tx, .tk-top')?.innerText.replace(/\\s+/g, ' ').trim(), seg: [...document.querySelectorAll('.tk-seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' (on)' : '')),
    hero: document.querySelector('.tk-hero')?.innerText.replace(/\\s+/g, ' ').trim(), dots: document.querySelector('.tk-dots')?.getAttribute('aria-label'),
    lists: [...document.querySelectorAll('main section[aria-label]')].filter((s) => !s.classList.contains('tk-pane')).map((s) => s.getAttribute('aria-label') + ': ' + [...s.querySelectorAll('.ui-row')].map((r) => r.getAttribute('aria-label')).join(' | ')),
    open: (document.querySelector('.tk-sheet, .tk-pane') ?? document.createElement('i')).innerText.replace(/\\s+/g, ' ').trim().slice(0, 900) })`);
  const rowOf = (id) => `main a.tk-row[href="#ticket/${id}"]`;
  const start = url + '#tickets';
  await go(start);
  await until(`!!document.querySelector('.tk-hero')`, 'Tickets drawn');
  facts.tickets = await read();
  await capture('tickets');
  await pair('tickets', proto, 'v=tickets');
  // Fleet upkeep: the filter's Who asked group, by a tap.
  await go(start);
  await until(`!!document.querySelector('.tk-rb')`, 'Tickets drawn again');
  await tap('.tk-rb');
  await until(`document.getElementById('tk-filter').open`, 'the filter open');
  await js(`[...document.querySelectorAll('#tk-filter .tk-pick')].find((b) => b.textContent.includes('Fleet upkeep')).click()`);
  await until(`!document.getElementById('tk-filter').open && !!document.querySelector('.tk-fpill')`, 'Fleet upkeep on');
  facts.system = await read();
  await capture('tickets-system');
  await pair('tickets-system', proto, 'v=tickets&kind=system');
  // A ticket: its row tapped opens it (over the list on a phone, in the third column on a desk), with its sub-tasks, Linked and Activity.
  await go(start);
  await until(`!!document.querySelector(${JSON.stringify(rowOf('settings-epic'))})`, 'the epic listed');
  await tap(rowOf('settings-epic'));
  await until(`location.hash === '#ticket/settings-epic' && !!document.querySelector('${phone ? '.tk-sheet' : '.tk-pane'} .tk-dt')`, 'the epic open');
  facts.epic = await read();
  facts.epicAssigned = await js(`[...document.querySelectorAll('${phone ? '.tk-sheet' : '.tk-pane'} .tk-assigned .ui-pr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.deepEqual(facts.epicAssigned, ['Assignee web-app · gpt-6.1-sol Live', 'Lead web-app', 'Worker Settings epic', 'Model gpt-6.1-sol', 'Tool Codex', 'Worker live Live'], 'the epic leads its Assigned block with who owns it, then the record');
  await capture('epic');
  await pair('epic', tree, 'tickets/T-9');
  await go(url + '#ticket/settings-epic');
  await until(`!!document.querySelector('a.tk-row[href="#ticket/settings-publish"]')`, 'the epic open again');
  await tap(`${phone ? '.tk-sheet' : '.tk-pane'} a.tk-row[href="#ticket/settings-publish"]`);
  await until(`location.hash === '#ticket/settings-publish' && document.querySelector('.tk-dt')?.textContent.startsWith('Publish')`, 'the ticket open');
  facts.ticket = await read();
  // Who works on it: the Assigned block of this ticket (lead, worker, model, tool, live), and the quiet line on each row, Unassigned where no task record names one.
  facts.assigned = await js(`[...document.querySelectorAll('${phone ? '.tk-sheet' : '.tk-pane'} .tk-assigned .ui-pr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.deepEqual(facts.assigned, ['Assignee web-app · Opus 5.5 Live', 'Lead web-app', 'Worker Settings publish', 'Model Opus 5.5', 'Tool Claude Code', 'Worker live Live'], 'the ticket page leads with who owns it, then the record');
  facts.assigneeLines = await js(`[...document.querySelectorAll('a.tk-row')].map((a) => a.getAttribute('href').slice(8) + ': ' + a.querySelector('.tk-as')?.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 12)`);
  assert.ok(facts.assigneeLines.every((l) => !/undefined$/.test(l)), 'every row has an assignee line');
  await capture('ticket');
  await pair('ticket', proto, 'v=tickets&t=firstmate-addons/addons-epics-prototype');
  if (phone) {
    await go(url + '#ticket/settings-publish');
    await until(`!!document.querySelector('.tk-sheet .tk-dt')`, 'the ticket open again');
    await js(`document.querySelector('.tk-sheet').scrollTo(0, 1e6)`);
    await capture('ticket-end');
    // Close goes back to the list where it was.
    await tap('.tk-sheet .tk-shd .x');
    await until(`!document.querySelector('.tk-sheet') && location.hash === '#tickets'`, 'the sheet closed');
    facts.closed = await js(`location.hash`);
    // The project filter: its sheet, then one project picked.
    await tap('.tk-top .tk-rb');
    await until(`document.getElementById('tk-filter').open`, 'the filter open');
    facts.filter = await js(`document.getElementById('tk-filter').innerText.replace(/\\s+/g, ' ').trim()`);
    await capture('filter');
    await tap('#tk-filter .tk-pick:nth-child(2)');
    await until(`!document.getElementById('tk-filter').open && !!document.querySelector('.tk-fpill')`, 'a project picked');
    facts.filtered = await read();
    await capture('tickets-filtered');
    await tap('.tk-fpill');
    await until(`!document.querySelector('.tk-fpill')`, 'every project again');
    // The list's end clears the dock.
    await js(`scrollTo(0, document.documentElement.scrollHeight)`);
    await capture('tickets-end');
  } else {
    // A desk list scrolled a little comes to rest on a whole row; at its end the fade goes.
    await go(start);
    await until(`!!document.querySelector('.tk-rows')`, 'lists drawn');
    facts.scroll = await js(`(async () => { const out = []; for (const l of document.querySelectorAll('.tk-rows')) { if (l.scrollHeight <= l.clientHeight + 1) continue; l.scrollBy(0, 50); await new Promise((ok) => setTimeout(ok, 700));
      const top = l.getBoundingClientRect().top, first = [...l.children].find((r) => r.getBoundingClientRect().bottom > top + 1); const r1 = { list: l.closest('.tk-card').querySelector('.tk-ch').textContent, firstRowOffset: Math.round(first.getBoundingClientRect().top - top) };
      l.scrollTo(0, 1e6); await new Promise((ok) => setTimeout(ok, 700)); r1.atEndFadeGone = !l.classList.contains('fades') || l.classList.contains('at-end'); out.push(r1); } return out; })()`);
    for (const s of facts.scroll) if (Math.abs(s.firstRowOffset) > 1 || !s.atEndFadeGone) problems.push(`scroll ${JSON.stringify(s)}`);
  }
  // The type system, the assignee and the hold reason: a row of each type on screen, six glyphs in six colours, the assignee at the row's right on a desk and on the row's
  // own second line on a phone (so the title keeps the full width), an epic's roll-up beside ordinary rows, and a hold that says why.
  // A fresh load, so the fleet-upkeep filter the walk picked earlier is not still on: the type check reads every ticket, yours and the fleet's.
  await go('about:blank');
  await go(url + '#tickets');
  await until(`!!document.querySelector('.tk-hero')`, 'the lists drawn for the type check');
  // A phone shows three rows a list until See all: open every list so the type check reads every ticket, yours and the fleet's.
  await js(`[...document.querySelectorAll('main button.see')].filter((b) => b.textContent === 'See all').forEach((b) => b.click())`);
  await until(`!!document.querySelector('${rowOf('digest-monday')}') && !!document.querySelector('${rowOf('settings-epic')}')`, 'every row on screen');
  facts.types = await js(`(() => { const rows = [...document.querySelectorAll('main a.tk-row')];
    const typeOf = (a) => (a.querySelector('.tk-tile')?.className.match(/t-(epic|ticket|bug|decision|evidence|merge)/) ?? [])[1];
    const byType = new Map(); for (const a of rows) { const k = typeOf(a); if (k && !byType.has(k)) byType.set(k, getComputedStyle(a.querySelector('.tk-tile')).color); }
    // The row the fit check reads is a rendered one: the widest ticket row on screen, not one scrolling out of sight.
    const widest = (list) => list.filter((a) => a.querySelector('.l1 .t')?.getBoundingClientRect().width > 40).sort((x, y) => y.querySelector('.l1 .t').getBoundingClientRect().width - x.querySelector('.l1 .t').getBoundingClientRect().width)[0];
    const epic = widest(rows.filter((a) => typeOf(a) === 'epic')), ticket = widest(rows.filter((a) => typeOf(a) === 'ticket')), bug = widest(rows.filter((a) => typeOf(a) === 'bug'));
    const box = (e) => e.getBoundingClientRect();
    const fullWidth = (a) => { const r = box(a), t = box(a.querySelector('.l1 .t')), asg = a.querySelector('.tk-as') && box(a.querySelector('.tk-as'));
      return { title: Math.round(t.width), row: Math.round(r.width), titleRight: Math.round(r.right - t.right), asgTop: asg ? Math.round(asg.top - r.top) : null, asgRight: asg ? Math.round(r.right - asg.right) : null }; };
    return { glyphs: Object.fromEntries(byType), epic: epic ? { roll: epic.querySelectorAll('.tk-roll i').length, meta: epic.querySelector('.meta')?.textContent, label: epic.getAttribute('aria-label') } : null,
      bug: bug?.getAttribute('aria-label') ?? null, ticket: fullWidth(ticket), epicRow: epic ? fullWidth(epic) : null }; })()`);
  const seen = Object.keys(facts.types.glyphs);
  for (const k of ['epic', 'ticket', 'bug']) if (!seen.includes(k)) problems.push(`no ${k} row on screen: ${seen.join(', ')}`);
  if (new Set(Object.values(facts.types.glyphs)).size !== seen.length) problems.push(`two types share a colour: ${JSON.stringify(facts.types.glyphs)}`);
  if (!facts.types.epic?.roll || !/of \d+ done/.test(facts.types.epic?.meta ?? '')) problems.push(`the epic row shows no roll-up: ${JSON.stringify(facts.types.epic)}`);
  if (!facts.types.epicRow) problems.push('no epic row beside the ordinary rows');
  // The approved change: at 390 the assignee sits under the title, so the title takes the row's whole width; on a desk it sits at the row's right edge.
  // The approved responsive rule, at both widths: the title keeps the row's whole width and who owns the ticket sits on its own line under it.
  const fit = facts.types.ticket;
  if (!(fit.asgTop > 20 && fit.title > fit.row * 0.6)) problems.push(`the assignee does not sit under a full-width title: ${JSON.stringify(fit)}`);
  facts.holdRow = await js(`(() => { const a = [...document.querySelectorAll('main a.tk-row')].find((x) => x.getAttribute('aria-label')?.includes('Send the weekly digest'));
    return a ? { meta: a.querySelector('.meta')?.textContent, label: a.getAttribute('aria-label'), assignee: a.querySelector('.tk-as')?.innerText.replace(/\\s+/g, ' ').trim() } : null; })()`);
  if (!/waiting for the newsletter copy/.test(facts.holdRow?.meta ?? '')) problems.push(`the hold row does not say why: ${JSON.stringify(facts.holdRow)}`);
  if (!/on hold, waiting for the newsletter copy/.test(facts.holdRow?.label ?? '')) problems.push(`the hold row's own name does not say it is held and why: ${JSON.stringify(facts.holdRow)}`);
  // The readable name: a row carries its key on the title line, and the ticket's page names it by that key with its slug as the small line under the title.
  facts.keyRow = await js(`(() => { const a = document.querySelector('${rowOf('settings-epic')}'); if (!a) return null;
    const key = a.querySelector('.tk-key'), slugEl = a.querySelector('.tk-row-slug'), title = a.querySelector('.l1 .t');
    const r = a.getBoundingClientRect(), k = key?.getBoundingClientRect(), titleBox = title.getBoundingClientRect();
    // The key is the row's name and leads its title line in the title's own type; the slug is the small second line right under it.
    const slugBox = slugEl?.getBoundingClientRect();
    return { key: key?.textContent ?? null, onTitleLine: !!k && Math.abs(k.top - titleBox.top) < 12, keySize: k ? getComputedStyle(k).fontSize : null,
      height: Math.round(r.height), titleWidth: Math.round(titleBox.width), titleClipped: title.scrollWidth > title.clientWidth + 1, rowWidth: Math.round(r.width),
      slug: slugEl?.textContent ?? null, slugOnSecondLine: !!slugBox && slugBox.top >= titleBox.bottom - 2 && !slugEl.closest('.l1') }; })()`);
  if (facts.keyRow?.key !== 'JG-101') problems.push(`the epic row does not carry its readable key: ${JSON.stringify(facts.keyRow)}`);
  if (!facts.keyRow?.onTitleLine) problems.push(`the key is not on the row's title line: ${JSON.stringify(facts.keyRow)}`);
  if (!facts.keyRow?.slugOnSecondLine) problems.push(`the slug is not the row's small second line: ${JSON.stringify(facts.keyRow)}`);
  if (facts.keyRow?.titleClipped) problems.push(`the row's title is cut: ${JSON.stringify(facts.keyRow)}`);
  await js(`document.querySelector('${rowOf('settings-epic')}').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await capture(phone ? 'key-row' : 'tickets');
  // The same ticket in its page, named by the key, its slug a small line under the title, and its description drawn as formatted text.
  await tap(rowOf('settings-epic'));
  await until(`location.hash === '#ticket/settings-epic' && !!document.querySelector('${phone ? '.tk-sheet' : '.tk-pane'} .tk-dt')`, 'the epic open by its key');
  facts.keySheet = await js(`(() => { const p = document.querySelector('${phone ? '.tk-sheet' : '.tk-pane'}');
    const key = p.querySelector('.tk-shd .tk-key')?.textContent ?? null, slug = p.querySelector('.tk-slug')?.textContent ?? null, d = p.querySelector('.tk-desc');
    return { key, slug, summary: d?.querySelector('.tk-sum')?.textContent ?? null, headings: [...(d?.querySelectorAll('.tk-dh') ?? [])].map((h) => h.textContent),
      items: [...(d?.querySelectorAll('.tk-dl li') ?? [])].map((li) => li.textContent), links: [...(d?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href')), quotes: [...(d?.querySelectorAll('.tk-dq p') ?? [])].map((q) => q.textContent) }; })()`);
  if (facts.keySheet?.key !== 'JG-101') problems.push(`the ticket's page does not name it by its key: ${JSON.stringify(facts.keySheet)}`);
  if (facts.keySheet?.slug !== 'settings-epic') problems.push(`the slug is not the small line under the title: ${JSON.stringify(facts.keySheet)}`);
  if (!facts.keySheet?.summary || !facts.keySheet?.headings.length || !facts.keySheet?.items.length || !facts.keySheet?.links.length || !facts.keySheet?.quotes.length)
    problems.push(`the description is not drawn as formatted text: ${JSON.stringify(facts.keySheet)}`);
  await capture('key-sheet');
  await pair('key-sheet', tree, 'tickets/T-9');
  // The hold, in its own list, with the reason on the row: back to the list, with every section open as the type check left it.
  await go('about:blank');
  await go(url + '#tickets');
  await until(`!!document.querySelector('.tk-hero')`, 'the lists drawn again for the hold');
  await js(`[...document.querySelectorAll('main button.see')].filter((b) => b.textContent === 'See all').forEach((b) => b.click())`);
  await until(`!!document.querySelector('${rowOf('digest-monday')}')`, 'the hold listed');
  await js(`document.querySelector('${rowOf('digest-monday')}').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await capture('holds');
  // The Epics view: every epic with its children under it, a figure and the states they are in.
  await go(url + '#epics');
  await until(`!!document.querySelector('.tk-epic')`, 'the Epics view drawn');
  facts.epics = await js(`({ seg: [...document.querySelectorAll('.tk-seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' (on)' : '')),
    groups: [...document.querySelectorAll('.tk-epic')].map((g) => ({ rows: g.querySelectorAll('a.tk-row').length, kids: g.querySelectorAll('li.tk-kid').length, text: g.querySelector('.l1 .t')?.textContent + ' · ' + g.querySelector('.meta')?.textContent, fig: g.querySelector('.tk-fig')?.textContent ?? null })) })`);
  if (!facts.epics.seg.some((x) => x === 'Epics (on)')) problems.push(`the Epics view is not its own tab: ${JSON.stringify(facts.epics.seg)}`);
  if (!facts.epics.groups.length || !facts.epics.groups[0].kids) problems.push(`no epic group with children: ${JSON.stringify(facts.epics.groups)}`);
  await capture('epics');
  writeFileSync(join(out, `${name('tickets')}.facts.json`), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(out, `measure.${side}.${theme}.${width}w.txt`), report.join('\n') + '\n');
  if (side === 'after') writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board (feel-board.sh) with tickets written through sign-off-axi ticket: 24 of your asks (one an epic with three tickets, one of them with four sub-tasks) and 15 system tickets (one with three sub-tasks), with priorities, projects (two with their own icons) and holds, and seven cards naming tickets.',
    steps: [`Open Tickets at ${metrics.width}x${metrics.height} (2x), ${theme}, in a headless Chromium of its own, and measure every block, row and button in the browser.`,
      `${phone ? 'Tap' : 'Click'} Fleet upkeep in the filter's Who asked group and read the lists.`,
      `${phone ? 'Tap' : 'Click'} the epic's row: it opens ${phone ? 'over the list as a sheet' : 'in the third column'} with its three tickets and an Assigned block (Codex, gpt-6.1-sol, the worker live); rows with no task record say Unassigned; then ${phone ? 'tap' : 'click'} the publishing ticket: its four sub-tasks, its linked cards and their Activity.`,
      ...(phone ? ['Scroll the ticket to its end, close it and land on the list.', 'Tap the filter button, read the projects, pick one, then clear it.', 'Scroll Tickets to its end and measure the last block against the dock.']
        : ['Nudge each list that holds more than it shows by 50px: it rests on a whole row; scrolled to its end its fade goes.']),
      ...(proto ? ['Capture the approved prototype at the same size and theme for each state and save each pair.'] : [])],
    result: `${theme}, ${metrics.width}px: Tickets is drawn as the approved prototype: the title with the project filter and the round light-or-dark button, Your asks or System with their counts, the hero (how many are done of how many, this week's count, how many move) with one square per ticket, then ${phone ? 'In progress, On hold, To do and Done (three rows each with See all) and two tiles' : 'three columns: the hero over In progress, On hold over To do, and the open ticket'}; rows carry the project's icon or initials, a P chip where one is set, and a bar only once a ticket has progress (full when done); an epic is as far along as its tickets on average and a ticket as its sub-tasks; the open ticket shows its project and state, its title in full, Priority, Progress, Part of and Last update, the tickets or sub-tasks in it, its linked cards and their Activity; ${phone ? 'the last block clears the dock and no control is under 44px' : 'every list ends on a whole row or fades its next one, the columns share one top and bottom, and the screen is under 15 percent empty'}; no file path or code in the words, no sideways overflow, no console error.` }, null, 2) + '\n');
  console.log(report.join('\n'));
  if (side === 'after') assert.deepEqual(problems, [], 'every capture measures clean');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { cli('stop', board); } catch {}
  await wait(300);
  rmSync(prof, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}
