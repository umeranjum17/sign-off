// A comment sent with an answer: Add a comment under a yes/no on Decide, typed, answered, then read back on the Answered card and by `answers`.
// Usage: node .agents/skills/done-done-verify-sign-off/comment-shots.mjs <output> [light|dark]
// COMMENT_WIDTH=390 or 1280 (default 390). Saves decide.<theme>.<width>w.png (the ask as it opens), comment.<theme>.<width>w.png (the box open with the typed comment), more-open.<theme>.<width>w.png (the bar's More… open),
// answered-card.<theme>.<width>w.png (the Answered card showing the comment) and answers.<theme>.<width>w.txt (what the agent reads: `answers` and `answers --json`).
// It only finds the box by its place under the choices, so the same run on an older board captures where its box was.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), theme = process.argv[3] ?? 'light', width = +(process.env.COMMENT_WIDTH ?? 390);
assert.ok([390, 1280].includes(width));
mkdirSync(out, { recursive: true });
const repo = resolve(import.meta.dirname, '../../..'), cell = `${theme}.${width}w`;
const dir = mkdtempSync(join(tmpdir(), 'so-comment-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-comment-${process.pid}` };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const read = (js) => JSON.parse(JSON.parse(JSON.parse(browser('eval', js).match(/result: (".*")/)[1])));
const pause = (ms) => browser('eval', `() => new Promise((r) => setTimeout(() => r(1), ${ms}))`);
// Each shot holds one settled state: every animation on the page finished, two frames painted, nothing focused that would draw a ring.
const settle = () => browser('eval', `async () => { await new Promise((r) => setTimeout(r, 300)); for (let i = 0; i < 50 && document.getAnimations().some((a) => a.playState === 'running'); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return 1; }`);
const text = 'Looks good, but I want to see reports and the desktop variant too';
let server;
try {
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  writeFileSync(board, JSON.stringify({ schema: 2, items: [
    { key: 'feel', title: 'Does the new feel look right?', about: 'Umer taps through the redone Today and Decide: every tap presses, springs and shows a toast with Undo.', options: yesNo, recommend_value: 'yes', filed: new Date().toISOString() },
  ] }));
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(Error(`Server exited ${code}`))); });
  browser('open', base);
  browser('emulate', '--viewport', `${width}x844x2${width === 390 ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  browser('open', `${base}#decide/feel`);
  browser('eval', `async () => { for (let i = 0; i < 50 && !document.querySelector('.decide .pick-option'); i++) await new Promise((r) => setTimeout(r, 100)); scrollTo(0, 0); return 1; }`);
  pause(400);
  // Where the box line sits: in the first screen, or below it.
  const place = read(`() => { const s = document.querySelector('.decide-other details > summary'), r = s.getBoundingClientRect(); return JSON.stringify({ label: s.textContent, top: Math.round(r.top), inFirstScreen: r.bottom <= innerHeight }); }`);
  settle();
  browser('screenshot', join(out, `decide.${cell}.png`));
  // The bar's one More…, tapped open on its own: what the card keeps out of the way of Answer.
  browser('eval', `() => { document.querySelector('.decide-bar .more-menu > summary').click(); document.activeElement?.blur(); return 1; }`);
  settle();
  const menu = read(`() => JSON.stringify([...document.querySelectorAll('.decide-bar .more-menu .menu > *')].filter((e) => e.getClientRects().length).map((e) => e.textContent))`);
  browser('screenshot', join(out, `more-open.${cell}.png`));
  browser('eval', `() => { document.querySelector('.decide-bar .more-menu > summary').click(); return 1; }`);
  browser('eval', `() => { const s = document.querySelector('.decide-other details > summary'); s.click(); s.scrollIntoView({ block: 'center' }); document.querySelector('.decide-other textarea').focus(); return 1; }`);
  browser('type', text); // real key events into the focused box
  pause(400);
  // The feel: the line's press and the box's ease-in, as the page runs them.
  const motion = read(`() => { const s = document.querySelector('.decide-other details > summary'), box = document.querySelector('.decide-other textarea'), c = getComputedStyle(s), b = getComputedStyle(box);
    return JSON.stringify({ press: c.transitionDuration, boxAnimation: b.animationName + ' ' + b.animationDuration, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }); }`);
  browser('eval', `() => { scrollTo(0, 0); return 1; }`);
  settle();
  browser('screenshot', join(out, `comment.${cell}.png`));
  browser('eval', `() => { document.querySelector('.decide-bar .answer').click(); return 1; }`);
  pause(6000); // the Saved toast has gone
  browser('open', `${base}#answered`);
  browser('eval', `async () => { for (let i = 0; i < 50 && !document.querySelector('#item-feel'); i++) await new Promise((r) => setTimeout(r, 100)); const d = document.querySelector('#item-feel').closest('details'); if (d) d.open = true; document.querySelector('#item-feel').scrollIntoView({ block: 'start' }); scrollBy(0, -120); return 1; }`);
  browser('eval', `() => { document.activeElement?.blur(); return 1; }`);
  settle();
  const card = read(`() => JSON.stringify({ saved: document.querySelector('#item-feel .saved-note')?.textContent ?? '', line: document.querySelector('#item-feel details > summary[aria-label]')?.textContent ?? '', overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
  browser('screenshot', join(out, `answered-card.${cell}.png`));
  const toon = run(process.execPath, [join(repo, 'dist/cli.js'), 'answers', board], { env }), json = run(process.execPath, [join(repo, 'dist/cli.js'), 'answers', board, '--json'], { env });
  writeFileSync(join(out, `answers.${cell}.txt`), `box line on Decide: ${place.label} (top ${place.top}px, in the first screen: ${place.inFirstScreen})\nAnswered card: ${card.saved || '(no comment shown)'} | line: ${card.line} | sideways overflow: ${card.overflow}\nMore… holds: ${menu.join(', ')}\nmotion: press ${motion.press}, box ${motion.boxAnimation}, reduced motion ${motion.reducedMotion}\n\n$ sign-off-axi answers <board>\n${toon}\n$ sign-off-axi answers <board> --json\n${json}\n`);
  assert.equal(JSON.parse(json).feel.note, text);
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version }, start: 'A throwaway board holding one yes/no ask, Does the new feel look right?',
    steps: [`The board is opened on the ask in Decide at ${width} px wide, ${theme}.`, 'The person taps More… beside Answer, sees what it holds, and taps it closed.', 'The person taps Add a comment under the choices and types a comment.', 'The person taps Answer Yes.', 'The person opens Answered.'],
    result: 'The ask shows Answer Yes and one More… (holding Later, Dismiss and the other ways to send); the comment is saved as the answer\'s note and read back by sign-off-axi answers; the Answered card reads only Yes and shows "Your comment, sent with Yes: …" with Edit comment.' }, null, 2) + '\n');
} finally {
  server?.kill();
  try { browser('stop'); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
