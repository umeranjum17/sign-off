import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    [without('--outcome').concat('--outcome', 'yes=It ships.'), /--outcome is required/, /Add --outcome no=<text>: what happens next if no is picked/],
    [without('--recommend-reason'), /--recommend-reason is required/, /Add --recommend-reason: why you recommend yes/],
    [without('--default'), /--default is required/, /Add --default: the option that happens if the person stays quiet/],
    [[...good, '--silent-by', 'tomorrow'], /--silent-by "tomorrow" is not a UTC time/, /YYYY-MM-DDTHH:MM:SSZ/],
    [[...good.slice(2), '--title', 'Say yes or no: ship the sign-in screen?'], /--title starts with a label for agents/, /ask the question itself/],
    [[...good.slice(2), '--title', 'Captain: ship the sign-in screen?'], /--title starts with a label for agents/, /ask the question itself/],
    [[...good.slice(2), '--title', 'Captain hold 5: ship the sign-in screen?'], /--title starts with a label for agents/, /ask the question itself/],
    [[...good.slice(2), '--title', 'fm-signin-7: ship it?'], /--title has the id "fm-signin-7"/, /plain words/],
    [[...good.slice(2), '--title', 'Ship sign-in-v2 this week?'], /--title has the id "sign-in-v2"/, /plain words/],
    [[...good.slice(2), '--title', 'Ship the new sign-in screen this week'], /--title must be a question ending in "\?"/, /12 words or fewer/],
    [[...good.slice(2), '--title', 'Should we ship the new sign-in screen to every single user this week?'], /--title is 13 words, over 12/, /put the rest in --why/],
    [[...good.slice(2), '--title', 'Which day: Option A, Option B or Option C?'], /--option are Yes\/No, but the text names choices A, B, C/, /--option a="A: <short label>" --outcome a=<text>/],
    [pick('Which day: Option A, Option B or Option C?'), /--option has 2 options, but the text names 3 choices: A, B, C/, /one option per choice/],
    [[...pick('Which day: Option A or Option B?').slice(0, 4), '--option', 'a=Today', ...pick('').slice(6)], /--option has no option label that starts with A/, /each label starting with its letter/],
    [[...good, '--option', 'yes=Sure', '--option', 'no=No'], /--option is "Sure", not Yes/, /Set the label of yes to "Yes"/],
    [[...without('--outcome', '--recommend', '--default'), '--option', 'done=Done', '--option', 'later=Not now', '--outcome', 'done=It closes.', '--outcome', 'later=It waits.', '--recommend', 'done', '--default', 'later'],
      /--option "Done" does not answer a question/, /Yes and No, or one per choice/],
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
  const merged = run('raise', board, ...good, '--merge', 'ship-a', '--merge', 'ship-b');
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
  // A wait on a merged key returns the answer too.
  assert.match(run('wait', board, '--key', 'ship-b', '--timeout', '1').stdout, /ship-b,yes/);
  // Undo: the answer goes back to none, on every card it closed.
  assert.equal((await answer({ key: 'ship-the-new-sign-in-screen-this-week', answer: '' })).status, 200);
  assert.deepEqual(Object.keys(JSON.parse(run('answers', board, '--json').stdout)), []);
});

test('a merge names a card on the board that offers every option of this ask, and never merges back', () => {
  const board = join(scratch, 'merge-refuse.json');
  assert.equal(run('raise', board, '--key', 'release-day', ...pick('Which day should it ship?')).status, 0);
  const missing = run('raise', board, ...good, '--merge', 'not-yet');
  assert.equal(missing.status, 2, missing.stdout);
  assert.match(missing.stdout, /merges not-yet, which is not on the board/);
  const lacking = run('raise', board, ...good, '--merge', 'release-day');
  assert.equal(lacking.status, 2, lacking.stdout);
  assert.match(lacking.stdout, /merges release-day, which has no yes option/);
  assert.equal(run('raise', board, '--key', 'ship-x', ...good.slice(2), '--title', 'Ship the sign-in screen?').status, 0);
  assert.equal(run('raise', board, '--key', 'ship-y', ...good.slice(2), '--title', 'Can the sign-in screen go out?', '--merge', 'ship-x').status, 0);
  const loop = run('raise', board, '--key', 'ship-x', ...good.slice(2), '--title', 'Ship the sign-in screen?', '--merge', 'ship-y');
  assert.equal(loop.status, 2, loop.stdout);
  assert.match(loop.stdout, /key ship-x merges others, but ship-y already merges ship-x/);
});

test('a merged card merges nothing itself: a chain of merges is refused at post time, in either order', () => {
  const board = join(scratch, 'chain.json');
  assert.equal(run('raise', board, '--key', 'chain-z', ...good.slice(2), '--title', 'Keep the old login screen?').status, 0);
  assert.equal(run('raise', board, '--key', 'chain-y', ...good.slice(2), '--title', 'Retire the old login screen?', '--merge', 'chain-z').status, 0);
  const chain = run('raise', board, '--key', 'chain-x', ...good.slice(2), '--title', 'Ship the new login screen?', '--merge', 'chain-y');
  assert.equal(chain.status, 2, chain.stdout);
  assert.match(chain.stdout, /key chain-x merges chain-y, which merges others/);
  assert.equal(run('raise', board, '--key', 'chain-w', ...good.slice(2), '--title', 'Keep the new login screen?').status, 0);
  const grown = run('raise', board, '--key', 'chain-z', ...good.slice(2), '--title', 'Keep the old login screen?', '--merge', 'chain-w');
  assert.equal(grown.status, 2, grown.stdout);
  assert.match(grown.stdout, /key chain-z merges others, but chain-y already merges chain-z/);
});

test('initials in the why are not lettered choices, so yes/no stays yes/no', () => {
  const board = join(scratch, 'initials.json');
  const r = run('raise', board, ...good.slice(0, 2), '--why', 'Approved by D. A. Brown on Monday.', ...good.slice(4));
  assert.equal(r.status, 0, r.stdout);
});

test('the title rules accept plain questions that merely contain a label or id-like word', () => {
  const board = join(scratch, 'titles.json');
  for (const title of ['Switch to pay-as-you-go pricing?', 'Turn on two-factor-auth?', 'Should we say yes or no to the offer?', 'Keep the A and B tabs?', 'Ship the 3-day trial?', 'Go-live: ship this week?']) {
    const r = run('raise', board, ...good.slice(2), '--title', title);
    assert.equal(r.status, 0, `${title}\n${r.stdout}`);
  }
});

test('a merge fans its answer out to the merged cards that have none, and a retry fills only those', async () => {
  const store = await import(new URL('../dist/store.js', import.meta.url));
  const board = join(scratch, 'fan.json');
  const yes = { value: 'yes', label: 'Yes' }, no = { value: 'no', label: 'No' };
  assert.equal(run('raise', board, '--key', 'fan-b', ...good.slice(2), '--title', 'Can the sign-in screen go out?').status, 0);
  assert.equal(run('raise', board, '--key', 'fan-c', ...good.slice(2), '--title', 'Should the sign-in screen wait?').status, 0);
  assert.equal(run('raise', board, '--key', 'fan-a', ...good.slice(2), '--title', 'Ship the sign-in screen?', '--merge', 'fan-b', '--merge', 'fan-c').status, 0);
  store.appendAnswer(board, { key: 'fan-c', close: 'done' }, no);
  // A crash after the parent's own line, before any merged card: the retry fills fan-b and keeps fan-c's own answer.
  appendFileSync(store.answersPath(board), `${JSON.stringify({ key: 'fan-a', answer: 'yes', label: 'Yes', close: 'done', at: new Date().toISOString() })}\n`);
  store.appendAnswer(board, store.loadDecisions(board).find((d) => d.key === 'fan-a'), yes, '');
  const got = JSON.parse(run('answers', board, '--json').stdout);
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, a]) => [k, a.answer])), { 'fan-a': 'yes', 'fan-b': 'yes', 'fan-c': 'no' });
  assert.equal(got['fan-b'].note, 'Answered with fan-a');
});

test('a fanned answer keeps its first value on a parent re-answer, an undo clears it, and a card\'s own note that names the parent is its own', async () => {
  const store = await import(new URL('../dist/store.js', import.meta.url));
  const board = join(scratch, 'refan.json');
  const yes = { value: 'yes', label: 'Yes' }, no = { value: 'no', label: 'No' };
  assert.equal(run('raise', board, '--key', 're-b', ...good.slice(2), '--title', 'Can the sign-in screen go out?').status, 0);
  assert.equal(run('raise', board, '--key', 're-c', ...good.slice(2), '--title', 'Should the sign-in screen wait?').status, 0);
  assert.equal(run('raise', board, '--key', 're-a', ...good.slice(2), '--title', 'Ship the sign-in screen?', '--merge', 're-b', '--merge', 're-c').status, 0);
  store.appendAnswer(board, store.loadDecisions(board).find((d) => d.key === 're-c'), yes, 'Answered with re-a: my own words');
  const a = store.loadDecisions(board).find((d) => d.key === 're-a');
  store.appendAnswer(board, a, yes);
  store.appendAnswer(board, a, no);
  let got = JSON.parse(run('answers', board, '--json').stdout);
  assert.equal(got['re-b'].answer, 'yes');
  assert.equal(got['re-b'].note, 'Answered with re-a');
  assert.equal(got['re-a'].answer, 'no');
  assert.equal(got['re-c'].answer, 'yes');
  store.appendAnswer(board, a, store.CLEARED);
  got = JSON.parse(run('answers', board, '--json').stdout);
  assert.equal(got['re-b'], undefined);
  assert.equal(got['re-c'].answer, 'yes');
});

test('a card has one open merging ask: a second ask may not merge a card another open ask already merges', () => {
  const board = join(scratch, 'one-parent.json');
  assert.equal(run('raise', board, '--key', 'one-c', ...good.slice(2), '--title', 'Ship the sign-in screen?').status, 0);
  assert.equal(run('raise', board, '--key', 'one-a', ...good.slice(2), '--title', 'Can the sign-in screen go out?', '--merge', 'one-c').status, 0);
  const second = run('raise', board, '--key', 'one-b', ...good.slice(2), '--title', 'Should the sign-in screen wait?', '--merge', 'one-c');
  assert.equal(second.status, 2, second.stdout);
  assert.match(second.stdout, /merges one-c, which one-a already merges/);
  assert.match(second.stdout, /Answer or restore one-a instead of posting a second card/);
});

test('a dismissed ask still names its merged card until it is answered, dismissed or restored', () => {
  const board = join(scratch, 'dismissed-parent.json');
  assert.equal(run('raise', board, '--key', 'dis-c', ...good.slice(2), '--title', 'Ship the sign-in screen?').status, 0);
  assert.equal(run('raise', board, '--key', 'dis-a', ...good.slice(2), '--title', 'Can the sign-in screen go out?', '--merge', 'dis-c').status, 0);
  const dismissed = (on) => appendFileSync(join(scratch, 'dismissed-parent.dismissed.jsonl'), `${JSON.stringify({ key: 'dis-a', dismissed: on, at: new Date().toISOString() })}\n`);
  dismissed(true);
  const refused = run('raise', board, '--key', 'dis-b', ...good.slice(2), '--title', 'Should the sign-in screen wait?', '--merge', 'dis-c');
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, /merges dis-c, which dis-a already merges/);
  dismissed(false);
  assert.equal(run('raise', board, '--key', 'dis-b', ...good.slice(2), '--title', 'Should the sign-in screen wait?', '--merge', 'dis-c').status, 2);
});

const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => (process.env.PATH ?? '').split(':').map((d) => join(d, b))).find(existsSync);

test('a merged card is hidden while its shown merger waits, and shown again once the merger is dismissed', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const board = join(scratch, 'merged-hide.json');
  assert.equal(run('raise', board, '--key', 'hide-x', ...good.slice(2), '--title', 'Keep the old login screen?').status, 0);
  assert.equal(run('raise', board, '--key', 'hide-y', ...good.slice(2), '--title', 'Ship the new login screen?', '--merge', 'hide-x').status, 0);
  const proc = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const waiting = () => execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=10000', '--dump-dom', `${url}#waiting`], { env: { ...env, TMPDIR: scratch }, encoding: 'utf8', timeout: 60000 });
  const before = waiting();
  assert.match(before, /Ship the new login screen\?/);
  assert.doesNotMatch(before, /Keep the old login screen\?/);
  const dismissed = await fetch(`${url}api/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: ['hide-y'], dismissed: true }) });
  assert.equal(dismissed.status, 200);
  assert.match(waiting(), /Keep the old login screen\?/);
  const undone = await fetch(`${url}api/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: ['hide-y'], dismissed: false }) });
  assert.equal(undone.status, 200);
  assert.doesNotMatch(waiting(), /Keep the old login screen\?/);
});

test('a merge cannot name a card that is already answered or dismissed', async () => {
  const store = await import(new URL('../dist/store.js', import.meta.url));
  const board = join(scratch, 'closed-merge.json');
  for (const key of ['closed-c', 'closed-d']) assert.equal(run('raise', board, '--key', key, ...good.slice(2), '--title', 'Ship the sign-in screen?').status, 0);
  store.appendAnswer(board, store.loadDecisions(board).find((d) => d.key === 'closed-c'), { value: 'yes', label: 'Yes' });
  store.appendDismissed(board, ['closed-d'], true);
  for (const [key, state] of [['closed-c', 'answered'], ['closed-d', 'dismissed']]) {
    const r = run('raise', board, '--key', `new-${key}`, ...good.slice(2), '--title', 'Can the sign-in screen go out?', '--merge', key);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stdout, new RegExp(`merges ${key}, which is already ${state}`));
    assert.match(r.stdout, /post the new question without --merge/);
  }
});

test('a fanned answer takes the merged card\'s own label for that value', async () => {
  const store = await import(new URL('../dist/store.js', import.meta.url));
  const board = join(scratch, 'label.json');
  const labelled = (title, a, b) => ['--title', title, '--why', 'Two fixes are still in review.', '--option', `a=${a}`, '--option', `b=${b}`,
    '--outcome', 'a=It ships now.', '--outcome', 'b=It ships with the fixes.', '--recommend', 'b', '--recommend-reason', 'The fixes land Thursday.', '--default', 'b'];
  assert.equal(run('raise', board, '--key', 'label-b', ...labelled('Can the sign-in screen go out?', 'A: Today, ship it', 'B: Friday, with fixes')).status, 0);
  assert.equal(run('raise', board, '--key', 'label-a', ...labelled('Ship the sign-in screen?', 'A: Today', 'B: Friday'), '--merge', 'label-b').status, 0);
  store.appendAnswer(board, store.loadDecisions(board).find((d) => d.key === 'label-a'), { value: 'a', label: 'A: Today' });
  const got = JSON.parse(run('answers', board, '--json').stdout);
  assert.equal(got['label-b'].label, 'A: Today, ship it');
});
