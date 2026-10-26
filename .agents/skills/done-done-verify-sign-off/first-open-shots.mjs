// The board's cold first open, measured on a board the size of a live one: seeds a throwaway board (thousands of answered and dismissed cards,
// guided plans whose writing a first screen must not carry), serves it on loopback, and measures the first open at 390 px in light and dark.
// usage: node first-open-shots.mjs <evidence folder>     (writes first-open-<theme>.png/.json, first-open-numbers.txt; fails over the gate)
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) { console.error('usage: node first-open-shots.mjs <evidence folder>'); process.exit(64); }
mkdirSync(out, { recursive: true });
const cli = join(process.cwd(), 'dist/cli.js'), here = new URL('.', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'so-first-open-')), board = join(dir, 'board.json'), home = join(dir, 'home');
mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache') };

// A board shaped like the captain's: a few open asks, a thousand the person answered, nine hundred they dismissed, and a couple of hundred
// guided plans and reports whose sections, pictures and understood lines are what a first screen must never carry.
const at = (n) => new Date(Date.UTC(2026, 9, 11, 12, n % 60, n % 60)).toISOString().replace(/\.\d+Z$/, 'Z');
const filler = (word, n) => Array.from({ length: n }, (_, i) => `${word} ${i}.`).join(' ');
const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const items = [], answers = [], gone = [];
for (let i = 0; i < 7; i++) items.push({ key: `open-${i}`, type: 'decision', title: `Ship the ${i + 1}th change to the sign-in?`, filed: at(i), by: 'agent', ask_ref: 'agent-1',
  about: filler('The change is small and the tests pass', 4), options: yesNo, recommend_value: 'yes' });
for (let i = 0; i < 1000; i++) {
  items.push({ key: `answered-${i}`, type: 'decision', title: `Answer number ${i} about the release`, filed: at(i), by: 'agent',
    about: filler('The agent asked this a while ago and it was answered', 10), detail: filler('What the answer unlocked', 4), options: yesNo });
  answers.push({ key: `answered-${i}`, answer: i % 2 ? 'yes' : 'no', label: i % 2 ? 'Yes' : 'No', close: 'done', at: at(i) });
}
for (let i = 0; i < 900; i++) {
  items.push({ key: `dismissed-${i}`, type: 'decision', title: `Dismissed question ${i} about the fleet`, filed: at(i), by: 'agent',
    about: filler('This one was let go without an answer', 10), options: yesNo });
  gone.push({ key: `dismissed-${i}`, dismissed: true, at: at(i) });
}
for (let i = 0; i < 240; i++) {
  items.push({ key: `plan-${i}`, type: 'plan', kind: 'plan', schema: 2, guided: true, filed: at(i), by: 'agent', project: 'Sign-off',
    title: `Plan ${i} to change how the board loads`, view: `plans/plan-${i}.html`,
    sections: [{ id: 's1', stage: 'overview', heading: 'What changes', body: filler('The board sends less before it draws', 70), blocks: [] },
      { id: 's2', stage: 'detail', heading: 'How', body: filler('One page of asks and the rest after the paint', 70), blocks: [] }],
    visual: { heading: 'Bytes before the first paint', text: 'One page of asks.', unit: 'KB', rows: [{ label: 'Before', value: 114 }, { label: 'After', value: 98 }],
      details: filler('Where the bytes went', 30), diagram: { nodes: ['asks', 'lists', 'items'] } },
    understood: [{ label: 'You asked', text: filler('Send less before the board draws', 8) }],
    next: { heading: 'Ship it', lines: [filler('Merge and publish', 8)] },
    decisions: [{ key: `plan-${i}-go`, title: 'Merge it?', options: yesNo }] });
}
writeFileSync(board, JSON.stringify({ schema: 2, items }));
writeFileSync(join(dir, 'board.answers.jsonl'), answers.map((a) => JSON.stringify(a)).join('\n') + '\n');
writeFileSync(join(dir, 'board.dismissed.jsonl'), gone.map((d) => JSON.stringify(d)).join('\n') + '\n');
const bytes = Buffer.byteLength(JSON.stringify({ items }));

const proc = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
const url = await new Promise((ok, no) => {
  let text = '';
  const timer = setTimeout(() => no(new Error('the board never printed its address')), 120_000);
  proc.stdout.on('data', (d) => { text += d; const m = /url: "(\S+)"/.exec(text); if (m) { clearTimeout(timer); ok(m[1]); } });
  proc.once('exit', (code) => { clearTimeout(timer); no(new Error(`the board exited ${code} before serving`)); });
});
const lines = [`board: ${bytes} B, ${items.length} cards (7 open, 1000 answered, 900 dismissed, 240 guided plans)`];
const failures = [], measured = {};
try {
  for (const theme of ['light', 'dark']) {
    const printed = execFileSync(process.execPath, [join(here, 'first-open.mjs'), url, out, 'first-open', 'cold', theme], { env, encoding: 'utf8', timeout: 300_000 }).trim();
    const one = JSON.parse(printed.split('\n').pop());
    measured[theme] = one;
    lines[0] += `\n${theme}: ${one.bytesBeforePaint} B before the first paint in ${one.requestsBeforePaint} requests, first paint ${one.paintMs} ms, whole open ${one.bytesWhole} B`;
    if (one.bytesBeforePaint >= 100_000) failures.push(`FAIL: ${one.bytesBeforePaint} B before the first paint in ${theme} (gate: under 100,000)`);
  }
} finally {
  // The board's own stop first, so a failed stop never hides the numbers; the child is killed as a backstop.
  try { execFileSync(process.execPath, [cli, 'stop', board], { env, stdio: 'pipe' }); } catch (e) { console.error(`stop: ${e.stderr ?? e.message}`); }
  proc.kill();
  writeFileSync(join(out, 'first-open-numbers.txt'), lines[0] + '\n');
  // What was driven and what it showed, for the run record a reviewer reads beside the frames.
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(here, '..', '..', '..', 'package.json'), 'utf8')).version },
    start: `A throwaway board the size of a live one (${bytes} B, ${items.length} cards: 7 open asks, 1000 answered, 900 dismissed, 240 guided plans), served by sign-off-axi serve on loopback with its own HOME`,
    steps: ['Open Today at 390x844 at 2x with the cache cold, on Lighthouse mobile slow 4G (1.6 Mbps, 150 ms RTT) and 4x CPU, in light',
      'the same in dark', "Read the run's own paint mark and request table: every request, its bytes, and whether its last byte landed before the board's first paint"],
    result: Object.entries(measured).map(([theme, one]) => `${theme}: ${one.bytesBeforePaint} B before the first paint in ${one.requestsBeforePaint} requests, first paint ${one.paintMs} ms, whole open ${one.bytesWhole} B`).join('; ')
      + '; the gate is under 100,000 B before the first paint, and this journey fails over it' }, null, 2) + '\n');
  rmSync(dir, { recursive: true, force: true });
}
console.log(lines[0]);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
