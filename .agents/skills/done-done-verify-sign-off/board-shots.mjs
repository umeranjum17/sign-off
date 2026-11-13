// A board on a report (report schema 6), read as a list: an agent posts a board as data and the person reads its steps,
// its shapes and the moves between them with no canvas. One isolated board per cell, driven through the real CLI and a real browser.
// Usage: node .agents/skills/done-done-verify-sign-off/board-shots.mjs <output> [light|dark] [390|1280]
// BOARD_CHECK=1 runs the command side only, with no browser: validate accepts the three machine boards and refuses every
// broken copy with its one fix line, and the post-time and report-init journeys in test/board.test.mjs pass.
// It writes board-check.log (every fixture, its verdict and its fix line) and board-cli.log (the TAP run) as text captures.
// SIGN_OFF_REPO names another built checkout to run.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';

const repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const cli = join(repo, 'dist/cli.js');
mkdirSync(out, { recursive: true });
/** One TOON row of `validate`, split on its commas outside quotes: the file, its kind, schema, verdict, error and fix line. */
const row = (text) => {
  const line = text.split('\n').find((l) => l.trim() && l.startsWith('  ') && l.includes(',report,'));
  assert.ok(line, `no result row in: ${text}`);
  const cells = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '\\') { cur += line[++i]; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ',' && !quoted) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
};

// The command side: the check the plan names. Three machine boards pass; every broken copy is refused with one fix line.
if (process.env.BOARD_CHECK === '1') {
  const folder = join(repo, 'fixtures/contract/report.v6'), files = readdirSync(folder).filter((f) => f.endsWith('.json')).sort();
  const valid = files.filter((f) => f.startsWith('valid-')), broken = files.filter((f) => f.startsWith('invalid-'));
  assert.equal(valid.length, 3, 'three machine boards: the task, the lane and the first real board');
  const log = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, [cli, 'validate', '--kind', 'report', join(folder, f)], { encoding: 'utf8' });
    const [file, kind, schema, ok, error, fix] = row(r.stdout);
    const good = f.startsWith('valid-');
    assert.equal(ok, String(good), `${f}: ${r.stdout}${r.stderr}`);
    assert.equal(r.status, good ? 0 : 2, `${f}: ${r.stdout}${r.stderr}`);
    if (!good) {
      // One fault, named by its field, and exactly one line that says how to fix this file.
      assert.ok(error && fix && !fix.includes('\n'), `${f} must carry one fix line: ${r.stdout}`);
      assert.match(error, /^key \S+: sections\[0\]\.board\.\S+/, `${f} names the field: ${error}`);
    }
    log.push(`${good ? 'ACCEPTED' : 'REFUSED '} ${f} (${kind} ${schema})${good ? '' : `\n  ${error}\n  fix: ${fix}`}`);
  }
  writeFileSync(join(out, 'board-check.log'), `${valid.length} machine boards accepted, ${broken.length} broken copies refused, each with one fix line.\n\n${log.join('\n')}\n`);
  // The rules the command side cannot show in a fixture: a removed id that comes back, and report init --board.
  const tap = spawnSync(process.execPath, ['--test', '--test-global-setup=./test/temp-folder.mjs', 'test/board.test.mjs'], { cwd: repo, encoding: 'utf8' });
  writeFileSync(join(out, 'board-cli.log'), tap.stdout + tap.stderr);
  assert.equal(tap.status, 0, tap.stdout + tap.stderr);
  // An older sign-off-axi knows no schema 6, so it refuses one with the way forward, and its board shows that report under Notes.
  // It refuses only when it is a build from before this one; a newer install that already takes schema 6 is named and not judged.
  const older = spawnSync('sign-off-axi', ['validate', '--kind', 'report', join(folder, 'valid-line.json')], { encoding: 'utf8' });
  let note;
  if (older.error) note = 'not run: no other sign-off-axi is installed on this machine';
  else if (older.status === 0) note = `not run: the installed sign-off-axi already takes schema 6, so it is not an older build: ${older.stdout.split('\n')[1]?.trim().split(`fixtures/contract/`).pop()}`;
  else {
    assert.equal(older.status, 2, older.stdout + older.stderr);
    assert.match(older.stdout, /schema 6 of report is not in this sign-off-axi/);
    assert.match(older.stdout, /Upgrade sign-off-axi/);
    const version = spawnSync('sign-off-axi', ['--version'], { encoding: 'utf8' }).stdout.trim();
    note = `the older sign-off-axi ${version} installed on this machine refuses schema 6 with its one line: report.v6/${older.stdout.split('\n')[1].trim().split(`fixtures/contract/report.v6/`).pop()}`;
  }
  writeFileSync(join(out, 'board-older-version.log'), `${note}\n`);
  console.log('board check: 3 machine boards accepted, ' + broken.length + ' broken copies refused, board.test.mjs passes');
  process.exit(0);
}

const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
const phone = width < 700, height = phone ? 844 : 800, records = recordsDir(out);
mkdirSync(records, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-board-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const run = (bin, args, options = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-board-${theme}-${width}-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const drive = (script) => run('chrome-devtools-axi', ['run'], { env: browserEnv, input: 'const wait = async (s) => { for (let i=0;i<100;i++) { if (await page.eval(`!!document.querySelector(${JSON.stringify(s)})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error("Not ready: " + s); };\n' + script });
const ask = (fn) => JSON.parse(drive(`console.log(JSON.stringify(await page.eval(${fn.toString()})));`));

// The report as an agent posts it: the first real board (the line after the plan) on its design section, through the real CLI.
const message = JSON.parse(readFileSync(join(repo, 'fixtures/contract/report.v6/valid-line.json'), 'utf8'));
const data = message.sections[0].board;
const posted = spawnSync(process.execPath, [cli, 'post', board, '--kind', 'report', '--from', join(repo, 'fixtures/contract/report.v6/valid-line.json')], { encoding: 'utf8', env, cwd: dir });
assert.equal(posted.status, 0, posted.stdout + posted.stderr);
// The same board with two shapes on one cell is refused by the same check the page never reaches, with its one fix line.
const clash = structuredClone(message);
clash.key = 'clash'; clash.sections[0].board.shapes[1].at = clash.sections[0].board.shapes[0].at;
const refused = spawnSync(process.execPath, [cli, 'post', board, '--kind', 'report', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(clash) });
assert.equal(refused.status, 2, refused.stdout);
assert.match(refused.stdout, /sections\[0\]\.board\.shapes\[1\]\.at puts .* on the cell of .*intake/);
assert.match(refused.stdout, /help\[1\]: Give every shape its own cell/);

const server = spawn(process.execPath, [cli, 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (code) => no(new Error(`serve exited ${code}`))); });
  browser('open', `${base}#reports/${message.key}`);
  // One device pixel to one CSS pixel: the words of the list are what the proof turns on, and a 2x capture halves their size for a reader.
  browser('emulate', '--viewport', `${width}x${height}x1${phone ? ',mobile,touch' : ''}`, '--color-scheme', theme);
  drive('await wait(".kb-board"); await new Promise(r => setTimeout(r, 800));');
  // On a phone a report first reads as a sheet over the list: Read the report opens the report itself, where the board's list is.
  drive('await page.eval(() => { document.querySelector(".rp-open-full")?.click(); }); await new Promise(r => setTimeout(r, 900));');
  drive('await wait(".kb-board"); await new Promise(r => setTimeout(r, 500));');
  const seen = ask(() => {
    const box = document.querySelector('.kb-board'), rows = (head) => [...box.querySelectorAll('.kb-part')].find((p) => p.querySelector('h4').textContent === head)?.querySelectorAll('.kb-list li') ?? [];
    const words = (li) => li.querySelector('b').textContent, under = (li) => [...li.querySelectorAll('span')].map((s) => s.textContent);
    const w = document.documentElement.clientWidth;
    return { url: location.href, title: box.querySelector('.kb-title').textContent,
      heads: [...box.querySelectorAll('.kb-part h4')].map((h) => h.textContent),
      steps: [...rows('Steps')].map((li) => words(li)), stepWords: under([...rows('Steps')][0]),
      shapes: [...rows('Shapes')].map(words), shapeNote: under([...rows('Shapes')][0]),
      moves: [...rows('Moves')].map(words), moveWords: under([...rows('Moves')][0]),
      zones: [...rows('Zones')].map(words), zoneMembers: under([...rows('Zones')][0]),
      // A label is never cut off: every line holds its own words at this width.
      clipped: [...box.querySelectorAll('.kb-list li b, .kb-list li span')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent),
      overflow: document.documentElement.scrollWidth > w,
      overflowing: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 5).map((e) => e.tagName.toLowerCase() + '.' + e.className),
      section: box.closest('.gd-sec')?.querySelector('h2, .gd-head')?.textContent };
  });
  assert.equal(seen.title, data.title);
  assert.deepEqual(seen.heads, ['Steps', 'Shapes', 'Moves', 'Zones']);
  assert.deepEqual(seen.steps, data.steps.map((s) => s.title));
  assert.deepEqual(seen.stepWords, [data.steps[0].text]);
  assert.deepEqual(seen.shapes, data.shapes.map((s) => s.label));
  assert.deepEqual(seen.shapeNote, [data.shapes[0].note]);
  const label = new Map(data.shapes.map((s) => [s.id, s.label]));
  assert.deepEqual(seen.moves, data.arrows.map((a) => `${label.get(a.from)} → ${label.get(a.to)}`));
  assert.deepEqual(seen.moveWords, [data.arrows[0].label, data.arrows[0].note]);
  assert.deepEqual(seen.zones, data.zones.map((z) => z.label));
  assert.equal(seen.zoneMembers[0], data.zones[0].around.map((id) => label.get(id)).join(', '));
  assert.match(seen.section, /The line, drawn/);
  assert.deepEqual(seen.clipped, [], 'no label is cut off');
  assert.equal(seen.overflow, false); assert.deepEqual(seen.overflowing, []);
  assert.match(browser('console', '--type', 'error'), /no console messages found/);
  const network = browser('network', '--limit', '100');
  const failed = [...network.matchAll(/reqid=\d+ \w+ (\S+) \[(\d+|failed)\]/g)].flatMap(([, url, status]) => status === 'failed' || +status >= 400 ? [{ url, status: +status || 0 }] : []);
  assert.deepEqual(failed, []);
  const stem = `board-list.${theme}.${width}w`;
  // The person reads the list, so the captures show the list: its steps, its shapes, then the moves between them.
  // A frame never cuts a line in half: after the page moves, it is nudged until no line of text straddles the reader's sticky bar
  // or the dock, so the capture reads as a list a person stopped on and never as clipped words.
  const scrollTo = (find) => drive(`await page.eval(() => { const e = ${find}; e.style.scrollMarginTop = '150px'; e.scrollIntoView({ block: 'start' }); }); await new Promise(r => setTimeout(r, 900)); await page.eval(async () => {
    const fixed = (top) => [...document.querySelectorAll('body *')].filter((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.height > 0 && (c.position === 'sticky' || c.position === 'fixed') && (top ? r.top < innerHeight / 2 : r.top > innerHeight / 2); });
    const lines = () => [...document.querySelectorAll('.gd-sec p, .gd-sec h2, .gd-sec h3, .gd-sec h4, .gd-sec li')].filter((e) => e.getClientRects().length && e.textContent.trim());
    for (let i = 0; i < 6; i++) {
      const top = fixed(true).reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0) + 2;
      const bottom = fixed(false).reduce((m, e) => Math.min(m, e.getBoundingClientRect().top), innerHeight) - 2;
      const cut = lines().find((e) => { const r = e.getBoundingClientRect(); return r.top < top && r.bottom > top; })
        || lines().find((e) => { const r = e.getBoundingClientRect(); return r.top < bottom && r.bottom > bottom; });
      if (!cut) break;
      const r = cut.getBoundingClientRect();
      window.scrollBy(0, r.top < top ? Math.floor(r.top - top) : Math.ceil(r.bottom - bottom));
      await new Promise((res) => setTimeout(res, 140));
    }
  }); await new Promise(r => setTimeout(r, 300));`);
  const part = (head) => `[...document.querySelectorAll('.kb-part')].find((p) => p.querySelector('h4').textContent === ${JSON.stringify(head)})`;
  scrollTo(`document.querySelector('.kb-board')`);
  browser('screenshot', join(out, `${stem}.png`));
  const framed = ask(() => {
    const box = document.querySelector('.kb-board'), rows = (head) => [...box.querySelectorAll('.kb-part')].find((p) => p.querySelector('h4').textContent === head).querySelectorAll('.kb-list li').length;
    const r = box.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + 14);
    return { top: Math.round(box.querySelector('.kb-title').getBoundingClientRect().top), moves: rows('Moves'), painted: !!at && box.contains(at) };
  });
  assert.equal(framed.moves, data.arrows.length);
  assert.ok(framed.top >= 0 && framed.top < 400, `the board's title sits at the top of the capture, not ${framed.top}px`);
  // What the person sees is the list: the board is the element painted at its own corner, not something laid over it.
  assert.equal(framed.painted, true, 'the board is painted where it sits');
  scrollTo(part('Shapes'));
  browser('screenshot', join(out, `board-shapes.${theme}.${width}w.png`));
  scrollTo(part('Moves'));
  browser('screenshot', join(out, `board-moves.${theme}.${width}w.png`));
  writeFileSync(join(records, `${stem}.dom.json`), JSON.stringify({ ...seen, console_errors: [], failed_requests: failed }));
  writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: a report whose design section carries a board shows its ${data.steps.length} steps, ${data.shapes.length} shapes, ${data.arrows.length} moves and ${data.zones.length} zone as a list, read without a canvas.\n`);
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
  writeFileSync(join(out, 'board-steps.json'), JSON.stringify({
    target: { version: `${pkg} at ${head}` },
    start: 'A clean board holding one report 6 whose design section carries the first real board (the line after the plan, 17 shapes, 22 arrows, one zone, six steps), posted through the CLI.',
    steps: ['Post the report with the CLI and refuse the same board with two shapes on one cell, with its one fix line.', 'Open the report in the reader at this width: its own words, then the board\'s steps, shapes, moves and zones as lists.'],
    result: 'The whole board reads as a list with no canvas: every step, shape label, move and zone named, nothing cut off and no sideways scroll.',
  }));
} finally {
  browser('stop');
  await new Promise((ok, no) => {
    const stop = spawn(process.execPath, [cli, 'stop', board], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; stop.stdout.on('data', (b) => { log += b; }); stop.stderr.on('data', (b) => { log += b; });
    stop.once('error', no); stop.once('exit', (code) => code === 0 ? ok() : no(new Error(log)));
  });
  rmSync(dir, { recursive: true, force: true });
}
