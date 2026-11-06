import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'so-content-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HOME: join(scratch, 'home') };
delete env.SIGN_OFF_FILER;
delete env.CLAUDE_CODE_SESSION_ID;
mkdirSync(env.HOME);
const run = (...args) => { const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env }); return { code: r.status, out: r.stdout + r.stderr }; };
const fx = (name) => JSON.parse(readFileSync(new URL(`../fixtures/contract/${name}`, import.meta.url), 'utf8'));

// The page-based report the captain named: a cost table and one risk, and a Details line that points at its own content.
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bots share one computer</title>
<style>body{font:17px system-ui}@media (prefers-color-scheme: dark){body{background:Canvas}}</style></head><body>
<svg viewBox="0 0 40 40" role="img" aria-label="Bots share one computer"><rect width="40" height="40"/></svg>
<h1>Bots share one computer, and can get their own</h1><button id="n" type="button">Next</button>${body}</body></html>`;
const THIN = page(`<h2>What each choice costs</h2><table><tr><td>Shared computer</td><td>nothing extra</td></tr><tr><td>Its own cloud computer</td><td>paid by the hour</td></tr></table>
<h2>The one risk worth knowing</h2><p>If the shared computer runs out of memory, everything on it stops, every bot at once.</p>
<details><summary>Details</summary><p>The measured runs, the cost numbers and the slice list are kept with this plan. No code is written until you approve it.</p></details>`);
const FULL = page(`<h2>What each choice costs</h2><table><tr><th>Choice</th><th>Cost</th><th>Measured</th></tr><tr><td>Shared computer</td><td>nothing extra</td><td>12 bots used 8 GB of 16 GB</td></tr><tr><td>Its own cloud computer</td><td>$0.05 per hour</td><td>a bot starts in 95 seconds</td></tr></table>
<h2>The slices, in order</h2><ol><li>Show which computer each bot uses. Size: S, half a day. Done when the bot list names the computer for all 12 test bots.</li>
<li>Let a bot take a cloud computer when the shared one is busy. Size: L, 4 days. Done when 3 busy-machine runs in a row hand over within 120 seconds.</li></ol>
<h2>The one risk worth knowing</h2><ul><li>If the shared computer runs out of memory, everything on it stops. Mitigation: a bot takes its own computer once the shared one passes 80% of its memory.</li></ul>
<details><summary>Details</summary><p>No code is written until you approve it.</p></details>`);

const pageReport = (key, view) => ({ contract: 1, kind: 'report', schema: 2, key, title: 'Bots share one computer', about: 'Your answer as a plan.', filed: '2026-11-05T17:56:02Z', purpose: 'plan', project: 'Umer', view, preview: view.replace('index.html', 'preview.svg') });

test('a new plan report must show its slices, a measured number, no pointer-only section and each risk\'s mitigation; a thin one is refused naming each rule, a complete one posts, and one already on the board still re-posts', () => {
  const dir = join(scratch, 'plan'), board = join(dir, 'board.json');
  for (const [name, html] of [['thin', THIN], ['full', FULL]]) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'index.html'), html);
    writeFileSync(join(dir, name, 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3"/></svg>');
  }
  const send = (name, m) => { writeFileSync(join(dir, `${name}.json`), JSON.stringify(m)); return run('post', board, '--kind', 'report', '--from', join(dir, `${name}.json`)); };
  // The page-based shape: the thin page breaks all four plan rules, each named with its fix, and nothing is written.
  const thin = send('thin', pageReport('thin-plan', 'thin/index.html'));
  assert.equal(thin.code, 2, thin.out);
  for (const rule of ['plan-slices', 'plan-measured', 'plan-pointer', 'plan-risk']) assert.match(thin.out, new RegExp(`\\[${rule}\\]`));
  assert.match(thin.out, /kept with this plan/);
  assert.match(thin.out, /Mitigation: \.\.\./);
  assert.match(thin.out, /words a script writes into the page/);
  assert.ok(!existsSync(board) || !/thin-plan/.test(readFileSync(board, 'utf8')));
  // validate checks a file as it is; --new holds it to the rules a new post meets.
  assert.equal(run('validate', join(dir, 'thin.json')).code, 0);
  assert.equal(run('validate', '--new', join(dir, 'thin.json')).code, 2);
  // The same page with its slices, sizes, checks, numbers and a mitigation posts.
  assert.equal(send('full', pageReport('full-plan', 'full/index.html')).code, 0);
  // A thin report the board already holds is a re-post of its own key, never refused; a feed that carries it is not either.
  writeFileSync(board, JSON.stringify({ schema: 2, items: [{ ...pageReport('old-thin', 'thin/index.html') }] }));
  assert.equal(send('old', pageReport('old-thin', 'thin/index.html')).code, 0);
  // The guided shape: a plan 5 whose slices lack a check or an order, with a risk and no mitigation, is refused; with them it posts.
  mkdirSync(join(dir, 'diagrams'), { recursive: true });
  copyFileSync(new URL('../.agents/skills/done-done-verify-sign-off/diagram-sample/flow.html', import.meta.url), join(dir, 'diagrams', 'flow.html'));
  const base = fx('report.v5/valid-full.json');
  const sec = (part, heading, more = {}) => ({ id: part, part, stage: 'found', heading, body: `${heading}, in a line.`, ...more });
  const guided = (slices, risks, key) => ({ ...base, key, purpose: 'plan', about: 'Settings move into the profile page.', understood: [{ label: 'You asked', text: 'Move settings into the profile.' }], visual: { type: 'tiles', heading: 'Settings move into the profile', rows: [{ label: 'Today', text: 'Own page' }, { label: 'After', text: 'In the profile' }] }, title: 'Move settings into the profile page', project: 'Umer', sections: [sec('goal', 'Goal and non-goals'), sec('current', 'How it works today'),
    sec('design', 'Design', { diagram: [{ label: 'Flow', src: 'diagrams/flow.html' }] }), sec('slices', 'Slices', { items: slices }), sec('tests', 'Tests and proof', { items: [{ title: 'Move the page', text: 'A browser test opens it.' }] }),
    sec('risks', 'Risks and rollback', { items: risks }), sec('rollout', 'Rollout'), sec('estimate', 'Time'), sec('owner-calls', 'Your calls')] });
  const bareSlice = { title: 'Move the page', text: 'Settings open from the profile.', size: 'S, half a day' };
  const bad = send('g-thin', guided([bareSlice], [{ title: 'Old links break', text: 'Bookmarks to the old page stop working.' }], 'g-thin'));
  assert.equal(bad.code, 2, bad.out);
  assert.match(bad.out, /\[plan-slices\] 1 of 1 slices lack their acceptance check/);
  assert.match(bad.out, /\[plan-slices\] 1 of 1 slices lack their order/);
  assert.match(bad.out, /\[plan-measured\]/);
  assert.match(bad.out, /\[plan-risk\] 1 risk in \\?"Risks and rollback\\?" without a mitigation: \\?"Old links break Bookmarks/);
  const slice = { title: '1. Move the page', text: 'Settings open from the profile. Done when the browser test opens it in under 2 seconds.', size: 'S, half a day' };
  const good = send('g-full', guided([slice], [{ title: 'Old links break', text: 'Mitigation: the old address redirects for 30 days.' }], 'g-full'));
  assert.equal(good.code, 0, good.out);
});

test('a new research report must show its sources, its counts and its pick; a thin one is refused naming each rule, a complete one posts', () => {
  const dir = join(scratch, 'research'), board = join(dir, 'board.json');
  mkdirSync(dir, { recursive: true });
  const send = (name, m) => { writeFileSync(join(dir, `${name}.json`), JSON.stringify(m)); return run('post', board, '--kind', 'report', '--from', join(dir, `${name}.json`)); };
  const base = { ...fx('report.v5/valid-full.json'), project: 'Umer' };
  assert.equal(send('full', { ...base, key: 'r-full' }).code, 0);
  // A research report 4 has no parts to check, so its words and links are read: this one links nothing, counts nothing sourced and picks nothing.
  const { title, about, understood, visual, sections, next, ...frame } = fx('report.v4/valid-full.json');
  const thin = { ...frame, ...JSON.parse(JSON.stringify({ title, about, understood, visual, sections, next }, (_, v) => (typeof v === 'string' ? v.replace(/\d+/g, 'some') : v))), key: 'r-thin', purpose: 'research', project: 'Umer' };
  const r = send('thin', thin);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /\[research-sources\] names 0 source links, under 3/);
  assert.match(r.out, /\[research-counts\] states no count/);
  assert.match(r.out, /\[research-pick\] names no pick/);
  assert.ok(!/r-thin/.test(existsSync(board) ? readFileSync(board, 'utf8') : ''));
});
