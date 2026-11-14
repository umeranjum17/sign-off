import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { examples, schemas } from './ticket-adapter-conformance.mjs';
import { validate } from './support/json-schema.mjs';

// The ticket adapter interface (docs/ticket-adapter.md): its schemas against its worked examples, the document against both, and the conformance script against a stand-in
// adapter that keeps the rules and against copies of it that each break one.
const run = promisify(execFile), here = (f) => new URL(f, import.meta.url).pathname;
const [conformance, standin, faults] = ['./ticket-adapter-conformance.mjs', './support/ticket-adapter-standin.mjs', './support/ticket-adapter-standin-faults.mjs'].map(here);
const doc = readFileSync(here('../docs/ticket-adapter.md'), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'so-adapter-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const OPERATIONS = ['describe', 'list', 'get', 'create', 'update', 'history', 'comment'];
const schemaFor = (op, side) => (side === 'request' ? `${op}.request.json` : side === 'response' ? `${op}.response.json` : 'error.json');
const worked = Object.entries(examples).filter(([name]) => !name.startsWith('invalid-')), refusedExamples = Object.entries(examples).filter(([name]) => name.startsWith('invalid-'));
/** Runs the conformance script as a user would, against its own backend folder; resolves to its exit code and output. */
const conform = (name, args, bug) => {
  const dir = join(scratch, name);
  mkdirSync(dir);
  const env = { ...process.env, TICKET_STANDIN_DIR: dir, ...(bug && { TICKET_STANDIN_BUG: bug }) };
  return run(process.execPath, [conformance, standin, ...args], { env }).then((r) => ({ code: 0, out: r.stdout, dir }), (e) => ({ code: e.code, out: `${e.stdout}${e.stderr}`, dir }));
};

test('the schemas accept every worked example and refuse every invalid one', () => {
  for (const [name, ex] of worked) {
    assert.deepEqual(validate(schemas, schemaFor(ex.operation, 'request'), ex.request), [], `${name}: request`);
    assert.deepEqual(validate(schemas, schemaFor(ex.operation, ex.exit ? 'error' : 'response'), ex.response), [], `${name}: response`);
    assert.equal('error' in ex.response, ex.exit !== 0, `${name}: an error exits non-zero and a success exits 0`);
  }
  for (const [name, ex] of refusedExamples) assert.notDeepEqual(validate(schemas, schemaFor(ex.operation, ex.side), ex.message), [], `${name} should be refused: ${ex.breaks}`);
  assert.deepEqual([...new Set(worked.map(([, ex]) => ex.operation))].sort(), [...OPERATIONS].sort(), 'every operation has a worked example');
  assert.throws(() => validate(new Map([['x.json', { type: 'object', patternProperties: {} }]]), 'x.json', {}), /not supported/, 'a keyword the checker does not know is an error, not a pass');
});

test('the document quotes its examples as they are and names no backend, status word or label convention', () => {
  const quoted = [...doc.matchAll(/```json example ([a-z-]+)\n([\s\S]*?)\n```/g)];
  for (const [, name, body] of quoted) assert.deepEqual(JSON.parse(body), examples[name], `the document's ${name} is not examples/${name}.json`);
  assert.deepEqual(quoted.map((q) => q[1]).sort(), worked.map(([name]) => name).sort(), 'the document quotes every worked example once');
  const error = schemas.get('error.json').properties.error.oneOf;
  for (const word of [...OPERATIONS, ...error.flatMap((b) => b.properties.code.enum ?? [b.properties.code.const])]) assert.ok(doc.includes(`\`${word}\``), `the document does not name ${word}`);
  // The pattern spells the backend's names with a bracket so that a search for them finds only the code still to go.
  const text = [doc, ...[...schemas.values(), ...Object.values(examples)].map((v) => JSON.stringify(v))].join('\n');
  assert.doesNotMatch(text, /\b[b]eads\b|\b[b]d\b|[d]olt/i, 'the interface names no backend');
  const statusWord = /^(open|closed?|done|todo|to do|in[ _-]?progress|blocked|queued|on[ _-]?hold|hold|deferred|pending|review|new|backlog|ready)$/i;
  const seen = [];
  (function walk(v) { if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (k === 'status' && typeof x === 'string') seen.push(x); if (k === 'labels' && Array.isArray(x)) seen.push(...x); walk(x); } } })(Object.values(examples));
  assert.ok(seen.length > 10, 'the examples carry statuses and labels to check');
  for (const word of seen) assert.ok(!statusWord.test(word) && !word.includes(':'), `${word} is a status word or a label convention`);
});

test('the conformance script passes against the stand-in adapter, failure checks included', async () => {
  const { code, out } = await conform('good', ['--throwaway', '--faults', faults]);
  assert.equal(code, 0, out);
  assert.match(out, /# 18 passed, 0 failed, 0 not run/);
  assert.match(out, /ok \d+ - update: an unknown field survives/);
  assert.match(out, /ok \d+ - update: a stale rev gives conflict/);
  assert.match(out, /ok \d+ - failed read: list and get are errors, never an empty list/);
  assert.match(out, /ok \d+ - incomplete: .*never a short list or complete=false/);
});

test('each rule the stand-in is made to break fails the check that names it', async () => {
  const breaks = { 'empty-on-failure': /failed read: .*never an empty list/, 'complete-false': /incomplete: /, 'drops-extra': /an unknown field survives/, 'ignores-rev': /a stale rev gives conflict/, 'no-op-id': /the same op_id twice/ };
  const ran = await Promise.all(Object.keys(breaks).map((bug) => conform(bug, ['--throwaway', '--faults', faults], bug)));
  Object.entries(breaks).forEach(([bug, name], i) => {
    assert.equal(ran[i].code, 1, `${bug}: the script should fail\n${ran[i].out}`);
    assert.match(ran[i].out, new RegExp(`not ok \\d+ - [^\\n]*${name.source}`), `${bug}: the check that names the broken rule should fail\n${ran[i].out}`);
  });
  assert.match(ran[1].out, /complete=false, which is refused as incomplete/, 'a list that answers complete=false is refused as incomplete');
});

test('the script writes nothing unless told the backend is throwaway, and says what it did not run without a faults driver', async () => {
  const refused = await conform('refused', []);
  assert.equal(refused.code, 2);
  assert.match(refused.out, /--throwaway/);
  assert.ok(!existsSync(join(refused.dir, 'store.json')), 'a run that was not told --throwaway wrote to the backend');
  const partial = await conform('partial', ['--throwaway']);
  assert.equal(partial.code, 3, partial.out);
  assert.match(partial.out, /# 16 passed, 0 failed, 2 not run/);
  assert.match(partial.out, /not run \d+ - failed read: .*\n    no --faults driver/);
});
