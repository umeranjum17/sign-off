import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDecisions, readTrail } from '../dist/store.js';
import { asked } from './support/ask.mjs';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'so-receipts-'));
mkdirSync(join(scratch, 'home'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HOME: join(scratch, 'home') };
delete env.SIGN_OFF_FILER;
delete env.CLAUDE_CODE_SESSION_ID;
const run = (...args) => execFileSync(process.execPath, [cli, ...asked(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env });

/** The steps the Inbox thread shows for a send (web/app-more.js lifeOf): Sent always, Read once the send has a read time. */
const stepsOf = (file, key) => { const t = readTrail(file, loadDecisions(file)).filter((x) => x.key === key && x.kind === 'answer').at(-1); return { sent: !!t, read: !!t?.read }; };
/** Fails with the card and the step that did not advance. */
const mustShowRead = (file, key) => assert.equal(stepsOf(file, key).read, true, `card ${key}: an answered card whose answer was relayed shows Sent only; the Read step did not advance`);

test('an answer the relay reads with `answers` is Read on its card, once, without any hand step', () => {
  const file = join(scratch, 'board.json');
  run('raise', file, '--key', 'name-the-tool', '--title', 'What should the tool be named?', '--filer', 'main');
  // The card was filed before it was answered, so the board holds no later post that would count as acting.
  const board = JSON.parse(readFileSync(file, 'utf8'));
  board.items[0].filed = new Date(Date.now() - 3_600_000).toISOString();
  writeFileSync(file, JSON.stringify(board));
  const at = new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
  writeFileSync(join(scratch, 'board.answers.jsonl'), JSON.stringify({ key: 'name-the-tool', answer: 'yes', label: 'Yes', close: 'done', at }) + '\n');
  assert.deepEqual(stepsOf(file, 'name-the-tool'), { sent: true, read: false });
  run('answers', file, '--json');
  mustShowRead(file, 'name-the-tool');
  const marks = () => readTrail(file, loadDecisions(file)).length;
  run('answers', file, '--json');
  assert.equal(marks(), 1);
});
