// A page report held to the board's look: report init --page writes a page with no colour of its own and no card, post refuses one that brings a palette or a card inside a card
// (naming the fix: the kit's blocks), and the page that posts opens in the board, light and dark. Usage: node .agents/skills/done-done-verify-sign-off/page-look-shots.mjs <output> [light|dark] [390|1280]
// The refusals are kept as text captures beside the frame. SIGN_OFF_REPO names another built checkout to run.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { recordsDir } from './records.mjs';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT);
const theme = process.argv[3] ?? process.env.DONE_DONE_THEME ?? 'light', width = +(process.argv[4] ?? process.env.DONE_DONE_WIDTH ?? 390);
assert.ok(['light', 'dark'].includes(theme) && [390, 1280].includes(width));
const phone = width < 700, height = phone ? 844 : 800, repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
mkdirSync(out, { recursive: true });
const records = recordsDir(out);
mkdirSync(records, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'so-look-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
const cli = (...args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', env, cwd: dir, timeout: 60000 });
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, ...options }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-look-${theme}-${width}-${process.pid}-${Date.now()}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
assert.equal(cli('report', 'init', join(dir, 'how'), '--page', '--purpose', 'other').status, 0);
const page = join(dir, 'how', 'index.html');
const words = ['How sign-in works', 'Sign-in now takes two steps.', 'Umer enters the code first, then confirms the email.', '15 Oct', 'The code step moved first', 'Before', 'After', 'The two steps in order', 'Enter the code', 'Confirm the email', 'Sign in', 'The code comes first, then the email.',
  'The code expires after 10 minutes.', 'A new code can be sent once a minute.', 'Code', 'Umer reads the code from a text.', 'Email', 'Umer confirms the address.', 'Done', 'Umer is in.'];
for (const f of ['index.html', 'preview.svg']) { let n = 0; writeFileSync(join(dir, 'how', f), readFileSync(join(dir, 'how', f), 'utf8').replace(/FILL: [^<"']*/g, () => words[n++ % words.length])); }
const flags = ['post', board, '--type', 'report', '--purpose', 'other', '--project', 'Muxr', '--title', 'How sign-in works', '--about', 'Two steps now.', '--view', 'how/index.html', '--preview', 'how/preview.svg'];
const scaffold = readFileSync(page, 'utf8');
// A palette of its own and a card inside a card are refused; each refusal names the fix and writes nothing.
const variants = {
  palette: scaffold.replace('</style>', '.x { color: #5B5BD6; background: #EEEEFA; border-color: #1F8A4C; } </style>'),
  'nested-card': scaffold.replace('</style>', '.pane { border: 1px solid; border-radius: 12px; } .tile { background: Canvas; border-radius: 1rem; } </style>').replace('<main>', '<main><div class="pane"><div class="tile"></div></div>'),
};
const refusals = {};
for (const [what, html] of Object.entries(variants)) {
  writeFileSync(page, html);
  const refused = cli(...flags);
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, what === 'palette' ? /draws its own colour palette \(#5b5bd6, #eeeefa, #1f8a4c\)/ : /puts a card inside a card \(\.tile in \.pane\)/);
  assert.match(refused.stdout, /Draw the report with the board's own blocks instead/);
  writeFileSync(join(records, `refused-${what}.txt`), refused.stdout);
  refusals[what] = refused.stdout;
}
writeFileSync(page, scaffold);
const posted = cli(...flags); assert.equal(posted.status, 0, posted.stdout);
writeFileSync(join(records, 'posted.txt'), posted.stdout);
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const base = await new Promise((ok, no) => { let log = ''; server.stdout.on('data', (b) => { log += b; const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(log); if (m) ok(m[0]); }); server.once('exit', (c) => no(new Error(`serve exited ${c}`))); });
  browser('open', base);
  browser('emulate', '--viewport', phone ? `${width}x${height}x2,mobile,touch` : `${width}x${height}x1`, '--color-scheme', theme);
  // What the author sees: the command and the CLI's own refusal, drawn as a page so the frame can be read.
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  for (const [what, text] of Object.entries(refusals)) {
    const shown = text.split('\n').map((l) => l.replace(/\\"/g, '"')).join('\n');
    const html = `<meta name=viewport content="width=device-width,initial-scale=1"><meta name=color-scheme content="light dark"><body style="margin:16px;font:14px/1.5 ui-monospace,monospace"><p><b>sign-off-axi post --type report ... --view how/index.html</b></p><p>${what === 'palette' ? 'The page writes three colours of its own.' : 'The page puts a card inside a card.'}</p><pre style="white-space:pre-wrap">${esc(shown)}</pre>`;
    browser('open', `data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((r) => setTimeout(r, 800));
    browser('screenshot', join(out, `refused-${what}.${theme}.${width}w.png`));
    writeFileSync(join(records, `refused-${what}.${theme}.${width}w.claim.txt`), `${width}px ${theme}: the author's post of a page that ${what === 'palette' ? 'writes its own palette' : 'draws a card inside a card'}, refused, with the fix: draw the report with the board's own blocks.\n`);
  }
  browser('open', `${base}#reports/how-sign-in-works`);
  await new Promise((r) => setTimeout(r, 2500));
  const stem = `page.${theme}.${width}w`;
  browser('screenshot', join(out, `${stem}.png`));
  assert.match(browser('console', '--type', 'error'), /no console messages found/);
  writeFileSync(join(records, `${stem}.claim.txt`), `${width}px ${theme}: the page report the scaffold writes, drawn in the board with no colour of its own and no card.\n`);
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
  writeFileSync(join(out, 'steps.json'), JSON.stringify({
    target: { version: `${pkg} at ${head}` },
    start: 'A clean board and the page report init --page writes, filled in.',
    steps: ['An agent posts the page with its own palette: refused, naming the colours and the fix.', 'It posts a page with a card inside a card: refused the same way.', 'It posts the scaffold page as written: it posts, and the reader opens it in the board.'],
    result: 'A page report with its own palette or nested cards never reaches the board; the plain page opens in light and dark.',
  }));
} finally {
  browser('stop'); server.kill();
  console.log(`Scratch for cleanup: ${dir}`);
}
