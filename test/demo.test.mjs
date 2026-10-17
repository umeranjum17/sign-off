// The static demo build: one source (web/index.html) plus the demo shim and
// seed data only in the demo build; the server's own page is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-demo-'));

test('demo build carries the shim and seed; the server page does not', async (t) => {
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const out = join(scratch, 'demo');
  execFileSync('node', [join(root, 'scripts/build-demo.mjs'), '--out', out], { cwd: root, stdio: 'pipe' });

  // The demo page is the real page plus the seed and the shim.
  const demo = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(demo, /<title>Dashboard/);
  assert.match(demo, /window\.SIGN_OFF_DEMO_SEED/);
  assert.match(demo, /demo-shim\.js/);
  for (const key of ['keep-the-weekly-digest', 'release-day', 'settings-layout', 'update-1', 'sign-in-tour']) {
    assert.ok(demo.includes(key), `demo seed carries ${key}`);
  }
  assert.ok(demo.includes('settings-layout~a'), 'demo seed carries the design mocks');

  // Every mapped file is in the build.
  const seed = JSON.parse(readFileSync(join(root, 'web/demo/seed.json'), 'utf8'));
  const files = JSON.parse(/window\.SIGN_OFF_DEMO_FILES = (\{.*?\});/.exec(demo)[1].replace(/\\u003c/g, '<'));
  const expect = seed.decisions.flatMap((d) => [
    ...(d.mocks ?? []).map((m) => `${seed.mockBase}${d.key}~${m.value}/${m.path.split('?')[0].split('/').pop()}`),
    ...(d.media ?? []).map((_, i) => `/api/media?key=${d.key}&i=${i}`),
  ]);
  assert.deepEqual(Object.keys(files).sort(), expect.sort());
  for (const dest of Object.values(files)) {
    assert.ok(dest.startsWith('./assets/'), `${dest} stays inside the build`);
    assert.ok(existsSync(join(out, dest.slice(2))), `${dest} is in the build`);
  }

  // The normal server build is unchanged: no demo hooks in the page it serves.
  const board = join(scratch, 'board.json');
  writeFileSync(board, JSON.stringify({ schema: 1, decisions: [{ key: 'probe', title: 'Probe?' }] }));
  const proc = spawn('node', [join(root, 'dist/cli.js'), 'serve', board, '--port', '0'], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill();
      await new Promise((ok) => proc.once('exit', ok));
    }
  });
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b.toString())[0])));
  const html = await new Promise((ok, no) => get(url, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => ok(body));
  }).once('error', no));
  assert.match(html, /<title>Dashboard/);
  assert.ok(!html.includes('SIGN_OFF_DEMO'), 'the served page has no demo hooks');
});
