// Tickets opens on the Story, driven with chrome-devtools-axi: the Story landing, the epic cards, one epic's drill-down, All tickets behind its tab and a ticket with its key and summary,
// at 390 and 1280 in light and dark. Usage: node tickets-story-shots.mjs <evidence folder>
// With TICKETS_STORY_BOARD=<folder holding board.json and its sidecars> (and optionally TICKETS_STORY_HOME=<fleet home for the task records>) it serves that copy of a real board; without it
// a throwaway board is seeded with the CLI. TICKETS_STORY_DETAIL names the ticket whose page is shot (default: the first one that carries a description).
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]), repo = process.cwd(), copy = process.env.TICKETS_STORY_BOARD;
mkdirSync(out, { recursive: true });
const dir = copy ? resolve(copy) : mkdtempSync('/tmp/signoff-tickets-story-'), board = join(dir, 'board.json');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir,
  ...(process.env.TICKETS_STORY_HOME && { SIGN_OFF_FLEET_HOME: process.env.TICKETS_STORY_HOME }) };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `tickets-story-${process.pid}` };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const browser = (...a) => execFileSync('chrome-devtools-axi', a, { env: browserEnv, encoding: 'utf8', timeout: 60000 });
const ticket = (id, title, ...flags) => cli('ticket', board, '--id', id, '--title', title, ...flags);
try {
  let base;
  if (copy) {
    // serve stays in the foreground, so it starts detached with its words in a file; the run reads the address from there and stops it by name at the end.
    try { cli('stop', board); } catch {}
    const log = openSync(join(dir, 'serve.out'), 'w');
    spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--bind', '127.0.0.1', '--port', '0'], { env, detached: true, stdio: ['ignore', log, log] }).unref();
    for (let i = 0; i < 60 && !base; i++) { await new Promise((r) => setTimeout(r, 250)); base = /url: "(http:\/\/[^"]+)"/.exec(readFileSync(join(dir, 'serve.out'), 'utf8'))?.[1]; }
    assert.ok(base, 'the board copy is served');
  }
  else {
    base = execFileSync('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { env, encoding: 'utf8' }).match(/http:\/\/127\.0\.0\.1:\d+\//g).at(-1);
    ticket('epic', 'Ship the owner board sync', '--project', 'Beacon', '--priority', 'P1', '--asked', 'yes');
    for (const [id, state] of [['one', 'queued'], ['two', 'queued'], ['three', 'queued']]) ticket(id, `Sync step ${id}`, '--parent', 'epic', '--project', 'Beacon', '--release', '0.2.0', '--state', state);
    ticket('one', 'Sync step one', '--parent', 'epic', '--project', 'Beacon', '--release', '0.2.0', '--state', 'done', '--progress', '100');
    ticket('two', 'Sync step two', '--parent', 'epic', '--project', 'Beacon', '--release', '0.2.0', '--state', 'in progress', '--progress', '40');
    ticket('three', 'Sync step three', '--parent', 'epic', '--project', 'Beacon', '--release', '0.2.0', '--state', 'on hold', '--hold-reason', 'waiting on the review call');
    ticket('one', 'Sync step one', '--description', 'Sync the owner board.\n\n# Ask\nKeep the owner board in step with the fleet.\n\n# Why\nThe board read stale.\n\n# Done when\nA change shows within a minute.');
  }
  const api = await (await fetch(`${base}api/state?view=tickets`)).json();
  const kids = (id) => api.tickets.filter((t) => t.parent === id), epic = api.tickets.find((t) => kids(t.id).length >= 3 && kids(t.id).length < 60 && kids(t.id).some((k) => k.progress < 100)), detail = process.env.TICKETS_STORY_DETAIL ?? api.tickets.find((t) => t.description)?.id;
  assert.ok(epic && detail, 'the board has an epic of three or more tickets and a ticket with a description');
  assert.equal(api.week.days.length, 7);
  const states = [['story', 'tickets', 'Shipped this week'], ['epics', 'epics', '3 or more tickets'], ['drill', `epics/${epic.id}`, 'All epics'], ['all', 'tickets/all', 'tickets ·'], ['detail', `ticket/${detail}`, 'Description']];
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) for (const [name, hash, wait] of states) {
    browser('open', `${base}#${hash}`);
    browser('resize', String(width), width === 390 ? '844' : '800');
    browser('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); }`);
    browser('wait', wait);
    const facts = JSON.parse(JSON.parse(browser('eval', `() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, cards: document.querySelectorAll('.tk-ecard').length, months: document.querySelectorAll('.tk-ms').length, days: document.querySelectorAll('.tk-days > div').length, hasList: !!document.querySelector('.tk-hero') })`).split('\n')[0].slice('result: '.length)));
    assert.equal(facts.overflow, false, `${name} at ${width} has no sideways overflow`);
    if (name === 'story') assert.equal(facts.days, 7), assert.equal(facts.hasList, false, 'the Story is not the flat list');
    if (name === 'epics') assert.ok(facts.cards > 0, 'epic cards');
    if (name === 'all') assert.equal(facts.hasList, true);
    writeFileSync(join(out, `${name}.${theme}.${width}.json`), JSON.stringify(facts));
    browser('screenshot', join(out, `${name}.${theme}.${width}.png`));
  }
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: copy ? 'A copy of the fleet board with its task records, served by sign-off-axi serve' : 'A new board of one epic with three tickets, a hold with its reason and one ticket with a description, served by sign-off-axi serve',
    steps: ['Open Tickets', 'Open Epics', 'Open one epic', 'Open All tickets', 'Open a ticket that carries a description'],
    result: 'On a phone and on a desk, in light and in dark: Tickets opens on the Story (the week by day and by project, the releases with their progress, what is in flight, what is blocked and why); Epics lists cards for epics of three or more tickets, each with its count, owner and next step; a card opens that epic with its tickets under it; All tickets holds the flat list behind its tab; a ticket page leads with its key and shows its summary, Ask, Why and Done when.' }, null, 2) + '\n');
} finally {
  // Each stop is its own step, so one that fails never hides the error of the capture itself.
  try { browser('stop'); } catch {}
  try { cli('stop', board); } catch {}
  if (!copy) rmSync(dir, { recursive: true, force: true });
}
