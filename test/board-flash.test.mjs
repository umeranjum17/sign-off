// The board's own redraws in a real browser: a poll that brings a new ask, and answering a card, must not blank the main region or rebuild it, and a
// loader must show while the board is reading. The drive is the journey script itself, so the check CI runs and the proof a person looks at are one
// thing: flash-shots.mjs holds a board's first read, adds an ask under a running poll and answers a card, then reads the main region on every frame.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = new URL('../.agents/skills/done-done-verify-sign-off/flash-shots.mjs', import.meta.url).pathname;
// The browser the repo's other journeys use: CHROME_PATH, else the first of the usual names on the PATH (a CI runner has google-chrome, not chromium).
const browser = process.env.CHROME_PATH ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .flatMap((b) => (process.env.PATH ?? '').split(':').map((d) => join(d, b))).find(existsSync);
const out = mkdtempSync(join(tmpdir(), 'so-flash-'));
after(() => rmSync(out, { recursive: true, force: true }));

test('a poll and an answer never blank or rebuild the board, and a loader shows while it reads', { skip: !browser && 'no Chrome or Chromium on this machine' }, () => {
  // A phone and a desk: the same drive, the same checks, once each.
  for (const width of ['390', '1280']) {
    const run = spawnSync(process.execPath, [shots, out, 'light', width], { encoding: 'utf8', env: { ...process.env, CHROME_PATH: browser } });
    assert.equal(run.status, 0, `the board flashed at ${width}px:\n${run.stdout}\n${run.stderr}`);
    // The measurements the script wrote say what it saw, so a pass cannot be a test that never looked.
    const report = JSON.parse(readFileSync(join(out, `board-flash.${width}w.json`), 'utf8')), by = Object.fromEntries(report.phases.map((p) => [p.phase, p]));
    assert.deepEqual(Object.keys(by), ['first-load', 'refresh', 'answer']);
    assert.equal(by['first-load'].skeleton, true, 'the first load holds a skeleton while its read is held');
    assert.equal(by['first-load'].loader, true, 'the first load shows the loader');
    assert.equal(by.refresh.loader, true, 'a poll shows the loader while it reads');
    assert.equal(by.refresh.newAsk, true, 'the poll actually brought the new ask to the board');
    for (const phase of ['refresh', 'answer']) {
      assert.equal(by[phase].rebuiltRows, 0, `${phase} rebuilt ${by[phase].rebuiltRows} rows under the person's thumb`);
      assert.ok(by[phase].keptRows > 0, `${phase} kept the rows it had on screen (${by[phase].keptRows})`);
    }
  }
});
