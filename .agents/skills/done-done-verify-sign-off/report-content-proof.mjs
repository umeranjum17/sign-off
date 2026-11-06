// Report content gate (CLI only, screen: none): the real "bots share one computer" plan report, read from the fleet board, is refused by
// `validate --new` with each rule named; a corrected version of it (slices with size, check and order, measured numbers, a risk with its mitigation) passes.
// Writes refused.txt, passes.txt, tests.log and steps.json into the folder named by argv[2].
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(process.argv[2]), repo = process.cwd(), sample = join(dirname(fileURLToPath(import.meta.url)), 'report-content-sample');
mkdirSync(out, { recursive: true });
const cli = join(repo, 'dist/cli.js');
// The sample pages are stored as index.html.txt so they never ship as pages; each run copies them back to index.html in a folder of its own.
const work = mkdtempSync(join(tmpdir(), 'so-content-sample-'));
for (const name of ['bots-share-machine', 'bots-share-machine-fixed']) {
  mkdirSync(join(work, name));
  copyFileSync(join(sample, name, 'index.html.txt'), join(work, name, 'index.html'));
  copyFileSync(join(sample, `${name}.json`), join(work, `${name}.json`));
}
const validate = (name) => {
  const r = spawnSync(process.execPath, [cli, 'validate', '--new', name], { cwd: work, encoding: 'utf8' });
  return { code: r.status, text: `$ sign-off-axi validate --new ${name}\n${r.stdout}${r.stderr}exit ${r.status}\n` };
};
const refused = validate('bots-share-machine.json'), passes = validate('bots-share-machine-fixed.json');
rmSync(work, { recursive: true, force: true });
writeFileSync(join(out, 'refused.txt'), refused.text);
writeFileSync(join(out, 'passes.txt'), passes.text);
const tests = spawnSync(process.execPath, ['--test', '--test-global-setup=test/temp-folder.mjs', 'test/report-content.test.mjs'], { cwd: repo, encoding: 'utf8' });
writeFileSync(join(out, 'tests.log'), `${tests.stdout}${tests.stderr}`);
const rules = ['plan-slices', 'plan-measured', 'plan-pointer', 'plan-risk'];
const problems = [];
if (refused.code !== 2) problems.push(`the real report exited ${refused.code}, not 2`);
for (const r of rules) if (!refused.text.includes(`[${r}]`)) problems.push(`the refusal does not name ${r}`);
if (passes.code !== 0) problems.push(`the corrected report exited ${passes.code}, not 0`);
if (tests.status !== 0) problems.push('test/report-content.test.mjs failed');
writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version },
  start: 'The "bots share one computer" plan report as filed on the fleet board (page-based, schema 2), and a corrected copy of it, in a folder beside their message files.',
  steps: ['Run validate --new on the real report: it exits 2 and names plan-slices, plan-measured, plan-pointer and plan-risk, each with its fix (refused.txt).', 'Run validate --new on the corrected copy: it exits 0 (passes.txt).', 'Run the integration test: a thin plan and a thin research report are refused with the rule named, a complete plan posts, a report already on the board still re-posts (tests.log).'],
  result: problems.length ? `FAILED: ${problems.join('; ')}` : 'The real report is refused with all four plan rules named and a fix line for each; the corrected copy passes; the integration tests pass.' }, null, 2) + '\n');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
