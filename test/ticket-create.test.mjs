import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const cli = new URL('../dist/cli.js', import.meta.url).pathname, run = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'so-create-'));
const env = { ...process.env, HOME: scratch, XDG_CONFIG_HOME: scratch, XDG_DATA_HOME: scratch, XDG_CACHE_HOME: scratch, SIGN_OFF_HOME: scratch };
delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_FILER;
const board = join(scratch, 'board.json'), axi = async (...a) => (await run(process.execPath, [cli, ...a], { env })).stdout;
let server;
after(() => { server?.kill(); rmSync(scratch, { recursive: true, force: true }); });

test('the owner makes a ticket on the page: an epic, a ticket under it with an assignee, a refusal with its reason, and the fleet lists them', async () => {
  await axi('raise', board, '--title', 'Ship the settings page on Friday?', '--why', 'The page is ready and the release goes out Friday.', '--outcome', 'yes=It ships on Friday.', '--outcome', 'no=It waits.',
    '--recommend', 'yes', '--recommend-reason', 'Every check passed.', '--default', 'no', '--ask-ref', 'message-test');
  await axi('ticket', board, '--id', 'E-1', '--title', 'The new settings page', '--description', 'The settings page.', '--project', 'Settings');
  server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  for await (const chunk of server.stdout) { out += chunk; if (/url: "http:\/\/[^"]+\/"/.test(out)) break; }
  const base = /url: "(http:\/\/[^"]+)"/.exec(out)[1], post = (body) => fetch(`${base}api/tickets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const made = await post({ title: '  Add the save button  ', description: 'Save the page.', type: 'bug', parent: 'E-1', priority: 'P1', project: 'Settings', assignee: 'Umer' });
  assert.equal(made.status, 200);
  const { ticket } = await made.json();
  assert.match(ticket.id, /^add-the-save-button-[0-9a-f]{6}$/);
  assert.deepEqual([ticket.title, ticket.type, ticket.parent, ticket.priority, ticket.state, ticket.progress, ticket.by, ticket.assignee], ['Add the save button', 'bug', 'E-1', 'P1', 'queued', 0, 'owner', { lead: 'Umer', live: false }]);
  const { tickets } = await (await fetch(`${base}api/tickets`)).json();
  const mine = tickets.find((t) => t.id === ticket.id);
  assert.deepEqual([mine.assignee.lead, mine.parent], ['Umer', 'E-1']);
  // Refusals say why and write nothing.
  for (const [body, why] of [[{ title: '   ' }, /needs a title/], [{ title: 'x', parent: 'nope' }, /No ticket nope/], [{ title: 'x', priority: 'P9' }, /priority must be/], [{ title: 'x', type: 'decision' }, /ticket, bug or epic/], [{ title: 'x', owner: 1 }, /Send one object/]]) {
    const res = await post(body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, why);
  }
  assert.equal((await (await fetch(`${base}api/tickets`)).json()).tickets.length, 2);
  const created = JSON.parse(await axi('ticket', board, '--created', '--json')).created;
  assert.deepEqual(created.map((c) => [c.ticket, c.title, c.type, c.parent, c.assignee]), [[ticket.id, 'Add the save button', 'bug', 'E-1', 'Umer']]);
});
