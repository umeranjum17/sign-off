// Create, assign and epic grouping on Tickets, driven with chrome-devtools-axi on a throwaway board: every epic as a card (one with a single ticket, one with none), an epic's page with its
// tickets by status, All tickets grouped by epic, the New ticket sheet empty and filled, the ticket as it is created (by the owner, with its epic, assignee and priority) and Activity naming it.
// Usage: node tickets-create-shots.mjs <evidence folder> [light|dark] [360|390|445|1280|1440]   (one theme and width per run; steps.json describes it)
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.argv[4] ?? 390), phone = width < 1024, repo = process.cwd();
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-create-')), board = join(dir, 'board.json');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir };
const browserEnv = { ...env, CHROME_DEVTOOLS_AXI_SESSION: `tickets-create-${process.pid}` };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const browser = (...a) => execFileSync('chrome-devtools-axi', a, { env: browserEnv, encoding: 'utf8', timeout: 60000 });
const evalIn = (fn) => JSON.parse(JSON.parse(browser('eval', fn).split('\n')[0].slice('result: '.length)));
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ticket = (id, title, ...flags) => cli('ticket', board, '--id', id, '--title', title, '--description', title, ...flags);
const name = (state) => `${state}.${theme}.${width}`;
let serving = false;
try {
  const base = execFileSync('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { env, encoding: 'utf8' }).match(/http:\/\/127\.0\.0\.1:\d+\//g).at(-1);
  serving = true;
  ticket('sync', 'Ship the owner board sync', '--project', 'Beacon', '--priority', 'P1', '--asked', 'yes', '--type', 'epic');
  for (const [id, state, p] of [['one', 'done', 100], ['two', 'in progress', 40], ['three', 'on hold', 0], ['four', 'queued', 0]]) ticket(id, `Sync step ${id}`, '--parent', 'sync', '--project', 'Beacon', '--state', state, '--progress', String(p), ...(state === 'on hold' ? ['--hold', 'yes', '--hold-reason', 'waiting on the review call'] : []));
  ticket('tidy', 'Tidy the tickets page', '--project', 'Harbor', '--priority', 'P2', '--asked', 'yes', '--type', 'epic');
  ticket('tidy-one', 'Group the list by epic', '--parent', 'tidy', '--project', 'Harbor', '--state', 'in progress', '--progress', '30');
  ticket('plan', 'Plan the next release', '--project', 'Harbor', '--asked', 'yes', '--type', 'epic');
  ticket('loose', 'Fix the stuck sync banner', '--project', 'Beacon', '--priority', 'P0', '--asked', 'yes', '--type', 'bug');
  const post = (body) => fetch(`${base}api/tickets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const first = await post({ title: 'Show who changed a ticket', parent: 'tidy', priority: 'P1', project: 'Harbor', assignee: 'Umer', description: 'Activity should say who moved a ticket.' });
  assert.ok(first.ticket?.id, 'the API makes a ticket: ' + JSON.stringify(first));
  const go = (hash, until) => { browser('open', `${base}#${hash}`); browser('resize', String(width), phone ? '844' : width >= 1440 ? '900' : '800'); browser('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); }`); browser('wait', until); };
  const shot = (state) => browser('screenshot', join(out, `${name(state)}.png`));
  const facts = (extra = "") => evalIn(`() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth ${extra} })`);
  const states = {};
  // Epics: every epic is a card, one with a single ticket and one with none among them.
  go('epics', 'Ship the owner board sync');
  states.epics = evalIn(`() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, cards: document.querySelectorAll('.tk-ecard').length, text: document.querySelector('main').innerText })`);
  assert.equal(states.epics.overflow, false, 'epics: no sideways overflow'); assert.equal(states.epics.cards, 3, 'epics: all three epics are cards, the one with a single ticket and the empty one too');
  assert.match(states.epics.text, /No tickets yet/); assert.doesNotMatch(states.epics.text, /3 or more/);
  shot('epics');
  go('epics/sync', 'In progress');
  states.drill = evalIn(`() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, sections: [...document.querySelectorAll('main section[aria-label]')].map((s) => s.getAttribute('aria-label')), add: !!document.querySelector('.tk-addin') })`);
  assert.equal(states.drill.overflow, false); assert.deepEqual(states.drill.sections.filter((s) => ['In progress', 'On hold', 'To do', 'Done'].includes(s)), ['In progress', 'On hold', 'To do', 'Done'], 'the epic lists its tickets by status'); assert.equal(states.drill.add, true);
  shot('epic');
  // All tickets grouped by epic.
  go('tickets/all', 'All tickets');
  evalIn(`() => { [...document.querySelectorAll('.tk-gseg button')].find((b) => b.textContent === 'Epic').click(); return 1; }`); await wait(400);
  states.byEpic = evalIn(`() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, heads: [...document.querySelectorAll('.tk-eh')].map((h) => h.textContent), pressed: [...document.querySelectorAll('.tk-gseg button[aria-pressed=true]')].map((b) => b.textContent) })`);
  assert.equal(states.byEpic.overflow, false); assert.deepEqual(states.byEpic.pressed, ['Epic']); assert.ok(states.byEpic.heads.some((h) => /Ship the owner board sync/.test(h)) && states.byEpic.heads.some((h) => /Tidy the tickets page/.test(h)), 'every epic heads a group');
  shot('by-epic');
  // New ticket: the sheet empty, then filled, then created.
  go('tickets/all', 'All tickets');
  evalIn(`() => { document.querySelector('.tk-newb').click(); return 1; }`); await wait(500);
  states.sheet = evalIn(`() => { const d = document.querySelector('#tk-new'), r = d.getBoundingClientRect(); return { open: d.open, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1,
    focus: document.activeElement?.getAttribute('aria-label'), small: [...d.querySelectorAll('button, input, select, textarea')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 40).map((e) => e.getAttribute('aria-label') ?? e.textContent) }; }`);
  assert.equal(states.sheet.open, true); assert.equal(states.sheet.focus, 'Title', 'the title has the focus'); assert.equal(states.sheet.overflow, false);
  shot('new-empty');
  evalIn(`() => { const d = document.querySelector('#tk-new'), set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set(d.querySelector('[aria-label=Title]'), 'Let me assign a ticket from its row'); set(d.querySelector('[aria-label=Description]'), 'A row should offer an assignee without opening the ticket.');
    set(d.querySelector('[aria-label=Epic]'), 'sync'); set(d.querySelector('[aria-label=Assignee]'), 'Umer'); [...d.querySelectorAll('[aria-label=Priority] button')].find((b) => b.textContent === 'P1').click(); return 1; }`); await wait(300);
  states.filled = evalIn(`() => ({ project: document.querySelector('#tk-new [aria-label=Project]').value, prio: [...document.querySelectorAll('#tk-new [aria-label=Priority] button[aria-pressed=true]')].map((b) => b.textContent) })`);
  assert.equal(states.filled.project, 'Beacon', 'picking an epic fills its project'); assert.deepEqual(states.filled.prio, ['P1']);
  shot('new-filled');
  evalIn(`() => { document.querySelector('#tk-new .tk-ngo').click(); return 1; }`);
  browser('wait', 'Let me assign a ticket from its row'); await wait(600);
  const api = await (await fetch(`${base}api/tickets`)).json(), made = api.tickets.find((t) => t.title === 'Let me assign a ticket from its row');
  assert.ok(made, 'the ticket was created'); assert.deepEqual([made.parent, made.priority, made.project, made.assignee?.lead, made.by, made.state], ['sync', 'P1', 'Beacon', 'Umer', 'owner', 'queued']);
  states.created = facts(`, hash: location.hash, sheetOpen: !!document.querySelector('#tk-new[open]'), shown: document.querySelector('.tk-dt')?.textContent ?? ''`);
  assert.equal(states.created.sheetOpen, false); assert.match(states.created.hash, new RegExp(`^#ticket/${made.id}`)); assert.equal(states.created.shown, 'Let me assign a ticket from its row');
  shot('created');
  // A refusal keeps the words and says why.
  go('tickets/all', 'All tickets');
  evalIn(`() => { document.querySelector('.tk-newb').click(); return 1; }`); await wait(400);
  evalIn(`() => { const d = document.querySelector('#tk-new'); const t = d.querySelector('[aria-label=Title]'); t.value = 'A ticket that cannot be saved'; const s = d.querySelector('[aria-label=Epic]'); const o = document.createElement('option'); o.value = 'gone'; o.textContent = 'Gone'; s.append(o); s.value = 'gone'; s.dispatchEvent(new Event('change', { bubbles: true })); d.querySelector('.tk-ngo').click(); return 1; }`); await wait(900);
  states.refused = evalIn(`() => ({ open: !!document.querySelector('#tk-new[open]'), error: document.querySelector('.tk-nerr:not([hidden])')?.textContent ?? '', kept: document.querySelector('#tk-new [aria-label=Title]').value })`);
  assert.equal(states.refused.open, true); assert.match(states.refused.error, /No ticket gone/); assert.equal(states.refused.kept, 'A ticket that cannot be saved');
  shot('refused');
  go('activity', 'Activity'); await wait(1500);
  states.activity = evalIn(`() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, text: document.querySelector('main').innerText })`);
  assert.equal(states.activity.overflow, false); assert.match(states.activity.text, /Umer|Created/);
  shot('activity');
  writeFileSync(join(out, `${name('facts')}.json`), JSON.stringify(states, null, 2));
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: 'A new board with three epics (one with four tickets, one with a single ticket, one with none), a bug under none and a ticket made through the board\'s own API, served by sign-off-axi serve',
    steps: ['Open Epics', 'Open one epic', 'Open All tickets and group it by epic', 'Open New ticket', 'Fill the title, description, epic, assignee and priority', 'Create ticket', 'Create a ticket the board refuses', 'Open Activity'],
    result: `At ${width} px in ${theme}: Epics shows every epic as a card, the one with a single ticket and the one with none too; an epic's page lists its tickets by status with New ticket in this epic; All tickets groups by epic; the New ticket sheet opens on its title, picking an epic fills its project, Create ticket makes the ticket by the owner with its epic, assignee and priority and opens it, a refused ticket keeps its words and says why; no sideways overflow in any of them.` }, null, 2) + '\n');
} finally {
  try { browser('stop'); } catch {}
  if (serving) try { cli('stop', board); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
