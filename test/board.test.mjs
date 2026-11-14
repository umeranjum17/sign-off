// A board on a report (schema 6): it is checked at post time, kept with the report, and one id it lost may not come back.
// The fixture folder covers the rules; this file drives the commands a person or an agent runs.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const fixtures = new URL('../fixtures/contract/report.v6/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-board-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HOME: join(scratch, 'home') };
const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env });
const file = (name, value) => { const path = join(scratch, name); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); return path; };
const three = () => ({
  title: 'Three states, two moves',
  shapes: [{ id: 'start', label: 'start', at: [0, 0], tone: 'start' }, { id: 'middle', label: 'middle', at: [1, 1] }, { id: 'end', label: 'end', at: [2, 2], tone: 'end' }],
  arrows: [{ id: 'm1', from: 'start', to: 'middle', label: 'go' }, { id: 'm2', from: 'middle', to: 'end', label: 'finish' }],
  steps: [{ title: 'It starts at start', text: 'Two moves take it to end.', focus: ['start', 'middle'] }],
});

test('a board posts with its report and reads back with it', () => {
  const board = join(scratch, 'board-1.json'), message = JSON.parse(readFileSync(join(fixtures, 'valid-line.json'), 'utf8'));
  assert.equal(run('post', board, '--kind', 'report', '--from', file('line.json', message)).status, 0);
  const kept = JSON.parse(readFileSync(board, 'utf8')).items[0];
  assert.equal(kept.schema, 6); assert.equal(kept.sections[0].board.shapes.length, 17);
  assert.match(run('list', board, '--full').stdout, /The line after the plan/);
  // A plan report needs every part, a design, slices with a size and tests; a board on the design part stands where a diagram would.
  const filled = (board) => ['goal', 'current', 'design', 'slices', 'tests', 'risks', 'rollout', 'estimate', 'owner-calls'].map((part) => ({ id: part, part, stage: part === 'goal' || part === 'current' ? 'found' : 'recommend', heading: `The ${part}`, body: 'One plain line, so the part is not empty.',
    ...(part === 'design' && board ? { board } : {}), ...(part === 'slices' ? { items: [{ title: 'Board data', text: 'The form and its check.', size: 'S, half a day' }] } : {}), ...(part === 'tests' ? { items: [{ title: 'The check and the list', text: 'Proven at 390 and 1280.' }] } : {}) }));
  const plan = { ...JSON.parse(readFileSync(join(fixtures, 'valid-task.json'), 'utf8')), key: 'plan-board', purpose: 'plan', sections: filled(three()),
    decisions: [{ key: 'scope', question: 'Keep the board in the report?', why: 'One place to read it.', options: [{ value: 'yes', label: 'Yes', outcome: 'The board travels with the report.' }, { value: 'no', label: 'No', outcome: 'The board is a separate page.' }], recommend: 'yes' }] };
  const posted = run('validate', '--kind', 'report', file('plan-board.json', plan));
  assert.equal(posted.status, 0, posted.stdout + posted.stderr);
  const { decisions: _d, ...withoutDecisions } = plan;
  const noBoard = run('validate', '--kind', 'report', file('plan-no-board.json', { ...withoutDecisions, schema: 5, sections: filled() }));
  assert.equal(noBoard.status, 2);
  assert.match(noBoard.stdout, /needs a diagram or a board/);
});

test('an id an earlier version removed may not come back', () => {
  const board = join(scratch, 'board-3.json'), base = JSON.parse(readFileSync(join(fixtures, 'valid-task.json'), 'utf8'));
  const withBoard = (version, b, changes) => ({ ...base, version, ...(changes ? { changes } : {}), sections: [{ ...base.sections[0], board: b }] });
  const first = run('post', board, '--kind', 'report', '--from', file('v1.json', withBoard(1, three())));
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const dropped = three();
  dropped.shapes = dropped.shapes.filter((s) => s.id !== 'middle');
  dropped.arrows = [{ id: 'm1', from: 'start', to: 'end', label: 'go' }];
  dropped.steps = [{ title: 'It starts at start', text: 'One move takes it to end.', focus: ['start', 'end'] }];
  const v2 = withBoard(2, dropped, [{ kind: 'removed', text: 'The middle state and its two moves' }]);
  assert.equal(run('post', board, '--kind', 'report', '--from', file('v2.json', v2)).status, 0);
  const again = run('post', board, '--kind', 'report', '--from', file('v3.json', withBoard(3, three(), [{ kind: 'added', text: 'A middle state comes back' }])));
  assert.equal(again.status, 2);
  assert.match(again.stdout, /middle.*was removed in an earlier version of this board/);
  assert.match(again.stdout, /Use a new id/);
});

test('report init --board writes a board to fill that the check accepts', () => {
  const folder = join(scratch, 'report-folder'), made = run('report', 'init', folder, '--purpose', 'other', '--board');
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const board = JSON.parse(readFileSync(join(folder, 'board.json'), 'utf8'));
  assert.ok(board.shapes.length >= 2 && board.steps.length >= 1);
  const filled = JSON.parse(JSON.stringify(board).replace(/FILL: [^"]*/g, 'A plain word'));
  const message = { ...JSON.parse(readFileSync(join(fixtures, 'valid-task.json'), 'utf8')), key: 'from-template', sections: [{ id: 'design', stage: 'recommend', heading: 'The line, drawn', body: 'One shape per state.', board: filled }] };
  const checked = run('validate', '--kind', 'report', file('from-template.json', message));
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  // --board is no help to a plan message or a page, so each is refused before anything is written.
  assert.equal(run('report', 'init', join(scratch, 'p'), '--plan', '--board').status, 2);
  assert.equal(run('report', 'init', join(scratch, 'g'), '--purpose', 'other', '--page', '--board').status, 2);
  // An older sign-off knows no schema 6, so it refuses one with the way forward.
  const future = run('validate', '--kind', 'report', file('future.json', { ...message, schema: 9 }));
  assert.equal(future.status, 2);
  assert.match(future.stdout, /not in this sign-off-axi/);
  assert.match(future.stdout, /Upgrade sign-off-axi/);
});
