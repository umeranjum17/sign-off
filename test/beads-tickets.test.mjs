import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'so-beads-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
// A stand-in for the Juggernaut wrapper: rows live in rows.json, `list` prints them as bd does, `create` and `update` change them, and every call is logged.
// It refuses to run unless BEADS_DIR is set, as the real wrapper does.
const store = join(scratch, 'store'), wrapper = join(scratch, 'jg-beads.sh'), rows = join(store, 'rows.json'), log = join(store, 'calls.log');
mkdirSync(join(store, '.beads'), { recursive: true });
writeFileSync(wrapper, `#!/usr/bin/env node
const fs = require('fs'), [verb, ...a] = process.argv.slice(2), file = ${JSON.stringify(rows)};
if (!process.env.BEADS_DIR) { console.error('BEADS_DIR is not set'); process.exit(2); }
fs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');
const all = JSON.parse(fs.readFileSync(file, 'utf8')), flag = (n) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
const save = () => fs.writeFileSync(file, JSON.stringify(all));
const now = '2026-11-06T10:00:00Z';
if (verb === 'list') console.log(JSON.stringify(all));
else if (verb === 'create') { all.push({ id: flag('--id'), title: a[0], status: flag('-s'), priority: Number(flag('-p')), issue_type: flag('-t'), labels: (flag('-l') || '').split(',').filter(Boolean), metadata: JSON.parse(flag('--metadata')), description: flag('-d'), created_at: now, updated_at: now }); save(); }
else if (verb === 'update') { const r = all.find((x) => x.id === a[0]); r.status = flag('-s'); r.title = flag('--title'); r.metadata = { ...r.metadata }; for (let i = 0; i < a.length; i++) { if (a[i] === '--set-metadata') { const [k, v] = a[i + 1].split(/=(.*)/s); r.metadata[k] = /^\\d+$/.test(v) ? Number(v) : v; } if (a[i] === '--unset-metadata') delete r.metadata[a[i + 1]]; } r.updated_at = now; save(); }
else { console.error('unserved verb ' + verb); process.exit(2); }
`);
chmodSync(wrapper, 0o755);
const seed = [
  { id: 'jg-1', title: 'Ship the board', status: 'in_progress', priority: 1, issue_type: 'task', labels: ['project:alpha', 'asked'], metadata: { progress: 40, stage: 'building', prs: 'https://github.com/o/r/pull/9' }, created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-05T09:00:00Z' },
  { id: 'jg-2', title: 'Pick the logo', status: 'on_hold', priority: 2, issue_type: 'task', labels: [], metadata: { hold_reason: 'Waiting on the owner' }, dependencies: [{ issue_id: 'jg-2', depends_on_id: 'jg-4', type: 'blocks' }, { issue_id: 'jg-2', depends_on_id: 'jg-3', type: 'blocks' }], created_at: '2026-11-02T09:00:00Z', updated_at: '2026-11-05T10:00:00Z' },
  { id: 'jg-3', title: 'Old chore', status: 'closed', priority: 3, issue_type: 'bug', labels: [], created_at: '2026-10-01T09:00:00Z', updated_at: '2026-11-04T09:00:00Z', closed_at: '2026-11-04T09:00:00Z' },
  { id: 'jg-4', title: 'The epic', status: 'open', priority: 2, issue_type: 'epic', labels: [], created_at: '2026-10-01T09:00:00Z', updated_at: '2026-11-04T09:00:00Z' },
  { id: 'jg-5', title: 'Under the epic', status: 'open', priority: 2, issue_type: 'task', labels: [], dependencies: [{ issue_id: 'jg-5', depends_on_id: 'jg-4', type: 'parent-child' }], created_at: '2026-10-01T09:00:00Z', updated_at: '2026-11-04T09:00:00Z' },
];
writeFileSync(rows, JSON.stringify(seed));
const board = join(scratch, 'board.json');
const env = { ...process.env, HOME: scratch, XDG_CONFIG_HOME: scratch, XDG_DATA_HOME: scratch, XDG_CACHE_HOME: scratch, SIGN_OFF_HOME: scratch, SIGN_OFF_BEADS_DIR: join(store, '.beads'), SIGN_OFF_BEADS_WRAPPER: wrapper };
delete env.CLAUDE_CODE_SESSION_ID; delete env.SIGN_OFF_FILER;
const axi = (...args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tickets = () => JSON.parse(axi('ticket', board, '--json')).tickets;

test('the board lists the tickets Beads holds, with their hold reason, pull requests and parent', () => {
  const by = Object.fromEntries(tickets().map((t) => [t.id, t]));
  assert.equal(Object.keys(by).length, 5);
  assert.deepEqual([by['jg-1'].priority, by['jg-1'].project, by['jg-1'].asked, by['jg-1'].stage, by['jg-1'].state, by['jg-1'].progress], ['P1', 'alpha', true, 'building', 'in progress', 40]);
  assert.deepEqual(by['jg-1'].prs, ['https://github.com/o/r/pull/9']);
  assert.deepEqual([by['jg-2'].hold, by['jg-2'].hold_reason, by['jg-2'].state], [true, 'Waiting on the owner', 'on hold']);
  assert.deepEqual(by['jg-2'].blocked_by, ['jg-4'], 'it waits on the open ticket, not on the closed one');
  assert.equal(by['jg-1'].blocked_by, undefined);
  assert.deepEqual([by['jg-3'].state, by['jg-3'].progress, by['jg-3'].type], ['done', 100, 'bug']);
  assert.deepEqual([by['jg-4'].type, by['jg-5'].parent, by['jg-4'].progress], ['epic', 'jg-4', 0]);
});

test('a write goes to Beads through the wrapper and the board file gets no tickets file', () => {
  axi('ticket', board, '--id', 'build-demo', '--description', 'Summary line.', '--title', 'Build the demo', '--progress', '10', '--project', 'alpha');
  axi('ticket', board, '--id', 'jg-1', '--progress', '70');
  const by = Object.fromEntries(JSON.parse(readFileSync(rows, 'utf8')).map((r) => [r.id, r]));
  assert.deepEqual([by['build-demo'].title, by['build-demo'].labels, by['build-demo'].metadata.progress], ['Build the demo', ['project:alpha'], 10]);
  assert.equal(by['jg-1'].metadata.progress, 70);
  assert.equal(existsSync(join(scratch, 'board.tickets.jsonl')), false);
  assert.match(readFileSync(log, 'utf8'), /^create Build the demo --id build-demo --force /m);
});

test('a hold put on a ticket needs its reason, is stored as on_hold, and releasing it drops the reason', () => {
  assert.throws(() => axi('ticket', board, '--id', 'jg-1', '--hold', 'yes'), (e) => /hold needs --hold-reason/.test(e.stdout + e.stderr));
  axi('ticket', board, '--id', 'jg-1', '--hold', 'yes', '--hold-reason', 'Waiting on the store review');
  const held = JSON.parse(readFileSync(rows, 'utf8')).find((r) => r.id === 'jg-1');
  assert.deepEqual([held.status, held.metadata.hold_reason], ['on_hold', 'Waiting on the store review']);
  axi('ticket', board, '--id', 'jg-1', '--hold', 'no', '--state', 'in progress');
  const freed = JSON.parse(readFileSync(rows, 'utf8')).find((r) => r.id === 'jg-1');
  assert.deepEqual([freed.status, freed.metadata.hold_reason], ['in_progress', undefined]);
});

test('an unreadable store is said plainly and the board still answers', () => {
  writeFileSync(wrapper, '#!/bin/sh\necho "the store is locked" >&2\nexit 2\n');
  const out = execFileSync(process.execPath, [cli, 'ticket', board, '--json'], { env: { ...env, SIGN_OFF_BEADS_DIR: join(store, '.beads') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.deepEqual(JSON.parse(out).tickets, []);
});
