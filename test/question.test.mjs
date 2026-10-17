import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-question-'));
const env = { ...process.env, HOME: join(scratch, 'home') };
delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_FILER;
const procs = [];
after(async () => {
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
// A question that meets the standard; each refusal case changes one flag of it.
const good = ['--title', 'Ship the new sign-in screen this week?', '--why', 'The screen is ready and the release goes out Friday.',
  '--outcome', 'yes=It ships to everyone on Friday.', '--outcome', 'no=It waits for next week.', '--recommend', 'yes',
  '--recommend-reason', 'Every check passed on 3 phones.', '--default', 'no'];
const without = (...flags) => good.filter((a, i) => !flags.includes(a) && !flags.includes(good[i - 1]));
const pick = (title) => ['--title', title, '--why', 'Two fixes are still in review.', '--option', 'a=A: Today', '--option', 'b=B: Friday',
  '--outcome', 'a=It ships now.', '--outcome', 'b=It ships with the fixes.', '--recommend', 'b', '--recommend-reason', 'The fixes land Thursday.', '--default', 'b'];

test('the question standard: every rule refuses a new question at post time, naming the field and one fix', () => {
  const board = join(scratch, 'refusals.json');
  // [flags, the field it names, the fix line]
  const cases = [
    [without('--why'), /--why is required/, /Add --why: what it is about and why it needs an answer now/],
    [without('--outcome').concat('--outcome', 'yes=It ships.'), /options\[1\]\.outcome is required/, /Add --outcome no=<text>: what happens next if no is picked/],
    [without('--recommend-reason'), /--recommend-reason is required/, /Add --recommend-reason: why you recommend yes/],
    [without('--default'), /--default is required/, /Add --default: the option that happens if the person stays quiet/],
    [[...good, '--silent-by', 'tomorrow'], /--silent-by "tomorrow" is not a UTC time/, /YYYY-MM-DDTHH:MM:SSZ/],
    [[...good.slice(2), '--title', 'Say yes or no: ship the sign-in screen?'], /--title starts with a label for agents/, /ask the question itself/],
    [[...good.slice(2), '--title', 'Captain: ship the sign-in screen?'], /--title starts with a label for agents/, /ask the question itself/],
    [[...good.slice(2), '--title', 'fm-signin-7: ship it?'], /--title starts with a label for agents/, /ask the question itself/],
    [[...good.slice(2), '--title', 'Ship fm-sign-off-question this week?'], /--title has the id "fm-sign-off-question"/, /plain words/],
    [[...good.slice(2), '--title', 'Ship the new sign-in screen this week'], /--title must be a question ending in "\?"/, /12 words or fewer/],
    [[...good.slice(2), '--title', 'Should we ship the new sign-in screen to every single user this week?'], /--title is 13 words, over 12/, /put the rest in --why/],
    [[...good.slice(2), '--title', 'Which day should it ship: A, B or C?'], /options are Yes\/No, but the text names choices A, B, C/, /--option a="A: <short label>" --outcome a=<text>/],
    [pick('Which day should it ship: A, B or C?'), /options has 2 options, but the text names 3 choices: A, B, C/, /one option per choice/],
    [[...pick('Which day should it ship: A or B?').slice(0, 4), '--option', 'a=Today', ...pick('').slice(6)], /options has no option label that starts with A/, /each label starting with its letter/],
    [[...good, '--option', 'yes=Sure', '--option', 'no=No'], /label of option yes is "Sure", not Yes/, /Set the label of yes to "Yes"/],
    [[...without('--outcome', '--recommend', '--default'), '--option', 'done=Done', '--option', 'later=Not now', '--outcome', 'done=It closes.', '--outcome', 'later=It waits.', '--recommend', 'done', '--default', 'later'],
      /options\[0\]\.label "Done" does not answer a question/, /Yes and No, or one per choice/],
    [[...good, '--merge', 'ship-the-new-sign-in-screen-this-week'], /--merge is this ask's own key/, /Name the other cards/],
    [[...good, '--outcome', 'maybe=It might.'], /--outcome maybe=It might\. must be <value>=<what happens next>, for one of yes, no/, /--outcome yes=/],
  ];
  for (const [flags, error, help] of cases) {
    const r = run('raise', board, ...flags), what = flags.join(' '), out = r.stdout.replaceAll('\\"', '"');
    assert.equal(r.status, 2, `${what}\n${r.stdout}`);
    assert.match(out, error, what);
    assert.match(out, /^help\[1\]:/m, `one fix line: ${what}`);
    assert.match(out, help, what);
  }
  // Nothing was written, and the same question that follows the standard goes in, from raise and post --type decision alike.
  assert.equal(run('list', board, '--json').stdout.includes('"key"'), false);
  assert.equal(run('raise', board, ...good, '--silent-by', '2026-10-17T16:00Z').status, 0);
  assert.equal(run('post', board, '--type', 'decision', ...pick('Which day should the release ship?')).status, 0);
  const stored = JSON.parse(run('list', board, '--json').stdout).decisions;
  assert.deepEqual(stored.map((d) => [d.why, d.options.map((o) => o.outcome).length, d.recommend_reason]),
    [['The screen is ready and the release goes out Friday.', 2, 'Every check passed on 3 phones.'], ['Two fixes are still in review.', 2, 'The fixes land Thursday.']]);
  // The new flags belong to questions only.
  const design = run('post', board, '--type', 'design', '--title', 'Pick a layout?', '--option', 'a=A', '--option', 'b=B', '--recommend', 'a', '--why', 'x');
  assert.equal(design.status, 2);
  assert.match(design.stdout, /--why needs --type decision/);
});

test('the question standard holds in post --kind ask and in a feed, for changed items only', () => {
  const board = join(scratch, 'feed.json'), file = join(scratch, 'feed-in.json');
  const ask = JSON.parse(readFileSync(new URL('../fixtures/contract/ask.v1/valid-yes-no.json', import.meta.url)));
  delete ask.filer;
  writeFileSync(file, JSON.stringify({ ...ask, title: 'Say yes or no: ship it?' }));
  const kind = run('post', board, '--kind', 'ask', '--from', file);
  assert.equal(kind.status, 2, kind.stdout);
  assert.match(kind.stdout, /title starts with a label for agents[^]*help\[1\]: "Remove the label in front/);
  // A feed: an item stored before the standard is kept as it is; only a changed item is checked.
  const old = { contract: 1, kind: 'ask', schema: 1, key: 'old', title: 'Ship it?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], recommend_value: 'yes' };
  writeFileSync(board, JSON.stringify({ schema: 2, items: [old] }));
  writeFileSync(file, JSON.stringify({ schema: 2, items: [old, { ...ask, key: 'new' }] }));
  const kept = run('post', board, '--from', file, '--replace');
  assert.equal(kept.status, 0, kept.stdout);
  writeFileSync(file, JSON.stringify({ schema: 2, items: [{ ...old, title: 'Ship it today?' }, { ...ask, key: 'new' }] }));
  const changed = run('post', board, '--from', file, '--replace');
  assert.equal(changed.status, 2, changed.stdout);
  assert.match(changed.stdout, /key old: why is required[^]*Add \\"why\\"/);
});

test('an old board reads as before: no why, outcome or reason is asked of what is already stored', () => {
  const board = join(scratch, 'old.json');
  const items = [{ key: 'dark-default', title: 'Say yes or no: dark mode by default', about: 'Most test users switch to dark.', recommend_value: 'yes', default_if_silent: 'no' },
    { key: 'release-window', title: 'Pick A, B or C', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], recommend_value: 'yes' }];
  writeFileSync(board, JSON.stringify({ schema: 2, items }));
  const before = readFileSync(board, 'utf8');
  const listed = run('list', board, '--json');
  assert.equal(listed.status, 0, listed.stdout);
  assert.deepEqual(JSON.parse(listed.stdout).decisions.map((d) => [d.key, d.title, d.options.map((o) => o.label).join('/'), d.why, d.recommend_reason]),
    [['dark-default', items[0].title, 'Yes/No', undefined, undefined], ['release-window', items[1].title, 'Yes/No', undefined, undefined]]);
  // Raising an old question again is the no-op it always was, and the file is not rewritten.
  assert.match(run('raise', board, '--title', items[0].title, '--key', 'dark-default', '--recommend', 'yes', '--default', 'no', '--about', items[0].about).stdout, /already waiting/);
  assert.equal(readFileSync(board, 'utf8'), before);
});

test('one decision, one card: an ask that merges others closes them with its answer, and an Undo clears them too', async () => {
  const board = join(scratch, 'merge.json');
  assert.equal(run('raise', board, '--key', 'ship-a', ...good.slice(2), '--title', 'Ship the sign-in screen?').status, 0);
  assert.equal(run('raise', board, '--key', 'ship-b', '--close', 'release', ...good.slice(2), '--title', 'Can the sign-in screen go out?').status, 0);
  const merged = run('raise', board, ...good, '--merge', 'ship-a', '--merge', 'ship-b', '--merge', 'gone-key');
  assert.equal(merged.status, 0, merged.stdout);
  const proc = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const answer = (body) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await answer({ key: 'ship-the-new-sign-in-screen-this-week', answer: 'yes', note: 'Go.' })).status, 200);
  const got = JSON.parse(run('answers', board, '--json').stdout);
  assert.deepEqual([got['ship-a'], got['ship-b']].map(({ answer, label, close, note }) => ({ answer, label, close, note })), [
    { answer: 'yes', label: 'Yes', close: 'done', note: 'Answered with ship-the-new-sign-in-screen-this-week: Go.' },
    { answer: 'yes', label: 'Yes', close: 'release', note: 'Answered with ship-the-new-sign-in-screen-this-week: Go.' }]);
  assert.equal(got['gone-key'], undefined, 'a merged key not on the board is ignored');
  // A wait on a merged key returns the answer too.
  assert.match(run('wait', board, '--key', 'ship-b', '--timeout', '1').stdout, /ship-b,yes/);
  // Undo: the answer goes back to none, on every card it closed.
  assert.equal((await answer({ key: 'ship-the-new-sign-in-screen-this-week', answer: '' })).status, 200);
  assert.deepEqual(Object.keys(JSON.parse(run('answers', board, '--json').stdout)), []);
});
