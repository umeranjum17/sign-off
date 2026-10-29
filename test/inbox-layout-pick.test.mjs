import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const run = promisify(execFile), cli = new URL('../dist/cli.js', import.meta.url).pathname;
const pages = new URL('../fixtures/contract/design.v1/design/inbox-layout-pick/', import.meta.url).pathname;

// The Inbox layout pick: each option is a page that runs (rows to tap, a thread that opens, a way back), never a sheet of pictures,
// so the card can be posted again from a clean checkout.
test('the Inbox layout pick ships three running option pages that post as one design pick', async (t) => {
  assert.deepEqual(readdirSync(pages).sort(), ['a.html', 'b.html', 'c.html']);
  for (const name of ['a.html', 'b.html', 'c.html']) {
    const html = readFileSync(join(pages, name), 'utf8');
    assert.match(html, /<meta name="viewport"[^>]*width=device-width/, `${name}: a viewport tag`);
    assert.match(html, /@media\s*\(prefers-color-scheme:\s*dark\)/, `${name}: its own dark mode`);
    // A first-draft page runs without script: each row is a link to its thread, the thread shows as the link's target, and Back is a link to the list.
    for (const n of [1, 2, 3, 4, 5]) {
      assert.match(html, new RegExp(`<a\\b[^>]*href="#c${n}"[^>]*data-testid="row-${n}"|<a\\b[^>]*data-testid="row-${n}"[^>]*href="#c${n}"`), `${name}: row ${n} links to its thread`);
      assert.match(html, new RegExp(`<section\\b[^>]*id="c${n}"`), `${name}: thread ${n}`);
    }
    assert.match(html, /href="#list"/, `${name}: a way back to the list`);
    assert.match(html, /:target/, `${name}: the open thread is the link's target`);
    // The board frames a mock in a sandbox with no network and no storage, so the page loads nothing and keeps nothing.
    assert.doesNotMatch(html, /\b(src|href)\s*=\s*["']?(https?:)?\/\//i, `${name}: nothing from the web`);
    assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|document\.cookie/, `${name}: no storage`);
    assert.doesNotMatch(html, /data:image\/(png|jpe?g|webp)/, `${name}: no embedded screenshot`);
  }
  const home = mkdtempSync(join(tmpdir(), 'pick-')), board = join(home, 'board.json'), env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'c'), XDG_STATE_HOME: join(home, 's'), XDG_DATA_HOME: join(home, 'd'), XDG_CACHE_HOME: join(home, 'k') };
  t.after(() => rmSync(home, { recursive: true, force: true }));
  cpSync(pages, join(home, 'mocks/inbox-layout-pick'), { recursive: true });
  const { stdout } = await run(process.execPath, [cli, 'post', board, '--type', 'design', '--key', 'inbox-layout-pick', '--title', 'Which layout should the Inbox use for every conversation?',
    '--option', 'a=A: List and open thread, life in every row', '--option', 'b=B: One feed of your messages, replies inline', '--option', 'c=C: One conversation, the list as a side rail',
    ...['a', 'b', 'c'].flatMap((v) => ['--mock', `${v}=mocks/inbox-layout-pick/${v}.html`]), '--recommend', 'a'], { env });
  assert.match(stdout, /inbox-layout-pick/);
  const [item] = JSON.parse(readFileSync(board, 'utf8')).items;
  assert.deepEqual(item.mocks.map((m) => m.path), ['a', 'b', 'c'].map((v) => `mocks/inbox-layout-pick/${v}.html`));
});
