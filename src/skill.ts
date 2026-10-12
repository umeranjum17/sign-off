// Generates skills/sign-off-axi/SKILL.md as a minimal stub that defers to the live CLI, so an
// installed copy never goes stale. Never bake help text or output shapes in here.
//   npm run build:skill              write the file
//   npm run build:skill -- --check   exit 1 when the committed file is stale
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// What agents match to load the skill on their own: keep it outcome-first.
const DESCRIPTION = 'Ask the user yes/no or pick-one questions on a local review board and read back their answers, using the sign-off-axi CLI. ' +
  'Use when you need a yes/no decision, a choice between a few options, or approval from the user before going on, want the user to review or sign off on something, ' +
  'or need to read back the answers the user already gave.';
// Hermes Agent metadata (https://hermes-agent.nousresearch.com/docs/user-guide/features/skills); other harnesses ignore it.
const HERMES_TAGS = ['decisions', 'approval', 'review', 'yes-no', 'multiple-choice', 'human-in-the-loop', 'cli'];

const markdown = `---
name: sign-off-axi
description: ${JSON.stringify(DESCRIPTION)}
license: MIT
metadata:
  author: umeranjum17
  argument-hint: <the question to ask>
  hermes:
    tags:
${HERMES_TAGS.map((tag) => `      - ${tag}`).join('\n')}
    category: productivity
---

# sign-off-axi

sign-off-axi puts your yes/no and pick-one questions on one local page (127.0.0.1) where the user answers each with one click, and saves the answers for you to read back.

## Current guidance lives in the CLI

Do not follow workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- \`npx -y sign-off-axi --help\` for commands, the board and examples
- \`npx -y sign-off-axi <command> --help\` for one command's flags

You do not need sign-off-axi installed globally - invoke it with \`npx -y sign-off-axi\`.
If sign-off-axi output shows a follow-up command starting with \`sign-off-axi\`, run it as \`npx -y sign-off-axi ...\` instead.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked \`/sign-off-axi\` explicitly - fetch the current CLI guidance, then ask that question.
If it is empty, infer the question from the conversation.
`;

const target = new URL('../skills/sign-off-axi/SKILL.md', import.meta.url);
if (process.argv.includes('--check')) {
  let actual = '';
  try { actual = readFileSync(target, 'utf8'); } catch {}
  if (actual !== markdown) {
    console.error('skills/sign-off-axi/SKILL.md is out of date. Run `npm run build:skill` and commit the result.');
    process.exit(1);
  }
  console.log('skills/sign-off-axi/SKILL.md is up to date.');
} else {
  mkdirSync(new URL('.', target), { recursive: true });
  writeFileSync(target, markdown);
  console.log(`Wrote ${fileURLToPath(target)}`);
}
