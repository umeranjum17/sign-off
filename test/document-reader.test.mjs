// A document report in a real browser: the headings are the outline, the answer is open and counted as read while the folded sections are not, a search leaves the sections with the words,
// and a long report past the guided limits posts whole while one block or row more is refused. The drive is the journey script itself, so CI and the proof are one thing.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = new URL('../.agents/skills/done-done-verify-sign-off/document-reader-shots.mjs', import.meta.url).pathname;
const chrome = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const out = mkdtempSync(join(tmpdir(), 'so-dread-'));
after(() => rmSync(out, { recursive: true, force: true }));

test('a document report reads by its own headings: the answer open first, sections that fold, a search that finds words, and a long report whole', { skip: !chrome && 'no Chromium on this machine' }, () => {
  for (const [theme, width] of [['light', '390'], ['dark', '1280']]) {
    const run = spawnSync(process.execPath, [shots, out, theme, width], { encoding: 'utf8', timeout: 240000 });
    assert.equal(run.status, 0, `${theme} ${width}px:\n${run.stdout}\n${run.stderr}`);
    // The records the script wrote say what it saw, so a pass cannot be a test that never looked.
    const m = (state) => JSON.parse(readFileSync(join(out, `${state}.${theme}.${width}w.txt`), 'utf8'));
    assert.deepEqual(m('reader-first').open, ['1. Answer (five lines)']);
    assert.equal(m('reader-first').answer.kicker, 'The answer');
    assert.equal(m('reader-outline').outline.length, 8);
    assert.match(m('reader-search').found, /^2 sections of 8 match$/);
    assert.match(readFileSync(join(out, `refusals.${theme}.${width}w.txt`), 'utf8'), /must list 1 to 100 rows/);
  }
});
