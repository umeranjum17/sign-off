import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;

test('every card carries one state; read stays separate; waiting cards say since when', () => {
  const dir = mkdtempSync(join(tmpdir(), 'so-state-'));
  try {
    const board = join(dir, 'd.json'), at = new Date().toISOString();
    const ask = (key, extra = {}) => ({ key, type: 'decision', title: `Q ${key}?`, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], close: 'done', filed: '2026-11-01T09:00:00Z', ...extra });
    writeFileSync(board, JSON.stringify({ schema: 2, items: ['open', 'later', 'done', 'gone', 'old'].map((k) => ask(k)) }));
    // Side files as older boards wrote them: a plain dismiss line has no deferred flag.
    writeFileSync(join(dir, 'd.answers.jsonl'), JSON.stringify({ key: 'done', answer: 'yes', label: 'Yes', close: 'done', at }) + '\n');
    writeFileSync(join(dir, 'd.dismissed.jsonl'), [{ key: 'gone', dismissed: true, at }, { key: 'later', dismissed: true, deferred: true, at }].map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(join(dir, 'd.reads.jsonl'), JSON.stringify({ key: 'open', read: true, by: 'captain', at }) + '\n');
    const run = (...a) => JSON.parse(execFileSync('node', [cli, ...a, '--json'], { env: { ...process.env, HOME: dir }, encoding: 'utf8' }));
    const rows = Object.fromEntries(run('list', board).decisions.map((d) => [d.key, d]));
    assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([k, d]) => [k, d.state])), { open: 'open', later: 'deferred', done: 'answered', gone: 'dismissed', old: 'open' });
    assert.equal(rows.open.waiting_since, '2026-11-01T09:00:00Z');
    assert.equal(rows.done.waiting_since, undefined);
    assert.equal(rows.later.waiting_since, undefined);
    assert.deepEqual(run('status', board).cards, { open: 2, deferred: 1, answered: 1, archived: 0, dismissed: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
