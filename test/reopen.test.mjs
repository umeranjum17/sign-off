import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asked } from './support/ask.mjs';

// Reopen: the real CLI and the real board, end to end. An answered card goes back to the list it belongs to, the person's answer stays in the record and the thread.
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const png = readFileSync(new URL('../fixtures/evidence/product-small.png', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-reopen-'));
const bin = join(scratch, 'bin');
mkdirSync(bin);
mkdirSync(join(scratch, 'home'));
symlinkSync(process.execPath, join(bin, 'node'));
const env = { ...process.env, PATH: bin, HOME: join(scratch, 'home') };
for (const name of ['SIGN_OFF_FILER', 'CLAUDE_CODE_SESSION_ID', 'npm_command', 'npm_config_package']) delete env[name];
const run = (...args) => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...asked(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout}${e.stderr}`, code: e.status };
  }
};
const post = (url, path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const state = async (url) => (await fetch(`${url}api/state`)).json();
const procs = [];
after(async () => {
  if (shared?.proc.exitCode === null) {
    const exited = new Promise((ok) => shared.proc.once('exit', ok));
    shared.call('Browser.close');
    await exited;
    shared.ws.close();
  }
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});
const served = (proc) => new Promise((ok) => {
  let out = '';
  proc.stdout.on('data', (b) => { out += b; if (/pid: \d+/.test(out)) ok(out); });
  proc.once('exit', () => ok(out));
});
const serve = async (file) => {
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(proc);
  return { proc, url: /url: "(\S+)"/.exec(await served(proc))[1] };
};
/** A design review of one screen, posted by a lead. */
const designMessage = (dir, key) => {
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'preview.png'), png);
  writeFileSync(join(dir, 'design', 'a.png'), png);
  const message = join(dir, `${key}.json`);
  writeFileSync(message, JSON.stringify({ contract: 1, kind: 'design', schema: 1, key, title: 'Approve the welcome screen?', about: 'Check the welcome screen before release.', group: 'Sign-in',
    filed: '2026-10-18T12:00:00Z', status: 'in_review', preview: 'design/preview.png',
    journeys: [{ id: 'flow', title: 'Flow', screens: [{ id: 'a', title: 'Welcome', views: { phone_light: 'design/a.png' } }] }] }));
  return message;
};
const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('reopening an answered pick: it waits again, the earlier answer stays in the record and the thread, and a new answer supersedes it', async () => {
  const file = join(scratch, 'pick', 'board.json');
  assert.equal(run('raise', file, '--key', 'ship-day', '--title', 'Which day should the release ship?', '--option', 'a=A: Today', '--option', 'b=B: Friday', '--recommend', 'b').code, 0);
  const { url } = await serve(file);
  assert.equal((await post(url, 'api/answers', { key: 'ship-day', answer: 'a', note: 'Today, the fixes are in.' })).status, 200);

  const out = run('reopen', 'ship-day', file);
  assert.equal(out.code, 0, out.out);
  assert.match(out.out, /reopened\[1\]/);
  assert.match(out.out, /ship-day/);
  assert.match(out.out, /A: Today/);
  assert.match(out.out, /waits in Decide again/);

  // The card is open: no answer, waiting, and the CLI's wait would block.
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out), {});
  assert.match(run('list', file, '--full').out, /ship-day,waiting/);

  // The person's answer is still in the record, and the reopen is its own event after it.
  const answerLog = lines(join(scratch, 'pick', 'board.answers.jsonl'));
  assert.equal(answerLog.length, 1);
  assert.equal(answerLog[0].answer, 'a');
  assert.equal(answerLog[0].note, 'Today, the fixes are in.');
  const [event] = lines(join(scratch, 'pick', 'board.reopened.jsonl'));
  assert.equal(event.key, 'ship-day');
  assert.equal(event.was.label, 'A: Today');
  assert.equal(event.was.note, 'Today, the fixes are in.');
  assert.ok(Date.parse(event.at) >= Date.parse(answerLog[0].at));

  // The board hands the page both: no answer, the reopen held, and the answer still in the trail.
  const board = await state(url);
  assert.equal(board.answers['ship-day'], undefined);
  assert.equal(board.reopened.length, 1);
  assert.equal(board.reopened[0].held, true);
  assert.equal(board.reopened[0].was.note, 'Today, the fixes are in.');
  assert.deepEqual(board.trail.filter((t) => t.key === 'ship-day').map((t) => t.kind), ['answer']);

  // Refused: an open card, an unknown key, and a card that is no longer on the board.
  const again = run('reopen', 'ship-day', file);
  assert.equal(again.code, 1);
  assert.match(again.out, /ship-day is already open/);
  assert.match(again.out, /CONFLICT/);
  assert.equal(lines(join(scratch, 'pick', 'board.reopened.jsonl')).length, 1);
  const unknown = run('reopen', 'nope', file);
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /no card with key nope/);
  assert.match(unknown.out, /NOT_FOUND/);
  assert.equal(run('reopen', file).code, 2, 'a key is needed');

  // The board's endpoint follows the same rules.
  const open = await post(url, 'api/reopen', { key: 'ship-day' });
  assert.equal(open.status, 409);
  assert.match((await open.json()).error, /already open/);
  const missing = await post(url, 'api/reopen', { key: 'nope' });
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /no card with key nope/);

  // A later answer records normally, names the answer it replaces, and the reopen no longer holds.
  assert.equal((await post(url, 'api/answers', { key: 'ship-day', answer: 'b', note: 'Friday is safer.' })).status, 200);
  const now = (await state(url));
  assert.equal(now.answers['ship-day'].answer, 'b');
  assert.equal(now.answers['ship-day'].replaces.label, 'A: Today');
  assert.equal(now.answers['ship-day'].replaces.note, 'Today, the fixes are in.');
  assert.equal(now.reopened[0].held, undefined);
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out)['ship-day'].answer, 'b');
  assert.equal(lines(join(scratch, 'pick', 'board.answers.jsonl')).length, 2);

  // An answered card reopens through the endpoint too, and again after that.
  const second = await post(url, 'api/reopen', { key: 'ship-day' });
  assert.equal(second.status, 200);
  const board2 = await second.json();
  assert.equal(board2.answers['ship-day'], undefined);
  assert.deepEqual(board2.reopened.map((r) => [r.was.answer, r.held]), [['a', undefined], ['b', true]]);

  // A card gone from the board file cannot be reopened.
  assert.equal((await post(url, 'api/answers', { key: 'ship-day', answer: 'a' })).status, 200);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...doc, items: doc.items.filter((i) => i.key !== 'ship-day') }));
  const gone = run('reopen', 'ship-day', file);
  assert.equal(gone.code, 1);
  assert.match(gone.out, /no longer on the board/);
  const goneApi = await post(url, 'api/reopen', { key: 'ship-day' });
  assert.equal(goneApi.status, 404);
  assert.match((await goneApi.json()).error, /no longer on the board/);
});

test('a reopened ask can be asked again on the same key; without a reopen a different question under a used key is still refused', async () => {
  const file = join(scratch, 'again', 'board.json');
  const ask = (...extra) => run('raise', file, '--key', 'which-look', '--title', 'Which look should the sign-in take?', ...extra);
  assert.equal(ask('--option', 'a=A: Light', '--option', 'b=B: Dark', '--recommend', 'a').code, 0);
  const { url } = await serve(file);
  assert.equal((await post(url, 'api/answers', { key: 'which-look', answer: 'b' })).status, 200);
  const refused = ask('--option', 'c=C: Light with blue', '--option', 'd=D: Dark with blue', '--recommend', 'c');
  assert.equal(refused.code, 1);
  assert.match(refused.out, /already/);
  assert.equal(run('reopen', 'which-look', file).code, 0);
  const next = ask('--option', 'c=C: Light with blue', '--option', 'd=D: Dark with blue', '--recommend', 'c');
  assert.equal(next.code, 0, next.out);
  assert.match(next.out, /raised again/);
  const board = await state(url);
  assert.deepEqual(board.decisions.find((d) => d.key === 'which-look').options.map((o) => o.value), ['c', 'd']);
  assert.equal(board.answers['which-look'], undefined);
  assert.equal(board.reopened[0].was.label, 'B: Dark');
  assert.equal((await post(url, 'api/answers', { key: 'which-look', answer: 'd' })).status, 200);
  assert.equal((await state(url)).answers['which-look'].replaces.label, 'B: Dark');
});

test('reopening an answered design review: it returns to Designs, its verdict stays in the record, and an open one is refused', async () => {
  const dir = join(scratch, 'design'), file = join(dir, 'board.json');
  assert.equal(run('post', file, '--kind', 'design', '--from', designMessage(dir, 'welcome-design')).code, 0);
  const { url } = await serve(file);
  const open = run('reopen', 'welcome-design', file);
  assert.equal(open.code, 1);
  assert.match(open.out, /already open/);
  assert.equal((await post(url, 'api/reopen', { key: 'welcome-design' })).status, 409);
  assert.equal((await post(url, 'api/answers', { key: 'welcome-design', verdict: 'change', notes: [{ verdict: 'change', note: 'The title is too small.' }] })).status, 200);
  assert.equal(JSON.parse(run('answers', file, '--json').out)['welcome-design'].answer, 'change');

  const done = run('reopen', 'welcome-design', file);
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /waits in Designs again/);
  assert.deepEqual(JSON.parse(run('answers', file, '--json').out), {});
  assert.match(run('list', file, '--full').out, /welcome-design,in review/);
  const [kept] = lines(join(dir, 'board.answers.jsonl'));
  assert.equal(kept.answer, 'change');
  assert.equal(kept.notes[0].note, 'The title is too small.');
  const board = await state(url);
  assert.equal(board.answers['welcome-design'], undefined);
  assert.equal(board.reopened[0].was.notes[0].note, 'The title is too small.');
  assert.equal(board.trail.filter((t) => t.key === 'welcome-design')[0].kind, 'answer');

  // Approved the second time round: it records normally and names the verdict it replaces.
  assert.equal((await post(url, 'api/answers', { key: 'welcome-design', verdict: 'approve', notes: [] })).status, 200);
  const now = await state(url);
  assert.equal(now.answers['welcome-design'].answer, 'approve');
  assert.equal(now.answers['welcome-design'].replaces.label, 'Changes requested');
});

test('a read-only board refuses to reopen', async () => {
  const file = join(scratch, 'ro', 'board.json');
  assert.equal(run('raise', file, '--key', 'ro-q', '--title', 'Keep the weekly digest?').code, 0);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...doc, readonly: true }));
  const { url } = await serve(file);
  assert.equal((await post(url, 'api/reopen', { key: 'ro-q' })).status, 403);
});

// A real browser draws the board for the page tests: CI's runner has Chrome; elsewhere they skip when none is on the PATH.
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((b) => process.env.PATH.split(':').map((d) => join(d, b))).find(existsSync);
// Chrome puts a socket in its TMPDIR and stops when that path passes 107 characters, so it gets one short throwaway TMPDIR of its own.
const chromeEnv = chrome && { ...process.env, TMPDIR: mkdtempSync('/tmp/so-') };
after(() => chromeEnv && rmSync(chromeEnv.TMPDIR, { recursive: true, force: true }));
const until = async (check) => {
  for (const end = Date.now() + 60000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await check()) return;
  assert.fail('the page did not reach the expected state');
};
let shared;
const browserFor = async () => {
  if (shared?.proc.exitCode === null && shared.ws.readyState === WebSocket.OPEN) return shared;
  const profile = mkdtempSync(join(scratch, 'chrome-')), active = join(profile, 'DevToolsActivePort');
  const proc = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, '--window-size=800,4000', '--remote-debugging-port=0', 'about:blank'],
    { env: chromeEnv, stdio: 'ignore' });
  procs.push(proc);
  await until(() => existsSync(active) && readFileSync(active, 'utf8').includes('\n'));
  const version = await (await fetch(`http://127.0.0.1:${readFileSync(active, 'utf8').split('\n')[0]}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  const replies = new Map();
  let seq = 0;
  ws.onmessage = (m) => { const msg = JSON.parse(m.data), done = replies.get(msg.id); if (!done) return; replies.delete(msg.id); done(msg.result); };
  const call = (method, params, sessionId) => new Promise((ok) => {
    const id = ++seq;
    replies.set(id, ok);
    setTimeout(() => { if (replies.delete(id)) ok(undefined); }, 10000).unref();
    ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
  return (shared = { proc, ws, call });
};
async function browse(width, height = 1200) {
  const { call } = await browserFor();
  const { browserContextId } = await call('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  const settle = () => send('Runtime.evaluate', { expression: 'new Promise((ok) => setTimeout(ok, 0))', awaitPromise: true });
  const evaluate = async (expression) => {
    const value = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
    await settle();
    return value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  return { evaluate, close: () => call('Target.disposeBrowserContext', { browserContextId }).catch(() => {}) };
}
const text = (selector) => `document.querySelector(${JSON.stringify(selector)})?.textContent`;

for (const [name, width] of [['a phone', 390], ['a desk', 1280]]) {
  test(`on ${name}, Reopen this question in an answered ask's menu asks first, then the ask is open again with the earlier answer in its thread`, { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
    const file = join(scratch, `ui-pick-${width}`, 'board.json');
    assert.equal(run('raise', file, '--key', 'ship-day', '--title', 'Which day should the release ship?', '--option', 'a=A: Today', '--option', 'b=B: Friday', '--recommend', 'b').code, 0);
    const { url } = await serve(file);
    assert.equal((await post(url, 'api/answers', { key: 'ship-day', answer: 'a', note: 'Today, the fixes are in.' })).status, 200);
    const { evaluate, close } = await browse(width);
    try {
      await evaluate(`location.href = ${JSON.stringify(`${url}#decide/ship-day`)}`);
      await until(async () => (await evaluate(text('.decide .ans-card b'))) === 'A: Today');
      // The menu holds the one action; it asks before it does anything.
      await evaluate('document.querySelector(".decide .dl-more summary, .split-detail .dl-more summary").click()');
      await until(async () => (await evaluate('document.querySelector(".dl-menu [data-act=reopen]")?.textContent')) === 'Reopen this question');
      await evaluate('document.querySelector(".dl-menu [data-act=reopen]").click()');
      await until(async () => (await evaluate('document.querySelector("#dc-sheet")?.open')) === true);
      assert.match(await evaluate(text('#dc-sheet .t-line')), /Your answer stays in its thread/);
      assert.match(await evaluate(text('#dc-sheet .t-line')), /can’t be undone from here/);
      // Keeping the answer closes the sheet and changes nothing.
      await evaluate('document.querySelector("#dc-sheet [data-act=keep]").click()');
      await until(async () => (await evaluate('document.querySelector("#dc-sheet")?.open')) === false);
      assert.equal((await state(url)).answers['ship-day'].answer, 'a');
      // Reopening it records the event and the card waits again.
      await evaluate('document.querySelector(".decide .dl-more summary, .split-detail .dl-more summary").click()');
      await evaluate('document.querySelector(".dl-menu [data-act=reopen]").click()');
      await until(async () => (await evaluate('document.querySelector("#dc-sheet")?.open')) === true);
      await evaluate('document.querySelector("#dc-sheet [data-act=reopen]").click()');
      await until(async () => (await evaluate(text('.decide .ui-dl, .split-detail .ui-dl'))) !== null && (await evaluate('[...document.querySelectorAll(".decide .ui-dl, .split-detail .ui-dl")].some((e) => e.textContent === "Your earlier answer")')));
      assert.equal((await state(url)).answers['ship-day'], undefined);
      // The ask is open again, with its choices, and shows what the person said before.
      assert.equal(await evaluate('document.querySelectorAll(".pick-list li").length > 0'), true);
      assert.equal(await evaluate(text('.decide .ans-card b, .split-detail .ans-card b')), 'A: Today');
      assert.equal(await evaluate(text('.decide .ans-card q, .split-detail .ans-card q')), 'Today, the fixes are in.');
      // The card's Activity lists the answer, then the reopen.
      assert.match(await evaluate('[...document.querySelectorAll(".thread .ui-act li")].map((li) => li.querySelector("b").textContent).join("|")'), /Your answer: A: Today\|.*reopened this question/);
    } finally {
      await close();
    }
  });
}

test('on a desk, a design review answered by the person can be reopened from its page, and its earlier verdict stays on the page', { skip: !chrome && !process.env.CI && 'no Chrome on the PATH' }, async () => {
  const dir = join(scratch, 'ui-design'), file = join(dir, 'board.json');
  assert.equal(run('post', file, '--kind', 'design', '--from', designMessage(dir, 'welcome-design')).code, 0);
  const { url } = await serve(file);
  assert.equal((await post(url, 'api/answers', { key: 'welcome-design', verdict: 'change', notes: [{ verdict: 'change', note: 'The title is too small.' }] })).status, 200);
  const { evaluate, close } = await browse(1280);
  try {
    await evaluate(`location.href = ${JSON.stringify(`${url}#designs/welcome-design`)}`);
    await until(async () => (await evaluate('[...document.querySelectorAll("button")].some((b) => b.textContent === "Reopen this question")')));
    await evaluate('[...document.querySelectorAll("button")].find((b) => b.textContent === "Reopen this question").click()');
    await until(async () => (await evaluate('document.querySelector("#dc-sheet")?.open')) === true);
    await evaluate('document.querySelector("#dc-sheet [data-act=reopen]").click()');
    await until(async () => (await evaluate('[...document.querySelectorAll(".dz-props .k")].some((e) => e.textContent === "Reopened")')));
    assert.match(await evaluate('[...document.querySelectorAll(".dz-props .ui-pr")].find((e) => e.querySelector(".k")?.textContent === "Reopened").textContent'), /Before: Changes requested/);
    assert.equal((await state(url)).answers['welcome-design'], undefined);
    assert.match(await evaluate('[...document.querySelectorAll(".thread .ui-act li")].map((li) => li.textContent).join("|")'), /Your answer: Changes requested.*The title is too small.*reopened this question/);
  } finally {
    await close();
  }
});
