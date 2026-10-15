import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
const file = join(scratch, 'd.json');
const root = join(scratch, 'proof');
const runId = '20261011T120000Z-a1b2c3d4';
const commit = '0123456789abcdef0123456789abcdef01234567';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
mkdirSync(join(root, '.done-done', 'runs'), { recursive: true });
writeFileSync(join(root, 'after.png'), png);
const makeRecord = (path = 'after.png', bytes = png) => ({ schema: 1, run_id: runId, journey: 'sign-off evidence', command: 'node capture.mjs', commit, tree: 'a'.repeat(40), dirty: false,
  started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:01:00Z', exit: 0,
  files: [{ path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }] });
const recordPath = join(root, '.done-done', 'runs', `${runId}.json`);
writeFileSync(recordPath, JSON.stringify(makeRecord()));
const originalRecord = readFileSync(recordPath);
copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), file);
const decisions = JSON.parse(readFileSync(file, 'utf8'));
decisions.decisions[0].title = 'Umer: Ship the new sign-in screen this week?';
decisions.decisions[0].evidence = { run_id: runId, commit, outcome: 'Umer can see the updated sign-in screen.', repro: 'repro: n/a: no bug', proof: 'done-done: real browser journey', evidence: 'after.png' };
writeFileSync(file, JSON.stringify(decisions));
const procs = [];
after(async () => {
  // A dying serve removes its own run record; removing the scratch folder under it leaves the folder behind.
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});
async function serve(f = file) {
  const proc = spawn('node', [cli, 'serve', f, '--port', '0', '--evidence-root', root], { cwd: tmpdir() });
  procs.push(proc);
  return { proc, url: await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0]))) };
}
const post = (url, body) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('answer journey: save, survive a torn line and a restart, read back', async () => {
  let { proc, url } = await serve();
  const html = await (await fetch(url)).text();
  assert.match(html, /<title>Dashboard/);
  assert.ok(!html.includes('claim-check'), 'the proof card uses plain words, not "claim-check"');
  const board = await (await fetch(`${url}api/decisions`)).json();
  assert.equal(board.decisions[0].evidenceCard.result, 'RUN PASS');
  assert.equal(board.decisions[0].evidenceCard.commit, commit);
  assert.equal(board.decisions[0].evidenceCard.media[0].path, 'after.png');
  assert.deepEqual(Buffer.from(await (await fetch(`${url}${board.decisions[0].evidenceCard.media[0].url.slice(1)}`)).arrayBuffer()), png);
  assert.deepEqual(readFileSync(recordPath), originalRecord);
  assert.deepEqual(JSON.parse(execFileSync('node', [cli, 'answers', file, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] })), {});
  const saved = await post(url, { key: 'short-question', answer: 'yes' });
  assert.equal(saved.status, 200);
  const answeredBoard = await saved.json();
  assert.equal(answeredBoard.decisions[0].evidenceCard.result, 'RUN PASS');
  assert.equal(answeredBoard.decisions[0].evidenceCard.media.length, 1);
  assert.equal((await post(url, { key: 'short-question', answer: 'maybe' })).status, 400);
  assert.equal((await post(url, { key: 'gone', answer: 'yes' })).status, 404);
  appendFileSync(file.replace('.json', '.answers.jsonl'), '{"key":"torn');
  assert.equal((await (await post(url, { key: 'use-dark-default', answer: 'no' })).json()).answers['use-dark-default'].answer, 'no');
  assert.equal((await new Promise((ok) => get(url, { headers: { host: 'evil.example' } }, ok))).statusCode, 403);
  proc.kill();
  ({ proc, url } = await serve());
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).answers['short-question'].answer, 'yes');
  const printed = JSON.parse(execFileSync('node', [cli, 'answers', file, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  assert.deepEqual(Object.keys(printed).sort(), ['short-question', 'use-dark-default']);
  writeFileSync(recordPath, '{malformed');
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard.result, 'UNVERIFIED');
  rmSync(recordPath);
  const missing = (await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard;
  assert.deepEqual([missing.result, missing.reason], ['UNVERIFIED', 'The proof for this run is missing.']);
  for (const bad of ['null', JSON.stringify({ ...makeRecord(), files: [null] })]) {
    writeFileSync(recordPath, bad);
    const card = (await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard;
    assert.equal(card.result, 'UNVERIFIED');
    assert.doesNotMatch(card.reason, /Cannot read|TypeError|properties of|\/|\\/);
  }
  const changed = JSON.parse(readFileSync(file, 'utf8'));
  changed.decisions[0].evidence.commit = 'f'.repeat(40);
  writeFileSync(file, JSON.stringify(changed));
  writeFileSync(recordPath, JSON.stringify(makeRecord()));
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).decisions[0].evidenceCard.result, 'UNVERIFIED');
  changed.decisions[0].evidence.commit = commit;
  writeFileSync(file, JSON.stringify(changed));
  const outside = join(scratch, 'private.png');
  writeFileSync(outside, 'private bytes');
  symlinkSync(outside, join(root, 'escape.png'));
  writeFileSync(join(root, '.done-done', 'runs', `${runId}.json`), JSON.stringify(makeRecord('escape.png', Buffer.from('private bytes'))));
  const unverified = await (await fetch(`${url}api/decisions`)).json();
  assert.equal(unverified.decisions[0].evidenceCard.result, 'UNVERIFIED');
  assert.equal((await fetch(`${url}api/evidence?run=${runId}&file=escape.png`)).status, 404);
  assert.deepEqual(JSON.parse(execFileSync('node', [cli, 'answers', file, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] })), printed);
  const checks = JSON.parse(readFileSync(file, 'utf8'));
  checks.decisions[0].evidence.outcome = '   n/a   ';
  writeFileSync(file, JSON.stringify(checks));
  assert.equal((await fetch(`${url}api/decisions`)).status, 200);
  for (const blank of ['', '   ']) {
    checks.decisions[0].evidence.outcome = blank;
    writeFileSync(file, JSON.stringify(checks));
    const response = await fetch(`${url}api/decisions`);
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /evidence/);
  }
});

test('agent journey: raise, open, answer, read back in TOON and JSON', async () => {
  const env = { ...process.env, HOME: mkdtempSync(join(scratch, 'home-')) };
  const run = (...args) => {
    try {
      return { out: execFileSync('node', [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), code: 0 };
    } catch (e) {
      return { out: e.stdout, code: e.status };
    }
  };
  assert.match(run().out, /waiting: 0 of 0 decisions/);
  const raised = run('raise', '--title', 'Keep the weekly digest?', '--recommend', 'yes');
  assert.match(raised.out, /keep-the-weekly-digest,raised,/);
  // A raised item records when it was raised; raising the same question again keeps that time.
  const filed = () => JSON.parse(readFileSync(join(env.HOME, '.sign-off', 'decisions.json'), 'utf8')).items[0].filed, first = filed();
  assert.ok(Date.now() - Date.parse(first) < 60_000, first);
  assert.match(run('raise', '--title', 'Keep the weekly digest?', '--recommend', 'yes').out, /already waiting/);
  assert.equal(filed(), first);
  assert.deepEqual([run('raise', '--title', 'Keep the weekly digest?').code, run('raise', '--title', 'x', '--recommend', 'maybe').code, run('list', '--stat').code], [1, 2, 2]);
  assert.match(run().out, /waiting\[1\]\{key,title\}:\n  keep-the-weekly-digest,Keep the weekly digest\?/);
  const opened = run('open', '--port', '0');
  const url = /url: "(.+)"/.exec(opened.out)[1], pid = Number(/pid: (\d+)/.exec(opened.out)[1]);
  assert.match(opened.out, /sign-off-axi stop/);
  assert.match(run('status').out, new RegExp(`status: running\npid: ${pid}\n`));
  // wait blocks until the answer is saved, then returns it straight away.
  const waiting = spawn('node', [cli, 'wait', '--key', 'keep-the-weekly-digest', '--timeout', '20'], { env });
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 500));
  assert.equal(waiting.exitCode, null);
  const clicked = Date.now();
  assert.equal((await post(url, { key: 'keep-the-weekly-digest', answer: 'no' })).status, 200);
  assert.equal(await exited, 0);
  assert.ok(Date.now() - clicked < 1500, `wait took ${Date.now() - clicked}ms after the answer`);
  assert.match(waited, /answers\[1\]\{key,answer,at\}:\n  keep-the-weekly-digest,no,/);
  assert.equal(JSON.parse(run('wait', '--key', 'keep-the-weekly-digest', '--json').out)['keep-the-weekly-digest'].answer, 'no');
  assert.match(run('answers').out, /answers\[1\]\{key,answer,at\}:\n  keep-the-weekly-digest,no,/);
  assert.equal(JSON.parse(run('answers', '--key', 'keep-the-weekly-digest', '--json').out)['keep-the-weekly-digest'].answer, 'no');
  assert.match(run('raise', '--title', 'Keep the weekly digest?', '--recommend', 'yes').out, /already answered no/);
  // Undo on the page saves the answer from before the tap; with none before, an empty answer: the line stays and the question waits again.
  const saved = join(env.HOME, '.sign-off', 'decisions.answers.jsonl'), lines = () => readFileSync(saved, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal((await post(url, { key: 'keep-the-weekly-digest', answer: '' })).status, 200);
  assert.deepEqual(lines().map((a) => a.answer), ['no', '']);
  assert.equal(JSON.parse(run('answers', '--json').out)['keep-the-weekly-digest'], undefined);
  assert.match(run().out, /waiting\[1\]\{key,title\}:\n  keep-the-weekly-digest,/);
  assert.equal((await post(url, { key: 'keep-the-weekly-digest', answer: '' })).status, 200);
  assert.equal(lines().length, 2, 'nothing to undo adds no line');
  assert.equal((await post(url, { key: 'keep-the-weekly-digest', answer: 'no' })).status, 200);
  // An option valued text is a plain pick, with no note needed; that item takes no Other answer.
  assert.match(run('raise', '--title', 'Which tab first?', '--option', 'text=Text', '--option', 'code=Code', '--recommend', 'code').out, /which-tab-first,raised/);
  assert.equal((await post(url, { key: 'which-tab-first', answer: 'text' })).status, 200);
  assert.equal(JSON.parse(run('answers', '--key', 'which-tab-first', '--json').out)['which-tab-first'].label, 'Text');
  // Listing options needs a recommendation; a plain yes/no may leave it out. A new decision in a file must be a contract ask, which always names one.
  const unmarked = run('raise', '--title', 'When should it ship?', '--option', 'today=Today', '--option', 'friday=Friday');
  assert.equal(unmarked.code, 2);
  assert.match(unmarked.out, /--recommend is required when you list options[^]*Add --recommend <value>, the option you would pick: one of today, friday/);
  assert.match(run('raise', join(env.HOME, 'picks.json'), '--title', 'When should it ship?', '--option', 'today=Today', '--option', 'friday=Friday', '--recommend', 'friday').out, /when-should-it-ship,raised/);
  assert.equal(run('post', '--type', 'design', '--title', 'Pick one', '--option', 'a=A', '--option', 'b=B').code, 2);
  const listed = join(env.HOME, 'listed.json');
  writeFileSync(listed, JSON.stringify({ schema: 2, items: [{ key: 'pick', title: 'Pick?', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }] }));
  for (const args of [['raise', '--from', listed], ['post', join(env.HOME, 'fed.json'), '--from', listed, '--replace']]) {
    assert.match(run(...args).out, /listed\.json: items\[0\] key pick: kind is required on a new decision[^]*Add \\"contract\\": 1, \\"kind\\" and \\"schema\\"/);
  }
  run('raise', '--title', 'Only toString?', '--key', 'toString');
  assert.match(run().out, /waiting\[1\]\{key,title\}:\n  toString,Only toString\?/);
  assert.match(run('help', 'raise').out, /raise \[board.json\] --title/);
  assert.deepEqual([run('help', 'nope').code, run('open', '--port', '0', '--evidence-root', join(env.HOME, 'missing')).code], [2, 2]);
  await Promise.all(Array.from({ length: 20 }, (_, i) => new Promise((ok) => spawn('node', [cli, 'raise', '--title', `Parallel question ${i}?`], { env }).on('exit', ok))));
  assert.match(run().out, /waiting\[21\]/);
  const timedOut = run('wait', '--key', 'toString', '--timeout', '1');
  assert.deepEqual([timedOut.code, /code: TIMEOUT/.test(timedOut.out)], [1, true]);
  assert.match(run('stop').out, new RegExp(`status: stopped\npid: ${pid}\n`));
  assert.match(run('status').out, /status: not running/);
  assert.match(run('stop').out, /not running \(no-op\)/);
  assert.match(run('raise', '--from', 'missing.json').out, new RegExp(`cannot read ${join(process.cwd(), 'missing.json')}: ENOENT`));
});

test('three dismissed updates are not waiting on the CLI either: list and answers count 0 like the board, and an agent still waits on them', async () => {
  const home = mkdtempSync(join(scratch, 'dismiss-'));
  const env = { ...process.env, HOME: home };
  const run = (...args) => {
    try { return { out: execFileSync('node', [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), code: 0 }; }
    catch (e) { return { out: e.stdout, code: e.status }; }
  };
  run('init', home);
  const shot = join(home, 'shot.png'), board = join(home, '.sign-off', 'decisions.json');
  writeFileSync(shot, png);
  // Three evidence updates, update-1 to update-3, as on the captain's board.
  for (const t of ['Sign-in flow', 'Weekly digest', 'Reports page']) assert.equal(run('post', '--type', 'evidence', '--title', t, '--about', 'Loads in 1 second.', '--media', shot).code, 0);
  assert.match(run('list', board).out, /waiting\[3\]/);
  // The board dismisses them through its own dismiss call and then shows none of them.
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: home, env });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const keys = ['update-1', 'update-2', 'update-3'];
  const dismiss = (ks) => fetch(`${url}api/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: ks, dismissed: true }) });
  assert.equal((await dismiss(keys)).status, 200);
  assert.deepEqual((await (await fetch(`${url}api/decisions`)).json()).dismissed, keys);
  // An answered item cleared from Answered, as Clear all done does, drops out of the answered count too.
  assert.equal(run('raise', board, '--title', 'Ship the new sign-in screen?', '--recommend', 'yes').code, 0);
  assert.equal((await post(url, { key: 'ship-the-new-sign-in-screen', answer: 'yes' })).status, 200);
  assert.match(run('list', board).out, /answered: 1/);
  assert.equal((await dismiss(['ship-the-new-sign-in-screen'])).status, 200);
  // The CLI agrees: nothing is waiting or answered in list, answers is not waiting, --full keeps a dismissed answer and --json says dismissed.
  assert.match(run('list', board).out, /waiting: 0 of 4 decisions \(nothing is waiting on the user\)/);
  assert.match(run('list', board).out, /answered: 0/);
  assert.match(run('answers', board).out, /waiting: 0/);
  assert.deepEqual([...run('list', board, '--full').out.matchAll(/(?:update-\d|ship-the-new-sign-in-screen),(\w+)/g)].map((m) => m[1]), ['dismissed', 'dismissed', 'dismissed', 'yes']);
  assert.deepEqual(JSON.parse(run('list', board, '--json').out).decisions.map((d) => d.dismissed), [true, true, true, true]);
  // A dismissed, unanswered ask is hidden from the board, not withdrawn: raising it again still reports it waiting.
  assert.equal(run('raise', board, '--title', 'Keep the weekly digest email?', '--recommend', 'yes').code, 0);
  assert.equal((await dismiss(['keep-the-weekly-digest-email'])).status, 200);
  assert.match(run('raise', board, '--title', 'Keep the weekly digest email?', '--recommend', 'yes').out, /keep-the-weekly-digest-email,already waiting/);
  proc.kill();
  // The agent is not told: answers still returns a dismissed answer, and a wait on the dismissed updates runs to its timeout.
  assert.match(run('answers', board, '--key', 'ship-the-new-sign-in-screen').out, /ship-the-new-sign-in-screen,yes/);
  const waited = run('wait', board, '--timeout', '0');
  assert.deepEqual([waited.code, /code: TIMEOUT/.test(waited.out)], [1, true]);
});

test('old files and answers read as before; a one-of-few answer with a note survives a restart', async () => {
  const old = join(scratch, 'old.json');
  copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), old);
  writeFileSync(old, JSON.stringify({ ...JSON.parse(readFileSync(old, 'utf8')), owner: 'Umer' }));
  const oldLines = ['{"key":"use-dark-default","answer":"yes","label":"Yes","close":"done","at":"2026-10-10T08:00:00Z"}',
    '{"key":"short-question","answer":"yes","label":"Yes","close":"done","at":"2026-10-11T09:14:03Z"}',
    '{"key":"use-dark-default","answer":"no","label":"No","close":"done","at":"2026-10-11T09:15:00Z"}'];
  writeFileSync(old.replace('.json', '.answers.jsonl'), oldLines.join('\n') + '\n');
  assert.equal(execFileSync('node', [cli, 'answers', old, '--json'], { encoding: 'utf8' }),
    '{"short-question":{"answer":"yes","label":"Yes","close":"done","at":"2026-10-11T09:14:03Z"},'
    + '"use-dark-default":{"answer":"no","label":"No","close":"done","at":"2026-10-11T09:15:00Z"}}\n');
  let { proc, url } = await serve(old);
  const oldBoard = await (await fetch(`${url}api/decisions`)).json();
  assert.deepEqual(oldBoard.answers, { 'use-dark-default': JSON.parse(oldLines[2]), 'short-question': JSON.parse(oldLines[1]) });
  assert.ok(oldBoard.decisions.every((d) => JSON.stringify(d.options) === '[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]'));
  proc.kill();
  // The first write upgrades the schema 1 board to schema 2 and keeps the old file once beside it; nothing is lost.
  const before = readFileSync(old), beforeAnswers = execFileSync('node', [cli, 'answers', old, '--json'], { encoding: 'utf8' });
  execFileSync('node', [cli, 'raise', old, '--title', 'Umer: one more question?'], { stdio: 'ignore' });
  const upgraded = JSON.parse(readFileSync(old, 'utf8'));
  assert.deepEqual([upgraded.schema, upgraded.owner, upgraded.items.slice(0, -1)], [2, 'Umer', JSON.parse(before).decisions]);
  assert.deepEqual(readFileSync(`${old}.schema-1.bak`), before);
  assert.equal(execFileSync('node', [cli, 'answers', old, '--json'], { encoding: 'utf8' }), beforeAnswers);
  execFileSync('node', [cli, 'raise', old, '--title', 'Umer: and another?'], { stdio: 'ignore' });
  assert.deepEqual(readFileSync(`${old}.schema-1.bak`), before);

  const opts = join(scratch, 'options.json');
  copyFileSync(new URL('../fixtures/options-decisions.json', import.meta.url), opts);
  const lines = () => readFileSync(opts.replace('.json', '.answers.jsonl'), 'utf8').trim().split('\n');
  ({ proc, url } = await serve(opts));
  assert.equal((await post(url, { key: 'release-window', answer: 'yes' })).status, 400);
  assert.equal((await post(url, { key: 'release-window', answer: 'friday', note: 'x'.repeat(501) })).status, 400);
  assert.equal((await post(url, { key: 'release-window', answer: 'friday', note: 5 })).status, 400);
  assert.equal((await (await post(url, { key: 'old-export', answer: 'keep', note: '😀'.repeat(500) })).json()).answers['old-export'].note, '😀'.repeat(500));
  assert.equal((await post(url, { key: 'old-export', answer: 'keep', note: '😀'.repeat(501) })).status, 400);
  const saved = await (await post(url, { key: 'release-window', answer: 'friday', note: '  Umer: after the stand-up  ' })).json();
  assert.equal(saved.answers['release-window'].note, 'Umer: after the stand-up');
  await post(url, { key: 'release-window', answer: 'friday', note: 'Umer: after the stand-up' });
  assert.equal(lines().length, 2);
  await post(url, { key: 'report-region', answer: 'token' });
  assert.equal(JSON.parse(lines()[2]).note, undefined);
  proc.kill();
  ({ proc, url } = await serve(opts));
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).answers['release-window'].note, 'Umer: after the stand-up');
  const printed = JSON.parse(execFileSync('node', [cli, 'answers', opts, '--json'], { encoding: 'utf8' }));
  assert.deepEqual(Object.keys(printed['release-window']), ['answer', 'label', 'close', 'at', 'note']);
  assert.deepEqual(Object.keys(printed['report-region']), ['answer', 'label', 'close', 'at']);
  assert.equal(printed['report-region'].answer, 'token');

  const good = JSON.parse(readFileSync(opts, 'utf8'));
  const six = good.decisions[1].options;
  for (const [field, change] of [['options', (d) => (d.options = six.slice(0, 1))], ['options', (d) => (d.options = [...six, { value: 'x', label: 'X' }])],
    ['options', (d) => (d.options = [six[0], { ...six[1], value: 'emea' }])], ['options', (d) => (d.options = [six[0], { value: 'a b', label: 'A' }])],
    ['options', (d) => (d.options = [six[0], { value: 'b', label: ' ' }])], ['recommend_value', (d) => (d.recommend_value = 'yes')],
    ['default_if_silent', (d) => (d.default_if_silent = 'maybe')]]) {
    const bad = structuredClone(good);
    change(bad.decisions[1]);
    writeFileSync(opts, JSON.stringify(bad));
    assert.throws(() => execFileSync('node', [cli, 'answers', opts], { stdio: 'pipe' }),
      (e) => e.status === 2 && `${e.stdout}`.includes(`decisions[1] (key \\"report-region\\"): ${field} `));
  }
  proc.kill();

  // An agent raises a one-of-few question from the CLI and reads the note back.
  const env = { ...process.env, HOME: mkdtempSync(join(scratch, 'home-')) };
  const run = (...args) => {
    try {
      return { out: execFileSync('node', [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
    } catch (e) {
      return { out: `${e.stdout}${e.stderr}`, code: e.status };
    }
  };
  const ship = ['raise', '--title', 'When should it ship?', '--option', 'today=Today', '--option', 'next-week=Next week, after the review'];
  assert.match(run(...ship, '--recommend', 'next-week').out, /when-should-it-ship,raised,/);
  for (const bad of [['--option', 'today'], ['--option', '=Today'], ['--option', 'x y=Bad value'], ['--recommend', 'yes']]) {
    assert.equal(run('raise', '--title', 'Bad?', '--option', 'a=A', ...bad).code, 2, bad.join(' '));
  }
  assert.equal(run('raise', '--title', 'One?', '--option', 'a=A').code, 2);
  assert.equal(run('raise', '--from', opts, '--option', 'a=A').code, 2);
  const opened = run('open', '--port', '0');
  const boardUrl = /url: "(.+)"/.exec(opened.out)[1];
  after(() => run('stop'));
  assert.equal((await post(boardUrl, { key: 'when-should-it-ship', answer: 'next-week', note: 'Umer: after the review, please.' })).status, 200);
  assert.match(run('answers').out, /answers\[1\]\{key,answer,at,note\}:\n  when-should-it-ship,next-week,[^,]+,"Umer: after the review, please."/);
  assert.equal(JSON.parse(run('answers', '--json').out)['when-should-it-ship'].note, 'Umer: after the review, please.');
});
