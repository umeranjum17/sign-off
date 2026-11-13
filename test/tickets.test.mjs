import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// The board reads and writes tickets only through the ticket adapter (docs/ticket-adapter.md): the CLI and the HTTP routes, end to end against the stand-in adapter.
// An unknown field is kept, a stale write is a conflict that shows the adapter's current ticket, a failure is the adapter's own message, a list the adapter does not
// vouch for is `incomplete`, and the board writes no ticket file and keeps no copy.
const run = promisify(execFile);
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const standin = new URL('./support/ticket-adapter-standin.mjs', import.meta.url).pathname;
const faults = new URL('./support/ticket-adapter-standin-faults.mjs', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'so-tickets-'));
const home = join(scratch, 'home'), store = join(scratch, 'store'), boardDir = join(scratch, 'board');
for (const d of [home, store, boardDir]) mkdirSync(d);
const board = join(boardDir, 'board.json');
const baseEnv = { ...process.env, HOME: home, TICKET_STANDIN_DIR: store };
for (const name of ['SIGN_OFF_FILER', 'CLAUDE_CODE_SESSION_ID', 'npm_command', 'npm_config_package', 'SIGN_OFF_BOARD', 'SIGN_OFF_TICKETS_ADAPTER', 'TICKET_STANDIN_BUG']) delete baseEnv[name];
const env = { ...baseEnv, SIGN_OFF_TICKETS_ADAPTER: standin };
// An async run (a blocking one would stop this process answering the board it is asked about).
const so = async (args, e = env) => { try { return { out: (await run(process.execPath, [cli, ...args], { env: e })).stdout, code: 0 }; } catch (x) { return { out: `${x.stdout}${x.stderr}`, code: x.code }; } };
const procs = [];
after(async () => {
  await Promise.all(procs.map((p) => new Promise((ok) => (p.exitCode !== null ? ok() : (p.once('exit', ok), p.kill())))));
  for (let i = 0; i < 50 && existsSync(scratch); i++) { try { rmSync(scratch, { recursive: true, force: true }); } catch {} await new Promise((r) => setTimeout(r, 100)); }
});
// One server to a board: each later server gets a board of its own (with the one card the first test raised).
let served = 0;
const serve = async (e = env) => {
  let file = board;
  if (served++) {
    file = join(boardDir, `board-${served}.json`);
    assert.equal((await so(['raise', file, '--key', 'ship', '--title', 'Ship it?', '--why', 'The page is ready.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'It is ready.', '--default', 'no', '--ask-ref', 'message-demo'])).code, 0);
  }
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env: e, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const out = await new Promise((ok) => { let text = ''; proc.stdout.on('data', (b) => { text += b; if (/pid: \d+/.test(text)) ok(text); }); proc.once('exit', () => ok(text)); });
  const url = /url: "(\S+)"/.exec(out)?.[1];
  assert.ok(url, `serve printed no url: ${out}`);
  return url;
};
const api = async (url, path, body) => {
  const r = await fetch(`${url}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const fault = (mode) => run(process.execPath, [faults, mode], { env });

test('the board names no ticket file and holds no copy: a card only names its ticket, and the tickets are read from the adapter each time', async () => {
  assert.equal((await so(['raise', board, '--key', 'ship', '--title', 'Ship it?', '--why', 'The page is ready.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'It is ready.', '--default', 'no', '--ask-ref', 'message-demo', '--ticket', 'tk-9'])).code, 0);
  const url = await serve();
  const made = await api(url, 'api/tickets', { ticket: { title: 'Ship the settings page', body: 'All of it.', extra: { estimate: '3', vendor_field: { nested: [1, 2] } } }, op_id: 'make-1' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.ticket.id;
  // The same request again is the first answer, not a second ticket.
  assert.equal((await api(url, 'api/tickets', { ticket: { title: 'Ship the settings page', body: 'All of it.', extra: { estimate: '3', vendor_field: { nested: [1, 2] } } }, op_id: 'make-1' })).body.ticket.id, id);
  const list = (await api(url, 'api/tickets')).body.tickets;
  assert.deepEqual(list.map((t) => t.id), [id]);
  assert.deepEqual(list[0].extra, { estimate: '3', vendor_field: { nested: [1, 2] } }, 'an unknown extra key is passed on as it is');
  // What the board writes beside its board file is its own cards and answers, never tickets.
  assert.deepEqual(readdirSync(boardDir).filter((f) => /ticket/i.test(f)), [], 'no ticket file and no cache in the board folder');
  // Nothing stands in for the adapter: take its answers away and the next read says so.
  await fault('unreadable');
  const down = await api(url, 'api/tickets');
  assert.equal(down.status, 502);
  assert.deepEqual([down.body.error.code, down.body.error.message, down.body.error.retryable], ['unavailable', 'The stand-in store cannot be read.', true], 'the adapter’s own code and message, with no older rows');
  assert.equal(down.body.tickets, undefined);
  await fault('none');
  assert.deepEqual((await api(url, 'api/tickets')).body.tickets.map((t) => t.id), [id]);
});

test('a patch sends only what changed with the rev that was read; a stale rev is a conflict that carries the current ticket, and an unknown extra key survives the edit', async () => {
  const url = await serve();
  const [{ id, rev, extra }] = (await api(url, 'api/tickets')).body.tickets;
  const one = await api(url, `api/tickets/${id}`, { rev, set: { title: 'Ship the settings page today' }, op_id: 'edit-1' });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.ticket.title, 'Ship the settings page today');
  assert.deepEqual(one.body.ticket.extra, extra, 'a patch that names no extra key leaves them all');
  assert.equal(one.body.ticket.body, 'All of it.', 'a field the patch did not name is as it was');
  // The same rev again is stale: the adapter's current ticket comes back so the person can see both versions.
  const stale = await api(url, `api/tickets/${id}`, { rev, set: { title: 'Another title' }, op_id: 'edit-2' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'conflict');
  assert.equal(stale.body.error.detail.current.title, 'Ship the settings page today');
  assert.equal(stale.body.error.detail.current.rev, one.body.ticket.rev);
  // A value the backend refuses is `invalid`, naming the field.
  const bad = await api(url, `api/tickets/${id}`, { rev: one.body.ticket.rev, set: { status: 'not-a-status' }, op_id: 'edit-3' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'invalid');
  assert.equal(bad.body.error.detail.fields[0].field, 'status');
  // A write with no op_id is refused before it reaches the adapter.
  assert.equal((await api(url, `api/tickets/${id}`, { rev: one.body.ticket.rev, set: { title: 'x' } })).status, 400);
  // The ticket, its cards and its history are read from the adapter as they stand.
  const got = await api(url, `api/tickets/${id}`);
  assert.equal(got.body.ticket.title, 'Ship the settings page today');
  const events = (await api(url, `api/tickets/${id}/history`)).body.events;
  assert.deepEqual(events.map((e) => e.type), ['created', 'changed']);
  assert.equal((await api(url, `api/tickets/${id}/comment`, { text: 'Needs a screenshot.', op_id: 'c-1' })).status, 200);
  assert.deepEqual((await api(url, `api/tickets/${id}/history`)).body.events.map((e) => e.type), ['created', 'changed', 'comment']);
  assert.equal((await api(url, 'api/tickets/nope')).status, 404);
  // describe: the fields and capabilities the screens are drawn from.
  const fields = (await api(url, 'api/ticket-fields')).body;
  assert.deepEqual([fields.backend, fields.capabilities], ['stand-in', ['history', 'comment']]);
});

test('a list the adapter does not vouch for is incomplete, and no adapter named is its own plain error', async () => {
  const url = await serve();
  await fault('partial');
  const partial = await api(url, 'api/tickets');
  assert.equal(partial.status, 502);
  assert.equal(partial.body.error.code, 'incomplete');
  assert.equal(partial.body.tickets, undefined, 'no partial list');
  // An adapter that answers a partial list as a success (complete is not true) is refused all the same.
  const lying = await serve({ ...env, TICKET_STANDIN_BUG: 'complete-false' });
  const refused = await api(lying, 'api/tickets');
  assert.equal(refused.body.error.code, 'incomplete');
  assert.equal(refused.body.tickets, undefined);
  await fault('none');
  const bare = await serve(baseEnv);
  const none = await api(bare, 'api/tickets');
  assert.equal(none.status, 503);
  assert.equal(none.body.error.code, 'not_configured');
  assert.match(none.body.error.message, /SIGN_OFF_TICKETS_ADAPTER/);
  assert.equal(none.body.tickets, undefined);
});

test('the CLI is the same client: create, read, patch with the rev, conflict, history and comment, and the adapter’s message verbatim', async () => {
  const made = JSON.parse((await so(['ticket', board, '--create', '--set', 'title=Rename the export', '--set', 'extra.owner=ada', '--json'])).out);
  assert.equal(made.status, 'created');
  const { id, rev } = made.ticket;
  assert.deepEqual(made.ticket.extra, { owner: 'ada' });
  const patched = JSON.parse((await so(['ticket', board, '--id', id, '--rev', rev, '--set', 'status=stage-2', '--json'])).out);
  assert.equal(patched.ticket.status, 'stage-2');
  assert.deepEqual(patched.ticket.extra, { owner: 'ada' });
  const stale = await so(['ticket', board, '--id', id, '--rev', rev, '--set', 'status=stage-3']);
  assert.notEqual(stale.code, 0);
  assert.match(stale.out, /conflict/);
  assert.match(stale.out, new RegExp(`${id} changed since it was read`), 'the adapter’s own message');
  assert.match((await so(['ticket', board, '--id', id, '--text', 'Looks right.'])).out, /comment|Looks right|e-\d/);
  const history = JSON.parse((await so(['ticket', board, '--id', id, '--history', '--json'])).out).events;
  assert.deepEqual(history.map((e) => e.type), ['created', 'changed', 'comment']);
  const listed = JSON.parse((await so(['ticket', board, '--json'])).out);
  assert.ok(listed.tickets.some((t) => t.id === id));
  const gone = await so(['ticket', board, '--id', 'tk-404']);
  assert.notEqual(gone.code, 0);
  assert.match(gone.out, /not_found|No ticket tk-404/);
  const none = await so(['ticket', board], baseEnv);
  assert.notEqual(none.code, 0);
  assert.match(none.out, /SIGN_OFF_TICKETS_ADAPTER/);
});
