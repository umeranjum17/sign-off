// The board feels seamless in a real browser: the journey script fails on any number over its line, so CI and the proof a person looks at are one thing.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = new URL('../.agents/skills/done-done-verify-sign-off/seamless-shots.mjs', import.meta.url).pathname;
const browser = process.env.CHROME_PATH ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => (process.env.PATH ?? '').split(':').map((d) => join(d, b))).find(existsSync);
const out = mkdtempSync(join(tmpdir(), 'so-seam-'));
after(() => rmSync(out, { recursive: true, force: true }));

test('taps are answered at once, a failed save is taken back and said, nothing shifts, a new ask arrives by itself', { skip: !browser && 'no Chrome or Chromium on this machine' }, () => {
  const run = spawnSync(process.execPath, [shots, out, 'light', '390'], { encoding: 'utf8', env: { ...process.env, CHROME_PATH: browser } });
  assert.equal(run.status, 0, `the board was not seamless:\n${run.stdout}\n${run.stderr}`);
  const seen = JSON.parse(readFileSync(join(out, 'seamless.light.390w.json'), 'utf8'));
  for (const k of ['approve', 'answer', 'comment']) assert.ok(seen[k].tapToResponse >= 0 && seen[k].tapToResponse < 150, `${k} answered the tap in ${seen[k].tapToResponse} ms`);
  assert.match(seen.revert.says, /did not save/);
});
