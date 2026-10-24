import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode } from '@toon-format/toon';
import { asked } from './ask.mjs';

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
const ask = JSON.parse(readFileSync(join(fixtures, 'ask.v1', 'valid-yes-no.json')));
delete ask.filer;
const gate = JSON.parse(readFileSync(join(fixtures, 'gate.v1', 'valid-three-actions.json')));
const finding = JSON.parse(readFileSync(join(fixtures, 'finding.v1', 'valid-apply.json')));
// A report is a page and its picture: the scaffold report init writes, filled in, beside the boards these tests write.
const fill = (file) => writeFileSync(file, readFileSync(file, 'utf8').replace(/FILL: [^<"']*/g, 'Umer taps through it'));
spawnSync('node', [cli, 'report', 'init', join(scratch, 'page'), '--page', '--purpose', 'other'], { env: { ...process.env, HOME: join(scratch, 'home') } });
for (const f of ['index.html', 'preview.svg']) fill(join(scratch, 'page', f));
const report = { contract: 1, kind: 'report', schema: 2, purpose: 'other', project: 'Umer', key: 'slice-5-live', title: 'How the new cards work', about: 'Umer can see the new cards.', filed: '2026-10-13T07:19:00Z',
  view: 'page/index.html', preview: 'page/preview.svg' };

test('design review posts journeys and returns change notes through answers --json', async () => {
  const dir = join(scratch, 'design-review'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'design-home') };
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), Buffer.from('image'));
  const variants = ['phone_light', 'phone_dark', 'computer_light', 'computer_dark'];
  const screens = ['welcome', 'confirm'].map((id, i) => {
    const views = Object.fromEntries(variants.map((variant) => {
      const path = `design/${id}-${variant}.html`;
      writeFileSync(join(dir, path), `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>${id}</body></html>`);
      return [variant, path];
    }));
    return { id, title: i ? 'Confirm email' : 'Welcome', views };
  });
  const msg = { ...JSON.parse(readFileSync(join(fixtures, 'design.v1', 'valid-basic.json'))),
    key: 'beacon-account-setup', title: 'Which account setup should we ship?', about: 'Choose the first-run experience for Beacon.', group: 'Beacon', status: 'in_review',
    options: [{ value: 'guided', label: 'Guided setup' }, { value: 'quick', label: 'Quick setup' }], recommend: 'guided',
    journeys: [{ id: 'account-setup', title: 'Account setup', screens }] };
  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  const source = message('design-message.json', JSON.stringify(msg)), posted = run('post', board, '--kind', 'design', '--from', source);
  assert.equal(posted.status, 0, posted.stdout + posted.stderr);
  const duplicateScreen = { ...msg, key: 'duplicate-screen', journeys: [{ ...msg.journeys[0], screens: [msg.journeys[0].screens[0], msg.journeys[0].screens[0]] }] };
  const duplicate = run('post', board, '--kind', 'design', '--from', message('duplicate-screen.json', JSON.stringify(duplicateScreen)));
  assert.equal(duplicate.status, 2); assert.match(duplicate.stdout, /journeys\[0\]\.screens\[1\]\.id.*repeats welcome/);
  const noScreens = { ...msg, key: 'design-level', journeys: [] };
  assert.equal(run('post', board, '--kind', 'design', '--from', message('design-level.json', JSON.stringify(noScreens))).status, 0);
  assert.match(run('list', board, '--full').stdout, /beacon-account-setup,in review,/);
  const outside = join(scratch, 'outside-design.png'); writeFileSync(outside, 'image'); symlinkSync(outside, join(dir, 'design', 'escape.png'));
  const escaped = run('post', board, '--kind', 'design', '--from', message('escaped-design.json', JSON.stringify({ ...msg, key: 'escaped-design', journeys: [{ ...msg.journeys[0], screens: [{ ...msg.journeys[0].screens[0], views: { phone_light: 'design/escape.png' } }] }] })));
  assert.equal(escaped.status, 2); assert.match(escaped.stdout, /outside the board folder/);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const url = await new Promise(ok => proc.stdout.once('data', b => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const answer = (body, key = msg.key) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, ...body }) });
    assert.equal((await answer({ verdict: 'change', pick: 'guided', notes: [] })).status, 400);
    assert.equal((await answer({ verdict: 'change', pick: 'guided', notes: [{ journey: 'account-setup', note: 'Targets must be paired.' }] })).status, 400);
    assert.equal((await answer({ verdict: 'change', pick: 'guided', notes: [{ journey: 'account-setup', screen: 'welcome', note: 'Move the button higher.' }] })).status, 200);
    assert.equal((await answer({ verdict: 'change', pick: 'guided', notes: [{ journey: 'account-setup', screen: 'confirm', note: 'Clarify the confirmation step.' }] })).status, 200);
    const got = JSON.parse(run('answers', board, '--json').stdout)[msg.key];
    assert.deepEqual([got.answer, got.notes, got.pick], ['change', [{ journey: 'account-setup', screen: 'confirm', note: 'Clarify the confirmation step.' }], 'guided']);
    assert.equal((await answer({ verdict: 'change', pick: 'guided', notes: [{ note: 'Clarify the overall direction.' }] }, noScreens.key)).status, 200);
    assert.deepEqual(JSON.parse(run('answers', board, '--json').stdout)[noScreens.key].notes, [{ note: 'Clarify the overall direction.' }]);
    assert.equal(JSON.parse(run('wait', board, '--key', msg.key, '--json', '--timeout', '0').stdout)[msg.key].answer, 'change');
    assert.equal((await answer({ verdict: 'approve', pick: 'quick', notes: [] })).status, 200);
    const revised = JSON.parse(run('answers', board, '--json').stdout)[msg.key];
    assert.deepEqual([revised.answer, revised.pick], ['approve', 'quick']);
    const approval = { ...msg, key: 'approved-design' };
    assert.equal(run('post', board, '--kind', 'design', '--from', message('approved-design.json', JSON.stringify(approval))).status, 0);
    const approved = await fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: approval.key, verdict: 'approve', pick: 'guided', notes: [] }) });
    assert.equal((await approved.json()).decisions.find(d => d.key === approval.key).status, 'approved');
  } finally { proc.kill(); }
});

test('a design asked as one question: post takes the plain question with its frames, and refuses an internal title, words for agents and frames that look the same', () => {
  const dir = join(scratch, 'design-ask'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'design-ask-home') };
  mkdirSync(join(dir, 'design'), { recursive: true });
  for (const f of readdirSync(join(fixtures, 'design.v2', 'design'))) copyFileSync(join(fixtures, 'design.v2', 'design', f), join(dir, 'design', f));
  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  const post = (m, name) => run('post', board, '--kind', 'design', '--from', message(`${name}.json`, JSON.stringify(m)));
  const three = JSON.parse(readFileSync(join(fixtures, 'design.v2', 'valid-three.json')));
  const posted = post(three, 'design-three');
  assert.equal(posted.status, 0, posted.stdout + posted.stderr);
  const stored = JSON.parse(readFileSync(board, 'utf8')).items.find((d) => d.key === three.key);
  assert.deepEqual([stored.title, stored.accepts, stored.reviewed, stored.journeys[0].screens[0].frames.map((f) => f.role)], [three.title, 'target', three.reviewed, ['today', 'built', 'target']]);
  // A today frame that is the built picture again, in other bytes, looks the same and is refused; so are an internal title and a pull request in the about.
  copyFileSync(join(dir, 'design', 'built.png'), join(dir, 'design', 'today-again.png'));
  appendFileSync(join(dir, 'design', 'today-again.png'), Buffer.alloc(8));
  const same = structuredClone(three); same.key = 'same-frames'; same.journeys[0].screens[0].frames[0].views = { phone_light: 'design/today-again.png' };
  const refused = post(same, 'design-same');
  assert.equal(refused.status, 2); assert.match(refused.stdout, /screen list-end: the today and built frames look the same \(phone_light: 0% of pixels differ\)/);
  for (const [field, value, rule] of [['title', 'Built: the chat list, slice 2', /title has \\"slice\\"/], ['title', 'The new end of the chat list', /title must be one question/], ['about', 'Built in PR 41.', /about has \\"PR\\"/]]) {
    const m = { ...three, key: `bad-${field}`, [field]: value }, r = post(m, `design-bad-${field}`);
    assert.equal(r.status, 2, value); assert.match(r.stdout, rule);
  }
  // A new design 1 is held to the question too; one already on the board (fed by a program) re-posts as it was.
  const old = { ...JSON.parse(readFileSync(join(fixtures, 'design.v1', 'valid-basic.json'))), key: 'old-design', title: 'Chat app journeys' };
  for (const f of readdirSync(join(fixtures, 'design.v1', 'design'))) copyFileSync(join(fixtures, 'design.v1', 'design', f), join(dir, 'design', f));
  const fresh = post(old, 'design-old');
  assert.equal(fresh.status, 2); assert.match(fresh.stdout, /title must be one question/);
  assert.equal(run('post', board, '--from', message('design-feed.json', JSON.stringify({ schema: 2, items: [old] }))).status, 0);
  assert.equal(post(old, 'design-old-again').status, 0);
});

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
    [{ ...finding, options: [...finding.options, { value: 'later', label: 'Later' }] }, /options must list 2 options/, /\{"value":"apply","label":"Apply"\}, \{"value":"skip"/],
    [{ ...finding, incidents: '4' }, /incidents must be a whole number, 0 or more/, /Set "incidents" to a count/],
    [{ ...finding, days: 1.5 }, /days must be a whole number/, /Set "days"/],
    [{ ...finding, cause: 'Missing-Env' }, /cause must be 1-64 of a-z 0-9 -/, /missing-env/],
    [{ ...finding, evidence_ids: Array.from({ length: 51 }, (_, n) => `rec-${n}`) }, /evidence_ids must list 0 to 50 record ids/, /never their text/],
    [{ ...finding, evidence_ids: ['CI failed: API_TOKEN is not set'] }, /evidence_ids\[0\] must be 1-128/, /never its text/],
    [{ ...finding, about: undefined }, /about is required/, /the counts, with no record text/],
    [{ ...finding, close: 'done' }, /close is not a field of finding/, /Remove "close"/],
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
  assert.equal(unknown.out.files[0].help, 'Remove "a\\nb"; ask takes key, title, filer, ticket, priority, link, about, ask_ref, detail, why, options, recommend_value, recommend_reason, default_if_silent, silent_by, guard, close, merges, proof, report');
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
  assert.match(mixed.out.files[2].error, /is not there/);
  const none = spawnSync('node', [cli, 'validate'], { encoding: 'utf8' });
  assert.equal(none.status, 2);
  assert.match(none.stdout, /code: VALIDATION_ERROR/);
});

test('a plan: validate checks each rule with one fix line; post stores it, it waits, and its one send-back reads back from answers and wait', async () => {
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v1', 'valid-full.json')));
  const [d] = plan.decisions, decision = (o) => ({ ...plan, decisions: [{ ...d, ...o }] });
  const ok = validate('--kind', 'plan', message('plan.json', JSON.stringify(plan)), message('no-steps.json', JSON.stringify({ ...plan, steps: undefined })));
  assert.equal(ok.status, 0, ok.raw);
  const spaced = validate('--kind', 'plan', message('spaced.json', JSON.stringify(decision({ question: 'Send every answer back as one event? ' }))));
  assert.equal(spaced.status, 0, spaced.raw);
  const fullWidth = validate('--kind', 'plan', message('full-width.json', JSON.stringify(decision({ question: 'Keep A or B？' }))));
  assert.equal(fullWidth.status, 0, fullWidth.raw);
  for (const [m, error, help] of [
    [{ ...plan, sections: [] }, /sections must list 1 to 8 sections/, /Set "sections" to 1-8 objects/],
    [{ ...plan, sections: [{ ...plan.sections[0], note: 'x' }] }, /sections\[0\]\.note is not a field of a section/, /a section has only id, heading, body/],
    [{ ...plan, sections: [{ ...plan.sections[0], id: 'Goals' }] }, /sections\[0\]\.id must be 1-40 of a-z 0-9 -/, /short slug/],
    [{ ...plan, decisions: undefined }, /decisions is required/, /Set "decisions" to 0-5 objects/],
    [decision({ recommend: 'maybe' }), /decisions\[0\]\.recommend "maybe" is not an option value/, /one of one, each/],
    [decision({ question: 'Send every answer back as one event.' }), /decisions\[0\]\.question must be one question, with one question mark as its last character/, /Ask one question ending in a question mark/],
    [decision({ question: 'Should the board send every answer back to the agent as one single event?' }), /decisions\[0\]\.question must be one question of 12 words or fewer, ending in a question mark/, /put the rest in "why"/],
    [decision({ question: '?' }), /decisions\[0\]\.question must be one question of 12 words or fewer, ending in a question mark/, /Ask it in 12 words or fewer/],
    [decision({ options: d.options.slice(0, 1) }), /decisions\[0\]\.options must list 2 to 6 options/, /"outcome"/],
    [decision({ options: [{ value: 'one', label: 'One event' }, d.options[1]] }), /decisions\[0\]\.options\[0\]\.outcome must be text/, /Set "outcome"/],
    [decision({ options: [{ ...d.options[0], note: 'x' }, d.options[1]] }), /decisions\[0\]\.options\[0\]\.note is not a field of an option/, /only value, label, outcome/],
    [{ ...plan, decisions: [d, d] }, /decisions\[1\]\.key repeats send-back/, /its own key/],
    [{ ...plan, steps: plan.steps.slice(0, 1) }, /steps must list 2 to 12 steps/, /Set "steps"/],
    [{ ...plan, steps: [{ title: 'A', marks: ['ai'] }, plan.steps[1]] }, /steps\[0\]\.marks is not a field of a step/, /a step has only title/],
    [{ ...plan, preview: 'page/preview.svg' }, /preview is not a field of plan schema 1/, /Remove "preview"/],
    [decision({ question: 'Keep A? Or B?' }), /decisions\[0\]\.question must be one question, with one question mark as its last character/, /split any other into its own decision/],
    [decision({ question: 'Keep A？ Or B?' }), /decisions\[0\]\.question must be one question, with one question mark as its last character/, /split any other into its own decision/],
    [{ ...plan, view: '../index.html' }, /view "..\/index.html" must be a relative path/, /Set "view"/],
    [{ ...plan, filed: '2026-10-13T07:19:00Z' }, /filed is not a field of plan schema 1/, /plan takes key, title, filer, ticket, priority, link, about, project, sections, decisions, steps, view$/],
  ]) {
    const { status, out: { files: [row] } } = validate(message('plan-bad.json', JSON.stringify(m)));
    assert.equal(status, 2, JSON.stringify(m));
    assert.match(row.error, error);
    assert.match(row.help, help);
  }
  // A plan posts with post --kind or in a --from feed, waits on the board, and its one send-back is its answer.
  const planDir = join(scratch, 'plan'), board = join(planDir, 'plan-board.json'), env = { ...process.env, HOME: join(scratch, 'home') };
  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env, input: JSON.stringify(plan) });
  mkdirSync(join(planDir, 'page'), { recursive: true });
  writeFileSync(join(planDir, 'page', 'index.html'), readFileSync(join(fixtures, 'plan.v1', 'page', 'index.html')));
  assert.equal(run('post', board, '--kind', 'plan', '--from', '-').status, 0);
  const missing = spawnSync('node', [cli, 'post', board, '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, input: JSON.stringify({ ...plan, key: 'plan-gone', view: 'page/gone.html' }) });
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /view \\"page\/gone.html\\" is not there/);
  const away = mkdtempSync(join(tmpdir(), 'plan-away-'));
  writeFileSync(join(away, 'index.html'), '<html>away</html>');
  symlinkSync(join(away, 'index.html'), join(planDir, 'escape.html'));
  const escaped = spawnSync('node', [cli, 'post', board, '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, input: JSON.stringify({ ...plan, key: 'plan-escape', view: 'escape.html' }) });
  rmSync(away, { recursive: true, force: true });
  assert.equal(escaped.status, 2);
  assert.match(escaped.stdout, /leads outside the board file/);
  const fed = run('post', board, '--from', message('plan-feed.json', JSON.stringify({ schema: 2, items: [{ ...plan, key: 'plan-two' }] })));
  assert.equal(fed.status, 0, fed.stdout);
  const odd = run('post', board, '--from', message('plan-odd.json', JSON.stringify({ schema: 2, items: [{ key: 'odd', title: 'Odd', type: 'plan' }] })));
  assert.match(odd.stdout, /kind is required on a new plan/);
  assert.deepEqual(decode(run('list', board).stdout.split('\nhelp[')[0]).waiting.map((w) => w.key), ['plan-kind-board', 'plan-two']);
  const [item] = JSON.parse(run('list', board, '--json').stdout).decisions;
  assert.deepEqual([item.type, item.options, item.sections, item.decisions, item.steps, item.view], ['plan', [], plan.sections, plan.decisions, plan.steps, plan.view]);
  const approve = plan.sections.map(({ id }) => ({ section: id, verdict: 'approve' })), notes = [{ section: 'goals', verdict: 'change', note: 'Add a non-goal: no desktop layout.' }, ...approve.slice(1)];
  const decisions = { 'send-back': 'one', where: 'own' };
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    assert.equal((await fetch(`${url}favicon.ico`)).status, 204);
    for (const [name, type] of [['icon.svg', 'image/svg+xml'], ['apple-touch-icon.png', 'image/png'], ['manifest.webmanifest', 'application/manifest+json']]) {
      const icon = await fetch(`${url}${name}`);
      assert.deepEqual([icon.status, icon.headers.get('content-type')], [200, type], name);
    }
    const send = (body) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: plan.key, ...body }) });
    for (const [body, error] of [[{ notes: approve.slice(1), decisions }, /notes must list each section once: goals, architecture/], [{ notes: [{ section: 'goals', verdict: 'change' }, ...approve.slice(1)], decisions }, /section goals needs a note/],
      [{ notes, decisions: { 'send-back': 'one' } }, /decisions must answer each of: send-back, where/], [{ notes, decisions: { ...decisions, where: '' } }, /decisions must answer/]]) {
      const refused = await send(body);
      assert.equal(refused.status, 400);
      assert.match((await refused.json()).error, error);
    }
    assert.equal((await send({ notes, decisions })).status, 200);
    assert.equal((await send({ notes, decisions })).status, 200);
  } finally {
    await new Promise((ok) => proc.once('exit', ok).kill());
  }
  const listed = decode(run('list', board).stdout.split('\nhelp[')[0]);
  assert.deepEqual(listed.waiting.map((w) => w.key), ['plan-two']);
  assert.equal(listed.answered, 1);
  const answer = JSON.parse(run('answers', board, '--json').stdout)[plan.key];
  assert.deepEqual([answer.answer, answer.notes, answer.decisions], ['sent', notes, { 'send-back': 'one', where: 'own' }]);
  assert.deepEqual(decode(run('answers', board).stdout.split('\nhelp[')[0]).plan, [...notes.map(({ section, verdict, note = '' }) => ({ key: plan.key, section, verdict, note })), { key: plan.key, decision: 'send-back', pick: 'one' }, { key: plan.key, decision: 'where', pick: 'own' }]);
  writeFileSync(join(planDir, 'page', 'other.html'), readFileSync(join(fixtures, 'plan.v1', 'page', 'index.html')));
  const revised = [{ ...plan, decisions: plan.decisions.slice(0, 1) }, { ...plan, about: `${plan.about} Changed.` }, { ...plan, sections: plan.sections.map((s, i) => (i ? s : { ...s, body: `${s.body} Changed.` })) }, { ...plan, view: 'page/other.html' }, { ...plan, steps: [...plan.steps].reverse() }];
  for (const item of revised) {
    const conflict = run('post', board, '--from', message('plan-revised.json', JSON.stringify({ schema: 2, items: [item] })), '--replace');
    assert.equal(conflict.status, 1, conflict.stdout);
    assert.match(conflict.stdout, /was answered and now holds a different question/);
  }
  const events = run('wait', board, '--filer', 'agent-41', '--events', '--timeout', '0').stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map(({ event, kind, key, notes: n, decisions: p }) => [event, kind, key, n, p]), [['answer', 'plan', plan.key, notes, { 'send-back': 'one', where: 'own' }]]);
});

test('a plan send-back takes an Other decision answer, a comment on an approval and a whole-plan comment', async () => {
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v1', 'valid-full.json')));
  const dir = join(scratch, 'plan-other'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(join(dir, 'page'), { recursive: true });
  writeFileSync(join(dir, 'page', 'index.html'), readFileSync(join(fixtures, 'plan.v1', 'page', 'index.html')));
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  assert.equal(spawnSync('node', [cli, 'post', board, '--kind', 'plan', '--from', join(dir, 'plan.json')], { encoding: 'utf8', env }).status, 0);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const send = (body) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: plan.key, ...body }) });
    const notes = plan.sections.map(({ id }, n) => (n ? { section: id, verdict: 'approve' } : { section: id, verdict: 'approve', note: 'Fine as is.' }));
    const decisions = Object.fromEntries(plan.decisions.map((q, n) => [q.key, n ? q.options[0].value : 'Neither: decide it in the review.']));
    const over = 'x'.repeat(501);
    for (const body of [{ notes, decisions: { ...decisions, where: '' } }, { notes, decisions: { ...decisions, where: over } },
      { notes, decisions, note: over },
      { notes: notes.map((n) => ({ ...n, verdict: 'maybe' })), decisions }]) {
      const refused = await send(body);
      assert.equal(refused.status, 400);
    }
    assert.equal((await send({ notes, decisions, note: 'Overall: start with slice 1.' })).status, 200);
    const answer = JSON.parse(spawnSync('node', [cli, 'answers', board, '--key', plan.key, '--json'], { encoding: 'utf8', env }).stdout)[plan.key];
    assert.deepEqual([answer.answer, answer.note, answer.notes, answer.decisions], ['sent', 'Overall: start with slice 1.', notes, decisions]);
    const waited = JSON.parse(spawnSync('node', [cli, 'wait', board, '--key', plan.key, '--json', '--timeout', '0'], { encoding: 'utf8', env }).stdout)[plan.key];
    assert.deepEqual([waited.answer, waited.note, waited.notes, waited.decisions], ['sent', 'Overall: start with slice 1.', notes, decisions]);
    const events = spawnSync('node', [cli, 'wait', board, '--filer', plan.filer, '--events', '--timeout', '0'], { encoding: 'utf8', env }).stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(events.map(({ event, kind, key, note, notes: n, decisions: p }) => [event, kind, key, note, n, p]),
      [['answer', 'plan', plan.key, 'Overall: start with slice 1.', notes, decisions]]);
  } finally {
    await new Promise((ok) => proc.once('exit', ok).kill());
  }
});

test('a plan view is held to the report page rules at post: a page a phone cannot read is refused', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v1', 'valid-full.json')));
  const dir = join(scratch, 'plan-rules'), board = join(dir, 'board.json');
  mkdirSync(join(dir, 'page'), { recursive: true });
  writeFileSync(join(dir, 'page', 'index.html'), readFileSync(join(fixtures, 'plan.v1', 'page', 'index.html'), 'utf8').replace(/<meta[^>]*viewport[^>]*>/, ''));
  const refused = spawnSync('node', [cli, 'post', board, '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, input: JSON.stringify(plan) });
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, /has no viewport tag/);
});

test('a report in a raise --from file: checked by its kind, stored with no options, never waiting; a new title over 160 is refused', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'reports.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
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
  const board = join(scratch, 'repost.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
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

test('Decide holds only what waits on the reader: not an expired sign-in, not a guided plan with no decisions to answer', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'lapsed.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  const signin = { key: 'tailscale', title: 'Tailscale', type: 'signin', link: 'https://example.com/login', unlocks: 'Pairing', waits: 'Main', filed: '2026-10-20T06:49:08Z' };
  writeFileSync(board, JSON.stringify({ schema: 2, items: [{ ...signin, expires: '2026-10-20T06:54:08Z' }, { ...signin, key: 'npm', title: 'npm', expires: '2999-01-01T00:00:00Z' }] }));
  const listed = decode(cli2('list', board).stdout.split('\nhelp[')[0]);
  assert.deepEqual(listed.waiting.map((d) => d.key), ['npm'], 'only the live link waits');
  // A guided plan is read in Reports; it waits only while it carries a decision to answer.
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v2', 'valid-full.json')));
  assert.ok(plan.decisions.length > 0);
  const post = (m) => cli2('post', board, '--kind', 'plan', '--from', message('plan-reading.json', JSON.stringify(m)));
  assert.equal(post(plan).status, 0);
  assert.equal(post({ ...plan, key: 'for-reading', decisions: [] }).status, 0);
  assert.deepEqual(decode(cli2('list', board).stdout.split('\nhelp[')[0]).waiting.map((d) => d.key), ['npm', plan.key]);
});

test('a design review cannot put itself in Decide: no post, feed or stored field promotes it, only promote does, and only a design', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const dir = join(scratch, 'design-promote'), board = join(dir, 'board.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  mkdirSync(join(dir, 'design'), { recursive: true });
  for (const f of readdirSync(join(fixtures, 'design.v1', 'design'))) copyFileSync(join(fixtures, 'design.v1', 'design', f), join(dir, 'design', f));
  const design = JSON.parse(readFileSync(join(fixtures, 'design.v1', 'valid-basic.json')));
  const post = (m, ...flags) => cli2('post', board, '--kind', 'design', '--from', message('design-promote.json', JSON.stringify(m)), ...flags);
  // A lead's message that names an area or a promotion is refused before anything is stored.
  for (const extra of [{ area: 'waiting' }, { promoted: true }]) {
    const refused = post({ ...design, ...extra });
    assert.equal(refused.status, 2, JSON.stringify(extra));
    assert.match(refused.stdout, new RegExp(`${Object.keys(extra)[0]} is not a field of design`));
  }
  assert.equal(post(design).status, 0);
  // list counts what waits on the user as Decide does: the design is in review, not waiting.
  assert.match(cli2('list', board).stdout, /nothing is waiting on the user/);
  assert.match(cli2('list', board, '--full').stdout, /chat-journeys,in review,/);
  const promoted = () => JSON.parse(cli2('list', board, '--json').stdout).decisions.find((d) => d.key === design.key).promoted;
  assert.equal(promoted(), undefined);
  assert.equal(existsSync(join(dir, 'board.promoted.jsonl')), false);
  // A feed that rewrites the board with the design in Decide is refused, and the board is left as it was.
  const fed = cli2('post', board, '--from', message('design-feed.json', JSON.stringify({ schema: 2, items: [{ ...design, area: 'waiting' }] })), '--replace');
  assert.equal(fed.status, 2);
  assert.match(fed.stdout, /area is not a field of design/);
  // So is a board file edited by hand: the board will not load until the field goes.
  const items = JSON.parse(readFileSync(board, 'utf8'));
  writeFileSync(board, JSON.stringify({ ...items, items: items.items.map((d) => ({ ...d, area: 'waiting' })) }));
  const edited = cli2('list', board);
  assert.equal(edited.status, 2);
  assert.match(edited.stdout, /area must be left out: a design shows under Designs, and Main moves it to Decide with sign-off-axi promote/);
  writeFileSync(board, JSON.stringify(items));
  // Main's promote is the one path: a line in the promoted log, undone the same way; any other card is refused.
  assert.equal(cli2('promote', design.key, board).status, 0);
  assert.equal(promoted(), true);
  assert.deepEqual(decode(cli2('list', board).stdout.split('\nhelp[')[0]).waiting.map((d) => d.key), [design.key]);
  assert.equal(cli2('promote', design.key, board, '--undo').status, 0);
  assert.equal(promoted(), undefined);
  assert.deepEqual(readFileSync(join(dir, 'board.promoted.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).promoted), [true, false]);
  assert.equal(cli2('post', board, '--kind', 'ask', '--from', message('promote-ask.json', JSON.stringify(ask))).status, 0);
  const notDesign = cli2('promote', ask.key, board);
  assert.equal(notDesign.status, 2);
  assert.match(notDesign.stdout, /is not a design review/);
});

test('a stored report with reply, area or type is refused: it can never wait, be answered, or leave Reports', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'stored-report.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  for (const extra of [{ reply: true }, { area: 'waiting' }, { type: 'design' }]) {
    writeFileSync(board, JSON.stringify({ schema: 2, items: [{ ...report, ...extra }] }));
    const listed = cli2('list', board);
    assert.equal(listed.status, 2, JSON.stringify(extra));
    assert.match(listed.stdout, /must be left out: a report takes no answer and shows only under Reports/);
  }
  // A text-only report stored before reports had pages still loads, and a feed that sends it unchanged keeps it; a new one is refused.
  const old = { contract: 1, kind: 'report', schema: 1, key: 'merged-12', title: 'Merged: fix the sign-in button', about: 'Checks passed.', filed: '2026-10-13T07:19:00Z' };
  writeFileSync(board, JSON.stringify({ schema: 2, items: [old] }));
  assert.equal(cli2('list', board).status, 0);
  const kept = cli2('post', board, '--from', message('old-report-feed.json', JSON.stringify({ schema: 2, items: [old] })), '--replace');
  assert.equal(kept.status, 0, kept.stdout);
  const fresh = cli2('post', board, '--from', message('new-text-report-feed.json', JSON.stringify({ schema: 2, items: [old, { ...old, key: 'merged-13' }] })), '--replace');
  assert.equal(fresh.status, 2, fresh.stdout);
  assert.match(fresh.stdout, /items\[1\]: key merged-13: schema 1 of report is text only[^]*report init <folder>/);
  assert.deepEqual(JSON.parse(readFileSync(board, 'utf8')).items.map((i) => i.key), ['merged-12']);
});

test('a report counts its group and decision in characters, not UTF-16 units: 21 emoji fit a 40 limit', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'emoji.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
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
  const board = join(scratch, 'repost-report.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
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
  const board = join(scratch, 'answered.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
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
  // A report's page is read at post from the board file's folder: validate passes a page beside the board but not beside the message file.
  const beside = join(scratch, 'beside'), feedDir = join(beside, 'feed');
  mkdirSync(join(beside, 'page'), { recursive: true });
  mkdirSync(feedDir);
  for (const f of ['index.html', 'preview.svg']) writeFileSync(join(beside, 'page', f), readFileSync(join(scratch, 'page', f)));
  const feedFile = (name, view) => { const path = join(feedDir, name); writeFileSync(path, JSON.stringify({ ...report, key: name, view, preview: 'page/preview.svg' })); return path; };
  const reportAt = feedFile('beside.json', 'page/index.html');
  assert.equal(spawnSync('node', [cli, 'validate', reportAt], { encoding: 'utf8', env }).status, 0);
  const beside2 = spawnSync('node', [cli, 'post', join(beside, 'board.json'), '--kind', 'report', '--from', reportAt], { encoding: 'utf8', env });
  assert.equal(beside2.status, 0, beside2.stdout);
  const gone = spawnSync('node', [cli, 'post', join(beside, 'board.json'), '--kind', 'report', '--from', feedFile('gone.json', 'page/gone.html')], { encoding: 'utf8', env });
  assert.equal(gone.status, 2, gone.stdout);
  assert.match(gone.stdout, /view \\"page\/gone\.html\\" is not there/);
  assert.match(gone.stdout, /Put the file at page\/gone\.html from the board file's folder/);
  spawnSync('node', [cli, ...asked(['raise', board, '--title', 'Plain?', '--key', 'plain'])], { env });
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
  // A report is a page: text alone is refused with what is missing and the command that makes the page, and nothing is written.
  const text = post('', '--type', 'report', '--purpose', 'other', '--project', 'Umer', '--title', 'Merged #12', '--about', 'Checks passed.');
  assert.equal(text.status, 2, text.stdout);
  assert.match(text.stdout, /a report is a page to tap through, not text: --view and --preview are missing/);
  // A report names its kind: refused with the seven named, on a flag post, in a file, and from report init, before anything is written.
  const kindless = post('', '--type', 'report', '--project', 'Umer', '--title', 'Merged #12', '--about', 'Checks passed.', '--view', 'page/index.html', '--preview', 'page/preview.svg');
  assert.equal(kindless.status, 2, kindless.stdout);
  assert.match(kindless.stdout, /a report needs --purpose <kind>, what it is for: research, plan, decision, audit, incident, status, other/);
  const unnamed = post(JSON.stringify({ ...report, key: 'slice-5-kindless', purpose: undefined }), '--kind', 'report', '--from', '-');
  assert.equal(unnamed.status, 2, unnamed.stdout);
  assert.match(unnamed.stdout, /stdin: report slice-5-kindless has no kind: \\"purpose\\" is required[^]*research, plan, decision, audit, incident, status, other/);
  const homeless = post('', '--type', 'report', '--purpose', 'other', '--title', 'Merged #12', '--about', 'Checks passed.', '--view', 'page/index.html', '--preview', 'page/preview.svg');
  assert.equal(homeless.status, 2, homeless.stdout);
  assert.match(homeless.stdout, /a report needs --project <name>, the project it is about; no project is registered/);
  const noProject = post(JSON.stringify({ ...report, key: 'slice-5-homeless', project: undefined }), '--kind', 'report', '--from', '-');
  assert.equal(noProject.status, 2, noProject.stdout);
  assert.match(noProject.stdout, /report slice-5-homeless has no project/);
  const bare = spawnSync('node', [cli, 'report', 'init', join(scratch, 'bare')], { encoding: 'utf8', env });
  assert.equal(bare.status, 2, bare.stdout);
  assert.match(bare.stdout, /report init needs --purpose <kind>, what the report is for: research, plan, decision, audit, incident, status, other/);
  assert.equal(existsSync(join(scratch, 'bare')), false);
  assert.match(text.stdout, /help\[1\]: "Run `sign-off-axi report init <folder> --page` to make the page and its picture/);
  assert.match(post(JSON.stringify({ ...report, schema: 1, view: undefined, preview: undefined }), '--kind', 'report', '--from', '-').stdout,
    /stdin: key slice-5-live: schema 1 of report is text only[^]*report init <folder>/);
  // report init writes the page; posted unfilled, or as text with nothing to tap, or with a block longer than a phone shows, it is refused.
  const made = spawnSync('node', [cli, 'report', 'init', join(scratch, 'draft'), '--page', '--purpose', 'other'], { encoding: 'utf8', env });
  assert.equal(made.status, 0, made.stdout);
  assert.match(made.stdout, /created\[2\]:.*draft\/index\.html,.*draft\/preview\.svg/);
  assert.match(made.stdout, /390 px wide and look before posting: mostly text means it is not ready/);
  const draft = ['--type', 'report', '--purpose', 'other', '--project', 'Umer', '--title', 'How sign-in works', '--about', 'Two steps now.', '--view', 'draft/index.html', '--preview', 'draft/preview.svg'];
  assert.match(post('', ...draft).stdout, /--type report: key how-sign-in-works: view \\"draft\/index\.html\\" still has FILL: lines/);
  fill(join(scratch, 'draft', 'index.html'));
  assert.match(post('', ...draft).stdout, /preview \\"draft\/preview\.svg\\" still has FILL: lines/);
  fill(join(scratch, 'draft', 'preview.svg'));
  const page = readFileSync(join(scratch, 'draft', 'index.html'), 'utf8');
  for (const [broken, error] of [[page.replace(/<button\b[^>]*>.*?<\/button>/g, ''), /has nothing to tap or slide, so it is text, not a report/],
    [page.replace('</main>', `<p>${'Umer reads a long block. '.repeat(12)}</p></main>`), /has a block of \d+ characters, over 240/]]) {
    writeFileSync(join(scratch, 'draft', 'index.html'), broken);
    const refused = post('', ...draft);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, error);
  }
  writeFileSync(join(scratch, 'draft', 'index.html'), page);
  assert.equal(readFileSync(board, 'utf8'), before);
  // Filled, it posts; the same flags again are the same report.
  const filed = post('', ...draft);
  assert.equal(filed.status, 0, filed.stdout);
  assert.match(filed.stdout, /how-sign-in-works,raised,[^]*so the user can read it/);
  assert.match(post('', ...draft).stdout, /how-sign-in-works,already posted/);
  const stored = JSON.parse(readFileSync(board, 'utf8')).items.at(-1);
  assert.deepEqual([stored.kind, stored.schema, stored.view, stored.preview], ['report', 2, 'draft/index.html', 'draft/preview.svg']);
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
  const board = join(scratch, 'kind-only.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  assert.equal(cli2('raise', board, '--title', 'Plain?', '--key', 'pick').status, 0);
  const kindOnly = { kind: 'ask', schema: 1, key: 'pick', title: ask.title, options: ask.options, recommend_value: ask.recommend_value };
  const feed = message('kind-only-feed.json', JSON.stringify({ schema: 2, items: [kindOnly] }));
  for (const verb of ['raise', 'post']) {
    const refused = cli2(verb, board, '--from', feed);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, /key pick already holds a different message[^]*Post it under a new key/);
  }
});

test('post --replace: a changed item is checked against its kind again, an unchanged one is not, and the board is left as it was', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'replace-check.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  assert.equal(cli2('post', board, '--kind', 'ask', '--from', message('replace-ask.json', JSON.stringify(ask)), '--filer', 'agent-41').status, 0);
  const feed = (name, item) => message(`replace-${name}.json`, JSON.stringify({ schema: 2, items: [item] }));
  const boardText = () => readFileSync(board, 'utf8'), before = boardText();
  // A changed item that no longer matches its kind is refused before anything is written, naming the file, the item index and the key.
  const broken = cli2('post', board, '--from', feed('broken', { ...ask, media: ['shot.png'] }), '--replace');
  assert.equal(broken.status, 2, broken.stdout);
  assert.match(broken.stdout, /replace-broken\.json: items\[0\]: key ship-signin-2: media is not a field of ask schema 1/);
  assert.match(broken.stdout, /Remove \\"media\\"/);
  assert.equal(boardText(), before);
  // A changed item that matches its kind is still replaced, and a resync of the board it wrote is left alone.
  const changed = cli2('post', board, '--from', feed('changed', { ...ask, title: 'Ship it Friday?' }), '--replace');
  assert.equal(changed.status, 0, changed.stdout);
  assert.equal(JSON.parse(boardText()).items[0].title, 'Ship it Friday?');
  const resync = cli2('post', board, '--from', feed('resync', JSON.parse(boardText()).items[0]), '--replace');
  assert.equal(resync.status, 0, resync.stdout);
  assert.match(resync.stdout, /changed: false/);
  // A whole-board item carries the board's own `filed` stamp, which is not part of the ask's message: changing it still replaces.
  const stamped = cli2('post', board, '--from', feed('stamped', { ...JSON.parse(boardText()).items[0], title: 'Ship it Monday?' }), '--replace');
  assert.equal(stamped.status, 0, stamped.stdout);
  assert.equal(JSON.parse(boardText()).items[0].title, 'Ship it Monday?');
  // An unchanged item is not checked again, even one the current rules would refuse.
  const old = { ...ask, title: 'Old title' };
  writeFileSync(board, JSON.stringify({ schema: 2, items: [old] }));
  const kept = cli2('post', board, '--from', feed('kept', old), '--replace');
  assert.equal(kept.status, 0, kept.stdout);
  assert.equal(JSON.parse(boardText()).items[0].title, 'Old title');
});

test('post --replace: a plan answered by a send-back is refused when a revision drops a decision or rewrites a section', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v1', 'valid-full.json')));
  const board = join(scratch, 'replace-plan-board.json'), cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  const feed = (name, item) => message(`replace-plan-${name}.json`, JSON.stringify({ schema: 2, items: [item] }));
  assert.equal(cli2('post', board, '--kind', 'plan', '--from', message('replace-plan-first.json', JSON.stringify(plan))).status, 0);
  const notes = plan.sections.map(({ id }) => ({ section: id, verdict: 'approve' }));
  const decisions = Object.fromEntries(plan.decisions.map((q) => [q.key, q.options[0].value]));
  appendFileSync(join(scratch, 'replace-plan-board.answers.jsonl'), `${JSON.stringify({ key: plan.key, answer: 'sent', label: 'Sent back', close: 'done', at: '2026-10-13T08:00:00Z', notes, decisions })}\n`);
  const dropped = cli2('post', board, '--from', feed('dropped', { ...plan, decisions: plan.decisions.slice(0, 1) }), '--replace');
  assert.equal(dropped.status, 1, dropped.stdout);
  assert.match(dropped.stdout, /was answered and now holds a different question/);
  const rewritten = cli2('post', board, '--from', feed('rewritten', { ...plan, sections: plan.sections.map((s, i) => (i ? s : { ...s, body: `${s.body} Changed.` })) }), '--replace');
  assert.equal(rewritten.status, 1, rewritten.stdout);
  assert.match(rewritten.stdout, /was answered and now holds a different question/);
  const same = cli2('post', board, '--from', feed('same', plan), '--replace');
  assert.equal(same.status, 0, same.stdout);
});

test('post --replace: an answer does not re-attach to a key the feed dropped and re-added, for every contract kind', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'replace-orphan.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  const report2 = { ...report, key: 'slice-note' };
  assert.equal(cli2('post', board, '--kind', 'ask', '--from', message('orphan-ask.json', JSON.stringify(ask))).status, 0);
  assert.equal(cli2('post', board, '--kind', 'report', '--from', message('orphan-report.json', JSON.stringify(report2))).status, 0);
  // Both keys are answered, then the feed drops them; a re-added one cannot bring the saved answer back.
  appendFileSync(join(scratch, 'replace-orphan.answers.jsonl'), [ask, report2].map(({ key }) => `${JSON.stringify({ key, answer: 'yes', label: 'Yes', close: 'done', at: '2026-10-13T08:00:00Z' })}\n`).join(''));
  const stored = JSON.parse(readFileSync(board, 'utf8')).items;
  assert.equal(cli2('post', board, '--from', message('orphan-dropped.json', JSON.stringify({ schema: 2, items: [] })), '--replace').status, 0);
  const gone = readFileSync(board, 'utf8');
  // The whole-board item a resync would send (with its `filed` stamp), and the bare message, are both refused the same way.
  for (const [kind, item] of [['ask', stored[0]], ['report', report2]]) {
    const back = cli2('post', board, '--from', message(`orphan-back-${kind}.json`, JSON.stringify({ schema: 2, items: [item] })), '--replace');
    assert.equal(back.status, 1, back.stdout);
    assert.match(back.stdout, new RegExp(`key ${item.key} was answered[^]*Post it under a new key`));
    assert.equal(readFileSync(board, 'utf8'), gone);
  }
});

test('a guided plan and report: report init writes them to fill, post refuses FILL lines, and Go deeper, read receipts and the one send-back round-trip with the agent', async () => {
  const dir = join(scratch, 'guide'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'guide-home') };
  mkdirSync(dir, { recursive: true });
  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env, cwd: dir });
  // report init writes the guided template; posted as it is, it is refused for its FILL lines, and a view is not a field.
  for (const [flag, kind] of [[['--purpose', 'research'], 'report'], [['--plan'], 'plan']]) {
    const made = run('report', 'init', join(dir, kind), ...flag);
    assert.equal(made.status, 0, made.stdout);
    assert.match(made.stdout, new RegExp('post --kind ' + kind + ' --from [^ ]*' + kind + '\\.json'));
    const raw = run('post', board, '--kind', kind, '--from', join(dir, kind, kind + '.json'));
    assert.equal(raw.status, 2);
    assert.match(raw.stdout, /still has FILL: lines/);
  }
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v2', 'valid-full.json'))), guide = { ...JSON.parse(readFileSync(join(fixtures, 'report.v3', 'valid-full.json'))), purpose: 'other', project: 'Umer' };
  for (const [m, error] of [[{ ...plan, view: 'page/index.html' }, /view is not a field of plan schema 2/], [{ ...guide, preview: 'p.svg' }, /preview is not a field of report schema 3/],
    [{ ...plan, visual: { ...plan.visual, rows: [{ label: 'A' }, { label: 'B', value: 1 }] } }, /visual\.rows\[0\]\.value/], [{ ...plan, sections: [{ ...plan.sections[0], items: [] }] }, /items must list 1 to 8/]]) {
    const { out: { files: [row] } } = validate(message('guide-bad.json', JSON.stringify(m)));
    assert.equal(row.ok, false, JSON.stringify(m));
    assert.match(row.error, error);
  }
  for (const [kind, m] of [['plan', plan], ['report', guide]]) {
    const posted = spawnSync('node', [cli, 'post', board, '--kind', kind, '--from', '-'], { encoding: 'utf8', env, input: JSON.stringify(m) });
    assert.equal(posted.status, 0, posted.stdout);
  }
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const post = (path, body) => fetch(url + 'api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const state = async () => (await fetch(url + 'api/decisions')).json();
    const items = (await state()).decisions;
    assert.deepEqual(items.map((d) => [d.key, d.guided]), [['faster-sign-in', true], ['sign-in-faster', true]]);
    // A part read is kept once, at the first time; an unknown part is refused.
    assert.equal((await post('reads', { key: 'faster-sign-in', part: 'understood' })).status, 200);
    const first = (await state()).reads['faster-sign-in/understood'];
    assert.match(first, /^\d{4}-\d\d-\d\dT/);
    await post('reads', { key: 'faster-sign-in', part: 'understood' });
    assert.equal((await state()).reads['faster-sign-in/understood'], first);
    assert.equal((await post('reads', { key: 'faster-sign-in', part: 'nowhere' })).status, 404);
    assert.equal((await post('deeper', { key: 'faster-sign-in', part: 'found:0', q: 'x'.repeat(600) })).status, 400);
    // Go deeper: the ask waits, the agent's wait --filer returns it once, and its answer streams back piece by piece.
    assert.equal((await post('deeper', { key: 'faster-sign-in', part: 'found:0', q: 'Why 31%?' })).status, 200);
    assert.equal((await post('deeper', { key: 'faster-sign-in', part: 'found:0' })).status, 200);
    const [ask] = (await state()).deeper;
    assert.deepEqual([ask.part, ask.q, ask.read, ask.text], ['found:0', 'Why 31%?', undefined, '']);
    const waited = spawnSync('node', [cli, 'wait', board, '--filer', 'agent-41', '--events', '--timeout', '5'], { encoding: 'utf8', env });
    const event = JSON.parse(waited.stdout.split('\n')[0]);
    assert.deepEqual([event.event, event.kind, event.key, event.part, event.q, event.id], ['deeper', 'plan', 'faster-sign-in', 'found:0', 'Why 31%?', ask.id]);
    assert.ok((await state()).deeper[0].read);
    assert.equal(run('deeper', board, '--id', ask.id, '--text', '62 of 200 left at that screen.', '--more').status, 0);
    let [now] = (await state()).deeper;
    assert.deepEqual([now.text, now.done], ['62 of 200 left at that screen.', undefined]);
    assert.equal(run('deeper', board, '--id', ask.id, '--text', 'That is 31%.').status, 0);
    [now] = (await state()).deeper;
    assert.deepEqual([now.text, now.done], ['62 of 200 left at that screen.\n\nThat is 31%.', true]);
    assert.equal(run('deeper', board, '--id', ask.id, '--text', 'more').status, 1);
    // The send-back: only what is off, every decision, and the plan stays on the board, with its read time once the agent has it.
    assert.equal((await post('answers', { key: 'faster-sign-in', decisions: {} })).status, 400);
    assert.equal((await post('answers', { key: 'faster-sign-in', notes: [{ section: 'understood', verdict: 'change' }], decisions: { rollout: 'tenth' } })).status, 400);
    assert.equal((await post('answers', { key: 'faster-sign-in', notes: [{ section: 'understood', verdict: 'change', note: 'Also the tablet flow.' }], decisions: { rollout: 'all' } })).status, 200);
    const sent = spawnSync('node', [cli, 'wait', board, '--filer', 'agent-41', '--events', '--timeout', '5'], { encoding: 'utf8', env });
    const answer = JSON.parse(sent.stdout.split('\n')[0]);
    assert.deepEqual([answer.event, answer.kind, answer.schema, answer.answer], ['answer', 'plan', 2, 'sent']);
    assert.deepEqual([answer.decisions, answer.notes], [{ rollout: 'all' }, [{ section: 'understood', verdict: 'change', note: 'Also the tablet flow.' }]]);
    assert.match((await state()).seen_at['faster-sign-in'], /^\d{4}-/);
    // New schemas reuse the same real server/CLI journey, without modifying legacy answers.
    for (const [kind, schema] of [['plan', 3], ['report', 4]]) {
      const m = JSON.parse(readFileSync(join(fixtures, `${kind}.v${schema}/valid-full.json`)));
      const key = `simplify-${kind}`; m.key = key; if (kind === 'report') Object.assign(m, { purpose: 'other', project: 'Umer' });
      m.understood[0].text = 'Ask 🙂 once, then ask 🙂 again, and ask 🙂 a third time.';
      const posted = spawnSync('node', [cli, 'post', board, '--kind', kind, '--from', '-'], { env, encoding: 'utf8', input: JSON.stringify(m) });
      assert.equal(posted.status, 0, posted.stdout);
      const d = (await state()).decisions.find(d => d.key === key), before = readFileSync(board, 'utf8');
      const request = { version: 1, id: `request-${kind}`, key, ...d.engagement, part: 'understood', action: 'simplify' };
      const cases = JSON.parse(readFileSync(new URL('../fixtures/engagement-v1.json', import.meta.url)));
      for (const bad of [...cases.invalid, { action: 'custom', q: '🙂'.repeat(501) }]) assert.equal((await post('engagement', { ...request, ...bad })).status, 409);
      for (const bad of [{ ...request, revision: '0'.repeat(64) }, { ...request, filer: 'other' }, { ...request, part: 'found:0:extra' }, { ...request, part: 7 }, { ...request, surprise: true }, { ...request, selection: { field: 'understood.0.text', start: 0, end: 1, quote: 'wrong' } }]) {
        assert.equal((await post('engagement', bad)).status, 409);
        assert.ok(!(await state()).deeper.some(a => a.id === request.id));
      }
      assert.equal((await post('engagement', request)).status, 200);
      assert.equal((await post('engagement', request)).status, 200);
      assert.equal((await post('engagement', { ...request, action: 'why' })).status, 409);
      assert.equal((await post('engagement', { ...request, id: request.id + '-second' })).status, 200);
      const event = JSON.parse(run('wait', board, '--filer', m.filer, '--events', '--timeout', '0').stdout.split('\n')[0]);
      assert.deepEqual([event.version, event.action, event.filer, event.revision], [1, 'simplify', m.filer, request.revision]);
      assert.notEqual(run('deeper', board, '--id', request.id, '--filer', 'other', '--text', 'No').status, 0);
      assert.notEqual(run('deeper', board, '--id', request.id, '--text', 'No').status, 0);
      assert.equal(run('deeper', board, '--id', request.id, '--filer', m.filer, '--text', 'A simpler explanation.', '--more').status, 0);
      assert.equal(run('deeper', board, '--id', request.id, '--filer', m.filer, '--text', 'The final line.').status, 0);
      let a = (await state()).deeper.find(a => a.id === request.id);
      assert.deepEqual([a.done, a.answerRevision, a.seen], [true, 2, undefined]);
      assert.equal((await post('engagement/seen', { id: a.id, answerRevision: 1 })).status, 409);
      assert.equal((await post('engagement/seen', { id: a.id, answerRevision: 2 })).status, 200);
      a = JSON.parse(run('deeper', board, '--all', '--json').stdout).deeper.find(a => a.id === request.id);
      assert.equal(a.seen, 2);
      for (const [i, intent] of [...cases.valid, { action: 'custom', q: '🙂'.repeat(500) }].entries()) {
        const ask = { ...request, ...intent, id: `${request.id}-intent-${i}`, part: 'next' };
        assert.equal((await post('engagement', ask)).status, 200);
        assert.equal((await post('engagement', ask)).status, 200);
        assert.equal((await post('engagement', { ...ask, q: 'Different text' })).status, 409);
        const saved = (await state()).deeper.find(a => a.id === ask.id);
        assert.deepEqual([saved.action, saved.part, saved.q], [intent.action, 'next', intent.q]);
      }
      assert.equal((await state()).deeper.filter(a => a.key === key).length, 9);
      const intents = run('wait', board, '--filer', m.filer, '--events', '--timeout', '0').stdout.trim().split('\n').map(JSON.parse);
      assert.equal(intents.length, 7);
      for (const [i, intent] of [...cases.valid, { action: 'custom', q: '🙂'.repeat(500) }].entries()) assert.deepEqual([intents[i].action, intents[i].part, intents[i].q], [intent.action, 'next', intent.q]);
      assert.equal(readFileSync(board, 'utf8'), before, 'explanations never rewrite plan decisions or the document');
      // Selected text: offsets pick one repeat of a phrase, counted in Unicode code points; any other target fails without a write.
      const text = m.understood[0].text, quoted = (n) => { let i = -1; for (let k = 0; k <= n; k++) i = text.indexOf('ask 🙂', i + 1); const start = [...text.slice(0, i)].length; return { field: 'understood.0.text', start, end: start + 5, quote: 'ask 🙂' }; };
      const sel = (n, over = {}) => ({ ...request, id: `${request.id}-sel-${n}`, selection: { ...quoted(n), ...over } }), saved = async () => (await state()).deeper.filter(a => a.key === key).length;
      const count = await saved();
      for (const bad of [sel(0, { start: quoted(0).start + 1, end: quoted(0).end + 1 }), sel(0, { end: quoted(1).end }), sel(0, { quote: '' }), sel(0, { end: quoted(0).start }), sel(0, { extra: 1 }), { ...sel(0), part: 'this' }, { ...sel(0), part: 'next' },
        { ...sel(0), revision: '0'.repeat(64) }, { ...sel(0), selection: { ...quoted(0), field: 'understood.0.label' } }, { ...sel(0), selection: { ...quoted(0), field: 'title' } }]) assert.equal((await post('engagement', bad)).status, 409);
      assert.equal(await saved(), count, 'a refused selection saves nothing');
      for (const n of [0, 1]) { assert.equal((await post('engagement', sel(n))).status, 200); assert.equal((await post('engagement', sel(n))).status, 200); }
      assert.equal((await post('engagement', sel(0, quoted(1)))).status, 409);
      assert.equal(await saved(), count + 2);
      const picked = run('wait', board, '--filer', m.filer, '--events', '--timeout', '0').stdout.trim().split('\n').map(JSON.parse);
      assert.deepEqual(picked.map(e => e.selection), [quoted(0), quoted(1)]);
      const changed = JSON.parse(before); changed.items.find(i => i.key === key).title += ' revised'; writeFileSync(board, JSON.stringify(changed));
      const stale = run('deeper', board, '--id', request.id + '-second', '--filer', m.filer, '--text', 'Stale');
      assert.notEqual(stale.status, 0); assert.match(stale.stdout, /stale/);
      assert.equal((await post('engagement', { ...sel(1), id: `${request.id}-late` })).status, 409);
      writeFileSync(board, before);
    }
  } finally {
    await new Promise((ok) => proc.once('exit', ok).kill());
  }
});

test('engagement listeners survive report-only boards, sent plans, timeouts and restarts without stealing requests', async () => {
  const dir = join(scratch, 'listeners'), board = join(dir, 'board.json');
  mkdirSync(dir);
  const env = { ...process.env, HOME: join(dir, 'home'), SIGN_OFF_HOME: dir, XDG_CONFIG_HOME: dir, XDG_STATE_HOME: dir };
  delete env.SIGN_OFF_FILER; delete env.CLAUDE_CODE_SESSION_ID;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
  const postItem = (kind, filer, key) => {
    const item = { ...JSON.parse(readFileSync(join(fixtures, kind === 'plan' ? 'plan.v2/valid-full.json' : 'report.v3/valid-full.json'))), filer, key, ...(kind === 'report' && { purpose: 'other', project: 'Umer' }) };
    const p = spawnSync(process.execPath, [cli, 'post', board, '--kind', kind, '--from', '-'], { env, encoding: 'utf8', input: JSON.stringify(item) });
    assert.equal(p.status, 0, p.stdout + p.stderr);
  };
  const children = new Set();
  const startWait = (filer, timeout = '3') => {
    const p = spawn(process.execPath, [cli, 'wait', board, ...(filer ? ['--filer', filer] : []), '--events', '--timeout', timeout], { env });
    children.add(p);
    let stdout = ''; p.stdout.on('data', b => { stdout += b; });
    const result = new Promise(resolve => p.on('close', status => { children.delete(p); resolve({ status, stdout }); }));
    return { p, result };
  };
  let server, url;
  const serve = async () => {
    server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env });
    url = await new Promise(ok => server.stdout.once('data', b => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  };
  const stop = p => new Promise(ok => p.once('close', ok).kill());
  const tap = async (key, part = 'this') => {
    const response = await fetch(url + 'api/deeper', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, part, q: 'Explain this for Umer.' }) });
    assert.equal(response.status, 200);
    const state = await response.json();
    return state.deeper.find(x => x.key === key && x.part === part).id;
  };
  const take = filer => run('wait', board, '--filer', filer, '--events', '--timeout', '0');
  const timedOut = result => { assert.equal(result.status, 1, result.stdout); assert.match(result.stdout, /TIMEOUT/); };
  try {
    postItem('report', 'umer', 'report-umer');
    postItem('report', 'other', 'report-other');
    await serve();
    const listener = startWait('umer'), isolated = startWait('other');
    await new Promise(ok => setTimeout(ok, 700));
    assert.equal(listener.p.exitCode, null, 'report-only listener must remain active before the tap');
    const id = await tap('report-umer');
    const got = await listener.result;
    assert.equal(got.status, 0, got.stdout);
    assert.deepEqual(JSON.parse(got.stdout).id, id);
    timedOut(await isolated.result);
    timedOut(take('umer')); // Already delivered, even though not answered yet.
    const queued = await tap('report-other');
    // Legacy board-wide answer waits must not consume an owner's engagement.
    const legacy = run('wait', board, '--json', '--timeout', '0');
    assert.match(legacy.stdout, /NOT_FOUND/);
    timedOut(run('wait', board, '--filer', 'umer', '--key', 'report-other', '--events', '--timeout', '0'));
    assert.equal(JSON.parse(take('other').stdout).id, queued);
    timedOut(take('other'));
    const racing = [startWait('umer'), startWait('umer')];
    await new Promise(ok => setTimeout(ok, 700));
    const raced = await tap('report-umer', 'understood');
    const results = await Promise.all(racing.map(x => x.result));
    assert.equal(results.filter(x => x.status === 0).length, 1);
    assert.equal(JSON.parse(results.find(x => x.status === 0).stdout).id, raced);
    timedOut(results.find(x => x.status !== 0));
    // A timed-out/restarted listener and a restarted server recover the durable queue.
    const abandoned = startWait('umer');
    await new Promise(ok => setTimeout(ok, 700));
    await stop(abandoned.p);
    const recovered = await tap('report-umer', 'next');
    await stop(server); await serve();
    assert.equal(JSON.parse(take('umer').stdout).id, recovered);
    timedOut(take('umer'));
    assert.ok(JSON.parse(run('deeper', board, '--filer', 'umer', '--json').stdout).deeper.some(x => x.id === recovered), 'unfinished delivered requests remain recoverable');
    postItem('plan', 'planner', 'sent-plan');
    const response = await fetch(url + 'api/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'sent-plan', notes: [], decisions: { rollout: 'all' } }) });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(take('planner').stdout).event, 'answer');
    const sent = startWait('planner');
    await new Promise(ok => setTimeout(ok, 700));
    assert.equal(sent.p.exitCode, null, 'sent plan listener must remain active');
    const followup = await tap('sent-plan');
    assert.equal(JSON.parse((await sent.result).stdout).id, followup);
    timedOut(take('planner'));
    const keyed = await tap('sent-plan', 'understood');
    assert.equal(JSON.parse(run('wait', board, '--filer', 'planner', '--key', 'sent-plan', '--events', '--timeout', '0').stdout).event, 'answer');
    // A keyed answer replay must not silently take a queued engagement.
    assert.equal(JSON.parse(take('planner').stdout).id, keyed);
  } finally {
    for (const p of children) await stop(p);
    if (server?.exitCode === null) await stop(server);
  }
});

test('an answers-only board takes Go deeper on a report part and still refuses rounds', async () => {
  const dir = join(scratch, 'fed-deeper'), board = join(dir, 'board.json'), env = { ...process.env, SIGN_OFF_HOME: dir, HOME: join(dir, 'home') };
  const report = { ...JSON.parse(readFileSync(join(fixtures, 'report.v4/valid-full.json'))), key: 'fed-report', purpose: 'other', project: 'Umer' };
  assert.equal(spawnSync(process.execPath, [cli, 'post', board, '--kind', 'report', '--from', '-'], { env, encoding: 'utf8', input: JSON.stringify(report) }).status, 0);
  writeFileSync(board, JSON.stringify({ ...JSON.parse(readFileSync(board, 'utf8')), answers_only: true }));
  const server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env });
  try {
    const url = await new Promise(ok => server.stdout.once('data', b => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const send = (path, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const deeper = await send('api/deeper', { key: 'fed-report', part: 'found:0' });
    assert.equal(deeper.status, 200);
    assert.deepEqual((await deeper.json()).deeper.map(a => [a.key, a.part]), [['fed-report', 'found:0']]);
    assert.equal((await send('api/rounds', { key: 'fed-report', note: 'again' })).status, 403);
  } finally { server.kill(); }
});

test('a comment on a report part reaches the author agent through wait --filer, is taken once, and its reply shows on the board', async () => {
  const dir = join(scratch, 'part-comment'), board = join(dir, 'board.json'), env = { ...process.env, SIGN_OFF_HOME: dir, HOME: join(dir, 'home') };
  delete env.SIGN_OFF_FILER; delete env.CLAUDE_CODE_SESSION_ID;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  const report = { ...JSON.parse(readFileSync(join(fixtures, 'report.v4/valid-full.json'))), key: 'comment-report', purpose: 'other', project: 'Umer', filer: 'agent-41' };
  assert.equal(spawnSync(process.execPath, [cli, 'post', board, '--kind', 'report', '--from', '-'], { env, encoding: 'utf8', input: JSON.stringify(report) }).status, 0);
  const server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env });
  try {
    const url = await new Promise(ok => server.stdout.once('data', b => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const send = (body) => fetch(url + 'api/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = 'The 6-second limit is short for a cold start.';
    assert.equal((await send({ key: 'comment-report', part: 'nope', text })).status, 404, 'a part the report has not got');
    assert.equal((await send({ key: 'comment-report', part: 'found:0' })).status, 400, 'neither a verdict nor words');
    assert.equal((await send({ key: 'comment-report', part: 'found:0', verdict: 'maybe' })).status, 400);
    const sent = await send({ key: 'comment-report', part: 'found:0', verdict: 'disagree', text });
    assert.equal(sent.status, 200);
    const [saved] = (await sent.json()).comments;
    assert.deepEqual([saved.part, saved.verdict, saved.text, saved.read], ['found:0', 'disagree', text, undefined], 'the board shows it sent, not read');
    // Another filer's wait does not get it; the author's does, once, with the part it is about.
    assert.notEqual(run('wait', board, '--filer', 'someone-else', '--events', '--timeout', '1').status, 0);
    const first = run('wait', board, '--filer', 'agent-41', '--events', '--timeout', '10');
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const [event, ...more] = first.stdout.trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(more, []);
    assert.deepEqual([event.event, event.kind, event.key, event.part, event.about, event.verdict, event.text, event.id], ['comment', 'report', 'comment-report', 'found:0', report.sections[0].items[0].title, 'disagree', text, saved.id]);
    assert.notEqual(run('wait', board, '--filer', 'agent-41', '--events', '--timeout', '1').status, 0, 'a taken comment does not wake the next wait');
    const board1 = await (await fetch(url + 'api/decisions')).json();
    assert.ok(board1.comments[0].read && !board1.comments[0].reply, 'the board shows Agent read it');
    // The reply goes through deeper, only for the filer who owns the report.
    assert.notEqual(run('deeper', board, '--filer', 'someone-else', '--id', saved.id, '--text', 'Not mine').status, 0);
    assert.equal(run('deeper', board, '--filer', 'agent-41', '--id', saved.id, '--text', 'It still hung at 30 s.').status, 0);
    assert.equal((await (await fetch(url + 'api/decisions')).json()).comments[0].reply, 'It still hung at 30 s.');
    // A comment is not an answer: nothing went to answers or rounds. It goes to the page's author, so an answers-only board takes it too.
    assert.deepEqual(JSON.parse(run('answers', board, '--json').stdout), {});
    writeFileSync(board, JSON.stringify({ ...JSON.parse(readFileSync(board, 'utf8')), answers_only: true }));
    const fed = await send({ key: 'comment-report', part: 'found:0', verdict: 'agree' });
    assert.equal(fed.status, 200);
    assert.deepEqual((await fed.json()).comments.map((c) => c.verdict), ['disagree', 'agree']);
  } finally { server.kill(); }
});

test('standalone owner registration preserves queued failures and separates delivery from owner acknowledgement', async () => {
  const dir = join(scratch, 'owners'), board = join(dir, 'board.json'), bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true }); symlinkSync(process.execPath, join(bin, 'node'));
  const env = { ...process.env, SIGN_OFF_HOME: dir, HOME: join(dir, 'home'), PATH: bin };
  delete env.SIGN_OFF_FILER; delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_OWNER_SESSION;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  const item = { ...JSON.parse(readFileSync(join(fixtures, 'plan.v2/valid-full.json'))), filer: 'umer', key: 'owner-plan' };
  assert.equal(spawnSync(process.execPath, [cli, 'post', board, '--kind', 'plan', '--from', '-'], { env, encoding: 'utf8', input: JSON.stringify(item) }).status, 0);
  const session = '3e26877a-e588-4313-a26e-7543f9847910';
  assert.equal(run('owner', board, '--filer', 'umer', '--host', 'shell', '--session', session, '--cwd', dir).status, 2);
  assert.equal(run('owner', board, '--filer', 'umer', '--host', 'claude', '--session', session, '--cwd', dir).status, 0);
  const server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env });
  try {
    const url = await new Promise(ok => server.stdout.once('data', b => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const response = await fetch(url + 'api/deeper', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: item.key, part: 'this' }) });
    const id = (await response.json()).deeper[0].id;
    assert.deepEqual(JSON.parse(run('owner', board, '--dispatch', '--filer', 'other').stdout).delivery, {});
    for (let restart = 0; restart < 2; restart++) {
      const state = JSON.parse(run('owner', board, '--dispatch').stdout).delivery[id];
      assert.equal(state.state, 'queued'); assert.match(state.error, /ENOENT/);
      assert.equal(JSON.parse(run('deeper', board, '--json').stdout).deeper[0].read, undefined);
    }
    assert.equal(run('owner', board, '--ack', id).status, 2);
    assert.equal(run('deeper', board, '--filer', 'other', '--id', id, '--text', 'wrong').status, 2);
    env.SIGN_OFF_OWNER_SESSION = session;
    assert.equal(run('deeper', board, '--id', id, '--text', 'too early').status, 2);
    assert.equal(run('owner', board, '--ack', id).status, 0);
    assert.equal(JSON.parse(run('owner', board).stdout).delivery[id].state, 'owner-read');
    for (let retry = 0; retry < 2; retry++) assert.equal(run('deeper', board, '--id', id, '--text', 'Umer gets one answer.').status, 0);
    const ask = JSON.parse(run('deeper', board, '--json', '--all').stdout).deeper[0];
    assert.equal(ask.text, 'Umer gets one answer.'); assert.equal(ask.done, true);
    assert.equal(run('owner', board, '--dispatch').status, 0);
  } finally { await new Promise(ok => server.once('close', ok).kill()); }
});

test('installed standalone Claude owner authors, idles and resumes to finish only its own Go deeper request', { skip: !process.env.SIGN_OFF_LIVE_OWNER, timeout: 240000 }, async () => {
  const dir = join(scratch, 'installed-owner'); mkdirSync(dir); mkdirSync(join(dir, 'tmp'));
  const evidence = process.env.SIGN_OFF_LIVE_OWNER;
  const env = { ...process.env, TMPDIR: join(dir, 'tmp'), SIGN_OFF_HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') };
  delete env.SIGN_OFF_FILER; delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_OWNER_SESSION;
  const exec = (bin, args, extra = {}) => {
    const r = spawnSync(bin, args, { cwd: dir, env, encoding: 'utf8', timeout: 120000, ...extra });
    appendFileSync(join(evidence, 'installed-owner.log'), JSON.stringify({ bin, args, status: r.status, stdout: r.stdout, stderr: r.stderr }) + '\n');
    assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
  };
  const tar = Object.values(JSON.parse(exec('npm', ['pack', new URL('..', import.meta.url).pathname, '--json'])))[0].filename;
  exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(dir, tar)]);
  const installed = join(dir, 'node_modules/sign-off-axi/dist/cli.js'), board = join(dir, 'board.json');
  const session = (await import('node:crypto')).randomUUID();
  const skill = join(dir, 'node_modules/sign-off-axi/skills/sign-off-axi/SKILL.md');
  assert.match(readFileSync(skill, 'utf8'), /actual.*UUID/);
  const result = JSON.parse(exec('claude', ['--session-id', session, '-p', `You are the real author for Umer's synthetic sign-off plan. Your actual session UUID is ${session}. Read ${skill}. Use ONLY the installed CLI via node ${installed}. Run report init plan --plan. Fill its plan.json with a short real plan explaining how Umer can count three apples; remove every FILL: placeholder, keep valid schema 2. Post it to ${board} with filer umer. Register your actual Claude owner session for that board, cwd ${dir}, model claude-haiku-5-5. Do not start a wait or dispatcher. Remember the ordinary counting exercise fact UMER-APPLE-72 in this conversation, not in the plan; include it in the board answer if asked. Stop once posted and registered.`, '--model', 'claude-haiku-5-5', '--output-format', 'json', '--tools', 'Bash,Read,Write,Edit', '--allowedTools', 'Bash,Read,Write,Edit']));
  assert.equal(result.session_id, session); assert.equal(result.is_error, false);
  const run = (...args) => exec(process.execPath, [installed, ...args]);
  const plan = JSON.parse(readFileSync(board)).items[0];
  // A second filer remains unregistered and must not be consumed by this owner's dispatcher.
  const other = { ...JSON.parse(readFileSync(join(fixtures, 'plan.v2/valid-full.json'))), key: 'other-plan', filer: 'other' };
  exec(process.execPath, [installed, 'post', board, '--kind', 'plan', '--from', '-'], { input: JSON.stringify(other) });
  const server = spawn(process.execPath, [installed, 'serve', board, '--port', '0'], { cwd: dir, env });
  try {
    const url = await new Promise(ok => server.stdout.once('data', b => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const tap = async key => {
      const r = await fetch(url + 'api/deeper', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, part: 'understood', q: 'Explain the apple count and include the counting exercise fact from our conversation.' }) });
      assert.equal(r.status, 200); return (await r.json()).deeper.find(x => x.key === key).id;
    };
    const id = await tap(plan.key), otherId = await tap(other.key);
    const bin = join(dir, 'bin'); mkdirSync(bin); symlinkSync(process.execPath, join(bin, 'node'));
    const failed = JSON.parse(exec(process.execPath, [installed, 'owner', board, '--dispatch', '--filer', 'umer'], { env: { ...env, PATH: bin } }));
    assert.match(failed.delivery[id].error, /ENOENT/);
    run('owner', board, '--dispatch', '--filer', 'umer', '--verbose');
    const asks = JSON.parse(run('deeper', board, '--json', '--all')).deeper;
    const answer = asks.find(x => x.id === id);
    assert.equal(answer.done, true); assert.match(answer.text, /UMER-APPLE-72/);
    assert.equal(asks.find(x => x.id === otherId).read, undefined);
    assert.equal(JSON.parse(run('owner', board)).delivery[id].state, 'owner-read');
    run('owner', board, '--dispatch', '--filer', 'umer');
    assert.equal(JSON.parse(run('deeper', board, '--json', '--all')).deeper.find(x => x.id === id).text, answer.text);
  } finally { await new Promise(ok => server.once('close', ok).kill()); }
});

test('post --kind evidence: a key the feed dropped after it was answered cannot be posted again, so no stale verdict re-attaches', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const dir = mkdtempSync(join(scratch, 'orphan-evidence-')), board = join(dir, 'board.json');
  const cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  const shot = readFileSync(join(fixtures, 'evidence.v1', 'shot.png'));
  writeFileSync(join(dir, 'one.png'), shot);
  writeFileSync(join(dir, 'two.png'), Buffer.concat([shot, Buffer.from('\n')]));
  const evidence = (name, media) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, key: 'signin-phone-2', title: 'Sign-in screen, second pass', about: 'Umer checks the new layout.', media: [media] }));
    return path;
  };
  const first = cli2('post', board, '--kind', 'evidence', '--from', evidence('first.json', 'one.png'));
  assert.equal(first.status, 0, first.stdout);
  const [item] = JSON.parse(readFileSync(board, 'utf8')).items;
  assert.deepEqual([item.key, item.media.length], ['signin-phone-2', 1]);
  appendFileSync(join(dir, 'board.answers.jsonl'), `${JSON.stringify({ key: 'signin-phone-2', answer: 'fail', label: 'Fail', close: 'done', at: '2026-10-13T08:00:00Z' })}\n`);
  assert.equal(cli2('post', board, '--from', message('orphan-evidence-dropped.json', JSON.stringify({ schema: 2, items: [] })), '--replace').status, 0);
  const gone = readFileSync(board, 'utf8');
  // The same key with different media cannot come back through the evidence path the --replace refusal points at.
  const back = cli2('post', board, '--kind', 'evidence', '--from', evidence('second.json', 'two.png'));
  assert.equal(back.status, 2, back.stdout);
  assert.match(back.stdout, /key signin-phone-2 was answered[^]*Post it under a new key/);
  assert.equal(readFileSync(board, 'utf8'), gone);
});

test('post --replace: a board-shaped evidence item with malformed media is refused with a fix line, never a crash', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const dir = mkdtempSync(join(scratch, 'media-shape-')), board = join(dir, 'board.json');
  const cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  const write = (name, body) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(body));
    return path;
  };
  writeFileSync(join(dir, 'shot.png'), readFileSync(join(fixtures, 'evidence.v1', 'shot.png')));
  const stored = () => JSON.parse(readFileSync(board, 'utf8')).items[0];
  assert.equal(cli2('post', board, '--kind', 'evidence', '--from', write('first.json', { contract: 1, kind: 'evidence', schema: 1, key: 'signin-phone-2', title: 'Sign-in screen, second pass', about: 'Umer checks the new layout.', media: ['shot.png'] })).status, 0);
  const before = readFileSync(board, 'utf8');
  for (const [media, error] of [['nope', /media must list 1 to 12 files/], [[null], /media\[0\] must be text/], [{ length: 3 }, /media must list 1 to 12 files/]]) {
    const refused = cli2('post', board, '--from', write('feed.json', { schema: 2, items: [{ ...stored(), media }] }), '--replace');
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.doesNotMatch(refused.stdout + refused.stderr, /TypeError|is not a function/);
    assert.match(refused.stdout, error);
    assert.equal(readFileSync(board, 'utf8'), before);
  }
  // The stored item is read back as a message too: a board whose own evidence media is malformed is refused, not crashed on.
  const doc = JSON.parse(before);
  doc.items[0].media = 'nope';
  writeFileSync(board, JSON.stringify(doc));
  const bare = cli2('post', board, '--from', write('bare.json', { schema: 2, items: [{ contract: 1, kind: 'evidence', schema: 1, type: 'evidence', key: 'signin-phone-2', title: 'T', about: 'A' }] }), '--replace');
  assert.equal(bare.status, 2, bare.stdout + bare.stderr);
  assert.doesNotMatch(bare.stdout + bare.stderr, /TypeError|is not a function/);
});

test('post --kind evidence: the same filer posting a key again replaces the first card and writes no dismissal', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const dir = mkdtempSync(join(scratch, 'repost-')), board = join(dir, 'board.json'), msg = join(dir, 'msg.json');
  copyFileSync(join(fixtures, 'evidence.v1', 'shot.png'), join(dir, 'shot.png'));
  const valid = JSON.parse(readFileSync(join(fixtures, 'evidence.v1', 'valid-media.json'), 'utf8'));
  const post = (title, filer) => (writeFileSync(msg, JSON.stringify({ ...valid, title })), spawnSync('node', [cli, 'post', board, '--kind', 'evidence', '--from', msg, '--filer', filer], { encoding: 'utf8', env }));
  const items = () => JSON.parse(readFileSync(board, 'utf8')).items, key = valid.key;
  assert.equal(post('First take', 'agent-41').status, 0);
  const second = post('Second take', 'agent-41');
  assert.equal(second.status, 0, second.stdout);
  assert.deepEqual(items().filter((i) => i.key === key).map((i) => i.title), ['Second take']);
  assert.equal(existsSync(join(dir, 'board.dismissed.jsonl')), false, 'a repost wrote a dismissal line');
  const listed = spawnSync('node', [cli, 'list', board, '--full'], { encoding: 'utf8', env }).stdout;
  assert.match(listed, new RegExp(`${key},shown,`));
  assert.equal(post('Other take', 'agent-9').status, 2, 'another filer cannot replace the card');
  assert.deepEqual(items().map((i) => i.title), ['Second take']);
});

test('post --kind evidence: media copied and hashed from the message folder, a run kept as the update\'s evidence, never in a --from file', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'ev', 'board.json'), post = (input, ...args) => spawnSync('node', [cli, 'post', board, ...args], { encoding: 'utf8', env, input });
  const file = join(fixtures, 'evidence.v1', 'valid-media.json'), items = () => JSON.parse(readFileSync(board, 'utf8')).items;
  assert.match(post('', '--kind', 'evidence', '--from', file, '--filer', 'agent-41').stdout, /signin-phone-2,1,1,"Sign-in screen, second pass",posted/);
  assert.deepEqual(readFileSync(join(scratch, 'ev', 'evidence', '1', '1.png')), readFileSync(join(fixtures, 'evidence.v1', 'shot.png')));
  assert.equal(items()[0].media[0].bytes, readFileSync(join(fixtures, 'evidence.v1', 'shot.png')).length);
  assert.match(post('', '--kind', 'evidence', '--from', file, '--filer', 'agent-41').stdout, /signin-phone-2,1,1,[^\n]*already posted/);
  const other = post('', '--kind', 'evidence', '--from', file, '--filer', 'agent-9');
  assert.equal(other.status, 2, other.stdout);
  assert.match(other.stdout, /key signin-phone-2 already holds a different message[^]*Post it under a new key/);
  // No key: the next update number; a run with no media is stored as the update's evidence field.
  const ran = post(readFileSync(join(fixtures, 'evidence.v1', 'valid-run.json')), '--kind', 'evidence', '--from', '-');
  assert.match(ran.stdout, /update-2,2,0,Sign-in screen on a phone,posted/);
  const [, update] = items();
  assert.deepEqual([update.type, update.kind, update.media, update.evidence.commit, update.run], ['evidence', 'evidence', undefined, '0123456789abcdef0123456789abcdef01234567', undefined]);
  assert.equal(spawnSync('node', [cli, ...asked(['raise', board, '--title', 'Plain?', '--key', 'plain'])], { encoding: 'utf8', env }).status, 0);
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
  const board = join(scratch, 'gate.json'), cli2 = (input, ...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env, input });
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

test('post --kind finding: a retro proposal waits like an ask, a changed proposal is another message, and its answer is apply or skip', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'finding.json'), cli2 = (input, ...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env, input });
  const posted = cli2(JSON.stringify(finding), 'post', board, '--kind', 'finding', '--from', '-');
  assert.equal(posted.status, 0, posted.stdout);
  assert.match(posted.stdout, /lfm-missing-env,raised,[^]*wait .*--filer learn-from-mistakes/);
  assert.match(cli2(JSON.stringify(finding), 'post', board, '--kind', 'finding', '--from', '-').stdout, /lfm-missing-env,already waiting,/);
  const before = readFileSync(board, 'utf8'), [item] = JSON.parse(before).items;
  assert.deepEqual([item.kind, item.proposal, item.evidence_ids], ['finding', finding.proposal, finding.evidence_ids]);
  // Another proposal or count under the key is another message, from a post or a feed: exit 2, nothing written.
  const changed = { ...finding, proposal: 'Fail fast when the env var is missing.' };
  const feed = message('finding-feed.json', JSON.stringify({ schema: 2, items: [changed] }));
  for (const args of [['post', board, '--kind', 'finding', '--from', '-'], ['raise', board, '--from', feed], ['post', board, '--from', message('finding-count.json', JSON.stringify({ schema: 2, items: [{ ...finding, incidents: 5 }] }))]]) {
    const refused = cli2(JSON.stringify(changed), ...args);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, /key lfm-missing-env already holds a different message[^]*Post it under a new key/);
  }
  assert.equal(readFileSync(board, 'utf8'), before);
  appendFileSync(join(scratch, 'finding.answers.jsonl'), `${JSON.stringify({ key: finding.key, answer: 'apply', label: 'Apply', close: 'done', at: '2026-10-13T08:00:00Z' })}\n`);
  const waited = cli2('', 'wait', board, '--filer', 'learn-from-mistakes', '--json', '--timeout', '5');
  assert.equal(waited.status, 0, waited.stdout);
  assert.equal(JSON.parse(waited.stdout)[finding.key].answer, 'apply');
  // An answered finding keeps the proposal it was answered for, in a --replace feed too, and once dropped it cannot come back.
  const swap = cli2('', 'post', board, '--from', feed, '--replace');
  assert.equal(swap.status, 1, swap.stdout);
  assert.match(swap.stdout, /was answered and now holds a different question/);
  assert.equal(cli2('', 'post', board, '--from', message('finding-dropped.json', JSON.stringify({ schema: 2, items: [] })), '--replace').status, 0);
  const gone = readFileSync(board, 'utf8'), back = cli2('', 'post', board, '--from', feed, '--replace');
  assert.equal(back.status, 1, back.stdout);
  assert.match(back.stdout, /key lfm-missing-env was answered[^]*Post it under a new key/);
  // Outside --replace the saved answer refuses it too, as a contract refusal: exit 2.
  const again = cli2('', 'raise', board, '--from', message('finding-again.json', JSON.stringify({ schema: 2, items: [finding] })));
  assert.equal(again.status, 2, again.stdout);
  assert.match(again.stdout, /key lfm-missing-env already has a saved answer[^]*Post it under a new key/);
  assert.equal(readFileSync(board, 'utf8'), gone);
});

test('post --kind evidence: an answered update keeps the media and run it was answered for, in a --replace feed too', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'evidence-replace.json'), cli2 = (input, ...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env, input });
  const dir = mkdtempSync(join(scratch, 'evmsg-'));
  writeFileSync(join(dir, 'shot.png'), readFileSync(join(fixtures, 'evidence.v1', 'shot.png')));
  const run = { run_id: '20261011T120000Z-a1b2c3d4', commit: '0123456789abcdef0123456789abcdef01234567',
    outcome: 'Umer can see the new screen.', repro: 'repro: n/a: no bug', proof: 'done-done: real browser journey', evidence: 'shot.png' };
  writeFileSync(join(dir, 'k1.json'), JSON.stringify({ contract: 1, kind: 'evidence', schema: 1, key: 'k1', title: 'Sign-in screen', about: 'First pass.', media: ['shot.png'], run }));
  const posted = cli2('', 'post', board, '--kind', 'evidence', '--from', join(dir, 'k1.json'));
  assert.equal(posted.status, 0, posted.stdout);
  assert.match(posted.stdout, /k1,1,1,Sign-in screen,posted/);
  appendFileSync(join(scratch, 'evidence-replace.answers.jsonl'), `${JSON.stringify({ key: 'k1', answer: 'fail', label: 'Fail', close: 'done', at: '2026-10-13T08:00:00Z' })}\n`);
  const before = readFileSync(board, 'utf8');
  const feed = (name, change) => {
    const [item] = JSON.parse(before).items;
    return message(name, JSON.stringify({ schema: 2, items: [change(item)] }));
  };
  // Other media under the key is another question in a --replace feed too: exit 1, nothing written.
  const swapped = feed('ev-media.json', (item) => ({ ...item, media: [{ ...item.media[0], sha256: '0'.repeat(64), bytes: item.media[0].bytes + 1 }] }));
  const media = cli2('', 'post', board, '--from', swapped, '--replace');
  assert.equal(media.status, 1, media.stdout);
  assert.match(media.stdout, /was answered and now holds a different question[^]*Post the new question under a new key/);
  assert.equal(readFileSync(board, 'utf8'), before);
  // Another run under the key is refused the same way.
  const rerun = feed('ev-run.json', (item) => ({ ...item, evidence: { ...item.evidence, run_id: '20261012T120000Z-d4c3b2a1' } }));
  const reran = cli2('', 'post', board, '--from', rerun, '--replace');
  assert.equal(reran.status, 1, reran.stdout);
  assert.match(reran.stdout, /was answered and now holds a different question[^]*Post the new question under a new key/);
  assert.equal(readFileSync(board, 'utf8'), before);
  // The unchanged feed still resyncs, and asking about the key still returns the saved verdict.
  assert.equal(cli2('', 'post', board, '--from', message('ev-same.json', before), '--replace').status, 0);
  const read = cli2('', 'answers', board, '--key', 'k1');
  assert.equal(read.status, 0, read.stdout);
  assert.match(read.stdout, /k1,fail/);
});

test('wait --events: one line per answer and per another-round ask, with the item kind and schema; a board-format item reports as ask', async () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const board = join(scratch, 'events.json'), cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  assert.equal(spawnSync('node', [cli, 'post', board, '--kind', 'gate', '--from', '-'], { encoding: 'utf8', env, input: JSON.stringify(gate) }).status, 0);
  // A board-format item, even one with a type of its own, reports as ask schema 1.
  assert.equal(cli2('post', board, '--type', 'design', '--key', 'plain', '--title', 'Plain?', '--option', 'a=A', '--option', 'b=B', '--recommend', 'a', '--filer', 'done-done').status, 0);
  assert.equal(cli2('raise', board, '--key', 'later', '--title', 'Later?', '--filer', 'done-done').status, 0);
  const save = (name, line) => appendFileSync(join(scratch, `events.${name}.jsonl`), `${JSON.stringify(line)}\n`);
  save('answers', { key: gate.key, answer: 'fix', label: 'Fix first', close: 'done', at: '2026-10-13T08:01:00Z', note: 'Umer: the judge first.' });
  save('answers', { key: 'plain', answer: 'a', label: 'A', close: 'done', at: '2026-10-13T08:00:00Z' });
  const head = { contract: 1, kind: 'gate', schema: 1, key: gate.key, title: gate.title };
  const took = cli2('wait', board, '--filer', 'done-done', '--events', '--timeout', '5');
  assert.equal(took.status, 0, took.stdout);
  assert.deepEqual(took.stdout.trim().split('\n').map((l) => JSON.parse(l)), [
    { event: 'answer', contract: 1, kind: 'ask', schema: 1, key: 'plain', title: 'Plain?', answer: 'a', label: 'A', close: 'done', at: '2026-10-13T08:00:00Z', filer: 'done-done' },
    { event: 'answer', ...head, answer: 'fix', label: 'Fix first', close: 'done', at: '2026-10-13T08:01:00Z', note: 'Umer: the judge first.', filer: 'done-done' }]);
  // A round asked while the filer waits wakes it as a round line; the answers it took already stay taken.
  const waiting = spawn('node', [cli, 'wait', board, '--filer', 'done-done', '--events', '--timeout', '10'], { env });
  let out = '';
  waiting.stdout.on('data', (b) => (out += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 700));
  save('rounds', { key: gate.key, note: 'Show it on a phone first.', at: '2026-10-13T08:05:00Z' });
  assert.equal(await exited, 0, out);
  assert.deepEqual(out.trim().split('\n').map((l) => JSON.parse(l)), [{ event: 'round', ...head, note: 'Show it on a phone first.', at: '2026-10-13T08:05:00Z', filer: 'done-done' }]);
  const both = cli2('wait', board, '--filer', 'done-done', '--events', '--json');
  assert.equal(both.status, 2, both.stdout);
  assert.match(both.stdout, /--events prints event lines, so it does not take --json/);
  // --events prints a filer's events, so a wait without one is refused.
  const noFiler = cli2('wait', board, '--events');
  assert.equal(noFiler.status, 2, noFiler.stdout);
  assert.match(noFiler.stdout, /needs --filer/);
});

// Every guard fed bad input: each one refuses with a reason and one fix line, so a caller can tell a refusal from a crash, and real
// evidence is never false-failed. A file that is not there is the case that used to come back as a bare `ENOENT` failure.
test('every guard refuses bad input with a reason and one fix line, and never false-fails real evidence', () => {
  const env = { ...process.env, HOME: join(scratch, 'guards-home') };
  delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_FILER;
  const dir = mkdtempSync(join(scratch, 'guards-')), board = join(dir, '.sign-off', 'decisions.json');
  const cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', cwd: dir, env, input: '' });
  const at = (name) => join(dir, name);
  assert.equal(cli2('init', dir).status, 0);
  writeFileSync(at('shot.png'), readFileSync(join(fixtures, 'evidence.v1', 'shot.png')));
  writeFileSync(at('ask.json'), JSON.stringify({ ...ask, key: 'k', title: 'Ship it?' }));
  writeFileSync(at('bad.json'), '{"schema":2,');
  writeFileSync(at('not-utf8.json'), Buffer.from('{"contract":1,"kind":"ask","schema":1,"key":"k","title":"Caf\u00e9?"}', 'latin1'));
  mkdirSync(join(dir, '.sign-off', 'mocks', 'k'), { recursive: true });
  writeFileSync(join(dir, '.sign-off', 'mocks', 'k', 'a.html'), '<html>a</html>');
  const absent = at('missing.json');

  // [args, exit code, the reason it must give, the fix line it must give]
  const cases = [
    // Board files: absent, malformed, unreadable, unparsable.
    [['list', at('missing-board.json')], 0, null, null],
    [['wait', at('missing-board.json'), '--timeout', '1'], 1, /no board yet/, /raise/],
    [['list', at('bad.json')], 2, /invalid JSON/, /file-format|help/],
    [['raise', at('bad.json'), '--title', 'T?'], 2, /invalid JSON/, /file format/],
    [['list', dir], 2, /is a folder, not a file/, /file format/],
    // Flag and type guards.
    [['raise', board, '--title', 'T?', '--port', '99999'], 2, /unknown flag --port for `raise`/, /valid flags/],
    [['raise', board, '--title', 'T?', '--filer', 'bad id!'], 2, /--filer bad id! must be 1-128/, /session id/],
    [['raise', board, '--title', 'T?', '--option', 'noequals', '--recommend', 'noequals'], 2, /--option noequals must be <value>=<label>/, /--recommend/],
    [['raise', board, '--title', 'T?', '--why', 'Why.', '--option', 'a=A', '--option', 'b=B', '--outcome', 'a=A goes.', '--outcome', 'b=B goes.'], 2, /--recommend is required/, /one of a, b/],
    [['raise', board, '--title', 'T?', 'extra'], 2, /unexpected argument extra/, /--help/],
    [['frobnicate'], 2, /Unknown command: frobnicate/, /--help/],
    [['wait', board, '--timeout', '1.5'], 2, /--timeout must be whole seconds/, /wait --help/],
    [['wait', board, '--filer', 'x', '--json', '--events'], 2, /does not take --json/, /--events/],
    [['wait', board, '--events'], 2, /needs --filer/, /--events/],
    // post: the type, view, mock and media guards.
    [['post', board, '--type', 'nope', '--title', 'T?'], 2, /--type must be decision, design, evidence, diagram, interactive, explainer, report or signin/, /post --help/],
    [['post', board, '--type', 'decision', '--title', 'T?', '--media', 'shot.png'], 2, /--media, --attach, --link and --chapter need --type evidence or explainer/, /post --help/],
    [['post', board, '--type', 'diagram', '--title', 'T?'], 2, /--type diagram needs --view <path>/, /post --help/],
    [['post', board, '--type', 'decision', '--title', 'T?', '--view', 'x.svg'], 2, /--view needs --type diagram or interactive/, /post --help/],
    [['post', board, '--type', 'diagram', '--title', 'T?', '--view', '../escape.svg'], 2, /escapes the board folder/, /next to the board file/],
    [['post', board, '--type', 'diagram', '--title', 'T?', '--view', 'mocks/k/gone.svg'], 1, /is not a file/, /relative to the board file's folder/],
    [['post', board, '--type', 'design', '--title', 'T?', '--option', 'a=A', '--option', 'b=B', '--mock', 'a=mocks/k/a.txt', '--recommend', 'a'], 2, /--mock .* must end in/, /Name the mock file itself/],
    [['post', board, '--type', 'design', '--title', 'T?', '--option', 'a=A', '--option', 'b=B', '--mock', 'a=../escape.html', '--recommend', 'a'], 2, /escapes the board folder/, /next to the board file/],
    [['post', board, '--type', 'design', '--title', 'T?', '--option', 'a=A', '--option', 'b=B', '--mock', 'a=mocks/k/a.html', '--link', 'b=https://example.com/b', '--recommend', 'a'], 2, /--link b=https:\/\/example\.com\/b must be <value>=<url> with a --mock/, /--link a=https/],
    [['post', board, '--type', 'design', '--title', 'T?', '--option', 'a=A', '--option', 'b=B', '--mock', 'a=mocks/k/a.html', '--link', 'a=javascript:alert(1)', '--recommend', 'a'], 2, /a link must be an http\(s\) link/, /post --help/],
    [['post', board, '--type', 'evidence', '--title', 'T?', '--about', 'x', '--media', 'gone.png'], 1, /gone\.png is not there/, /Name a file that is there/],
    [['post', board, '--type', 'evidence', '--title', 'T?', '--about', 'x', '--media', 'notes.txt'], 2, /must end in \.png, \.jpg/, /media shot\.png/],
    [['post', board, '--type', 'evidence', '--title', 'T?', '--about', 'x'], 2, /needs 1 to 12 --media files/, /--media shot\.png/],
    [['post', board, '--type', 'explainer', '--title', 'T?', '--about', 'x', '--media', 'shot.png', '--media', 'shot.png'], 2, /needs one --media video/, /explainer\.mp4/],
    [['post', board, '--type', 'explainer', '--title', 'T?', '--about', 'x', '--media', 'shot.png', '--chapter', 'bogus'], 2, /--chapter bogus must be <m:ss>=<title>/, /0:00=Start/],
    [['post', board, '--replace'], 2, /--replace needs --from/, /--replace/],
    [['post', board, '--kind', 'ask'], 2, /--kind needs --from/, /--from ask\.json/],
    [['post', board, '--kind', 'nope', '--from', at('ask.json')], 2, /--kind must be one of/, /--kind ask/],
    [['export', board, '--out', 'board.txt'], 2, /does not end in \.html/, /--out <file\.html>/],
    [['init', dir, '--agent', 'nobody'], 2, /unknown agent nobody/, /one or more of claude-code/],
    // open/serve: the port, bind and evidence-root guards.
    [['open', board, '--port', '99999'], 2, /--port must be a number from 0 to 65535/, /Pass a free port/],
    [['open', board, '--bind', '0.0.0.0'], 2, /never all interfaces or a public address/, /127\.0\.0\.1 or a private address/],
    [['open', board, '--evidence-root', at('missing')], 2, /--evidence-root .* is not a folder/, /holds \.done-done\//],
    // A message file that is not there, on every path that reads one: a refusal that says so, never a bare ENOENT failure.
    [['validate', absent], 1, /is not there/, /Check the path names a readable file/],
    [['validate', at('bad.json')], 2, /invalid JSON/, /Write the message as one JSON object/],
    [['validate', at('not-utf8.json')], 2, /is not UTF-8 text/, /Save the message as UTF-8/],
    [['post', board, '--kind', 'ask', '--from', absent], 1, /is not there/, /Check the path names a readable file/],
    [['post', board, '--from', absent], 2, /is not there/, /file format/],
    [['raise', board, '--from', absent], 2, /is not there/, /file format/],
    [['post', board, '--replace', '--from', absent], 2, /is not there/, /file format/],
    [['post', board, '--kind', 'ask', '--from', '-'], 2, /invalid JSON/, /one JSON object/],
  ];
  for (const [args, code, error, help] of cases) {
    const run = cli2(...args), what = args.join(' ');
    assert.equal(run.status, code, `${what} -> ${run.status}\n${run.stdout}`);
    if (code === 0) continue;
    assert.match(run.stdout, error, `reason: ${what}`);
    assert.match(run.stdout, help, `fix: ${what}`);
    // validate answers with a per-file row (`files[N]` plus its own error and help columns) instead of an error envelope.
    if (args[0] === 'validate') {
      assert.match(run.stdout, /^files\[\d+\]\{file,kind,schema,ok,error,help\}:$/m, `a row per file: ${what}`);
      assert.match(run.stdout, /,false,/, `the row is refused, not skipped: ${what}`);
      continue;
    }
    assert.match(run.stdout, /^error: /m, `names the failure: ${what}`);
    assert.match(run.stdout, /^code: \w+/m, `carries a code: ${what}`);
    assert.match(run.stdout, /^help\[/m, `prints a fix line: ${what}\n${run.stdout}`);
    // The old failure shape: the whole reason was the system's code, with nothing a person could act on.
    assert.doesNotMatch(run.stdout, /^error: "?[^"]*:\s*ENOENT"?$/m, `a missing file is a reason, not a bare ENOENT: ${what}`);
  }
  // A file that is not there refuses its own row and leaves the other files alone; a real message still passes.
  const mixed = cli2('validate', at('ask.json'), absent);
  assert.equal(mixed.status, 1, mixed.stdout);
  assert.deepEqual(decode(mixed.stdout.split('\nhelp[')[0]).files.map((f) => f.ok), [true, false]);
  assert.equal(cli2('validate', at('ask.json')).status, 0, 'a real ask still passes');
  assert.equal(cli2('validate', at('shot.png')).status, 2, 'a picture is refused as a message, not read as a crash');
  // Real evidence on the same board: post and read back never false-fail.
  const posted = cli2('post', board, '--type', 'evidence', '--title', 'Sign-in screen', '--about', 'Umer signs in.', '--media', at('shot.png'));
  assert.equal(posted.status, 0, posted.stdout);
  assert.match(posted.stdout, /update-1,1,1/);
});

test('a card carries a priority and a project its own icon: every post takes --priority, project --icon pins a picture inside the board folder, and the board serves only that file', async () => {
  const dir = join(scratch, 'priority-icon'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'priority-home'), SIGN_OFF_FILER: 'umer-agent' };
  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  mkdirSync(join(dir, 'icons'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(dir, 'icons', 'beacon.png'), png);
  copyFileSync(join(fixtures, 'evidence.v1', 'shot.png'), join(dir, 'shot.png'));
  const asked = ['--why', 'It is ready.', '--outcome', 'yes=It ships.', '--outcome', 'no=It waits.', '--recommend', 'yes', '--recommend-reason', 'Tests pass.', '--default', 'no', '--ask-ref', 'message-example'];

  // Every way a card gets in takes --priority, or "priority" in its message or --from item; a card with none has none.
  for (const args of [['raise', board, '--priority', 'P0', '--key', 'urgent', '--title', 'Ship the settings page on Friday?', ...asked],
    ['raise', board, '--key', 'plain', '--title', 'Move the theme switch to the top?', ...asked],
    ['post', board, '--type', 'evidence', '--priority', 'P2', '--title', 'Settings on a phone', '--about', 'Umer changes the theme in one tap.', '--media', join(dir, 'shot.png')],
    ['post', board, '--kind', 'ask', '--from', message('priority-ask.json', JSON.stringify({ ...ask, key: 'from-message', title: 'Keep the weekly digest going?', priority: 'P3' }))],
    ['post', board, '--kind', 'ask', '--from', message('flag-ask.json', JSON.stringify({ ...ask, key: 'from-flag', title: 'Send the digest on Mondays?' })), '--priority', 'P1']]) {
    const r = run(...args);
    assert.equal(r.status, 0, args.join(' ') + r.stdout);
  }
  const stored = Object.fromEntries(JSON.parse(readFileSync(board, 'utf8')).items.map((i) => [i.key, i.priority]));
  assert.deepEqual(stored, { urgent: 'P0', plain: undefined, 'update-1': 'P2', 'from-message': 'P3', 'from-flag': 'P1' });
  // A priority outside P0-P3, or a message naming another than --priority, is refused with one fix line, and nothing is written.
  for (const [args, error] of [[['raise', board, '--priority', 'P4', '--key', 'p4', '--title', 'Ship the help page this week?', ...asked], /--priority P4 must be one of P0, P1, P2, P3/],
    [['raise', board, '--priority', 'high', '--key', 'high', '--title', 'Ship the help page next week?', ...asked], /--priority high must be one of/],
    [['post', board, '--kind', 'ask', '--from', message('other-priority.json', JSON.stringify({ ...ask, key: 'other', title: 'Ship the digest page now?', priority: 'P0' })), '--priority', 'P2'], /priority P0 is not --priority P2/],
    [['post', board, '--from', message('feed.json', JSON.stringify({ schema: 2, items: [] })), '--replace', '--priority', 'P1'], /--priority does not apply to --replace/]]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stdout, error);
  }
  assert.equal(JSON.parse(readFileSync(board, 'utf8')).items.length, 5);
  // A board file edited by hand is held to the same rule when it loads.
  const hand = join(dir, 'hand.json');
  writeFileSync(hand, JSON.stringify({ schema: 2, items: [{ key: 'k', title: 'Ship it?', priority: 'urgent' }] }));
  assert.match(run('list', hand).stdout, /priority must be P0 or P1 or P2 or P3/);

  // No project has an icon until one is set: the board then draws its initials.
  assert.match(run('project', board).stdout, /projects: 0 projects/);
  assert.equal(existsSync(join(dir, 'board.projects.jsonl')), false);
  // A picture in the board folder is pinned by its hash; the same write again changes nothing.
  const set = run('project', board, '--name', 'Beacon', '--icon', 'icons/beacon.png');
  assert.equal(set.status, 0, set.stdout);
  assert.match(set.stdout, /status: created/);
  assert.match(run('project', board, '--name', 'Beacon', '--icon', 'icons/beacon.png').stdout, /status: unchanged/);
  // Invalid icons are refused, and nothing is written: a path out of the folder, a link that leads out, a file that is not its type, a script, too big, missing.
  writeFileSync(join(scratch, 'outside.png'), png);
  symlinkSync(join(scratch, 'outside.png'), join(dir, 'icons', 'link.png'));
  writeFileSync(join(dir, 'icons', 'fake.png'), 'not a picture');
  writeFileSync(join(dir, 'icons', 'script.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(1)"><circle r="4"/></svg>');
  writeFileSync(join(dir, 'icons', 'big.png'), Buffer.concat([png, Buffer.alloc(500_001)]));
  for (const [icon, error] of [['../outside.png', /with no \.\./], [join(scratch, 'outside.png'), /from the board file's folder/], ['icons/link.png', /leads outside the board file's folder/],
    ['icons/fake.png', /is not a PNG picture/], ['icons/script.svg', /holds a script/], ['icons/big.png', /is over 500000 bytes/], ['icons/none.png', /is not a file in/], ['icons/beacon.gif', /must end in \.png/]]) {
    const r = run('project', board, '--name', 'Beacon', '--icon', icon);
    assert.equal(r.status, icon === 'icons/none.png' ? 1 : 2, icon);
    assert.match(r.stdout, error, icon);
  }
  assert.equal(readFileSync(join(dir, 'board.projects.jsonl'), 'utf8').trim().split('\n').length, 1);
  // An SVG with no script is a picture too; --clear-icon takes the icon away again.
  writeFileSync(join(dir, 'icons', 'tern.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>');
  assert.equal(run('project', board, '--name', 'Tern', '--icon', 'icons/tern.svg').status, 0);
  assert.equal(run('project', board, '--name', 'Old', '--icon', 'icons/tern.svg').status, 0);
  assert.match(run('project', board, '--name', 'old', '--clear-icon').stdout, /status: updated/);
  // A line another program wrote that breaks a rule, such as an icon path out of the folder, is skipped: the other projects still show.
  appendFileSync(join(dir, 'board.projects.jsonl'), `${JSON.stringify({ name: 'Escape', icon: { path: '../../outside.png', sha256: 'a'.repeat(64), bytes: 10 }, at: '2026-10-23T09:00:00Z' })}\n`);
  assert.deepEqual(JSON.parse(run('project', board, '--json').stdout).projects.map((p) => [p.name, p.icon?.path ?? '']), [['Beacon', 'icons/beacon.png'], ['Tern', 'icons/tern.svg'], ['old', '']]);

  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    const state = await (await fetch(`${url}api/decisions`)).json();
    assert.deepEqual(Object.fromEntries(state.decisions.map((d) => [d.key, d.priority])), stored);
    assert.deepEqual(state.projects.map((p) => p.name), ['Beacon', 'Tern', 'old']);
    // The board serves the pinned file, by project name in any case, as a picture that cannot run or sniff into anything else.
    const got = await fetch(`${url}api/project-icon?name=beacon`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.match(got.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);
    assert.equal((await fetch(`${url}api/project-icon?name=Tern`)).headers.get('content-type'), 'image/svg+xml');
    // No icon, no project, the skipped line, and a picture changed after it was set all answer 404: the page then draws the initials.
    for (const name of ['old', 'Nobody', 'Escape']) assert.equal((await fetch(`${url}api/project-icon?name=${name}`)).status, 404, name);
    writeFileSync(join(dir, 'icons', 'beacon.png'), Buffer.concat([png.subarray(0, -1), Buffer.from([0])]));
    assert.equal((await fetch(`${url}api/project-icon?name=Beacon`)).status, 404);
  } finally { proc.kill(); }
});

test('post --kind evidence: a concern card keeps its status and a caption for each capture, and refuses a status or captions that do not fit', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const dir = mkdtempSync(join(scratch, 'concern-')), board = join(dir, 'board.json');
  const cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  const write = (name, body) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(body));
    return path;
  };
  for (const n of ['before.png', 'after.png']) writeFileSync(join(dir, n), readFileSync(join(fixtures, 'evidence.v1', 'shot.png')));
  const card = { contract: 1, kind: 'evidence', schema: 1, key: 'concern-send', title: 'Comment Send answers at once', about: 'Send shows Sending, then Sent.', media: ['before.png', 'after.png'], status: 'Fixed', captions: ['Before, phone', 'After, phone'] };
  for (const [change, error] of [[{ status: 'Done' }, /status .*Done.* is not one of Fixed, In progress, Waiting on you/], [{ captions: ['Before'] }, /captions must list one caption for each file in .*media/], [{ captions: ['Before', 'x'.repeat(41)] }, /captions\[1\] is 41 characters, over 40/]]) {
    const refused = cli2('post', board, '--kind', 'evidence', '--from', write('bad.json', { ...card, ...change }));
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stdout, error);
  }
  const posted = cli2('post', board, '--kind', 'evidence', '--from', write('card.json', card));
  assert.equal(posted.status, 0, posted.stdout + posted.stderr);
  const item = JSON.parse(readFileSync(board, 'utf8')).items[0];
  assert.equal(item.status, 'Fixed');
  assert.deepEqual(item.captions, ['Before, phone', 'After, phone']);
  // The same message again adds nothing, and a card with neither field still posts as before.
  assert.match(cli2('post', board, '--kind', 'evidence', '--from', join(dir, 'card.json')).stdout, /already posted/);
  assert.equal(cli2('post', board, '--kind', 'evidence', '--from', write('plain.json', { ...card, key: 'concern-plain', status: undefined, captions: undefined })).status, 0);
});

test('post --kind evidence: a concern card with a status and no frame posts and keeps no media; with neither status nor proof it is refused', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const dir = mkdtempSync(join(scratch, 'pending-')), board = join(dir, 'board.json');
  const cli2 = (...args) => spawnSync('node', [cli, ...asked(args)], { encoding: 'utf8', env });
  const write = (name, body) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(body)); return path; };
  const card = { contract: 1, kind: 'evidence', schema: 1, key: 'concern-pending', title: 'The leash is not real yet', about: 'Frame pending: nothing is built yet.', status: 'In progress' };
  const { status: _s, ...bare } = card;
  assert.equal(cli2('post', board, '--kind', 'evidence', '--from', write('bare.json', bare)).status, 2);
  const posted = cli2('post', board, '--kind', 'evidence', '--from', write('card.json', card));
  assert.equal(posted.status, 0, posted.stdout + posted.stderr);
  const item = JSON.parse(readFileSync(board, 'utf8')).items[0];
  assert.equal(item.status, 'In progress');
  assert.equal(item.media, undefined);
});

test('report kind names the reports posted before every report had a kind: all lines checked first, who set it recorded, the report itself unchanged, a re-run changes nothing', () => {
  const dir = join(scratch, 'kinds'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'kinds-home') };
  mkdirSync(dir, { recursive: true });
  const { purpose: _purpose, project: _project, ...older } = JSON.parse(readFileSync(join(fixtures, 'report.v4/valid-full.json'))), old = { ...older, key: 'old-incident', title: 'Why messages were sent twice: a retro' };
  writeFileSync(board, JSON.stringify({ schema: 2, items: [old, { ...old, key: 'old-weekly', title: 'Where the digest stands' }, { ...old, key: 'has-kind', purpose: 'audit', project: 'Muxr' }, JSON.parse(readFileSync(join(fixtures, 'plan.v3/valid-full.json')))] }));
  const before = readFileSync(board, 'utf8'), run = (...args) => spawnSync('node', [cli, 'report', 'kind', ...args], { encoding: 'utf8', env });
  const replay = message('kinds.tsv', '# key\tkind\tproject\nold-incident\tincident\tMuxr\nold-weekly\tstatus\tFleet\n');
  for (const [args, error] of [[['old-incident', 'incident', '--project', 'Muxr'], /report kind needs --by/], [['old-incident', 'guess', '--project', 'Muxr', '--by', 'agent-41', '--board', board], /guess is not a report kind: use one of research, plan/],
    [['nope', 'status', '--project', 'Muxr', '--by', 'agent-41', '--board', board], /nope is not a report on/], [['--from', message('bad.tsv', 'old-incident\tincident\tMuxr\nold-weekly\tnone\tFleet\n'), '--by', 'agent-41', '--board', board], /bad\.tsv line 2: none is not a report kind/]]) {
    const refused = run(...args);
    assert.equal(refused.status, /is not a report on/.test(error.source) ? 1 : 2, refused.stdout);
    assert.match(refused.stdout, error);
  }
  assert.match(run('old-weekly', 'status', '--by', 'agent-41', '--board', board).stdout, /expected <key> <kind> <project>/);
  assert.equal(existsSync(join(dir, 'board.kinds.jsonl')), false, 'a bad line writes nothing');
  const set = run('--from', replay, '--by', 'agent-41', '--board', board);
  assert.equal(set.status, 0, set.stdout);
  assert.match(set.stdout, /changed: 2/);
  const lines = readFileSync(join(dir, 'board.kinds.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map(({ key, purpose, project, by }) => [key, purpose, project, by]), [['old-incident', 'incident', 'Muxr', 'agent-41'], ['old-weekly', 'status', 'Fleet', 'agent-41']]);
  assert.equal(readFileSync(board, 'utf8'), before, 'the report is not rewritten');
  assert.match(run('--from', replay, '--by', 'agent-41', '--board', board).stdout, /changed: 0[^]*unchanged: 2/);
  const stored = run('has-kind', 'status', '--project', 'Muxr', '--by', 'agent-41', '--board', board);
  assert.equal(stored.status, 2, stored.stdout);
  assert.match(stored.stdout, /has-kind already has its kind audit in the report itself/);
  assert.equal(run('plan-key', 'status', '--project', 'Muxr', '--by', 'agent-41', '--board', board).status, 1);
});

test('a page report is held to the board\'s look at its first post: its own palette or a card inside a card is refused, a report already on the board is not', () => {
  const env = { ...process.env, HOME: join(scratch, 'home') };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.SIGN_OFF_FILER;
  const dir = join(scratch, 'page-look'), board = join(dir, 'board.json'), page = join(dir, 'how', 'index.html');
  const cli2 = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
  assert.equal(cli2('report', 'init', join(dir, 'how'), '--page', '--purpose', 'other').status, 0);
  for (const f of ['index.html', 'preview.svg']) fill(join(dir, 'how', f));
  const flags = ['--type', 'report', '--purpose', 'other', '--project', 'Muxr', '--title', 'How sign-in works', '--about', 'Two steps now.', '--view', 'how/index.html', '--preview', 'how/preview.svg'];
  const scaffold = readFileSync(page, 'utf8');
  // The scaffold draws no colour of its own and no card in a card, so it posts as it is.
  const palette = scaffold.replace('</style>', '.x { color: #0066CC; background: #E6F1FC; border-color: #17702F; } </style>');
  const nested = scaffold.replace('</style>', '.pane { border: 1px solid; border-radius: 12px; } .tile { background: Canvas; border-radius: 1rem; } </style>').replace('<main>', '<main><div class="pane"><div class="tile"></div></div>');
  for (const [html, error] of [[palette, /draws its own colour palette \(#0066cc, #e6f1fc, #17702f\)/], [nested, /puts a card inside a card \(\.tile in \.pane\)/]]) {
    writeFileSync(page, html);
    const refused = cli2('post', board, ...flags);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stdout, error);
    assert.match(refused.stdout, /Draw the report with the board's own blocks instead/);
    assert.equal(existsSync(board), false);
  }
  writeFileSync(page, scaffold);
  assert.equal(cli2('post', board, ...flags).status, 0);
  // A report filed before the rule stays filed: the same report posts again as already posted, and the board loads it.
  writeFileSync(page, palette);
  const again = cli2('post', board, ...flags);
  assert.equal(again.status, 0, again.stdout);
  assert.match(again.stdout, /how-sign-in-works,already posted/);
});
