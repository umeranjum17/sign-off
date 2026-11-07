// A link opens its ticket, driven with chrome-devtools-axi: #tickets/<backlog slug>, #tickets/<key> and the slug of a ticket filed during this run each move to #ticket/<id>
// and show that ticket, and a name no ticket has says so. At 390 and 1280 in light and dark, nine frames in all. Usage: node tickets-links-shots.mjs <evidence folder>
// With TICKETS_LINKS_BOARD=<folder holding board.json and its sidecars> it serves a fresh copy of that board (the folder itself is never written); without it a throwaway
// board is seeded with the CLI. TICKETS_LINKS_SLUG and TICKETS_LINKS_KEY name the slug and key to open (defaults: bots-share-build and the first key the Tickets view gives).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2]), repo = process.cwd(), source = process.env.TICKETS_LINKS_BOARD;
mkdirSync(out, { recursive: true });
const dir = mkdtempSync('/tmp/signoff-tickets-links-'), board = join(dir, 'board.json');
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_STATE_HOME: dir, XDG_CACHE_HOME: dir, SIGN_OFF_HOME: dir };
delete env.SIGN_OFF_FLEET_HOME;
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `tickets-links-${process.pid}` };
const cli = (...a) => execFileSync(process.execPath, [join(repo, 'dist/cli.js'), ...a], { env, encoding: 'utf8' });
const browser = (...a) => execFileSync('chrome-devtools-axi', a, { env: browserEnv, encoding: 'utf8', timeout: 60000 });
// The id a Juggernaut fleet gives a backlog item's ticket: jg- and the first 32 hex of sha256("main/<slug>").
const fleetId = (slug) => `jg-${createHash('sha256').update(`main/${slug}`).digest('hex').slice(0, 32)}`;
const slug = process.env.TICKETS_LINKS_SLUG ?? 'bots-share-build', filed = 'ticket-filed-in-this-run';
try {
  let base;
  if (source) {
    cpSync(resolve(source), dir, { recursive: true });
    // serve stays in the foreground, so it starts detached with its words in a file; the run reads the address from there and stops it by name at the end.
    const log = openSync(join(dir, 'serve.out'), 'w');
    spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--bind', '127.0.0.1', '--port', '0'], { env, detached: true, stdio: ['ignore', log, log] }).unref();
    for (let i = 0; i < 120 && !base; i++) { await new Promise((r) => setTimeout(r, 250)); base = /url: "(http:\/\/[^"]+)"/.exec(readFileSync(join(dir, 'serve.out'), 'utf8'))?.[1]; }
    assert.ok(base, 'the board copy is served');
  } else {
    base = execFileSync('bash', [join(repo, '.agents/skills/done-done-verify-sign-off/seed-board.sh'), dir], { env, encoding: 'utf8' }).match(/http:\/\/127\.0\.0\.1:\d+\//g).at(-1);
    cli('ticket', board, '--id', fleetId(slug), '--description', 'The bots share one computer plan.', '--title', 'Build the bots share one computer plan', '--project', 'crewhouse', '--state', 'queued');
  }
  // Filed while the board is up, the way the fleet files one: its id is the hash of its backlog slug, and only the slug is in the link.
  cli('ticket', board, '--id', fleetId(filed), '--description', 'Umer files this ticket to prove a new ticket opens by its slug.', '--title', 'Umer filed this ticket during the proof run', '--project', 'sign-off', '--priority', 'P1', '--state', 'queued');
  const api = await (await fetch(`${base}api/state?view=tickets`)).json(), byId = (id) => api.tickets.find((t) => t.id === id);
  const key = process.env.TICKETS_LINKS_KEY ?? api.tickets.find((t) => t.key)?.key, keyed = api.tickets.find((t) => t.key === key);
  assert.ok(byId(fleetId(slug)) && keyed && byId(fleetId(filed)), 'the slug, the key and the filed ticket are on the board');
  // [frame name, link, the ticket it must open (or none), words to wait for]
  const links = { slug: [`tickets/${slug}`, byId(fleetId(slug))], key: [`tickets/${key.toLowerCase()}`, keyed], filed: [`tickets/${filed}`, byId(fleetId(filed))], missing: ['tickets/no-such-backlog-item', undefined] };
  const shots = [['slug', 390, 'light'], ['slug', 390, 'dark'], ['slug', 1280, 'light'], ['slug', 1280, 'dark'], ['key', 390, 'light'], ['key', 1280, 'dark'], ['filed', 390, 'dark'], ['filed', 1280, 'light'], ['missing', 390, 'light']];
  const facts = [];
  // A new chrome-devtools-axi session (0.1.34) opens with no page selected and refuses open until one is: select its first tab.
  try { browser('open', 'about:blank'); } catch { browser('selectpage', '1'); }
  for (const [name, width, theme] of shots) {
    const [hash, want] = links[name];
    browser('open', `${base}#${hash}`);
    // resize cannot make a window narrower than 500 px, so the width is the page's own, set as a device: a phone at 390 by 844 with touch, a desk at 1280 by 800.
    browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1');
    browser('eval', `() => { localStorage.setItem('so-theme', '${theme}'); location.reload(); }`);
    // The title can show in a list before the link resolves, so the frame waits until the address has moved and the ticket is open (or the not-found line shows).
    const look = () => JSON.parse(JSON.parse(browser('eval', `() => ({ hash: location.hash, open: document.querySelector('.tk-sheet, .tk-pane')?.getAttribute('aria-label') ?? '', toast: document.getElementById('toast-text')?.textContent ?? '', overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, width: innerWidth })`).split('\n')[0].slice('result: '.length)));
    let seen = look();
    for (let i = 0; i < 60 && !(want ? seen.hash === `#ticket/${want.id}` && seen.open === want.title : /No ticket named/.test(seen.toast)); i++) await new Promise((r) => setTimeout(r, 250)), seen = look();
    // The sheet rises in; the frame is taken once it has settled.
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(seen.width, width, `${name} is drawn ${width} px wide`);
    assert.equal(seen.overflow, false, `${name} at ${width} has no sideways overflow`);
    if (want) assert.equal(seen.hash, `#ticket/${want.id}`, `#${hash} moves to its ticket`), assert.equal(seen.open, want.title, `#${hash} shows ${want.title}`);
    else assert.match(seen.toast, /No ticket named no-such-backlog-item/);
    facts.push({ frame: `${name}.${theme}.${width}.png`, link: `#${hash}`, ...seen });
    browser('screenshot', join(out, `${name}.${theme}.${width}.png`));
  }
  writeFileSync(join(out, 'links.json'), JSON.stringify(facts, null, 2) + '\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
    start: source ? 'A fresh copy of the fleet board, served by sign-off-axi serve, with one ticket filed by the CLI during the run' : 'A new board with a fleet-style ticket, served by sign-off-axi serve, with one ticket filed by the CLI during the run',
    steps: [`Open #tickets/${slug}`, `Open #tickets/${key.toLowerCase()}`, `Open #tickets/${filed}`, 'Open #tickets/no-such-backlog-item'],
    result: `On a phone and on a desk, in light and in dark: #tickets/${slug} opens "${links.slug[1].title}"; the key ${key}, typed in lower case, opens "${keyed.title}"; the slug of the ticket filed during the run opens it; a name no ticket has says No ticket named no-such-backlog-item on this board.` }, null, 2) + '\n');
} finally {
  // Each stop is its own step, so one that fails never hides the error of the capture itself.
  try { browser('stop'); } catch {}
  try { cli('stop', board); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
