// Tickets on the board, one theme and width per run: a card of each kind posted with --ticket shows a Ticket row (the ticket's title, id and progress) that opens
// the ticket's page; the same kind posted without one, and a card naming a ticket the board has not got, show no row; the ticket's page lists its cards newest first
// and the tickets under it, and its Back returns to the card. A card's Activity thread lists, oldest first, what the board keeps of it: posted, each answer and note
// (the one a change replaced too), when its agent took it, a new round asked for and a comment; the ticket's page shows its cards' activity together.
// Usage: node .agents/skills/done-done-verify-sign-off/ticket-shots.mjs <output> [light|dark]   (TICKET_WIDTH=390|1280, default 390)
// Saves <state>.<theme>.<width>w.png and .txt (the screen's Ticket rows, the ticket page's lists, overflow) and cli.<theme>.<width>w.txt (ticket list and show).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
const out = resolve(process.env.TICKET_REVIEW_ROOT ?? process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), sealedOut = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT ?? out), theme = process.argv[3] ?? 'light', width = +(process.env.TICKET_WIDTH ?? 390);
const repo = resolve('.'), cell = `${theme}.${width}w`;
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-ticket-'));
const bridge = createServer(), bridgePort = await new Promise((ok, fail) => { bridge.once('error', fail); bridge.listen(0, '127.0.0.1', () => { const { port } = bridge.address(); bridge.close((error) => error ? fail(error) : ok(port)); }); });
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-ticket-${process.pid}`, CHROME_DEVTOOLS_AXI_PORT: process.env.CHROME_DEVTOOLS_AXI_PORT ?? String(bridgePort) };
const seedEnv = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share'), XDG_STATE_HOME: join(dir, '.local/state'), XDG_CACHE_HOME: join(dir, '.cache'), SIGN_OFF_FILER: 'verify' };
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
  const rows = [...(document.querySelector('#reader:not([hidden])') ?? document).querySelectorAll('.ui-props a.ui-pr[href^="#ticket/"]')].filter(vis).map((r) => { const b = r.getBoundingClientRect(); return { text: words(r), href: r.getAttribute('href'), w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left), right: Math.round(w - b.right) }; });
  const first = (...sels) => { for (const s of sels) { const e = [...document.querySelectorAll(s)].find(vis); if (e) return words(e); } return ''; };
  const h1 = first('.tk-sheet .tk-dt', '.tk-pane .tk-dt', '#reader:not([hidden]) h1', '.decide h2', '.ev-title', '#board h1');
  // A ticket, over Tickets on a phone and in its third column on a desk: where it stands, its progress, and its lists (the tickets under it, Linked, Activity).
  const tk = document.querySelector('.tk-sheet, .tk-pane'), lists = tk ? [...tk.querySelectorAll('.ui-dl')].map((h) => ({ head: words(h), rows: [...(h.nextElementSibling?.matches('ul, ol') ? h.nextElementSibling.children : [])].map(words) })) : [];
  const wide = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > w + 1 && !e.closest('.split-list, iframe')).slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
  const thread = tk ? [...tk.querySelectorAll('.ui-act li')].map((li) => [li.querySelector('.on'), li.querySelector('b')].filter(Boolean).map(words).join(' ')) : [...(document.querySelector('#reader:not([hidden])') ?? document).querySelectorAll('.ui-act li')].filter(vis).map((li) => [li.querySelector('b'), li.querySelector('.th-n'), li.querySelector('time')].filter(Boolean).map(words).join(' '));
  const kicker = tk ? words(tk.querySelector('.tk-shd p')) : '', done = tk ? words([...tk.querySelectorAll('.ui-pr')].find((p) => p.textContent.startsWith('Progress'))) : '';
  return JSON.stringify({ hash: location.hash, h1, rows, thread, kicker, done, lists, overflow: document.documentElement.scrollWidth > w, wide });
}`;
// Each state, and the element its Ticket row sits under (or would): the shot centres it, so linked and unlinked cards show the same part of the card.
const STATES = [
  ['ask-linked', '#decide/settings-friday', '.decide .ui-props'], ['ask-unlinked', '#decide/ship', '.decide .proof-block, .decide .why'], ['ask-unknown-ticket', '#decide/settings-copy', '.decide .why'],
  ['proof-linked', '#evidence/settings-proof', '.ui-props a.ui-pr[href^="#ticket/"]'], ['proof-unlinked', '#evidence/update-2', '.ev-say'],
  ['design-linked', '#designs/settings-screens', '.ui-props a.ui-pr[href^="#ticket/"]'], ['design-unlinked', '#designs/chat-journeys', '.design-review .about'],
  ['report-linked', '#reports/settings-saves', '.ui-props a.ui-pr[href^="#ticket/"]'], ['report-unlinked', '#reports/digest-ran', '.gd-top .sub'],
  ['plan-linked', '#waiting/faster-sign-in', '.ui-props a.ui-pr[href^="#ticket/"]'], ['plan-unlinked', '#waiting/plan-kind-board', '.plan-main h2'],
  ['ask-thread', '#decide/settings-search', '.thread'], ['proof-thread', '#evidence/settings-proof', '.thread'],
  ['tickets', '#tickets', ''], ['tickets-activity', '#tickets', '.tk-activity'], ['ticket', '#ticket/T-29', ''], ['ticket-activity', '#ticket/T-29', '.ui-act'], ['ticket-release', '#ticket/T-31', '.tk-sheet .ui-act, .tk-pane .ui-act'], ['ticket-answer-release', '#ticket/T-32', '.tk-sheet .ui-act, .tk-pane .ui-act'], ['ticket-lifecycle', '#ticket/T-33', '.tk-sheet .ui-act, .tk-pane .ui-act'], ['ticket-parent', '#ticket/T-9', ''],
];
try {
  const base = sh('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { cwd: repo, env: seedEnv }).trim().split('\n').pop();
  // Ticket histories, then one card of each kind on T-29 and one ask naming a ticket the board has not got.
  const ask = ['--ask-ref', 'message-demo', '--outcome', 'yes=It ships on Friday.', '--outcome', 'no=It waits a week.', '--recommend', 'yes', '--recommend-reason', 'Every check passed on a phone.', '--default', 'no'];
  so('ticket', board, '--id', 'T-9', '--title', 'The new settings page', '--progress', '45');
  so('ticket', board, '--id', 'T-29', '--title', 'Ship the new settings page', '--progress', '60', '--parent', 'T-9');
  so('ticket', board, '--id', 'T-30', '--title', 'Settings copy review', '--progress', '100', '--parent', 'T-9');
  so('ticket', board, '--id', 'T-31', '--title', 'Ship the settings release', '--stage', 'queued');
  so('ticket', board, '--id', 'T-31', '--stage', 'building', '--progress', '25');
  so('ticket', board, '--id', 'T-31', '--stage', 'review', '--progress', '60');
  so('ticket', board, '--id', 'T-31', '--hold', 'yes');
  so('ticket', board, '--id', 'T-31', '--stage', 'done', '--progress', '100');
  so('ticket', board, '--id', 'T-31', '--stage', '');
  so('ticket', board, '--id', 'T-32', '--title', 'Choose the rollout date', '--hold', 'yes');
  so('raise', board, '--ticket', 'T-32', '--key', 'hold-answer', '--title', 'When should the rollout ship?', '--why', 'Choose the rollout date.', ...ask);
  so('ticket', board, '--id', 'T-33', '--title', 'Validate ticket sync', '--stage', 'queued', '--progress', '25');
  so('ticket', board, '--id', 'T-33', '--stage', 'building');
  so('ticket', board, '--id', 'T-33', '--hold', 'yes');
  so('ticket', board, '--id', 'T-33', '--hold', 'no');
  so('ticket', board, '--id', 'T-33', '--stage', 'done', '--progress', '100');
  so('raise', board, '--ticket', 'T-29', '--key', 'settings-friday', '--title', 'Ship the settings page on Friday?', '--why', 'It is built and checked on a phone; the release goes out Friday.', ...ask);
  so('raise', board, '--ticket', 'T-404', '--key', 'settings-copy', '--title', 'Keep the old settings link for a week?', '--why', 'Some readers still open the old page from their bookmarks.', ...ask);
  writeFileSync(join(dir, 'proof.json'), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, key: 'settings-proof', title: 'The settings page on a phone', filer: 'verify', about: 'Umer opens settings and changes the theme in one tap.', media: ['shot.webp'] }));
  so('post', board, '--kind', 'evidence', '--from', join(dir, 'proof.json'), '--ticket', 'T-29');
  const design = JSON.parse(readFileSync(join(dir, 'design-message.json'), 'utf8'));
  writeFileSync(join(dir, 'design-settings.json'), JSON.stringify({ ...design, key: 'settings-screens', title: 'Approve the settings page screens?', about: 'Review the settings screens on a phone and a desk.', group: 'Settings', filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }));
  so('post', board, '--kind', 'design', '--from', join(dir, 'design-settings.json'), '--ticket', 'T-29');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), report = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v4/valid-minimal.json'), 'utf8'));
  writeFileSync(join(dir, 'report-settings.json'), JSON.stringify({ ...report, key: 'settings-saves', title: 'How the settings page saves', about: 'Each change saves at once, so nothing is lost when Umer leaves the page.', filed: now, filer: 'verify', ticket: 'T-29' }));
  so('post', board, '--kind', 'report', '--from', join(dir, 'report-settings.json'));
  writeFileSync(join(dir, 'report-digest.json'), JSON.stringify({ ...report, filed: now, filer: 'verify' }));
  so('post', board, '--kind', 'report', '--from', join(dir, 'report-digest.json'));
  so('post', board, '--kind', 'plan', '--from', join(repo, 'fixtures/contract/plan.v3/valid-full.json'), '--ticket', 'T-29');
  // A thread to show: an ask answered No with a note, changed to Yes with a note, taken by its agent, then a new round asked for; the proof gets a verdict and a comment.
  // Each goes through the board's own API, as a tap does, a second apart so the times read in order.
  so('raise', board, '--ticket', 'T-29', '--key', 'settings-search', '--title', 'Turn on search in the settings page?', '--why', 'Umer asked for it twice this week.', ...ask);
  const api = async (path, body) => { const r = await fetch(`${base}api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200, `${path} ${await r.text()}`); await new Promise((ok) => setTimeout(ok, 1100)); };
  const askReleaseBefore = Math.floor(Date.now() / 1000);
  await api('answers', { key: 'hold-answer', answer: 'no', note: 'Not this week.' });
  const asksTicket = JSON.parse(so('ticket', board, '--id', 'T-32', '--json')).ticket;
  assert.equal(asksTicket.hold, false, 'answering a linked ask must release its ticket hold');
  assert.equal(asksTicket.state, 'queued');
  assert.ok(asksTicket.last_event_at >= askReleaseBefore, JSON.stringify(asksTicket));
  const asksActivity = await (await fetch(`${base}api/state?view=tickets`)).json();
  const askReleased = asksActivity.ticketActivity.some((e) => e.ticket === 'T-32' && e.kind === 'release' && e.text === 'Hold released');
  assert.equal(askReleased, true, JSON.stringify(asksActivity.ticketActivity));
  writeFileSync(join(out, `hold-asks-answer.${cell}.json`), JSON.stringify({ path: 'asks-page answer', theme, width, ticket: 'T-32', hold: asksTicket.hold, state: asksTicket.state, last_event_at: asksTicket.last_event_at, release_activity: askReleased }, null, 2) + '\n');
  const oldEvent = Math.floor(Date.now() / 1000) - 3600;
  so('ticket', board, '--id', 'T-31', '--comment', JSON.stringify({ id: 'hold-comment', at: oldEvent, text: 'What should I choose?', picked: oldEvent, replies: [{ at: oldEvent, text: 'Friday.' }] }));
  const commentHold = JSON.parse(so('ticket', board, '--id', 'T-31', '--json')).ticket.hold;
  assert.equal(commentHold, false, 'a replied-to ticket comment must release its ticket hold');
  writeFileSync(join(out, `hold-comment-reply.${cell}.json`), JSON.stringify({ path: 'ticket-comment reply', theme, width, ticket: 'T-31', hold: commentHold }, null, 2) + '\n');
  await api('answers', { key: 'settings-search', answer: 'no', note: 'Not this week.' });
  await api('answers', { key: 'settings-search', answer: 'yes', note: 'After the Friday stand-up.' });
  so('wait', board, '--filer', 'verify', '--key', 'settings-search', '--timeout', '5');
  await new Promise((ok) => setTimeout(ok, 1100));
  await api('rounds', { key: 'settings-search', note: 'Show it on a phone first.' });
  await api('answers', { key: 'settings-proof', answer: 'pass', note: 'The theme switch works.' });
  await api('messages', { kind: 'comment', key: 'settings-proof', text: 'Add the dark theme next.' });
  writeFileSync(join(out, `cli.${cell}.txt`), `$ sign-off-axi ticket\n${so('ticket', board)}\n$ sign-off-axi ticket --id T-29\n${so('ticket', board, '--id', 'T-29')}\n`);
  browser('open', base);
  browser('emulate', '--viewport', `${width}x844x${width === 390 ? '2,mobile,touch' : '1'}`, '--color-scheme', theme);
  const seen = {};
  for (const [state, hash, anchor] of STATES) {
    browser('open', 'about:blank');
    browser('open', `${base}${hash}`);
    wait(900);
    if (anchor) browser('eval', `() => { document.querySelector(${JSON.stringify(anchor)})?.scrollIntoView({ block: ${JSON.stringify(state === 'tickets-activity' ? 'start' : 'center')} }); return new Promise((ok) => setTimeout(ok, 400)); }`);
    const name = `${state}.${cell}`;
    browser('screenshot', join(out, `${name}.png`));
    const m = seen[state] = value(browser('eval', probe));
    writeFileSync(join(out, `${name}.txt`), `${state} ${theme} ${width}w ${hash}\ntitle: ${m.h1}\n${m.thread.length ? `Activity, ${state.startsWith('ticket') ? 'newest' : 'oldest'} first:\n${m.thread.map((t) => `  ${t}`).join('\n')}\n` : 'no Activity thread\n'}${m.rows.length ? m.rows.map((r) => `Ticket row: "${r.text}" -> ${r.href}, ${r.w}x${r.h}px, ${r.left}px from the left and ${r.right}px from the right`).join('\n') : 'no Ticket row'}\n`
      + (m.kicker ? `kicker: ${m.kicker}\nprogress: ${m.done}\n` : '') + m.lists.map((l) => `${l.head}:\n${l.rows.map((r) => `  ${r}`).join('\n')}`).join('\n') + `${m.lists.length ? '\n' : ''}horizontal overflow ${m.overflow ? 1 : 0}${m.wide.length ? ` (${m.wide.join(', ')})` : ''}\n`);
    assert.equal(m.overflow, false, `${state}: wider than the screen: ${m.wide.join(', ')}`);
    assert.equal(m.rows.length, state.endsWith('-linked') || state.endsWith('-thread') ? 1 : 0, `${state}: ${JSON.stringify(m.rows)}`);
    // An ask names its ticket in its panel's Its ask row (title and progress); every other card in its Ticket row (title, id and progress).
    if (m.rows.length) assert.deepEqual([m.rows[0].href, /Ship the new settings page (T-29 )?60%/.test(m.rows[0].text)], ['#ticket/T-29', true], `${state}: ${m.rows[0].text}`);
  }
  // The ticket: in progress at 60%, its six cards, none of the unlinked or unknown-ticket cards; T-9 lists the two tickets under it and is as far along as they are on average.
  assert.deepEqual([seen.ticket.kicker, seen.ticket.done, seen.ticket.lists[0].head, seen.ticket.lists[0].rows.length], ['In progress', 'Progress 60%', 'Linked', 6], JSON.stringify(seen.ticket));
  // The answered ask's thread in the order it happened, with its notes; the proof's verdict and comment; the ticket's page has its cards' steps together.
  const steps = (state) => seen[state].thread.map((t) => t.replace(/ (Today|\d+ \w+), \d\d:\d\d$/, ''));
  assert.deepEqual(steps('ask-thread'), ['Posted by verify', 'Your answer: No “Not this week.”', 'Changed to: Yes “After the Friday stand-up.”', 'Delivered to verify', 'verify read it', 'You asked for a new round “Show it on a phone first.”'], JSON.stringify(seen['ask-thread'].thread));
  assert.deepEqual(steps('proof-thread'), ['Posted by verify', 'Your answer: Pass “The theme switch works.”', 'Your comment “Add the dark theme next.”'], JSON.stringify(seen['proof-thread'].thread));
  // The ticket's Activity: its cards' steps newest first, each naming its card.
  assert.deepEqual(seen['ticket-activity'].thread, ['Turn on search in the settings page? Your answer: No', 'Turn on search in the settings page? Changed to: Yes',
    'Turn on search in the settings page? Delivered to verify', 'Turn on search in the settings page? verify read it', 'Turn on search in the settings page? You asked for a new round', 'Update 3 · The settings page on a phone Your answer: Pass', 'Update 3 · The settings page on a phone Your comment'].reverse().concat('Ticket created'), JSON.stringify(seen['ticket-activity'].thread));
  assert.deepEqual(seen['ticket-release'].thread, ['Hold released', 'Stage cleared', 'Stage moved to done', 'Progress changed to 100%', 'Ticket merged', 'Put on hold', 'Stage moved to review', 'Progress changed to 60%', 'Stage moved to building', 'Progress changed to 25%', 'Ticket created'], JSON.stringify(seen['ticket-release'].thread));
  assert.deepEqual(seen['ticket-lifecycle'].thread, ['Stage moved to done', 'Progress changed to 100%', 'Ticket merged', 'Hold released', 'Put on hold', 'Stage moved to building', 'Ticket created'], JSON.stringify(seen['ticket-lifecycle'].thread));
  assert.ok(seen['ticket-answer-release'].thread.some((line) => line === 'Hold released'), JSON.stringify(seen['ticket-answer-release'].thread));
  for (const state of ['ask-unlinked', 'ask-linked', 'design-unlinked']) assert.equal(seen[state].thread.length, 0, `${state} has only its posting: no thread`);
  assert.deepEqual([seen['ticket-parent'].done, ...seen['ticket-parent'].lists.map((l) => `${l.head} ${l.rows.length}`)], ['Progress 80%', 'Tickets in this epic · 1 of 2 done 2', 'Linked 0', 'Activity 1'], JSON.stringify(seen['ticket-parent']));
  // A tap on the ask's Ticket row opens the ticket; Close (a phone) or the browser's Back (a desk) returns to the ask.
  browser('open', 'about:blank');
  browser('open', `${base}#decide/settings-friday`);
  wait(900);
  const walk = value(browser('eval', `async () => {
    const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
    document.querySelector('.decide .ui-props a[href^="#ticket/"]').click(); await pause(600);
    const at = location.hash, title = document.querySelector('.tk-dt')?.textContent;
    const x = document.querySelector('.tk-sheet .tk-shd .x'); x ? x.click() : history.back(); await pause(600);
    return JSON.stringify({ at, title, back: location.hash });
  }`));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board seeded with one card of each kind and no tickets, then T-9, T-29 (under T-9), T-30, held T-31 and T-32, and lifecycle T-33, a card of each kind posted with --ticket T-29, and an ask naming T-404.',
    steps: ['Open the Tickets tab and a ticket on a phone and at 1280 px, in light and dark; inspect the board-wide and per-ticket Activity feeds.',
      'Answer a linked ask on held T-32 and verify it releases to To do with a Hold released event; reply to a comment on held T-31 and verify it releases.',
      'Open each linked card (an ask, an update, a design review, a guided report, a guided plan), the same kind with no ticket, and the ask naming T-404.',
      'Answer an ask No with a note, change it to Yes with a note, let its agent take it, ask for a new round; give the update Pass with a note and a comment.',
      'Open each card\'s Activity, tap the ask\'s Its ask row to open T-29, read its Linked list and Activity, close it, then open T-9.'],
    result: 'Each linked card shows a Ticket row with the ticket title, T-29 and 60% that opens the ticket; unlinked cards and the T-404 ask show none; held T-32 releases after its linked ask is answered, held T-31 releases after its comment is answered, and both release events appear in Activity; board and per-ticket feeds show lifecycle events newest first; the ticket lists its six cards newest first, in progress at 60%, with card activity newest first; T-9 lists its two tickets at 80%; each card lists its answers, notes, pickup and new round oldest first.' }, null, 2) + '\n');
  writeFileSync(join(out, `walk.${cell}.txt`), `${theme} ${width}w: tap the ask's Its ask row on #decide/settings-friday: the page is ${walk.at}, the ticket "${walk.title}".\n${width < 1024 ? 'Tap Close' : 'Go back'}: the page is ${walk.back} again.\n`);
  assert.deepEqual(walk, { at: '#ticket/T-29', title: 'Ship the new settings page', back: '#decide/settings-friday' });
} finally {
  try { browser('stop'); } catch {}
  try { so('stop', board); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
if (process.env.TICKET_REVIEW_ROOT && width === 1280 && theme === 'dark') {
  mkdirSync(sealedOut, { recursive: true });
  for (const file of ['tickets-activity.light.390w.png', 'tickets-activity.dark.390w.png', 'tickets-activity.light.1280w.png', 'tickets-activity.dark.1280w.png',
    'ticket-answer-release.light.390w.png', 'ticket-answer-release.dark.390w.png', 'ticket-answer-release.light.1280w.png', 'ticket-answer-release.dark.1280w.png', 'steps.json']) copyFileSync(join(out, file), join(sealedOut, file));
}
