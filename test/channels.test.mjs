import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactComms } from '../dist/channels.js';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
test('Channels reads bounded real sources, keeps stable IDs across appends, pages history and redacts before HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'channels-'));
  let proc;
  try {
    const board = join(dir, 'board.json'), ledger = join(dir, 'ledger.jsonl'), feed = join(dir, 'feed.jsonl');
    copyFileSync(new URL('../fixtures/sample-decisions.json', import.meta.url), board);
    const homes = ['Main', ...Array.from({ length: 13 }, (_, i) => `team-${i}`)];
    writeFileSync(join(dir, 'config.yaml'), `comms_ledger: ${ledger}\ncomms_feed: ${feed}\ncomms_homes: ${homes.join(', ')}\n`);
    const key = ['sk', 'AbCd0123456789AbCd0123456789'].join('-');
    const row = (i) => ({ v: 1, ts: 1700000000 + i, event: 'task.status', task: 'team-0', state: 'working', key: '', text: `${i}: ${'older history '.repeat(30)}` });
    writeFileSync(ledger, Array.from({ length: 2000 }, (_, i) => JSON.stringify(row(i))).join('\n') + '\n');
    proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: dir, env: { ...process.env, SIGN_OFF_COMMS_LEDGER: '', SIGN_OFF_COMMS_FEED: '', SIGN_OFF_COMMS_HOMES: '' } });
    let errors = ''; proc.stderr.on('data', (b) => errors += b);
    const url = await new Promise((ok, no) => {
      let said = ''; proc.stdout.on('data', (b) => { said += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(said); if (m) ok(m[0]); });
      proc.once('exit', (code) => no(new Error(`server exited ${code}: ${errors}`)));
    });
    const get = async (query = '') => { const r = await fetch(`${url}api/channels${query}`); return { response: r, body: await r.json() }; };
    const first = await get();
    assert.equal(first.response.headers.get('cache-control'), 'no-store');
    assert.equal(first.body.homes.length, 14);
    assert.ok(first.body.messages.length < 2000 && first.body.messages.length > 10);
    assert.ok(first.body.before > 0);
    assert.equal(first.body.messages.at(-1).text.startsWith('1999:'), true);
    const lastId = first.body.messages.at(-1).id;
    appendFileSync(ledger, JSON.stringify({ ...row(2001), text: `Do not disclose API_KEY=${key} or Bearer ${key}; <script>alert(1)</script>`, model: 'gpt-6.1-sol' }) + '\n');
    const next = await get();
    assert.equal(next.body.messages.find((m) => m.text.startsWith('1999:')).id, lastId);
    assert.equal(next.body.messages.at(-1).runtime, 'gpt-6.1-sol');
    assert.ok(!JSON.stringify(next.body).includes(key));
    assert.equal(next.body.messages.at(-1).read, 'Read not recorded');
    assert.equal(next.body.messages.at(-1).handled, 'Handled not recorded');
    const older = await get(`?before=${first.body.before}`);
    assert.ok(older.body.messages.at(-1).at < first.body.messages[0].at);
    const deep = (await get(`?message=${encodeURIComponent(older.body.messages[0].id)}`)).body;
    assert.ok(deep.messages.some((m) => m.id === older.body.messages[0].id), 'an older message deep link resolves without loading all history');
    const repeated = await get();
    assert.equal((await fetch(`${url}api/channels`, { headers: { 'if-none-match': repeated.response.headers.get('etag') } })).status, 304);
    // The official feed takes over without a restart when it appears; no source schema invents receipts.
    writeFileSync(feed, JSON.stringify({ id: 'order-1', at: 1700010000, home: 'team-1', thread: 'worker-a', from: { name: 'Lead', model: 'Opus 5.5' }, to: { name: 'Worker' }, kind: 'order', text: `Use TOKEN=${key}`, read_at: null, handled_at: null }) + '\n');
    const official = (await get()).body;
    assert.equal(official.source, 'Fleet feed');
    assert.equal(official.partial, false);
    assert.equal(official.messages[0].channel, 'team-1');
    assert.equal(official.messages[0].thread, 'worker-a');
    assert.equal(official.messages[0].runtime, 'Opus 5.5');
    assert.equal(official.messages[0].to, 'Worker');
    assert.ok(!JSON.stringify(official).includes(key));
    appendFileSync(feed, '{"text":"torn');
    assert.equal((await get()).body.messages.length, 1);
    const invalid = await fetch(`${url}api/channels?before=../secret`);
    assert.equal(invalid.status, 400);
    rmSync(feed); rmSync(ledger);
    const failed = (await get()).body;
    assert.equal(failed.available, false);
    assert.ok(!JSON.stringify(failed).includes(dir), 'source failures expose no filesystem paths');
  } finally {
    if (proc && proc.exitCode === null) { proc.kill(); await new Promise((ok) => proc.once('exit', ok)); }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('communications redaction covers metadata-shaped credentials and URLs', () => {
  const secret = 'AbCd0123456789'.repeat(4);
  for (const text of [`password="${secret}"`, `NPM_TOKEN=${secret}`, `https://example.test/?token=${secret}`, `Bearer ${secret}`, `github_pat_${secret}`]) {
    assert.ok(!redactComms(text).includes(secret));
  }
});
