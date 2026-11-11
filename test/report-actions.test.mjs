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
after(async () => {
  // A served board is stopped and gone before the scratch folder is taken away, and the folder is waited out: the suite fails a file that
  // leaves anything in the run's temp folder.
  await Promise.all(procs.map((p) => new Promise((ok) => (p.exitCode !== null ? ok() : (p.once('exit', ok), p.kill())))));
  for (let i = 0; i < 50 && existsSync(scratch); i++) {
    try { rmSync(scratch, { recursive: true, force: true }); } catch {}
    if (!existsSync(scratch)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
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

test('a report sets its approve words, and an empty or overlong one is refused by field', () => {
  const act = (extra) => report({ actions: { ...report().actions, ...extra } });
  assert.equal(run('validate', write('words.json', act({ approve_result: 'Runs the test. Ada posts the result.', approved_heading: 'Test started' }))).code, 0);
  const empty = run('validate', write('words-empty.json', act({ approved_heading: ' ' })));
  assert.equal(empty.code, 2, empty.out);
  assert.match(empty.out, /actions\.approved_heading/);
  assert.match(run('validate', write('words-long.json', act({ approve_result: 'x'.repeat(121) }))).out, /actions\.approve_result/);
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
  assert.equal(items[0].versions.length, 2, 'the board keeps the original and the new version');
  assert.equal(items[0].versions[1].version, 2);
  assert.equal(after.report_actions['paint-budget'].action, 'refine', 'the refine note is still the report\'s state');
});

// Sanitized reported transitions, not a claim to possess the unavailable original caller inputs.
test('report history survives raise, retry, discard, feed replacement and a missing draft', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/report-history.json', import.meta.url), 'utf8'));
  const board = join(scratch, 'history-board.json'), firstDay = '2020-01-01T02:00:00Z';
  const drafts = fixture.drafts.map(({ version, title, rows }) => report({ key: fixture.key, title, filed: version === 1 ? firstDay : `2020-01-01T0${version}:00:00Z`,
    ...(version > 1 && { version, changes: [{ kind: 'added', text: `The review now has ${rows} rows` }] }),
    about: `The review has ${rows} rows.`, actions: { ...report().actions, owner: 'Umer' } }));
  const send = (m, command = 'raise') => run(command, board, '--from', write('history-feed.json', { schema: 2, items: [m] }));
  assert.equal(send(drafts[0]).code, 0);
  const { url } = await serve(board);
  assert.equal(run('dismiss', fixture.key, board, '--reason', 'replaced').code, 0);
  assert.equal(lines(board.replace(/\.json$/, '') + '.dismissed.jsonl').at(-1).version, 1, 'the discard belongs to the version being replaced');
  assert.equal(send(drafts[1]).code, 0);
  let current = await state(url);
  assert.ok(!current.dismissed.includes(fixture.key), 'a successful repost is live even when the first filing is old');
  assert.ok(!current.discarded[fixture.key], 'the current version is never discarded by the earlier discard');
  const posted = readFileSync(board, 'utf8');
  assert.equal(send(drafts[1]).code, 0, 'raise retry is idempotent');
  assert.equal(run('post', board, '--kind', 'report', '--from', write('history-message.json', drafts[1])).code, 0, 'contract retry is idempotent');
  assert.equal(readFileSync(board, 'utf8'), posted, 'retries do not create new history or timestamps');
  write('unposted-draft.json', drafts[2]);
  assert.equal((await state(url)).decisions.find((d) => d.key === fixture.key).version, 3, 'writing draft 5 alone does not post it');
  const companion = report({ key: fixture.companion, filed: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  assert.equal(send(companion).code, 0);
  const feed = write('history-replace.json', { schema: 2, items: [drafts[2], companion] });
  assert.equal(run('post', board, '--from', feed, '--replace').code, 0);
  current = await state(url);
  const card = current.decisions.find((d) => d.key === fixture.key);
  assert.equal(current.decisions.filter((d) => d.key === fixture.key).length, 1);
  assert.equal(card.version, 5);
  assert.equal(card.filed, firstDay, 'the card keeps its original filing');
  assert.deepEqual(card.versions.map((v) => v.version), [1, 3, 5]);
  assert.equal(card.versions[1].item.about, drafts[1].about, 'the previous document remains readable');
  assert.deepEqual(card.versions[1].changes, drafts[1].changes);
  assert.ok(!current.dismissed.includes(fixture.key));
  assert.equal(run('post', board, '--from', feed, '--replace').code, 0, 'feed retry is idempotent');
  assert.equal(run('post', board, '--from', write('stored-report-feed.json', JSON.parse(readFileSync(board, 'utf8'))), '--replace').code, 0, 'a stored board round-trips despite its original filing stamp and retained history');
  const saved = readFileSync(board, 'utf8');
  for (const bad of [drafts[0], { ...drafts[2], about: 'Changed without a new version' }, { ...drafts[2], version: 6, changes: undefined }]) {
    assert.notEqual(send(bad).code, 0, 'stale, changed same-version and unannotated revisions are refused');
    assert.equal(readFileSync(board, 'utf8'), saved, 'a refusal leaves the live report intact');
    const badFeed = write('bad-report-feed.json', { schema: 2, items: [bad, companion] });
    assert.notEqual(run('post', board, '--from', badFeed, '--replace').code, 0, 'feeds obey the same transition rules');
    assert.equal(readFileSync(board, 'utf8'), saved);
  }
  assert.equal(run('dismiss', fixture.key, board, '--reason', 'replaced').code, 0);
  assert.equal(run('post', board, '--from', feed, '--replace').code, 0, 'an identical repost restores a dismissed report');
  assert.ok(!(await state(url)).dismissed.includes(fixture.key));
  const anotherKind = { key: fixture.key, title: 'A different card', type: 'interactive', view: 'demo.html' };
  assert.notEqual(send(anotherKind).code, 0, 'a report key cannot be changed to another kind');
  const legacy = JSON.parse(readFileSync(board, 'utf8'));
  legacy.items[0].versions = [{ version: 3, at: '2020-01-01T03:00:00Z', changes: drafts[1].changes }];
  writeFileSync(board, JSON.stringify(legacy));
  assert.equal(send({ ...drafts[2], version: 6 }).code, 0);
  const kept = (await state(url)).decisions.find((d) => d.key === fixture.key).versions;
  assert.equal(kept[0].version, 3); assert.equal(kept[0].item, undefined, 'legacy change notes remain without inventing a lost document');
  assert.equal(kept[1].version, 5); assert.ok(kept[1].item, 'the available earlier document is retained');
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

test('a report that names the key it replaces archives the old card in the same write, and a missing key writes nothing', () => {
  const board = join(scratch, 'replace-board.json');
  assert.equal(run('post', board, '--kind', 'report', '--from', write('old.json', report({ key: 'old-plan' }))).code, 0);
  const refused = run('post', board, '--kind', 'report', '--from', write('new.json', report({ key: 'new-plan' })), '--replaces', 'no-such-card');
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /no card with key no-such-card/);
  assert.equal(JSON.parse(readFileSync(board, 'utf8')).items.some((i) => i.key === 'new-plan'), false, 'a refused replace writes no card');
  assert.equal(run('post', board, '--kind', 'report', '--from', write('new.json', report({ key: 'new-plan' })), '--replaces', 'old-plan').code, 0);
  const keys = JSON.parse(readFileSync(board, 'utf8')).items.map((i) => i.key);
  assert.deepEqual(keys.sort(), ['new-plan', 'old-plan']);
  const archived = lines(`${board.replace(/\.json$/, '')}.dismissed.jsonl`).findLast((l) => l.key === 'old-plan');
  assert.equal(archived?.dismissed, true);
  assert.equal(archived?.reason, 'replaced');
  assert.equal(lines(`${board.replace(/\.json$/, '')}.dismissed.jsonl`).findLast((l) => l.key === 'new-plan')?.dismissed, false, 'the new card stays live');
});
