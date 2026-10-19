// The real done-done check must accept the plan-review journey's repeated network diagnostics, and still
// flag identical records that are cited as evidence for any other journey.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { recordsDir } from '../.agents/skills/verify-sign-off/records.mjs';

const repo = resolve(import.meta.dirname, '..');
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(onPath);
const app = 'sign-off';
const png = join(repo, 'fixtures', 'evidence', 'product-board.png');
const noCheck = !onPath('done-done') && 'done-done is not on the PATH';

function onPath(bin) {
  return (process.env.PATH ?? '').split(':').some((dir) => {
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function run(cwd, args, env = {}) {
  return spawnSync('done-done', args, { cwd, encoding: 'utf8', timeout: 240_000, env: { ...process.env, ...env } });
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

function commit(cwd) {
  git(cwd, ['init', '-q']);
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'user.name=records', '-c', 'user.email=records@example.com', 'commit', '-qm', 'init']);
}

const recordOf = (home, name, runId) => JSON.parse(readFileSync(join(home, 'evidence', name, '.done-done', 'runs', `${runId}.json`), 'utf8'));
const evidenceOf = (home, name, record) => record.files.map((f) => join(home, 'evidence', name, f.path));

test('identical plan-review diagnostics stay out of the check; another journey with the same shape still fails', { skip: noCheck }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'so-plan-records-'));
  try {
    const home = join(dir, 'home'), helper = join(dir, 'helper.mjs');
    writeFileSync(helper, `import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { recordsDir } = await import(process.env.RECORDS);
const [journey, root] = process.argv.slice(2);
const dir = journey === 'plan-review' ? recordsDir(root) : root;
mkdirSync(dir, { recursive: true });
for (const name of ['approved.network.txt', 'note.network.txt']) writeFileSync(join(dir, name), 'reqid=1 GET / [200]\\n');
copyFileSync(process.env.SHOT, join(root, journey + '.png'));
`);
    writeFileSync(join(dir, 'app.txt'), 'app\n');
    writeFileSync(join(dir, '.done-done.yaml'), `app: "plan-review-records"
journeys:
  plan-review:
    command: "node helper.mjs plan-review \\"$DONE_DONE_EVIDENCE_ROOT\\""
  other:
    command: "node helper.mjs other \\"$DONE_DONE_EVIDENCE_ROOT\\""
`);
    commit(dir);
    const env = { DONE_DONE_HOME: home, SHOT: png, RECORDS: join(repo, '.agents/skills/verify-sign-off/records.mjs'), PLAN_REVIEW_DIAGNOSTICS: '' };

    const ran = run(dir, ['run', 'plan-review', '--json'], env);
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    const name = 'plan-review-records';
    const plan = recordOf(home, name, JSON.parse(ran.stdout).run_id), planFiles = evidenceOf(home, name, plan);
    assert.ok(planFiles.length && planFiles.every((f) => f.endsWith('.png')), planFiles.join('\n'));
    const diagnostics = join(home, 'evidence', name, `${plan.run_id}-diagnostics`);
    const networks = readdirSync(diagnostics).filter((n) => n.endsWith('.network.txt')).map((n) => readFileSync(join(diagnostics, n), 'utf8'));
    assert.equal(networks.length, 2);
    assert.equal(networks[0], networks[1]);
    assert.ok(!readdirSync(join(home, 'evidence', name, plan.run_id)).some((n) => n.endsWith('.network.txt')));

    const passed = run(dir, ['check', '--outcome', 'Plan review states load and the answer is saved.', '--claim-id', 'plan-review-records', '--json', ...planFiles], env);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);

    const otherRan = run(dir, ['run', 'other', '--json'], env);
    assert.equal(otherRan.status, 0, otherRan.stdout + otherRan.stderr);
    const other = recordOf(home, name, JSON.parse(otherRan.stdout).run_id);
    const failed = run(dir, ['check', '--outcome', 'Another journey loads.', '--claim-id', 'other-journey', '--json', ...evidenceOf(home, name, other)], env);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout, /byte-identical/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const noJourney = noCheck || (!chrome && 'no Chrome on the PATH') || (!onPath('chrome-devtools-axi') && 'chrome-devtools-axi is not on the PATH');
test('the real plan-review journey passes the real check with identical network records', { skip: noJourney }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'so-plan-journey-'));
  let ran;
  try {
    // A committed copy keeps the run clean even while the checkout under test has uncommitted changes.
    const work = join(dir, 'work'), home = join(dir, 'home');
    for (const path of ['dist', 'web', 'fixtures', '.agents/skills/verify-sign-off']) cpSync(join(repo, path), join(work, path), { recursive: true });
    cpSync(join(repo, '.done-done.yaml'), join(work, '.done-done.yaml'));
    writeFileSync(join(work, '.gitignore'), 'node_modules\n');
    symlinkSync(join(repo, 'node_modules'), join(work, 'node_modules'), 'dir');
    writeFileSync(join(work, 'package.json'), readFileSync(join(repo, 'package.json')));
    commit(work);
    const env = { DONE_DONE_HOME: home, TMPDIR: dir, PLAN_REVIEW_DIAGNOSTICS: '' };
    ran = run(work, ['run', 'plan-review', '--json'], env);
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    const record = recordOf(home, app, JSON.parse(ran.stdout).run_id), files = evidenceOf(home, app, record);
    assert.ok(files.length > 2);
    assert.ok(files.every((f) => f.endsWith('.png')), files.join('\n'));
    const diagnostics = join(home, 'evidence', app, `${record.run_id}-diagnostics`);
    assert.ok(existsSync(join(diagnostics, 'answers.json')), `no diagnostics in ${diagnostics}`);
    const networks = readdirSync(diagnostics).filter((n) => n.endsWith('.network.txt')).map((n) => readFileSync(join(diagnostics, n), 'utf8'));
    assert.ok(networks.length > 1 && networks.some((n, i) => networks.indexOf(n) !== i), 'the journey should have repeated a network record by design');

    const checked = run(work, ['check', '--outcome', 'Plan review states load and the answer is sent back.', '--claim-id', 'plan-review-journey', '--json', ...files], env);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  } finally {
    const scratch = /Scratch for cleanup: (\S+)/.exec(`${ran?.stdout ?? ''}${ran?.stderr ?? ''}`)?.[1];
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
