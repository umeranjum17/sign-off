import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { once } from 'node:events';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const exec = promisify(execFile);
test('serve tells its starter how to stop only that board without a shell kill', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sign-off-serve-stop-'));
  const env = { ...process.env, SIGN_OFF_HOME: dir, HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_CACHE_HOME: dir };
  const children = [];
  const run = (...args) => exec(process.execPath, [cli, ...args], { env });
  try {
    const boards = [];
    for (const name of ['umer', 'other']) {
      const board = join(dir, `${name}.json`);
      writeFileSync(board, '{"schema":2,"items":[]}\n');
      const child = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      const ended = once(child, 'exit');
      let output = '';
      for await (const chunk of child.stdout) {
        output += chunk;
        if (/url: "http:\/\/127\.0\.0\.1:\d+\/"/.test(output)) break;
      }
      const url = /url: "(http:\/\/127\.0\.0\.1:\d+\/)"/.exec(output)?.[1];
      assert.ok(url, output);
      boards.push({ board, child, ended, url, output });
    }
    const [ours, other] = boards;
    assert.equal((await fetch(`${ours.url}api/board`)).status, 200);
    const stopped = await run('stop', ours.board);
    assert.match(stopped.stdout, /status: stopped/);
    assert.deepEqual(await ours.ended, [0, null]);
    assert.throws(() => process.kill(ours.child.pid, 0), { code: 'ESRCH' });
    assert.equal(existsSync(ours.board.replace('.json', '.board.pid')), false);
    await assert.rejects(fetch(ours.url, { signal: AbortSignal.timeout(1000) }));
    assert.equal((await fetch(`${other.url}api/board`)).status, 200);
    assert.match((await run('stop', ours.board)).stdout, /not running \(no-op\)/);
    await run('stop', other.board);
    assert.deepEqual(await other.ended, [0, null]);
    assert.match(ours.output, /Run `sign-off-axi stop /);
    console.log('Both foreground servers exited cleanly; stopped PID and port gone; other board survived; repeated stop safe.');
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit');
        child.kill();
        await ended;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
