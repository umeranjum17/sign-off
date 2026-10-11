import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const file = join(mkdtempSync(join(tmpdir(), 'sign-off-')), 'd.json');
copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), file);
const procs = [];
after(() => procs.forEach((p) => p.kill()));
async function serve() {
  const proc = spawn('node', [cli, 'serve', file, '--port', '0'], { cwd: tmpdir() });
  procs.push(proc);
  return { proc, url: await new Promise((ok) => proc.stdout.once('data', (b) => ok(b.toString().trim()))) };
}
const post = (url, body) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('answer journey: save, survive a torn line and a restart, read back', async () => {
  let { proc, url } = await serve();
  assert.match(await (await fetch(url)).text(), /<title>Decisions/);
  assert.equal((await post(url, { key: 'short-question', answer: 'yes' })).status, 200);
  assert.equal((await post(url, { key: 'short-question', answer: 'maybe' })).status, 400);
  assert.equal((await post(url, { key: 'gone', answer: 'yes' })).status, 404);
  appendFileSync(file.replace('.json', '.answers.jsonl'), '{"key":"torn');
  assert.equal((await (await post(url, { key: 'use-dark-default', answer: 'no' })).json()).answers['use-dark-default'].answer, 'no');
  assert.equal((await new Promise((ok) => get(url, { headers: { host: 'evil.example' } }, ok))).statusCode, 403);
  proc.kill();
  ({ proc, url } = await serve());
  assert.equal((await (await fetch(`${url}api/decisions`)).json()).answers['short-question'].answer, 'yes');
  const printed = JSON.parse(execFileSync('node', [cli, 'answers', file], { stdio: ['ignore', 'pipe', 'ignore'] }));
  assert.deepEqual(Object.keys(printed).sort(), ['short-question', 'use-dark-default']);
});
