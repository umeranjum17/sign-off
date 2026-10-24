import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-ticket-perf-'));
const env = { ...process.env, HOME: join(scratch, 'home') };
delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_FILER;
after(() => rmSync(scratch, { recursive: true, force: true }));
const axi = (...args) => run(process.execPath, [cli, ...args], { env, encoding: 'utf8', maxBuffer: 1 << 26 });

test('ticket reads the board once and warns once, however many tickets the board has', async () => {
  const board = join(scratch, 'board.json');
  await axi('raise', board, '--title', 'Ship the new sign-in screen this week?', '--why', 'The screen is ready and the release goes out Friday.', '--outcome', 'yes=It ships to everyone on Friday.',
    '--outcome', 'no=It waits for next week.', '--recommend', 'yes', '--recommend-reason', 'Every check passed on 3 phones.', '--default', 'no', '--ask-ref', 'message-test', '--ticket', 'T-0');
  const lines = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ id: `T-${i}`, title: `Ticket ${i}`, progress: i % 101, at: '2026-10-24T08:00:00Z' }));
  writeFileSync(join(scratch, 'board.tickets.jsonl'), lines.join('\n') + '\n');
  // A torn line in the answers log makes every load of the board warn.
  appendFileSync(join(scratch, 'board.answers.jsonl'), '{"torn\n');
  for (const args of [['ticket', board, '--json'], ['ticket', board]]) {
    const started = performance.now(), { stdout, stderr } = await axi(...args), took = performance.now() - started;
    assert.ok(took < 1000, `${args.join(' ')} took ${Math.round(took)} ms`);
    assert.equal(stderr.split('\n').filter((l) => /skipped unreadable line/.test(l)).length, 1, stderr.slice(0, 300));
    assert.match(stdout, /T-999/);
  }
  const { stdout } = await axi('ticket', board, '--json');
  assert.deepEqual(JSON.parse(stdout).tickets.find((t) => t.id === 'T-0').cards.length, 1);
});
