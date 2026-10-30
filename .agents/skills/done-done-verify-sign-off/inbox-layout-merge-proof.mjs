// Capture both the Inbox redo and the required Designs reference in one sealed run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const drive = (script, ...args) => {
  const run = spawnSync(process.execPath, [join('.agents/skills/done-done-verify-sign-off', script), out, ...args], { stdio: 'inherit' });
  assert.equal(run.status, 0, `${script} passed`);
  return JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8'));
};
const inbox = drive('inbox-layout-shots.mjs');
writeFileSync(join(out, 'inbox-layout.steps.json'), JSON.stringify(inbox, null, 2));
const designs = drive('designs-shots.mjs', 'dark', '1440');
writeFileSync(join(out, 'designs.steps.json'), JSON.stringify(designs, null, 2));
copyFileSync(join(out, 'designs.after.dark.1440w.png'), join(out, 'designs.1440.dark.png'));
writeFileSync(join(out, 'steps.json'), JSON.stringify({
  commit: inbox.commit, target: inbox.target, start: inbox.start,
  steps: [...inbox.steps, ...designs.steps],
  result: 'Three Inbox option pages at 390 and 1280 in light and dark; the desktop viewer on a phone at its own readable size and with Fit; Designs at 1440 dark, all measured without assertion failures.',
}, null, 2));
