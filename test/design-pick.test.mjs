import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const run = promisify(execFile), cli = new URL('../dist/cli.js', import.meta.url).pathname;

// A design pick (post --type design) must open each option as a page that runs, and one decision is one card.
test('a pick refuses a page of pictures, and a repeated pick, but takes a page that runs', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dp-')), board = join(home, 'board.json'), env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'c'), XDG_STATE_HOME: join(home, 's'), XDG_DATA_HOME: join(home, 'd'), XDG_CACHE_HOME: join(home, 'k') };
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'mocks/k'), { recursive: true });
  writeFileSync(join(home, 'mocks/k/sheet.html'), '<h2>Light</h2><figure><img src="data:image/png;base64,AAAA"><figcaption>Computer</figcaption></figure>');
  writeFileSync(join(home, 'mocks/k/live.html'), '<img src="data:image/png;base64,AAAA"><button onclick="document.title=1">Next</button>');
  const post = (key, title, mock) => run(process.execPath, [cli, 'post', board, '--type', 'design', '--key', key, '--title', title, '--option', 'a=A', '--option', 'b=B', '--mock', `a=${mock}`, '--mock', `b=${mock}`, '--recommend', 'a'], { env });
  await assert.rejects(post('k1', 'Which layout?', 'mocks/k/sheet.html'), (e) => /is a sheet of pictures/.test(e.stdout + e.stderr) && /running prototype page/.test(e.stdout + e.stderr));
  assert.match((await post('k1', 'Which layout should it use?', 'mocks/k/live.html')).stdout, /k1/);
  await assert.rejects(post('k2', 'Which layout should it use today?', 'mocks/k/live.html'), (e) => /asks what k1 already asks/.test(e.stdout + e.stderr));
});
