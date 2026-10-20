// One journey for the evidence media guard: a real chat screen with an empty thread is posted as an Evidence card and read on the board at
// 390 and 1280; a flat placeholder card is refused with its CLI output saved. Usage: node .../evidence-guard-journey.mjs <output>
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve(import.meta.dirname, '../../..');
mkdirSync(out, { recursive: true });
const dd = dirname(realpathSync(spawnSync('which', ['done-done'], { encoding: 'utf8' }).stdout.trim()));
const { LOOK, SQUASHED_TEXT, lookIssues } = await import(pathToFileURL(join(dd, 'dom.js')));
const work = mkdtempSync(join(tmpdir(), 'sign-off-evidence-guard-'));
const env = { ...process.env, HOME: work, XDG_CONFIG_HOME: `${work}/.config`, XDG_DATA_HOME: `${work}/.local/share`, XDG_STATE_HOME: `${work}/.local/state`, XDG_CACHE_HOME: `${work}/.cache`, SIGN_OFF_FILER: 'verify' };
const so = (...args) => spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120000, env });
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-guard-${process.pid}` };
const browser = (...args) => { const r = spawnSync('chrome-devtools-axi', args, { encoding: 'utf8', env: browserEnv }); assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const evalIn = (fn) => JSON.parse(spawnSync('chrome-devtools-axi', ['run'], { encoding: 'utf8', env: browserEnv, input: `console.log(JSON.stringify(await page.eval(${fn})));` }).stdout.trim().split('\n').pop());
// EVIDENCE_GUARD_SCREEN: a real app screen to post instead of the synthetic fixture (never committed).
const fixtures = join(repo, 'fixtures/evidence'), screen = process.env.EVIDENCE_GUARD_SCREEN ?? join(fixtures, 'sparse-screen.png'), board = join(work, 'board.json');
let server;
try {
  assert.equal(so('init', work).status, 0);
  const posted = so('post', board, '--type', 'evidence', '--title', 'Empty chat on a phone', '--about', 'An app chat screen with a header and a message; the thread is mostly empty.', '--media', screen);
  writeFileSync(join(out, 'sparse-posted.txt'), `run ${process.env.DONE_DONE_RUN_ID}\nWHAT THIS SHOWS: posting a mostly empty app screen (${screen.split('/').pop()}) as evidence succeeds.\nexit ${posted.status}\n${posted.stdout}${posted.stderr}`);
  assert.equal(posted.status, 0);
  assert.match(posted.stdout, /update-1,1,1/);
  const refused = so('post', board, '--type', 'evidence', '--title', 'Placeholder', '--about', 'A flat card.', '--media', join(fixtures, 'placeholder-card.png'));
  writeFileSync(join(out, 'placeholder-refused.txt'), `run ${process.env.DONE_DONE_RUN_ID}\nWHAT THIS SHOWS: posting a flat placeholder card (one grey colour with a small label) as evidence is refused, on the same board where the empty app screen posted with exit ${posted.status}.\nexit ${refused.status}\n${refused.stdout}${refused.stderr}`);
  assert.equal(refused.status, 2);
  assert.match(refused.stdout, /is a placeholder card, not evidence/);
  assert.deepEqual(readdirSync(join(work, 'evidence')), ['1']);
  server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env });
  const link = await new Promise((ok) => server.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const failures = [];
  for (const width of [390, 1280]) {
    browser('open', link);
    browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1');
    browser('open', `${link}#evidence/update-1`);
    evalIn(`async () => { for (let i = 0; i < 100 && !document.querySelector('img'); i++) await new Promise((r) => setTimeout(r, 50)); return 1; }`);
    const img = evalIn(`async () => { const i = document.querySelector('img'); await i.decode(); return { w: i.naturalWidth, h: i.naturalHeight }; }`);
    assert.ok(img.w > 0 && img.h > 0, `${width}w shows the posted screen`);
    browser('screenshot', join(out, `evidence-card.${width}w.png`));
    const look = evalIn(`async () => ({ url: location.href, ...(${LOOK})(), squashed_text: (${SQUASHED_TEXT})() })`);
    failures.push(...lookIssues(look).map((m) => `${width}w look: ${m}`));
  }
  assert.deepEqual(failures, []);
  console.log('evidence guard journey ok: sparse screen posted and shown, placeholder card refused');
} finally {
  server?.kill();
  spawnSync('chrome-devtools-axi', ['stop'], { env: browserEnv });
  rmSync(work, { recursive: true, force: true });
}
