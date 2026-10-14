import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode } from '@toon-format/toon';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const fixtures = new URL('../fixtures/contract/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const validate = (...args) => {
  const run = spawnSync('node', [cli, 'validate', ...args], { encoding: 'utf8' });
  return { status: run.status, out: decode(run.stdout.split('\nhelp[')[0]), raw: run.stdout };
};
const message = (name, text) => {
  const path = join(scratch, name);
  writeFileSync(path, text);
  return path;
};
const ask = { contract: 1, kind: 'ask', schema: 1, key: 'ship-signin-2', title: 'Ship the new sign-in screen this week?',
  options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], recommend_value: 'yes' };
const gate = JSON.parse(readFileSync(join(fixtures, 'gate.v1', 'valid-three-actions.json')));
const report = { contract: 1, kind: 'report', schema: 1, key: 'slice-5-live', title: 'Board slice 5 is live', about: 'Umer can see the new cards.', filed: '2026-10-13T07:19:00Z' };

test('every shipped fixture: valid files pass, each invalid file is refused on the field its name gives', () => {
  for (const folder of readdirSync(fixtures).filter((f) => !f.endsWith('.md'))) {
    const files = readdirSync(join(fixtures, folder)).map((f) => join(fixtures, folder, f));
    const valid = files.filter((f) => f.includes('/valid-')), invalid = files.filter((f) => f.includes('/invalid-'));
    assert.ok(valid.length >= 2 && invalid.length >= 3, `${folder} has 2 valid and 3 invalid files`);
    const kind = folder.split('.')[0], ok = validate('--kind', kind, ...valid);
    assert.equal(ok.status, 0, ok.raw);
    // The conformance pair: every valid file passes, and --expect-invalid passes only when every invalid file is refused.
    assert.equal(validate('--expect-invalid', ...invalid).status, 0);
    const missed = validate('--expect-invalid', ...invalid, valid[0]);
    assert.equal(missed.status, 2);
    assert.match(missed.raw, /make it break the one rule its name gives/);
    assert.ok(ok.out.files.every((f) => f.ok && f.kind === kind && `v${f.schema}` === folder.split('.')[1]));
    for (const file of invalid) {
      const { status, out: { files: [row] } } = validate(file);
      assert.equal(status, 2, file);
      assert.equal(row.ok, false);
      assert.match(row.error, new RegExp(`\\b${/invalid-([a-z_]+)-/.exec(file)[1]}\\b`), file);
      assert.ok(row.help && !row.help.includes('\n'), 'one fix line');
    }
  }
});

test('refusals: strict at every level, in contract order, with one fix line each', () => {
  const cases = [
    [{ ...ask, contract: undefined }, /contract is required/, /Add "contract": 1, "kind" and "schema"/],
    [{ ...ask, schema: 2 }, /schema 2 of ask is not in this sign-off-axi/, /Upgrade sign-off-axi/],
    [{ ...ask, schema: '1' }, /schema must be a whole number/, /Set "schema": 1/],
    [{ ...ask, kind: 'finding' }, /finding is not checked by this sign-off-axi yet/, /Upgrade sign-off-axi/],
    [{ ...gate, run: undefined, options: gate.options.slice(0, 1) }, /options must list 2 or 3 options/, /2 or 3 of \{"value":"approve","label":"Approve"\}/],
    [{ ...gate, options: [gate.options[0], { value: 'yes', label: 'Yes' }] }, /options \{"value":"yes","label":"Yes"\} is not a gate action/, /Skip the judge/],
    [{ ...gate, run: { ...gate.run, commit: 'abc1234' } }, /run\.commit must be a full 40-character/, /git rev-parse HEAD/],
    [{ ...gate, run: 'r1' }, /run must be an object/, /"run_id", "commit"\}/],
    [{ ...gate, about: undefined }, /about is required/, /why the run is held/],
    [{ ...report, filed: '2026-02-30T00:00:00Z' }, /filed "2026-02-30T00:00:00Z" is not a UTC time/, /exactly YYYY-MM-DDTHH:MM:SSZ/],
    [{ ...report, filed: '2026-10-13T07:19:00.000Z' }, /filed .* is not a UTC time/, /exactly YYYY-MM-DDTHH:MM:SSZ/],
    [{ ...report, group: 'g'.repeat(41) }, /group is 41 characters, over 40/, /Shorten "group"/],
    [{ ...report, about: 'Umer \udc00' }, /about has an unpaired surrogate/, /Remove the broken character from "about"/],
    [{ ...ask, link: 'https://example.com/\u007f' }, /link must be an http\(s\) link with no spaces or control characters/, /Set "link"/],
    [{ ...ask, about: null }, /about must be text/, /about/],
    [{ ...ask, '': 1 }, /"" is not a field of ask/, /Remove ""/],
    [{ ...ask, options: [{ ...ask.options[0], '': 1 }, ask.options[1]] }, /options\[0\]\."" is not a field of an option/, /Remove ""/],
    [{ ...JSON.parse(readFileSync(join(fixtures, 'evidence.v1', 'valid-run.json'))), run: { '': 1 } }, /run\."" is not a field of run/, /Remove ""/],
    [{ ...ask, title: 'Tab\tin title' }, /title has a control character/, /Remove tabs/],
    [{ ...ask, kind: 'nope' }, /kind must be one of/, /Set "kind"/],
    [{ ...ask, contract: 2, kind: undefined }, /contract must be 1, not 2/, /Upgrade sign-off-axi/],
    [{ ...ask, link: `https://${'\u{1F600}'.repeat(500)}` }, null, null],
    [{ ...ask, options: [{ value: 'yes', label: 'Yes', note: 'x' }, ask.options[1]] }, /options\[0\]\.note is not a field/, /Remove "note"/],
    [{ ...ask, options: [ask.options[0], ask.options[0]] }, /options\[1\]\.value repeats yes/, /own value/],
    [{ ...ask, recommend_value: 'maybe' }, /"maybe" is not an option value/, /one of yes, no/],
  ];
  for (const [m, error, help] of cases) {
    const { status, out: { files: [row] } } = validate(message('m.json', JSON.stringify(m)));
    if (!error) { assert.equal(status, 0, 'a 500-character link passes, counted in code points'); continue; }
    assert.equal(status, 2, JSON.stringify(m));
    assert.match(row.error, error);
    assert.match(row.help, help);
  }
  const nested = validate(message('nested.json', '{"contract":1,"kind":"ask","schema":1,"key":"k","title":"T","options":[{"value":"yes","value":"no","label":"Yes"},{"value":"no","label":"No"}],"recommend_value":"no"}'));
  assert.equal(nested.out.files[0].help, 'Remove the second "value".');
  // A field name written inside a string value is text, not a second field.
  const quoted = validate(message('quoted.json', JSON.stringify({ ...ask, about: 'Umer wrote "key": "title", twice' })));
  assert.equal(quoted.status, 0, quoted.raw);
  assert.equal(validate(message('bad.json', '{"contract":1,')).out.files[0].help, 'Write the message as one JSON object');
  const latin1 = Buffer.from(JSON.stringify({ ...ask, title: 'Caf\u00e9?' }), 'latin1');
  assert.equal(validate(message('latin1.json', latin1)).out.files[0].help, 'Save the message as UTF-8');
});

test('a field name holding a newline is refused on one help line, shown escaped', () => {
  const unknown = validate(message('newline-unknown.json', JSON.stringify({ ...ask, 'a\nb': 'x' })));
  assert.equal(unknown.status, 2, unknown.raw);
  assert.equal(unknown.out.files[0].help, 'Remove "a\\nb"; ask takes key, title, filer, link, about, detail, options, recommend_value, default_if_silent, close');
  const repeated = validate(message('newline-twice.json', JSON.stringify(ask).slice(0, -1) + ',"a\\nb":1,"a\\nb":2}'));
  assert.equal(repeated.status, 2, repeated.raw);
  assert.equal(repeated.out.files[0].error, 'field "a\\nb" is written twice');
  assert.equal(repeated.out.files[0].help, 'Remove the second "a\\nb".');
});

test('exit codes: --kind must match, an unreadable file wins over a refusal, no file is a usage error', () => {
  const good = message('ask.json', JSON.stringify(ask));
  const wrong = validate('--kind', 'finding', good);
  assert.equal(wrong.status, 2);
  assert.match(wrong.out.files[0].error, /is ask, not --kind finding/);
  const mixed = validate(good, message('refused.json', '{}'), join(scratch, 'missing.json'));
  assert.equal(mixed.status, 1);
  assert.deepEqual(mixed.out.files.map((f) => f.ok), [true, false, false]);
  assert.match(mixed.out.files[2].error, /cannot read: ENOENT/);
  const none = spawnSync('node', [cli, 'validate'], { encoding: 'utf8' });
  assert.equal(none.status, 2);
  assert.match(none.stdout, /code: VALIDATION_ERROR/);
});

test('a report in a raise --from file: checked by its kind, stored with no options, never waiting; a new title over 160 is refused', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'reports.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  const feed = (name, ...items) => message(name, JSON.stringify({ schema: 2, items }));
  const posted = cli2('raise', board, '--from', feed('feed.json', { ...report, about: 'Umer can see the new cards \u{1F600}' }));
  assert.equal(posted.status, 0, posted.stdout);
  assert.match(posted.stdout, /so the user can read it/);
  assert.doesNotMatch(posted.stdout, /answer/);
  const [item] = JSON.parse(cli2('list', board, '--json').stdout).decisions;
  assert.deepEqual([item.key, item.options, item.filed], ['slice-5-live', [], '2026-10-13T07:19:00Z']);
  assert.match(cli2('list', board).stdout, /waiting: 0 of 1/);
  for (const [bad, help] of [[{ ...report, key: 'r2', options: [] }, /or post an ask to get an answer/], [{ ...report, key: 'r3', filed: undefined }, /exactly YYYY-MM-DDTHH:MM:SSZ/]]) {
    const refused = cli2('raise', board, '--from', feed('bad.json', bad));
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, help);
  }
  const long = cli2('raise', board, '--title', 'T'.repeat(161));
  assert.equal(long.status, 2);
  assert.match(long.stdout, /title is 161 characters, over 160/);
  // An item already on the board is not checked again: a long title from before still loads.
  writeFileSync(board, JSON.stringify({ schema: 2, items: [{ key: 'old', title: 'T'.repeat(200) }] }));
  assert.equal(cli2('list', board).status, 0);
});

test('the 160 title limit applies to new items only: a re-post of an item already on the board reports it waiting', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'repost.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  assert.equal(cli2('raise', board, '--title', 'Ship the sign-in screen?', '--key', 'signin').status, 0);
  const doc = JSON.parse(readFileSync(board, 'utf8'));
  doc.items[0].title = 'T'.repeat(200);
  writeFileSync(board, JSON.stringify(doc));
  const again = cli2('raise', board, '--title', 'T'.repeat(200), '--key', 'signin');
  assert.equal(again.status, 0, again.stdout);
  assert.match(again.stdout, /already waiting/);
  const evidence = join(scratch, 'evidence.json');
  const long = cli2('post', evidence, '--type', 'evidence', '--title', 'T'.repeat(161), '--about', 'Shot');
  assert.equal(long.status, 2, long.stdout);
  assert.match(long.stdout, /title is 161 characters, over 160/);
  assert.equal(existsSync(evidence), false, 'refused before anything is written');
});

test('a stored report with reply, area or type is refused: it can never wait, be answered, or leave Reports', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'stored-report.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  for (const extra of [{ reply: true }, { area: 'waiting' }, { type: 'design' }]) {
    writeFileSync(board, JSON.stringify({ schema: 2, items: [{ ...report, ...extra }] }));
    const listed = cli2('list', board);
    assert.equal(listed.status, 2, JSON.stringify(extra));
    assert.match(listed.stdout, /must be left out: a report takes no answer and shows only under Reports/);
  }
});

test('a report counts its group and decision in characters, not UTF-16 units: 21 emoji fit a 40 limit', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'emoji.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  const feed = (name, ...items) => message(name, JSON.stringify({ schema: 2, items }));
  const emoji = { ...report, key: 'emoji', group: '\u{1F600}'.repeat(21), decided: '\u{1F600}'.repeat(100), link: `https://${'\u{1F600}'.repeat(300)}` };
  const posted = cli2('raise', board, '--from', feed('emoji.json', emoji));
  assert.equal(posted.status, 0, posted.stdout);
  const [item] = JSON.parse(cli2('list', board, '--json').stdout).decisions;
  assert.equal(item.group, '\u{1F600}'.repeat(21));
});

test('a report re-posted under its key reports already posted, and a feed with no items says nothing about reading the board', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'repost-report.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  const feed = (name, ...items) => message(name, JSON.stringify({ schema: 2, items }));
  assert.equal(cli2('raise', board, '--from', feed('one.json', report)).status, 0);
  const again = cli2('raise', board, '--from', feed('two.json', report));
  assert.equal(again.status, 0, again.stdout);
  assert.match(again.stdout, /already posted/);
  assert.doesNotMatch(again.stdout, /already waiting/);
  const empty = cli2('raise', board, '--from', feed('empty.json'));
  assert.equal(empty.status, 0, empty.stdout);
  assert.doesNotMatch(empty.stdout, /so the user can read/);
});

test('a re-post of an answered ask beside a new report gets the read hint, never the answer hint', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'answered.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  const feed = (name, ...items) => message(name, JSON.stringify({ schema: 2, items }));
  assert.equal(cli2('raise', board, '--from', feed('ask.json', ask)).status, 0);
  appendFileSync(join(scratch, 'answered.answers.jsonl'), `${JSON.stringify({ key: ask.key, answer: 'yes', label: 'Yes', close: 'done', at: '2026-10-13T08:00:00Z' })}\n`);
  const mixed = cli2('raise', board, '--from', feed('mixed.json', ask, { ...report, key: 'mixed-report' }));
  assert.equal(mixed.status, 0, mixed.stdout);
  assert.match(mixed.stdout, /so the user can read them/);
  assert.doesNotMatch(mixed.stdout, /so the user can answer/);
});

test('post --kind: one message from a file or stdin, checked against its kind, refused with the file named and one fix line', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'kind.json'), post = (input, ...args) => spawnSync('node', [cli, 'post', board, ...args], { encoding: 'utf8', env, input });
  const file = message('ask.json', JSON.stringify(ask));
  const posted = post('', '--kind', 'ask', '--from', file, '--filer', 'agent-41');
  assert.equal(posted.status, 0, posted.stdout);
  assert.match(posted.stdout, /ship-signin-2,raised,/);
  const [item] = JSON.parse(readFileSync(board, 'utf8')).items;
  assert.deepEqual([item.kind, item.schema, item.filer], ['ask', 1, 'agent-41']);
  assert.match(post('', '--kind', 'ask', '--from', file, '--filer', 'agent-41').stdout, /ship-signin-2,already waiting,/);
  // stdin, and every refusal: the file (or stdin) and the key in the error, one help line, exit 2, nothing written.
  const read = post(JSON.stringify(report), '--kind', 'report', '--from', '-');
  assert.equal(read.status, 0, read.stdout);
  assert.match(read.stdout, /slice-5-live,raised,[^]*so the user can read it/);
  spawnSync('node', [cli, 'raise', board, '--title', 'Plain?', '--key', 'plain'], { env });
  const before = readFileSync(board, 'utf8');
  // A key takes only the same message again: another filer, another filed time, or a plain item under it is a conflict.
  for (const [input, args, error, help] of [
    ['', ['--kind', 'ask', '--from', file, '--filer', 'agent-99'], /already holds a different message/, /Post it under a new key/],
    [JSON.stringify({ ...report, filed: '2026-10-14T07:19:00Z' }), ['--kind', 'report', '--from', '-'], /key slice-5-live already holds a different message/, /Post it under a new key/],
    [JSON.stringify({ ...ask, key: 'plain' }), ['--kind', 'ask', '--from', '-'], /key plain already holds a different message/, /Post it under a new key/],
    [JSON.stringify({ ...ask, recommend_value: undefined }), ['--kind', 'ask', '--from', '-'], /stdin: key ship-signin-2: recommend_value is required/, /Add \\"recommend_value\\"/],
    ['', ['--kind', 'report', '--from', file], new RegExp(`${file}: key ship-signin-2: kind is ask, not --kind report`), /Pass --kind ask/],
    [JSON.stringify({ ...ask, title: 'Ship it next week?' }), ['--kind', 'ask', '--from', '-'], /stdin: key ship-signin-2 already holds a different message/, /Post it under a new key/],
    [JSON.stringify({ ...ask, key: 'k2', filer: 'agent-7' }), ['--kind', 'ask', '--from', '-', '--filer', 'agent-41'], /filer agent-7 is not --filer agent-41/, /Leave \\"filer\\" out/],
    ['', ['--kind', 'ask', '--from', file, '--title', 'X'], /--kind cannot be combined with --title/, /Put every field in the message file/],
  ]) {
    const refused = post(input, ...args);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, error);
    assert.match(refused.stdout, help);
    assert.match(refused.stdout, /help\[1\]/);
  }
  assert.equal(readFileSync(board, 'utf8'), before);
  assert.equal(post('', '--kind', 'ask', '--from', join(scratch, 'missing.json')).status, 1);
  // An item already on the board is not checked again, even one the current rules would refuse.
  const old = { ...ask, title: 'Old \u0007 title' };
  writeFileSync(board, JSON.stringify({ schema: 2, items: [old] }));
  const kept = spawnSync('node', [cli, 'post', board, '--from', message('kept.json', JSON.stringify({ schema: 2, items: [old] })), '--replace'], { encoding: 'utf8', env });
  assert.equal(kept.status, 0, kept.stdout);
});

test('a feed item that carries kind but no contract, under a key that holds a different message, exits 2 with the new-key fix', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'kind-only.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  assert.equal(cli2('raise', board, '--title', 'Plain?', '--key', 'pick').status, 0);
  const kindOnly = { kind: 'ask', schema: 1, key: 'pick', title: ask.title, options: ask.options, recommend_value: ask.recommend_value };
  const feed = message('kind-only-feed.json', JSON.stringify({ schema: 2, items: [kindOnly] }));
  for (const verb of ['raise', 'post']) {
    const refused = cli2(verb, board, '--from', feed);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, /key pick already holds a different message[^]*Post it under a new key/);
  }
});

test('post --kind evidence: media copied and hashed from the message folder, a run kept as the update\'s evidence, never in a --from file', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'ev', 'board.json'), post = (input, ...args) => spawnSync('node', [cli, 'post', board, ...args], { encoding: 'utf8', env, input });
  const file = join(fixtures, 'evidence.v1', 'valid-media.json'), items = () => JSON.parse(readFileSync(board, 'utf8')).items;
  assert.match(post('', '--kind', 'evidence', '--from', file, '--filer', 'agent-41').stdout, /signin-phone-2,1,1,"Sign-in screen, second pass",posted/);
  assert.deepEqual(readFileSync(join(scratch, 'ev', 'evidence', '1', '1.png')), readFileSync(join(fixtures, 'evidence.v1', 'shot.png')));
  assert.equal(items()[0].media[0].bytes, 69);
  assert.match(post('', '--kind', 'evidence', '--from', file, '--filer', 'agent-41').stdout, /signin-phone-2,1,1,[^\n]*already posted/);
  const other = post('', '--kind', 'evidence', '--from', file, '--filer', 'agent-9');
  assert.equal(other.status, 2, other.stdout);
  assert.match(other.stdout, /key signin-phone-2 already holds a different message[^]*Post it under a new key/);
  // No key: the next update number; a run with no media is stored as the update's evidence field.
  const ran = post(readFileSync(join(fixtures, 'evidence.v1', 'valid-run.json')), '--kind', 'evidence', '--from', '-');
  assert.match(ran.stdout, /update-2,2,0,Sign-in screen on a phone,posted/);
  const [, update] = items();
  assert.deepEqual([update.type, update.kind, update.media, update.evidence.commit, update.run], ['evidence', 'evidence', undefined, '0123456789abcdef0123456789abcdef01234567', undefined]);
  assert.equal(spawnSync('node', [cli, 'raise', board, '--title', 'Plain?', '--key', 'plain'], { encoding: 'utf8', env }).status, 0);
  // Media that leads out of the folder, to a non-image or to an unreadable file, evidence in any feed, and a contract key conflict in a feed:
  // each exits 2 and writes nothing.
  const dir = mkdtempSync(join(scratch, 'msg-')), valid = JSON.parse(readFileSync(file, 'utf8')), before = readFileSync(board, 'utf8');
  symlinkSync(join(fixtures, 'evidence.v1', 'shot.png'), join(dir, 'link.png'));
  writeFileSync(join(dir, 'notes.txt'), 'x');
  symlinkSync('notes.txt', join(dir, 'note.png'));
  writeFileSync(join(dir, 'locked.png'), 'x');
  chmodSync(join(dir, 'locked.png'), 0);
  const msg = (media) => (writeFileSync(join(dir, `${media}.json`), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, title: 'Linked', about: 'A link.', media: [media] })), join(dir, `${media}.json`));
  const feedOf = (item) => message(`feed-${item.key}-${item.kind}.json`, JSON.stringify({ schema: 2, items: [item] }));
  for (const [args, error] of [
    [['--kind', 'evidence', '--from', msg('link.png')], /link\.png\.json: media\[0\] \\"link\.png\\" leads outside the message file's folder/],
    [['--kind', 'evidence', '--from', msg('note.png')], /links to a file that does not end in \.png/],
    ...(process.getuid?.() === 0 ? [] : [[['--kind', 'evidence', '--from', msg('locked.png')], /media\[0\] \\"locked\.png\\" cannot be read/]]),
    [['--from', feedOf({ ...valid, key: 'fed' })], /items\[0\] key fed: evidence is posted one at a time[^]*post --kind evidence --from/],
    [['--from', feedOf(valid), '--replace'], /key signin-phone-2: evidence is posted one at a time/],
    [['--from', feedOf({ type: 'evidence', key: 'plain', title: 'Plain?' }), '--replace'], /key plain: evidence is posted one at a time/],
    [['--from', feedOf({ ...ask, key: 'signin-phone-2' })], /key signin-phone-2 already holds a different message[^]*Post it under a new key/],
  ]) {
    const refused = post('', ...args);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, error);
  }
  assert.equal(readFileSync(board, 'utf8'), before);
  assert.deepEqual(readdirSync(join(scratch, 'ev', 'evidence')).sort(), ['1', '2']);
});

test('post --kind gate: a done-done run waits for approval like an ask, its run kept, and its answer is the action to take', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'gate.json'), cli2 = (input, ...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env, input });
  const posted = cli2(JSON.stringify(gate), 'post', board, '--kind', 'gate', '--from', '-');
  assert.equal(posted.status, 0, posted.stdout);
  assert.match(posted.stdout, /dd-gate-a1b2c3d4,raised,[^]*wait .*--filer done-done/);
  assert.match(cli2(JSON.stringify(gate), 'post', board, '--kind', 'gate', '--from', '-').stdout, /dd-gate-a1b2c3d4,already waiting,/);
  const [item] = JSON.parse(readFileSync(board, 'utf8')).items;
  assert.deepEqual([item.kind, item.run, item.options.map((o) => o.value)], ['gate', gate.run, ['approve', 'skip', 'fix']]);
  // The same key with another run is a different message: exit 2, nothing written.
  const before = readFileSync(board, 'utf8');
  const other = cli2(JSON.stringify({ ...gate, run: { ...gate.run, run_id: 'other-run' } }), 'post', board, '--kind', 'gate', '--from', '-');
  assert.equal(other.status, 2, other.stdout);
  assert.match(other.stdout, /key dd-gate-a1b2c3d4 already holds a different message[^]*Post it under a new key/);
  assert.equal(readFileSync(board, 'utf8'), before);
  const reordered = message('gate-reordered.json', JSON.stringify({ schema: 2, items: [{ ...gate, run: { commit: gate.run.commit, run_id: gate.run.run_id } }] }));
  const same = cli2('', 'raise', board, '--from', reordered);
  assert.equal(same.status, 0, same.stdout);
  assert.match(same.stdout, /dd-gate-a1b2c3d4,already waiting,/);
  assert.equal(readFileSync(board, 'utf8'), before);
  appendFileSync(join(scratch, 'gate.answers.jsonl'), `${JSON.stringify({ key: gate.key, answer: 'fix', label: 'Fix first', close: 'done', at: '2026-10-13T08:00:00Z' })}\n`);
  const waited = cli2('', 'wait', board, '--filer', 'done-done', '--json', '--timeout', '5');
  assert.equal(waited.status, 0, waited.stdout);
  assert.equal(JSON.parse(waited.stdout)[gate.key].answer, 'fix');
  // Another run under the key is another question in a feed too, and an answered gate keeps the run it was answered for.
  const swapped = message('gate-feed.json', JSON.stringify({ schema: 2, items: [{ ...gate, run: { ...gate.run, run_id: 'other-run' } }] }));
  for (const [args, status, error] of [[['raise', board, '--from', swapped], 2, /already holds a different message[^]*Post it under a new key/],
    [['post', board, '--from', swapped, '--replace'], 1, /was answered and now holds a different question[^]*Post the new question under a new key/]]) {
    const refused = cli2('', ...args);
    assert.equal(refused.status, status, refused.stdout);
    assert.match(refused.stdout, error);
  }
  assert.equal(readFileSync(board, 'utf8'), before);
  // A replace feed that drops the answered gate keeps its answer, so the same key under another run is refused and nothing is written.
  const dropped = message('gate-dropped.json', JSON.stringify({ schema: 2, items: [] }));
  assert.equal(cli2('', 'post', board, '--from', dropped, '--replace').status, 0);
  const gone = readFileSync(board, 'utf8');
  const back = cli2('', 'post', board, '--from', swapped, '--replace');
  assert.equal(back.status, 1, back.stdout);
  assert.match(back.stdout, /key dd-gate-a1b2c3d4 was answered[^]*Post it under a new key/);
  assert.equal(readFileSync(board, 'utf8'), gone);
});
