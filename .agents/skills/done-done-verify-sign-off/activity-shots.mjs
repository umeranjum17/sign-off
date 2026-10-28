// The Tickets screen's Activity tab on a throwaway board whose tickets moved over four days, one width and theme per run:
//   node activity-shots.mjs <folder> <light|dark> <360|390|445|1280|1440>
// Frames: tickets (All tickets, with the Activity card open on a phone), activity (the timeline), expanded (a row opened: the sheet on a phone, the dialog on a desk),
// filtered (priority P0) and no-match (a project and a priority that match nothing, with Clear filters). Checked in the browser as it goes: every row carries its priority,
// project and stage tags, the open view holds the full title, the change, who made it, the ticket and its pull request as links and the exact time, Escape puts the focus back on the row.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]), theme = process.argv[3] ?? 'light', width = Number(process.argv[4] ?? 390), phone = width < 1024;
mkdirSync(out, { recursive: true });
const repo = resolve('.'), dir = mkdtempSync('/tmp/so-activity-'), board = join(dir, 'board.json');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `activity-${process.pid % 997}-${width}${theme[0]}` };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8', cwd: dir });
const browser = (...a) => execFileSync('chrome-devtools-axi', a, { env: browserEnv, encoding: 'utf8', timeout: 60000 });
const evaluate = (code) => { let v = JSON.parse(browser('eval', code).match(/result: (".*")/)[1]); while (typeof v === 'string') v = JSON.parse(v); return v; };
const pause = (ms) => browser('eval', `() => new Promise((ok) => setTimeout(ok, ${ms}))`);
const shot = (name) => browser('screenshot', join(out, `${name}.${theme}.${width}.png`));
const server = { child: null };
try {
  // A board needs one post to exist; the tickets then carry their own history: one line per write, as the CLI appends them, with the time each was written.
  cli('post', board, '--ask-ref', 'message-demo', '--title', 'Keep the weekly digest?', '--why', 'Open rate held.', '--outcome', 'yes=Keep', '--outcome', 'no=Stop', '--recommend', 'yes', '--recommend-reason', 'Readers open it.', '--default', 'yes');
  // The captain's own ask for T-5: the board's ask card names the ticket, filed three days ago.
  const items = JSON.parse(readFileSync(board, 'utf8')); Object.assign(items.items[0], { title: 'Make the digest weekly, not daily', ticket: 'T-5', filed: new Date(Math.floor(Date.now() / 1000) * 1000 - 72 * 3600e3).toISOString().replace('.000Z', 'Z') });
  writeFileSync(board, JSON.stringify(items, null, 2) + '\n');
  writeFileSync(join(dir, 'config.yaml'), 'board: board.json\nname: Umer\n');
  mkdirSync(join(dir, 'icons'));
  copyFileSync(join(repo, 'docs/media/phone-light.webp'), join(dir, 'icons/beacon.webp')); copyFileSync(join(repo, 'docs/media/phone-dark.webp'), join(dir, 'icons/juggernaut.webp'));
  cli('project', board, '--name', 'Beacon', '--icon', 'icons/beacon.webp'); cli('project', board, '--name', 'Juggernaut', '--icon', 'icons/juggernaut.webp'); cli('project', board, '--name', 'Settings', '--clear-icon');
  const now = Date.now(), h = 3600e3, sec = h / 3600, pr = 'https://github.com/umeranjum17/sign-off/pull/';
  const at = (ago, plus = 0) => new Date(Math.floor((now - ago * h + plus * sec) / 1000) * 1000).toISOString();
  const lines = [
    ['T-1', 70, { title: 'Show tags and an expanded view on every Activity row', project: 'Beacon', priority: 'P1', progress: 0, state: 'queued', stage: 'queued' }],
    ['T-1', 50, { title: 'Show tags and an expanded view on every Activity row', project: 'Beacon', priority: 'P1', progress: 20, state: 'in progress', stage: 'building' }],
    ['T-1', 3, { title: 'Show tags and an expanded view on every Activity row', project: 'Beacon', priority: 'P1', progress: 60, state: 'in progress', stage: 'review', prs: [pr + '316'], by: 'firstmate-crew' }],
    ['T-2', 49, { title: 'One shared empty, loading and error state', project: 'Juggernaut', priority: 'P0', progress: 0, state: 'queued' }],
    ['T-2', 26, { title: 'One shared empty, loading and error state', project: 'Juggernaut', priority: 'P0', progress: 90, state: 'in progress', stage: 'review', prs: [pr + '314'] }],
    ['T-2', 2, { title: 'One shared empty, loading and error state', project: 'Juggernaut', priority: 'P0', progress: 100, state: 'done', stage: 'done', prs: [pr + '314'], by: 'firstmate-crew' }],
    ['T-3', 30, { title: 'Keep the weekly digest on Mondays', project: 'Settings', priority: 'P2', progress: 10, state: 'in progress', stage: 'building' }],
    ['T-3', 25, { title: 'Keep the weekly digest on Mondays', project: 'Settings', priority: 'P2', progress: 10, state: 'on hold', stage: 'building', hold: true }],
    ['T-4', 8, { title: 'Tidy the docs for the release', project: 'Settings', priority: 'P3', progress: 0, state: 'queued' }],
    ['T-4', 1, { title: 'Tidy the docs for the release', project: 'Settings', priority: 'P3', progress: 40, state: 'in progress', stage: 'building' }],
    // One change burst on T-5: written within a minute, so one row whose open view lists every change.
    ['T-5', 0.5, { title: 'Send the digest every Monday', project: 'Settings', priority: 'P2', progress: 0, state: 'queued', stage: 'queued', asked: true }, 0],
    ['T-5', 0.5, { title: 'Send the digest every Monday', project: 'Settings', priority: 'P2', progress: 20, state: 'in progress', stage: 'building', asked: true }, 20],
    ['T-5', 0.5, { title: 'Send the digest every Monday', project: 'Settings', priority: 'P2', progress: 40, state: 'in progress', stage: 'review', asked: true, prs: [pr + '317'], by: 'firstmate-crew' }, 50],
  ];
  appendFileSync(join(dir, 'board.tickets.jsonl'), lines.map(([id, ago, f, plus]) => JSON.stringify({ id, at: at(ago, plus), ...f })).join('\n') + '\n');
  const count = JSON.parse(cli('ticket', board, '--json')).tickets.length;
  assert.equal(count, 5);
  const { spawn } = await import('node:child_process');
  server.child = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let said = ''; for await (const chunk of server.child.stdout) { said += chunk; if (/http:\/\/127\.0\.0\.1:\d+\//.test(said)) break; }
  const base = said.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];

  browser('open', base);
  browser('emulate', '--viewport', `${width}x${phone ? 844 : 800}x${phone ? '2,mobile,touch' : '1'}`, '--color-scheme', theme);
  const go = (hash) => { browser('open', 'about:blank'); browser('open', base + hash); pause(900); };
  const facts = { width, theme };
  const rowsOf = `[...document.querySelectorAll('.tk-day .tk-ev')]`;
  const overflow = () => evaluate(`() => document.documentElement.scrollWidth > document.documentElement.clientWidth`);

  // All tickets: the Activity card on a phone is opened to its newest rows and ends in See all, which leads to the tab.
  go('#tickets');
  if (phone) {
    browser('eval', `() => { document.querySelector('.tk-activity > summary').click(); document.querySelector('.tk-activity').scrollIntoView({ block: 'start' }); }`); pause(400);
    facts.card = evaluate(`() => JSON.stringify({ rows: document.querySelectorAll('.tk-activity .tk-ev').length, all: document.querySelector('.tk-activity a.tk-all')?.getAttribute('href') })`);
    assert.equal(facts.card.all, '#activity'); assert.ok(facts.card.rows >= 3);
  }
  facts.tabs = evaluate(`() => JSON.stringify([...document.querySelectorAll('.tk-seg button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' (on)' : '')))`);
  assert.deepEqual(facts.tabs, ['All tickets (on)', 'Activity']);
  assert.equal(overflow(), false); shot('tickets');

  // Activity: the timeline, by day, every row with its tags.
  go('#activity');
  facts.timeline = evaluate(`() => JSON.stringify({ days: [...document.querySelectorAll('.tk-day h2')].map((h) => h.textContent.replace(/\\s+/g, ' ')), rows: ${rowsOf}.length,
    untagged: ${rowsOf}.filter((r) => !r.querySelector('.ui-pc.p0, .ui-pc.p1, .ui-pc.p2, .ui-pc.p3') || !r.querySelector('.ui-icon') || !r.querySelector('.meta').textContent.trim()).length, count: document.querySelector('.tk-count').textContent })`);
  assert.equal(facts.timeline.rows, 11); assert.equal(facts.timeline.untagged, 0); assert.ok(facts.timeline.days.length >= 3 && facts.timeline.days[0].startsWith('Today'), JSON.stringify(facts.timeline));
  assert.equal(overflow(), false); shot('activity');

  // A row opens: by a tap, with the full title, the change, who made it, the ticket and its pull request as links and the exact time.
  browser('eval', `() => ${rowsOf}.find((r) => r.getAttribute('aria-label').startsWith('Show tags')).click()`); pause(700);
  facts.expanded = evaluate(`() => { const d = document.querySelector('dialog.tk-evs[open]'); return JSON.stringify({ title: d.querySelector('h2').textContent, props: d.querySelector('.ui-props').innerText.replace(/\\s+/g, ' '),
    ticket: d.querySelector('a[href^="#ticket/"]').getAttribute('href'), prs: [...d.querySelectorAll('.tk-in a')].map((a) => a.href), focus: document.activeElement === d.querySelector('h2'), within: d.getBoundingClientRect().right <= innerWidth + 1 }); }`);
  assert.equal(facts.expanded.title, 'Show tags and an expanded view on every Activity row'); assert.match(facts.expanded.props, /State In progress/); assert.match(facts.expanded.props, /Made by worker/); assert.doesNotMatch(facts.expanded.props, /firstmate|juggernaut/i);
  assert.equal(facts.expanded.ticket, '#ticket/T-1'); assert.deepEqual(facts.expanded.prs, [pr + '316']); assert.match(facts.expanded.props, /Time \d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}/); assert.equal(facts.expanded.within, true);
  shot('expanded');
  // Escape closes it and the focus is back on the row.
  browser('press', 'Escape'); pause(400);
  facts.escape = evaluate(`() => JSON.stringify({ closed: !document.querySelector('dialog.tk-evs[open]'), back: document.activeElement.classList.contains('tk-ev') && document.activeElement.getAttribute('aria-label').startsWith('Show tags') })`);
  assert.deepEqual(facts.escape, { closed: true, back: true });

  // The burst on T-5 is one row; its open view lists every change and the captain's words with their date.
  facts.burstRows = evaluate(`() => ${rowsOf}.filter((r) => r.getAttribute('aria-label').startsWith('Send the digest every Monday')).length`); assert.equal(facts.burstRows, 1);
  browser('eval', `() => ${rowsOf}.find((r) => r.getAttribute('aria-label').startsWith('Send the digest every Monday')).click()`); pause(700);
  facts.burst = evaluate(`() => { const d = document.querySelector('dialog.tk-evs[open]'); return JSON.stringify({ changes: [...d.querySelectorAll('.tk-chg li')].map((l) => l.textContent), ask: d.querySelector('.tk-ask').innerText.replace(/\\s+/g, ' '), props: d.querySelector('.ui-props').innerText.replace(/\\s+/g, ' '), within: d.getBoundingClientRect().right <= innerWidth + 1 }); }`);
  assert.equal(facts.burst.changes.length, 6, facts.burst.changes.join(' | ')); assert.ok(facts.burst.changes[0].startsWith('Ticket created') && facts.burst.changes.at(-1).startsWith('Progress changed to 40%'));
  assert.match(facts.burst.ask, /^Make the digest weekly, not daily \d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}$/); assert.match(facts.burst.props, /Made by worker/); assert.equal(facts.burst.within, true);
  // On a desk the dialog is shorter than the view: scroll it so the changes and the quoted words are both in the frame.
  browser('eval', `() => { const d = document.querySelector('dialog.tk-evs[open]'); d.querySelector('.tk-ask').scrollIntoView({ block: 'end' }); }`); pause(300);
  facts.burst.askVisible = evaluate(`() => { const a = document.querySelector('dialog.tk-evs[open] .tk-ask').getBoundingClientRect(); return a.bottom <= innerHeight && a.top >= 0; }`); assert.equal(facts.burst.askVisible, true);
  shot('burst');
  browser('press', 'Escape'); pause(400);

  // Filters: one priority, then a project and a priority that match nothing, and Clear filters.
  const pick = (i, v) => browser('eval', `() => { const s = document.querySelectorAll('.tk-sel')[${i}]; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); }`);
  browser('eval', `() => scrollTo(0, 0)`);
  pick(1, 'P0'); pause(400);
  facts.filtered = evaluate(`() => JSON.stringify({ count: document.querySelector('.tk-count').textContent, others: ${rowsOf}.filter((r) => !r.querySelector('.ui-pc.p0')).length })`);
  assert.equal(facts.filtered.others, 0); assert.match(facts.filtered.count, /^\d+ of 11 events$/); shot('filtered');
  pick(0, 'Beacon'); pause(400);
  facts.empty = evaluate(`() => JSON.stringify({ title: document.querySelector('.es')?.innerText.replace(/\\s+/g, ' '), count: document.querySelector('.tk-count').textContent })`);
  assert.match(facts.empty.title, /No activity matches/); assert.equal(facts.empty.count, '0 of 11 events'); shot('no-match');
  browser('eval', `() => [...document.querySelectorAll('.es button')].find((b) => b.textContent === 'Clear filters').click()`); pause(400);
  assert.equal(evaluate(`() => ${rowsOf}.length`), 11);
  assert.equal(overflow(), false);
  facts.errors = browser('console', '--type', 'error').includes('<no console messages found>');
  writeFileSync(join(out, `facts.${theme}.${width}.json`), JSON.stringify(facts, null, 2) + '\n');
  const where = phone ? 'on a phone' : 'on a desk';
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A throwaway board for Umer with five tickets in three projects whose history runs over four days: twenty-five changes in eleven entries, three written with a named writer and the rest with none; six changes of the digest ticket in one minute fold into one entry.',
    steps: [`Open Tickets ${where} at ${width} px in ${theme}${phone ? ' and open its Activity card' : ''}: the two tabs All tickets and Activity.`,
      'Open the Activity tab: the timeline grouped by day, each entry with its project tile, priority chip, stage chip and project name.',
      `${phone ? 'Tap' : 'Click'} the entry for the tags ticket: its full title, the change, who made it, the ticket and its pull request as links and the exact time; press Escape and the focus is back on the entry.`,
      `${phone ? 'Tap' : 'Click'} the entry for the digest ticket, whose six changes within a minute are one entry: the open view lists every change and quotes the captain's own words with their date; Made by reads worker.`, 'Filter by priority P0, then by project Beacon as well: no entry matches, and Clear filters brings the timeline back.'],
    result: `${theme}, ${width}px ${where}: every Activity entry carries the same tags as the In progress cards, opens to an expanded view with the full title, change, writer, ticket and pull request links and the exact time, a filter narrows the timeline and one that matches nothing says so with a way back; nothing is wider than the screen.` }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  if (server.child) { server.child.kill(); await new Promise((ok) => server.child.once('exit', ok)); }
  rmSync(dir, { recursive: true, force: true });
}
