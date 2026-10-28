import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const { readTicketActivity } = await import('../dist/store.js');
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-tickets-api-'));
const env = { ...process.env, HOME: scratch, XDG_CONFIG_HOME: scratch, XDG_DATA_HOME: scratch, XDG_CACHE_HOME: scratch, SIGN_OFF_HOME: scratch };
delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_FILER;
const board = join(scratch, 'board.json'), procs = [];
const readToken = () => readFileSync(join(scratch, 'board.token'), 'utf8').trim();
const axi = (...args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// One board is served at a time: a second serve of it is refused.
const stopAll = () => Promise.all(procs.splice(0).map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
after(async () => {
  await stopAll();
  rmSync(scratch, { recursive: true, force: true });
});
// The board is served in the foreground of this test, and its link read from what it prints.
async function serve(...flags) {
  await stopAll();
  const child = spawn(process.execPath, [cli, 'serve', board, '--port', '0', ...flags], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(child);
  let out = '';
  for await (const chunk of child.stdout) { out += chunk; if (/url: "http:\/\/[^"]+\/"/.test(out)) break; }
  return new URL(/url: "(http:\/\/[^"]+)"/.exec(out)[1]).port;
}

// An epic with two tickets under it (one with a sub-task), and a card that names one of them.
axi('ticket', board, '--id', 'E-1', '--title', 'The new settings page', '--priority', 'P1', '--project', 'Settings', '--asked', 'yes');
axi('ticket', board, '--id', 'T-1', '--title', 'Build the page', '--progress', '40', '--parent', 'E-1');
axi('ticket', board, '--id', 'T-2', '--title', 'Publish it', '--progress', '80', '--parent', 'E-1', '--hold', 'yes');
axi('ticket', board, '--id', 'S-1', '--title', 'Wire the save button', '--progress', '20', '--parent', 'T-1');
axi('raise', board, '--title', 'Ship the settings page on Friday?', '--why', 'The page is ready and the release goes out Friday.', '--outcome', 'yes=It ships on Friday.', '--outcome', 'no=It waits.',
  '--recommend', 'yes', '--recommend-reason', 'Every check passed.', '--default', 'no', '--ask-ref', 'message-test', '--ticket', 'T-1');

test('the ticket API lists every ticket with its roll-up and reads one with its cards', async () => {
  const port = await serve();
  const list = await fetch(`http://127.0.0.1:${port}/api/tickets`);
  assert.equal(list.status, 200);
  assert.match(list.headers.get('content-type'), /^application\/json/);
  const { tickets } = await list.json();
  assert.deepEqual(tickets.map((t) => [t.id, t.progress, t.parent ?? null, t.cards.length]), [['E-1', 50, null, 0], ['T-1', 20, 'E-1', 1], ['T-2', 80, 'E-1', 0], ['S-1', 20, 'T-1', 0]]);
  assert.deepEqual(tickets.find((t) => t.id === 'E-1'), { id: 'E-1', title: 'The new settings page', progress: 50, priority: 'P1', project: 'Settings', asked: true, at: tickets[0].at, cards: [] });
  assert.deepEqual(tickets.find((t) => t.id === 'T-2').hold, true);
  // The list is the CLI's own read of the board.
  const cli = JSON.parse(axi('ticket', board, '--json')).tickets;
  assert.deepEqual(tickets, cli);

  const one = await fetch(`http://127.0.0.1:${port}/api/tickets/T-1`);
  assert.equal(one.status, 200);
  const { ticket } = await one.json();
  assert.equal(ticket.progress, 20);
  assert.equal(ticket.parent, 'E-1');
  assert.deepEqual(ticket.cards.map((c) => [c.key, c.kind, c.status, c.title]), [['ship-the-settings-page-on-friday', 'ask', 'waiting', 'Ship the settings page on Friday?']]);
  assert.deepEqual(ticket, JSON.parse(axi('ticket', board, '--id', 'T-1', '--json')).ticket);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/T-1?x=1`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/nope`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/%E0%A4%A`)).status, 404);
  // Read only: nothing writes a ticket over HTTP.
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets`, { method: 'POST', body: '{}' })).status, 404);
});

test('ticket lifecycle activity and hold release use effective progress', async () => {
  axi('ticket', board, '--id', 'E-2', '--title', 'Release epic', '--hold', 'yes', '--state', 'on hold');
  axi('ticket', board, '--id', 'T-3', '--title', 'Release child', '--progress', '40', '--parent', 'E-2');
  const comment = JSON.stringify({ id: 'release-reply', at: 1792820000, text: 'Which date?', picked: 1792820100, replies: [{ at: 1792820200, text: 'Friday' }] });
  axi('ticket', board, '--id', 'E-2', '--comment', comment);
  const released = JSON.parse(axi('ticket', board, '--id', 'E-2', '--json')).ticket;
  assert.deepEqual([released.hold, released.state], [false, 'in progress']);

  axi('ticket', board, '--id', 'T-6', '--title', 'Reply to the release note', '--hold', 'yes');
  const replayComment = { id: 'reply-once', at: 1792820000, text: 'Which date?', replies: [] };
  axi('ticket', board, '--id', 'T-6', '--comment', JSON.stringify({ ...replayComment, picked: 1792820100 }));
  const reply = { at: 1792820200, text: 'Friday' };
  axi('ticket', board, '--id', 'T-6', '--comment', JSON.stringify({ ...replayComment, picked: 1792820300, replies: [reply] }));
  assert.equal(JSON.parse(axi('ticket', board, '--id', 'T-6', '--json')).ticket.hold, false);
  axi('ticket', board, '--id', 'T-6', '--hold', 'yes');
  axi('ticket', board, '--id', 'T-6', '--comment', JSON.stringify({ ...replayComment, picked: 1792820400, replies: [reply] }));
  assert.equal(JSON.parse(axi('ticket', board, '--id', 'T-6', '--json')).ticket.hold, true);

  axi('ticket', board, '--id', 'T-4', '--title', 'State completion');
  axi('ticket', board, '--id', 'T-4', '--state', 'done');
  axi('ticket', board, '--id', 'T-5', '--title', 'State transition', '--state', 'queued');
  axi('ticket', board, '--id', 'T-5', '--state', 'in progress');
  const port = await serve(), response = await fetch(`http://127.0.0.1:${port}/api/state?view=tickets`);
  const state = await response.json(), events = state.ticketActivity.filter((event) => event.ticket === 'T-4');
  assert.equal(state.ticketActivity.filter((event) => event.ticket === 'T-6' && event.kind === 'release').length, 1);
  assert.ok(events.some((event) => event.kind === 'state' && event.text === 'State changed to done'));
  assert.ok(!events.some((event) => event.kind === 'merged'));
  const moving = state.ticketActivity.filter((event) => event.ticket === 'T-5' && event.kind === 'state');
  assert.deepEqual(moving.map((event) => event.text), ['State changed to in progress']);
});

test('Tickets read caps a live-shape activity feed at 200 newest events without losing ticket-local activity', async () => {
  for (let i = 0; i < 205; i++) axi('ticket', board, '--id', `CAP-${i}`, '--title', `Activity ticket ${i}`);
  axi('ticket', board, '--id', 'CAP-204', '--state', 'in progress');
  const port = await serve(), response = await fetch(`http://127.0.0.1:${port}/api/state?view=tickets`);
  const text = await response.text(), state = JSON.parse(text);
  const all = readTicketActivity(board), events = state.ticketActivity;
  assert.ok(all.length > 200, `expected live-shape history, got ${all.length} events`);
  assert.equal(events.length, 200);
  assert.deepEqual(events, all.slice(0, 200));
  assert.equal(events[0].ticket, 'CAP-204');
  assert.ok(events.every((event, i) => !i || Date.parse(events[i - 1].at) >= Date.parse(event.at)));
  assert.ok(events.some((event) => event.ticket === 'CAP-204' && event.kind === 'state'));
  const fullBytes = Buffer.byteLength(JSON.stringify({ ...state, ticketActivity: all }));
  console.log(`ticket activity response: ${Buffer.byteLength(text)} B after cap; ${fullBytes} B before cap (${all.length} events)`);
});

// Beyond loopback the board needs its token on every route; the board refuses to bind all interfaces, so this uses the machine's private address.
const mine = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(i.address));
test('the ticket API needs the access token beyond loopback, like the rest of the board', { skip: !mine && 'this machine has no private IPv4 address' }, async () => {
  const port = await serve('--bind', mine.address), origin = `http://${mine.address}:${port}`;
  for (const path of ['/api/tickets', '/api/tickets/T-1', '/api/state']) {
    const got = await fetch(`${origin}${path}`);
    assert.equal(got.status, 401, path);
    assert.match(await got.text(), /needs its access link/);
  }
  const cookie = (await fetch(`${origin}/?token=${readToken()}`, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const got = await fetch(`${origin}/api/tickets/T-1`, { headers: { cookie } });
  assert.equal(got.status, 200);
  assert.equal((await got.json()).ticket.id, 'T-1');
});
