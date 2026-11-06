// The question shape in a real browser: every question is one radio list with the recommended answer selected and Something else last, a guarded ask selects nothing,
// a plan's and a report's open questions draw the same list, and a plan or report whose open question is only prose is refused. Selected is only what the page shows:
// the board files stay byte for byte and a waiting agent times out until the one tap. The drive is the journey script itself, so CI and the proof are one thing.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = new URL('../.agents/skills/done-done-verify-sign-off/question-shape-shots.mjs', import.meta.url).pathname;
const chrome = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const out = mkdtempSync(join(tmpdir(), 'so-qshape-'));
after(() => rmSync(out, { recursive: true, force: true }));

test('a question is a radio list with the recommended answer selected, Something else opens a field, and nothing is saved or woken until the button', { skip: !chrome && 'no Chromium on this machine' }, () => {
  for (const [theme, width] of [['light', '390'], ['dark', '1280']]) {
    const run = spawnSync(process.execPath, [shots, out, theme, width], { encoding: 'utf8', timeout: 240000 });
    assert.equal(run.status, 0, `${theme} ${width}px:\n${run.stdout}\n${run.stderr}`);
    // The records the script wrote say what it saw, so a pass cannot be a test that never looked.
    const m = (state) => JSON.parse(readFileSync(join(out, `${state}.${theme}.${width}w.txt`), 'utf8'));
    assert.deepEqual(m('ask-preselected').radios.filter((r) => r.checked).map((r) => r.label), ['Friday']);
    assert.deepEqual(m('ask-guarded').radios.filter((r) => r.checked), []);
    assert.equal(m('ask-something-else').fieldShown, true);
    const record = readFileSync(join(out, `no-write.${theme}.${width}w.txt`), 'utf8');
    assert.match(record, /code: TIMEOUT/);
    assert.match(record, /"server-owner": "vendor"/);
  }
});
