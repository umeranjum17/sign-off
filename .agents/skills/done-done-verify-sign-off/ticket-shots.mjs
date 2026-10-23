// Tickets on the board, one theme and width per run: a card of each kind posted with --ticket shows a Ticket row (the ticket's title, id and progress) that opens
// the ticket's page; the same kind posted without one, and a card naming a ticket the board has not got, show no row; the ticket's page lists its cards newest first
// and the tickets under it, and its Back returns to the card.
// Usage: node .agents/skills/done-done-verify-sign-off/ticket-shots.mjs <output> [light|dark]   (TICKET_WIDTH=390|1280, default 390)
// Saves <state>.<theme>.<width>w.png and .txt (the screen's Ticket rows, the ticket page's lists, overflow) and cli.<theme>.<width>w.txt (ticket list and show).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.env.TICKET_WIDTH ?? 390);
const repo = resolve('.'), cell = `${theme}.${width}w`;
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-ticket-'));
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-ticket-${process.pid}` };
const seedEnv = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
const sh = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browser = (...args) => sh('chrome-devtools-axi', args, { env });
const board = join(dir, 'board.json'), so = (...args) => sh(process.execPath, [join(repo, 'dist/cli.js'), ...args], { env: seedEnv, cwd: dir });
const value = (raw) => { let m = JSON.parse(raw.match(/result: (".*")/)[1]); while (typeof m === 'string') m = JSON.parse(m); return m; };
const wait = (ms) => browser('eval', `() => new Promise((ok) => setTimeout(ok, ${ms}))`);
// What a screen holds: its title, each Ticket row's words and size, the ticket page's lists, and anything wider than the screen.
const probe = `() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const words = (e) => e.innerText.replace(/\\s+/g, ' ').trim(), w = document.documentElement.clientWidth;
  // A report or plan opened over the board covers the desk's pane under it: only what is on top counts.
  const rows = [...(document.querySelector('#reader:not([hidden])') ?? document).querySelectorAll('.ticket-row')].filter(vis).map((r) => { const b = r.getBoundingClientRect(); return { text: words(r), href: r.getAttribute('href'), w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left), right: Math.round(w - b.right) }; });
  const first = (...sels) => { for (const s of sels) { const e = [...document.querySelectorAll(s)].find(vis); if (e) return words(e); } return ''; };
  const h1 = first('#reader:not([hidden]) h1', '.decide h2', '.ev-title', '#board h1');
  const lists = [...document.querySelectorAll('#board .tk-h')].map((h) => ({ head: words(h), rows: [...(h.nextElementSibling?.querySelectorAll('li') ?? [])].map(words) }));
  const wide = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > w + 1 && !e.closest('.split-list, iframe')).slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
  return JSON.stringify({ hash: location.hash, h1, rows, kicker: words(document.querySelector('.tk-kicker') ?? document.createElement('i')), done: words(document.querySelector('.tk-done') ?? document.createElement('i')), lists, overflow: document.documentElement.scrollWidth > w, wide });
}`;
// Each state, and the element its Ticket row sits under (or would): the shot centres it, so linked and unlinked cards show the same part of the card.
const STATES = [
  ['ask-linked', '#decide/settings-friday', '.ticket-row'], ['ask-unlinked', '#decide/ship', '.decide .proof-block, .decide .why'], ['ask-unknown-ticket', '#decide/settings-copy', '.decide .why'],
  ['proof-linked', '#evidence/settings-proof', '.ticket-row'], ['proof-unlinked', '#evidence/update-2', '.ev-say'],
  ['design-linked', '#designs/settings-screens', '.ticket-row'], ['design-unlinked', '#designs/chat-journeys', '.design-review .about'],
  ['report-linked', '#reports/settings-saves', '.ticket-row'], ['report-unlinked', '#reports/digest-ran', '.gd-top .sub'],
  ['plan-linked', '#waiting/faster-sign-in', '.ticket-row'], ['plan-unlinked', '#waiting/plan-kind-board', '.plan-main h2'],
  ['ticket', '#ticket/T-29', ''], ['ticket-parent', '#ticket/T-9', ''],
];
try {
  const base = sh('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  // Three tickets, one under another, then one card of each kind on T-29, posted after the seed's own (unlinked) cards, and one ask naming a ticket the board has not got.
  so('ticket', board, '--id', 'T-9', '--title', 'The new settings page', '--progress', '45');
  so('ticket', board, '--id', 'T-29', '--title', 'Ship the new settings page', '--progress', '60', '--parent', 'T-9');
  so('ticket', board, '--id', 'T-30', '--title', 'Settings copy review', '--progress', '100', '--parent', 'T-9');
  const ask = ['--ask-ref', 'message-demo', '--outcome', 'yes=It ships on Friday.', '--outcome', 'no=It waits a week.', '--recommend', 'yes', '--recommend-reason', 'Every check passed on a phone.', '--default', 'no'];
  so('raise', board, '--ticket', 'T-29', '--key', 'settings-friday', '--title', 'Ship the settings page on Friday?', '--why', 'It is built and checked on a phone; the release goes out Friday.', ...ask);
  so('raise', board, '--ticket', 'T-404', '--key', 'settings-copy', '--title', 'Keep the old settings link for a week?', '--why', 'Some readers still open the old page from their bookmarks.', ...ask);
  writeFileSync(join(dir, 'proof.json'), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, key: 'settings-proof', title: 'The settings page on a phone', filer: 'verify', about: 'Umer opens settings and changes the theme in one tap.', media: ['shot.webp'] }));
  so('post', board, '--kind', 'evidence', '--from', join(dir, 'proof.json'), '--ticket', 'T-29');
  const design = JSON.parse(readFileSync(join(dir, 'design-message.json'), 'utf8'));
  writeFileSync(join(dir, 'design-settings.json'), JSON.stringify({ ...design, key: 'settings-screens', title: 'Settings page screens', about: 'Review the settings screens on a phone and a desk.', group: 'Settings', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }));
  so('post', board, '--kind', 'design', '--from', join(dir, 'design-settings.json'), '--ticket', 'T-29');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), report = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-minimal.json'), 'utf8'));
  writeFileSync(join(dir, 'report-settings.json'), JSON.stringify({ ...report, key: 'settings-saves', title: 'How the settings page saves', about: 'Each change saves at once, so nothing is lost when Umer leaves the page.', filed: now, filer: 'verify', ticket: 'T-29' }));
  so('post', board, '--kind', 'report', '--from', join(dir, 'report-settings.json'));
  writeFileSync(join(dir, 'report-digest.json'), JSON.stringify({ ...report, filed: now, filer: 'verify' }));
  so('post', board, '--kind', 'report', '--from', join(dir, 'report-digest.json'));
  so('post', board, '--kind', 'plan', '--from', join(repo, 'fixtures/contract/plan.v3/valid-full.json'), '--ticket', 'T-29');
  writeFileSync(join(out, `cli.${cell}.txt`), `$ sign-off-axi ticket\n${so('ticket', board)}\n$ sign-off-axi ticket --id T-29\n${so('ticket', board, '--id', 'T-29')}\n`);
  browser('open', base);
  browser('emulate', '--viewport', `${width}x844x${width === 390 ? '2,mobile,touch' : '1'}`, '--color-scheme', theme);
  const seen = {};
  for (const [state, hash, anchor] of STATES) {
    browser('open', 'about:blank');
    browser('open', `${base}${hash}`);
    wait(900);
    if (anchor) browser('eval', `() => { document.querySelector(${JSON.stringify(anchor)})?.scrollIntoView({ block: 'center' }); return new Promise((ok) => setTimeout(ok, 400)); }`);
    const name = `${state}.${cell}`;
    browser('screenshot', join(out, `${name}.png`));
    const m = seen[state] = value(browser('eval', probe));
    writeFileSync(join(out, `${name}.txt`), `${state} ${theme} ${width}w ${hash}\ntitle: ${m.h1}\n${m.rows.length ? m.rows.map((r) => `Ticket row: "${r.text}" -> ${r.href}, ${r.w}x${r.h}px, ${r.left}px from the left and ${r.right}px from the right`).join('\n') : 'no Ticket row'}\n`
      + (m.kicker ? `kicker: ${m.kicker}\nprogress: ${m.done}\n` : '') + m.lists.map((l) => `${l.head}:\n${l.rows.map((r) => `  ${r}`).join('\n')}`).join('\n') + `${m.lists.length ? '\n' : ''}horizontal overflow ${m.overflow ? 1 : 0}${m.wide.length ? ` (${m.wide.join(', ')})` : ''}\n`);
    assert.equal(m.overflow, false, `${state}: wider than the screen: ${m.wide.join(', ')}`);
    assert.equal(m.rows.length, state.endsWith('-linked') ? 1 : 0, `${state}: ${JSON.stringify(m.rows)}`);
    if (m.rows.length) assert.deepEqual([m.rows[0].href, /Ship the new settings page T-29 60%/.test(m.rows[0].text)], ['#ticket/T-29', true], `${state}: ${m.rows[0].text}`);
  }
  // The ticket's page: under T-9, 60% done, its five cards newest first (the plan was posted last), none of the unlinked or unknown-ticket cards; T-9 lists the two tickets under it.
  assert.deepEqual([seen.ticket.kicker, seen.ticket.done, seen.ticket.lists[0].rows.length], ['The new settings page › T-29', '60% done', 5], JSON.stringify(seen.ticket));
  assert.deepEqual(seen['ticket-parent'].lists.map((l) => l.rows.length), [0, 2], JSON.stringify(seen['ticket-parent']));
  // A tap on the ask's Ticket row opens the ticket; Back returns to the ask.
  browser('open', 'about:blank');
  browser('open', `${base}#decide/settings-friday`);
  wait(900);
  const walk = value(browser('eval', `async () => {
    const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
    document.querySelector('.ticket-row').click(); await pause(600);
    const at = location.hash, title = document.querySelector('#board h1')?.textContent;
    document.querySelector('.top .back').click(); await pause(600);
    return JSON.stringify({ at, title, back: location.hash });
  }`));
  writeFileSync(join(out, `walk.${cell}.txt`), `Tap the Ticket row on #decide/settings-friday: the page is ${walk.at}, titled "${walk.title}".\nTap Back: the page is ${walk.back} again.\n`);
  assert.deepEqual(walk, { at: '#ticket/T-29', title: 'Ship the new settings page', back: '#decide/settings-friday' });
} finally {
  try { browser('stop'); } catch {}
  try { so('stop', board); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
