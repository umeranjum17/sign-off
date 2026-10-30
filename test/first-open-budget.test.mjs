import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => process.env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
const scratch = mkdtempSync(join(tmpdir(), 'so-budget-')), temp = join(scratch, 't');
mkdirSync(temp);
after(() => rmSync(scratch, { recursive: true, force: true }));

// Recorded 27 October 2026 on 0.8.0: a board of 2,147 cards (3.4 MB: 7 open asks, 1,000 answered, 900 dismissed, 240 guided plans), cold, 390 px at DPR 2,
// slow 4G (1.6 Mbps down, 750 kbps up, 150 ms RTT), CPU 4x; the whole open re-recorded on 28 October 2026 in the change that added the Activity tab (+2,952 B, all after the first paint) and again on 29 October 2026 in the change that threads replies under what they answer (+1,687 B of screen code and rules, all after the first paint) and again on 29 October 2026 in the change that keeps the inbox to the threads the person took part in (+1,306 B of thread code, all after the first paint). docs/pwa-performance-plan.md ("First open budgets") holds the same numbers and how they were taken.
const baseline = { bytesBeforePaint: 94_796, requestsBeforePaint: 5, bytesWhole: 298_908, paintMs: 900 };
const byteHeadroom = 1_024;
const firstPaintCeiling = 100_000;
// The paint is the one number a busy host moves: it may take half as long again, and is never allowed more.
const paintTolerance = 1.5;

const n = (v) => v.toLocaleString('en-US');

test('a cold first open of a live-size board stays inside its recorded budgets: bytes and requests before the paint, the whole open, and the paint', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const out = join(scratch, 'out');
  // Seeds the board, serves it, and opens it cold on the recorded profile; async, so this process keeps answering while the browser works.
  await run(process.execPath, ['.agents/skills/done-done-verify-sign-off/first-open-shots.mjs', out], { cwd: root, encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, TMPDIR: temp, FIRST_OPEN_THEMES: 'light', ...(chrome && { CHROME_PATH: chrome }) } })
    .catch((e) => assert.fail(`the first open could not be measured (.agents/skills/done-done-verify-sign-off/first-open-shots.mjs): ${e.stderr || e.message}`));
  const got = JSON.parse(readFileSync(join(out, 'first-open-cold-light.json'), 'utf8'));
  const table = got.table.map((r) => `  ${r.beforePaint ? 'before paint' : 'after paint '} ${String(r.kb).padStart(5)} KB  ${r.path}`).join('\n');
  const where = `Look at .agents/skills/done-done-verify-sign-off/first-open.mjs (it measures) and docs/pwa-performance-plan.md "First open budgets" (the baselines). Requests of this open:\n${table}`;
  // The requests are the same files each run: a different count is a file added to, or taken from, the first screen.
  const requestsCeiling = baseline.requestsBeforePaint;
  assert.ok(got.requestsBeforePaint <= requestsCeiling, `requests before the first paint: ${got.requestsBeforePaint} requests, ceiling ${requestsCeiling} (exceeded by ${got.requestsBeforePaint - requestsCeiling}). ${where}`);
  for (const [key, label, ceiling] of [
    ['bytesBeforePaint', 'bytes before the first paint', Math.min(baseline.bytesBeforePaint + byteHeadroom, firstPaintCeiling)],
    ['bytesWhole', 'bytes of the whole open', baseline.bytesWhole + byteHeadroom],
  ]) {
    assert.ok(got[key] < ceiling, `${label}: ${n(got[key])} B, ceiling ${n(ceiling)} B (exceeded by ${n(Math.max(0, got[key] - ceiling + 1))} B). ${where}`);
  }
  assert.ok(got.paintMs <= baseline.paintMs * paintTolerance, `first paint: ${n(got.paintMs)} ms, baseline ${n(baseline.paintMs)} ms (up to ${n(baseline.paintMs * paintTolerance)} ms on a loaded host). ${where}`);
  console.log(`first open: ${n(got.bytesBeforePaint)} B in ${got.requestsBeforePaint} requests before the first paint, ${n(got.bytesWhole)} B whole, paint ${got.paintMs} ms`);
});
