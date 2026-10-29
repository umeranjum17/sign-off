// Seals the test-phone captures of a real notify journey (test notice, Decide and Evidence notices, the card each tap opened) into the run.
// The captures come from a keeper-locked phone session against a throwaway board; PHONE_PROOF_DIR holds them.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2], from = process.env.PHONE_PROOF_DIR;
const shots = ['1-shade-test-notice.png', '2-shade-decide-notice.png', '3-tap-opens-decide-card.png', '4-shade-evidence-notice.png', '5-tap-opens-evidence-card.png'];
if (!from || shots.some((f) => !existsSync(join(from, f)))) { console.error('PHONE_PROOF_DIR must hold ' + shots.join(', ')); process.exit(1); }
for (const f of shots) copyFileSync(join(from, f), join(out, f));
writeFileSync(join(out, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version },
  start: 'A throwaway board served on the tailnet with a notify block for muxr; the test phone has its shade cleared.',
  steps: ['notify test: the sign-off test notice is in the phone shade.', 'A Decide card is raised: one notice with its title is in the shade.', 'Tap it: the board opens on that card.', 'An Evidence card is posted: one notice with its title is in the shade.', 'Tap it: the board opens on that card.'],
  result: 'Each new card raised one notice and its tap opened that card.',
}, null, 2));
