// A ticket's status and assignee switched on its page, driven with chrome-devtools-axi: To do to In progress with the switch, an assignee picked from the sheet, the page
// reloaded with both kept, a save that fails putting the old value back, and `sign-off-axi ticket --changes` listing what the owner changed. At 390 and 1280, light and
// dark, eight frames. Usage: node tickets-status-shots.mjs <evidence folder>
// With TICKETS_STATUS_BOARD=<folder holding board.json and its sidecars> it serves a fresh copy of that board (the folder itself is never written); without it a throwaway
// board is seeded with the CLI, with one fleet line that names a lead so the picker has one.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]), repo = process.cwd(), source = process.env.TICKETS_STATUS_BOARD;
mkdirSync(out, { recursive: true });
const dir = mkdtempSync('/tmp/signoff-tickets-status-'), board = join(dir, 'board.json');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir };
delete env.SIGN_OFF_FLEET_HOME;
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `tickets-status-${process.pid}` };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const browser = (...a) => execFileSync('chrome-devtools-axi', a, { env: browserEnv, encoding: 'utf8', timeout: 60000 });
const evalJson = (fn) => JSON.parse(JSON.parse(browser('eval', fn).split('\n')[0].slice('result: '.length)));
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn) => { for (let i = 0; i < 240; i++) { const v = evalJson(fn); if (v.ok) return v; await nap(250); } throw new Error(`not seen: ${what}`); };
const id = 'umer-status-proof', title = 'Umer switches this ticket on its page';
try {
  let base;
  if (source) cpSync(resolve(source), dir, { recursive: true });
  else {
    writeFileSync(board, '{"schema":2,"items":[]}\n');
    appendFileSync(join(dir, 'board.tickets.jsonl'), JSON.stringify({ id: 'fleet-work', title: 'Fleet work', progress: 30, state: 'in progress', assignee: { lead: 'crewhouse', live: false, model: 'claude-sonnet-5-5', tool: 'claude' }, at: '2026-11-06T04:00:00Z' }) + '\n');
  }
  cli('ticket', board, '--id', id, '--title', title, '--project', 'sign-off', '--priority', 'P1', '--state', 'queued');
  // serve stays in the foreground, so it starts detached with its words in a file; the run reads the address from there and stops it by name at the end.
  const log = openSync(join(dir, 'serve.out'), 'w');
  spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--bind', '127.0.0.1', '--port', '0'], { env, detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 120 && !base; i++) { await nap(250); base = /url: "(http:\/\/[^"]+)"/.exec(readFileSync(join(dir, 'serve.out'), 'utf8'))?.[1]; }
  assert.ok(base, 'the board is served');
  // A new chrome-devtools-axi session (0.1.34) opens with no page selected and refuses open until one is: select its first tab.
  try { browser('open', 'about:blank'); } catch { browser('selectpage', '1'); }
  const look = `() => { const sheet = document.querySelector('.tk-sheet'); const pressed = sheet?.querySelector('.tk-set-seg [aria-pressed="true"]')?.textContent ?? ''; return { ok: true, width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    status: pressed, buttons: [...(sheet?.querySelectorAll('.tk-set-seg button') ?? [])].map((b) => Math.round(b.getBoundingClientRect().height + 12)), assignee: sheet?.querySelector('.tk-asg .v')?.textContent ?? '', toast: document.getElementById('toast-text')?.textContent ?? '',
    picker: document.getElementById('tk-asg')?.open ? [...document.querySelectorAll('#tk-asg .tk-pick .k')].map((k) => k.textContent) : [] }; }`;
  const open = async (width, theme) => {
    browser('open', 'about:blank');
    // resize cannot make a window narrower than 500 px, so the width is the page's own, set as a device.
    browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1');
    browser('open', `${base}#ticket/${id}`);
    browser('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); }`);
    return until('the ticket with its status switch', look.replace('return { ok: true', "return { ok: !!document.querySelector('.tk-sheet .tk-set-seg') && !!document.querySelector('.tk-sheet .tk-asg')"));
  };
  const frames = [], shot = (name, seen) => { assert.equal(seen.width, Number(name.split('.').at(-1)), `${name} is drawn at its width`); assert.equal(seen.overflow, false, `${name} has no sideways overflow`); browser('screenshot', join(out, `${name}.png`)); frames.push({ frame: `${name}.png`, ...seen }); };
  // 1. Before: To do pressed, nobody assigned.
  let seen = await open(390, 'light');
  assert.deepEqual([seen.status, seen.assignee], ['To do', 'Unassigned']);
  assert.ok(seen.buttons.every((h) => h >= 44), `each status button is 44px to the touch: ${seen.buttons}`);
  shot('before.light.390', seen);
  // 2. In progress, tapped: saved, and said so.
  browser('eval', `() => [...document.querySelectorAll('.tk-sheet .tk-set-seg button')].find((b) => b.textContent === 'In progress').click()`);
  seen = await until('the save line', look.replace('return { ok: true', "return { ok: /^Saved/.test(document.getElementById('toast-text')?.textContent ?? '')"));
  assert.equal(seen.status, 'In progress');
  shot('saved.light.390', seen);
  // 3. The assignee picker, open: the board's leads, most tickets first, and Unassigned last.
  browser('eval', `() => document.querySelector('.tk-sheet .tk-asg').click()`);
  seen = await until('the picker', look.replace('return { ok: true', "return { ok: !!document.getElementById('tk-asg')?.open"));
  assert.ok(seen.picker.length >= 2 && seen.picker.at(-1) === 'Unassigned', `the picker lists leads then Unassigned: ${seen.picker}`);
  const lead = seen.picker.find((n) => n.startsWith('crewhouse')) ? 'crewhouse' : seen.picker[0].split(/\s/)[0];
  shot('picker.light.390', seen);
  browser('eval', `() => [...document.querySelectorAll('#tk-asg .tk-pick')].find((b) => b.querySelector('.k').firstChild.textContent === ${JSON.stringify(lead)}).click()`);
  await until('the assignee saved', look.replace('return { ok: true', `return { ok: (document.querySelector('.tk-sheet .tk-asg .v')?.textContent ?? '').startsWith(${JSON.stringify(lead)}) && /^Saved/.test(document.getElementById('toast-text')?.textContent ?? '')`));
  // 4. Reloaded, on a phone and a desk, light and dark: both changes kept.
  for (const [width, theme] of [[390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
    seen = await open(width, theme);
    assert.equal(seen.status, 'In progress', `${width} ${theme} keeps In progress after a reload`);
    assert.ok(seen.assignee.startsWith(lead), `${width} ${theme} keeps ${lead}: ${seen.assignee}`);
    await nap(600);
    shot(`reloaded.${theme}.${width}`, seen);
  }
  // 5. Done, with the board out of reach: the old status comes back and the page says why.
  seen = await open(1280, 'light');
  browser('eval', `() => { const real = window.fetch; window.fetch = (u, o) => (o?.method === 'POST' ? Promise.reject(new TypeError('Failed to fetch')) : real(u, o)); [...document.querySelectorAll('.tk-sheet .tk-set-seg button')].find((b) => b.textContent === 'Done').click(); }`);
  seen = await until('the failed save', look.replace('return { ok: true', "return { ok: /^Couldn’t save/.test(document.getElementById('toast-text')?.textContent ?? '')"));
  assert.equal(seen.status, 'In progress', 'a failed save puts the old status back');
  shot('failed.light.1280', seen);
  const changes = JSON.parse(cli('ticket', board, '--changes', '--json')).changes.filter((c) => c.ticket === id);
  assert.deepEqual(changes.map(({ field, from, to }) => [field, from, to]), [['state', 'queued', 'in progress'], ['assignee', 'nobody', lead]]);
  writeFileSync(join(out, 'changes.json'), JSON.stringify({ changes, frames }, null, 2) + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: source ? 'A fresh copy of the fleet board with one ticket Umer filed during the run, To do and unassigned, served by sign-off-axi serve' : 'A new board with one fleet ticket and one ticket Umer filed, To do and unassigned, served by sign-off-axi serve',
    steps: ['Open the ticket', 'Tap In progress', `Open Assignee and pick ${lead}`, 'Reload on a phone and on a desk, light and dark', 'Tap Done with the board out of reach', 'Run sign-off-axi ticket --changes'],
    result: `The ticket shows In progress and ${lead} after every reload; Saved · the fleet applies it to the backlog shows after each change; a save that cannot reach the board puts In progress back and says Couldn’t save; ticket --changes lists the status from queued to in progress and the assignee from nobody to ${lead}.` }, null, 2) + '\n');
} finally {
  // Each stop is its own step, so one that fails never hides the error of the capture itself.
  try { browser('stop'); } catch {}
  try { cli('stop', board); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
