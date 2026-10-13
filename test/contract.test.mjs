import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('every shipped fixture: valid files pass, each invalid file is refused on the field its name gives', () => {
  for (const folder of readdirSync(fixtures).filter((f) => !f.endsWith('.md'))) {
    const files = readdirSync(join(fixtures, folder)).map((f) => join(fixtures, folder, f));
    const valid = files.filter((f) => f.includes('/valid-')), invalid = files.filter((f) => f.includes('/invalid-'));
    assert.ok(valid.length >= 2 && invalid.length >= 3, `${folder} has 2 valid and 3 invalid files`);
    const kind = folder.split('.')[0], ok = validate('--kind', kind, ...valid);
    assert.equal(ok.status, 0, ok.raw);
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
    [{ ...ask, kind: 'report' }, /report is not checked by this sign-off-axi yet/, /Upgrade sign-off-axi/],
    [{ ...ask, about: null }, /about must be text/, /about/],
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
  const wrong = validate('--kind', 'gate', good);
  assert.equal(wrong.status, 2);
  assert.match(wrong.out.files[0].error, /is ask, not --kind gate/);
  const mixed = validate(good, message('refused.json', '{}'), join(scratch, 'missing.json'));
  assert.equal(mixed.status, 1);
  assert.deepEqual(mixed.out.files.map((f) => f.ok), [true, false, false]);
  assert.match(mixed.out.files[2].error, /cannot read: ENOENT/);
  const none = spawnSync('node', [cli, 'validate'], { encoding: 'utf8' });
  assert.equal(none.status, 2);
  assert.match(none.stdout, /code: VALIDATION_ERROR/);
});
