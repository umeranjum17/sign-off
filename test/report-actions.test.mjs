import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Actions block, replayed end to end on the real CLI and the real board: a report that declares none fails the lint,
// Refine sends it back and the owner's version 2 lands on the same key with its diff, Reject closes it and records the rule,
// Approve mints the build ticket the fleet reads, and Reopen puts a closed report back.
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-actions-'));
const home = join(scratch, 'home');
mkdirSync(home);
const env = { ...process.env, HOME: home };
for (const name of ['SIGN_OFF_FILER', 'CLAUDE_CODE_SESSION_ID', 'npm_command', 'npm_config_package', 'SIGN_OFF_BOARD']) delete env[name];
const run = (...args) => {
  try { return { out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }), code: 0 }; }
  catch (e) { return { out: `${e.stdout}${e.stderr}`, code: e.status }; }
};
const procs = [];
after(() => {
  for (const p of procs) if (p.exitCode === null) p.kill();
  rmSync(scratch, { recursive: true, force: true });
});
const report = (patch = {}) => {
  const m = JSON.parse(readFileSync(new URL('../fixtures/contract/report.v5/valid-minimal.json', import.meta.url), 'utf8'));
  return { ...m, key: 'paint-budget', filed: '2026-10-31T09:00:00Z', filer: 'agent-41', ...patch };
};
const write = (name, message) => { const file = join(scratch, name); writeFileSync(file, JSON.stringify(message)); return file; };
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const serve = async (file) => {
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  const out = await new Promise((ok) => { let text = ''; proc.stdout.on('data', (b) => { text += b; if (/pid: \d+/.test(text)) ok(text); }); proc.once('exit', () => ok(text)); });
  const url = /url: "(\S+)"/.exec(out)?.[1];
  assert.ok(url, `serve printed no url: ${out}`);
  return { file, url };
};
const post = async (url, path, body) => { const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const state = async (url) => (await fetch(`${url}api/state`)).json();

test('a report with no Actions block fails the lint, naming the report, and passes once it declares one', () => {
  const bare = report();
  delete bare.actions;
  const refused = run('validate', write('no-actions.json', bare));
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /paint-budget/, 'the lint names the report');
  assert.match(refused.out, /actions is required/, 'the lint says which field is missing');
  assert.equal(run('validate', write('with-actions.json', report())).code, 0, 'a report that declares its actions passes');
});

test('Refine sends the report back, and the owner\'s version 2 lands on the same key with the diff of what changed', async () => {
  const board = join(scratch, 'refine-board.json');
  const first = run('post', board, '--kind', 'report', '--from', write('v1.json', report()), '--filer', 'agent-41');
  assert.equal(first.code, 0, first.out);
  const { url } = await serve(board);

  const refined = await post(url, 'api/report-action', { key: 'paint-budget', action: 'refine', note: 'Add the rollback step, and cut the cost to one server' });
  assert.equal(refined.status, 200, JSON.stringify(refined.body));
  const recorded = lines(`${board.replace(/\.json$/, '')}.report-actions.jsonl`);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].action, 'refine');
  assert.equal(recorded[0].result, 'version', 'Refine asks for a version, it does not build');
  assert.equal(recorded[0].note, 'Add the rollback step, and cut the cost to one server');
  assert.equal(existsSync(`${board.replace(/\.json$/, '')}.tickets.jsonl`), false, 'Refine starts no build');

  const v2 = report({ version: 2, changes: [{ kind: 'added', text: 'The rollback step' }, { kind: 'rewritten', text: 'One server', was: 'Two servers' }, { kind: 'removed', text: 'The second-region test' }] });
  const posted = run('post', board, '--kind', 'report', '--from', write('v2.json', v2), '--filer', 'agent-41');
  assert.equal(posted.code, 0, posted.out);
  assert.match(posted.out, /version 2 posted/, 'the same key takes the new version instead of refusing it');

  const after = await state(url);
  const items = after.decisions.filter((d) => d.key === 'paint-budget');
  assert.equal(items.length, 1, 'version 2 is the same report, never a second one');
  assert.equal(items[0].version, 2);
  assert.deepEqual(items[0].changes.map((c) => c.kind), ['added', 'rewritten', 'removed']);
  assert.equal(items[0].changes[1].was, 'Two servers', 'a rewritten line keeps the wording it replaces');
  assert.equal(items[0].versions.length, 1, 'the board keeps the version history');
  assert.equal(items[0].versions[0].version, 2);
  assert.equal(after.report_actions['paint-budget'].action, 'refine', 'the refine note is still the report\'s state');
});

test('Reject closes the report, records the reason as the owner\'s rule, starts no build, and Reopen brings it back', async () => {
  const board = join(scratch, 'reject-board.json');
  const first = run('post', board, '--kind', 'report', '--from', write('reject-v1.json', report()), '--filer', 'agent-41');
  assert.equal(first.code, 0, first.out);
  const { url } = await serve(board);

  const badReason = await post(url, 'api/report-action', { key: 'paint-budget', action: 'reject', reason: 'Because' });
  assert.equal(badReason.status, 409, 'a reason outside the chips is refused');
  assert.match(badReason.body.error, /Pick a reason: Wrong direction, Too expensive, Not now, Already handled/);

  const closed = await post(url, 'api/report-action', { key: 'paint-budget', action: 'reject', reason: 'Too expensive', note: 'We do not need a second server for this' });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const actions = lines(`${board.replace(/\.json$/, '')}.report-actions.jsonl`);
  const closedLine = actions.at(-1);
  assert.equal(closedLine.action, 'reject');
  assert.equal(closedLine.result, 'closed');
  assert.equal(closedLine.reason, 'Too expensive');
  assert.equal(closedLine.note, 'We do not need a second server for this');
  const learnings = lines(`${board.replace(/\.json$/, '')}.report-learnings.jsonl`);
  assert.equal(learnings.length, 1);
  assert.equal(learnings[0].key, 'paint-budget');
  assert.equal(learnings[0].owner, 'Ada', 'the rule is left on the report\'s own owner');
  assert.equal(learnings[0].reason, 'Too expensive');
  assert.equal(learnings[0].rule, 'We do not need a second server for this.', 'the line typed is the rule the owner keeps');
  assert.equal(existsSync(`${board.replace(/\.json$/, '')}.tickets.jsonl`), false, 'Reject never starts a build');

  const approved = await post(url, 'api/report-action', { key: 'paint-budget', action: 'approve' });
  assert.equal(approved.status, 409, 'a closed report is not approved without reopening it');
  assert.match(approved.body.error, /closed: reopen it first/);

  const back = await post(url, 'api/report-action', { key: 'paint-budget', action: 'reopen' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  const reopened = await state(url);
  assert.equal(reopened.report_actions['paint-budget'].action, 'reopen', 'Reopen puts the report back on its actions');
});

test('Approve starts the build through the ticket the fleet reads, and only once', async () => {
  const board = join(scratch, 'approve-board.json');
  const first = run('post', board, '--kind', 'report', '--from', write('approve-v1.json', report({ key: 'ship-the-block' })), '--filer', 'agent-41');
  assert.equal(first.code, 0, first.out);
  const { url } = await serve(board);

  const bad = await post(url, 'api/report-action', { key: 'ship-the-block', action: 'approve' });
  assert.equal(bad.status, 200, JSON.stringify(bad.body));
  const tickets = lines(`${board.replace(/\.json$/, '')}.tickets.jsonl`);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].id, 'build-ship-the-block');
  assert.equal(tickets[0].state, 'queued');
  assert.equal(tickets[0].stage, 'queued');
  assert.equal(tickets[0].asked, true);
  assert.match(tickets[0].description, /Ada starts the build; the first pull request lands by 2026-11-06/);
  const action = lines(`${board.replace(/\.json$/, '')}.report-actions.jsonl`).at(-1);
  assert.equal(action.action, 'approve');
  assert.equal(action.result, 'build');
  assert.equal(action.owner, 'Ada', 'the owner comes from the report\'s own actions');
  assert.equal(action.ticket, 'build-ship-the-block');

  const again = await post(url, 'api/report-action', { key: 'ship-the-block', action: 'approve' });
  assert.equal(again.status, 409, 'one approval, one build');
  assert.equal(lines(`${board.replace(/\.json$/, '')}.tickets.jsonl`).length, 1);
});
