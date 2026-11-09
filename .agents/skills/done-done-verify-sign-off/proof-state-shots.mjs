// Drive a throwaway board with linked proof records and capture its proof state.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const before = process.env.PROOF_STATE_BEFORE === '1';
const out = resolve(process.argv[2]), dir = mkdtempSync(join(tmpdir(), 'so-proof-state-')), board = join(dir, 'board.json'), repo = resolve(process.env.SIGN_OFF_REPO ?? '.');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.data'), XDG_STATE_HOME: join(dir, '.state'), XDG_CACHE_HOME: join(dir, '.cache') };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `proof-state-${process.pid}` };
const browser = (...args) => { const r = spawnSync('chrome-devtools-axi', args, { encoding: 'utf8', env: browserEnv }); assert.equal(r.status, 0, JSON.stringify({ args, status: r.status, stdout: r.stdout, stderr: r.stderr })); return r.stdout; };
const evalIn = (expr) => JSON.parse(spawnSync('chrome-devtools-axi', ['run'], { encoding: 'utf8', env: browserEnv, input: `console.log(JSON.stringify(await page.eval(${expr})));` }).stdout.trim().split('\n').pop());
const hash = (b) => createHash('sha256').update(b).digest('hex');
const commit = 'a'.repeat(40), older = 'b'.repeat(40), bytes = readFileSync(join(repo, 'fixtures/evidence/product-small.png'));
mkdirSync(join(dir, '.done-done/runs'), { recursive: true }); writeFileSync(join(dir, 'capture.png'), bytes);
const make = (key, head, exit, ref) => { const run_id = `run-${key}`, tree = 'c'.repeat(40); writeFileSync(join(dir, '.done-done/runs', `${run_id}.json`), JSON.stringify({ schema: 1, run_id, commit: head, tree, dirty: false, exit, files: [{ path: 'capture.png', sha256: hash(bytes), bytes: bytes.length }] }));
  const receipt = JSON.stringify({ schema: 2, head, tree, result: 'pass', runs: [{ run_id, commit: head }], files: [{ path: 'capture.png', sha256: hash(bytes) }], judge: { route: 'fixture', model: 'fixture', independence: 'agent', verdicts: [{ path: 'capture.png', sha256: hash(bytes), verdict: 'pass' }] } });
  writeFileSync(join(dir, `${key}.json`), receipt);
  return { key, type: 'evidence', number: key === 'current' ? 1 : key === 'older' ? 2 : 3, title: `Proof ${key}`, evidence: { run_id, commit: head, outcome: `Proof ${key}`, repro: 'repro', proof: 'proof', evidence: 'capture.png', proof_series_id: 'example', current_head: commit, release_state: { state: 'unreleased' }, ...(ref ? { proof_verdict: 'pass', proof_ref: { path: `${key}.json`, sha256: hash(receipt), issuer: 'done-done', validated: true } } : {}) } }; };
writeFileSync(board, JSON.stringify({ schema: 2, items: [make('older', older, 0, true), make('current', commit, 0, true), make('failed', commit, 1, false)] }));
const original = readFileSync(board, 'utf8');
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0', '--evidence-root', dir], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (b) => { log += b; });
try {
  let url; for (let i = 0; i < 100 && !url; i++) { await new Promise((r) => setTimeout(r, 100)); url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; } assert.ok(url, log);
  for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
    browser('open', url); browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1', '--color-scheme', theme);
    evalIn(`() => { localStorage.removeItem('so-theme'); return true; }`);
    browser('open', `${url}#evidence/current`);
    const state = evalIn(`async () => { for (let i = 0; i < 100 && !document.querySelector('.ev-props'); i++) await new Promise(r => setTimeout(r, 50)); await new Promise(r => setTimeout(r, 500)); return { text: document.body.innerText, dark: matchMedia('(prefers-color-scheme: dark)').matches, surface: getComputedStyle(document.querySelector('.ev-props')).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme, selected: document.querySelectorAll('.ev-verdict .ink').length }; }`);
    assert.equal(state.dark, theme === 'dark'); assert.ok(state.scheme.includes(theme));
    const rgb = state.surface.match(/\d+/g).map(Number); assert.ok(theme === 'dark' ? rgb.slice(0, 3).every(v => v < 100) : rgb.slice(0, 3).every(v => v > 100), `${theme}: ${state.surface}`);
    for (const word of before ? ['Holds up'] : ['Current', 'Not released', 'Holds up']) assert.ok(state.text.includes(word), `${width} ${theme}: ${word}`);
    if (!before) assert.equal(state.selected, 0, 'no review selected');
    browser('screenshot', join(out, `proof-state.${theme}.${width}w.png`));
  }
  if (!before) for (const [key, words] of [['older', ['History', 'Holds up']], ['failed', ['Failed (exit 1)', 'Unverified']]]) {
    browser('open', `${url}#evidence/${key}`);
    const text = evalIn(`async () => { for (let i = 0; i < 100 && !document.querySelector('.ev-title')?.textContent.includes('${key}'); i++) await new Promise(r => setTimeout(r, 50)); return document.body.innerText; }`);
    for (const word of words) assert.ok(text.includes(word), `${key}: ${word}`);
  }
  if (!before) { assert.equal(readFileSync(board, 'utf8'), original); assert.equal(existsSync(join(dir, 'board.answers.jsonl')), false); assert.equal(existsSync(join(dir, 'board.reads.jsonl')), false); }
  writeFileSync(join(out, 'proof-state.log'), 'Current proof: Holds up; release: Not released. Earlier and failed runs remain on the board.\n');
  writeFileSync(join(out, 'steps.json'), JSON.stringify({ target: { version: JSON.parse(readFileSync(join(repo, 'package.json'))).version }, start: 'A throwaway board with linked current, older and failed runs.', steps: ['Open Evidence', 'Open the current proof', 'Read the proof and release state'], result: 'The board shows the proof verdict and release separately.' }));
} finally { spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board], { env, encoding: 'utf8' }); browser('stop'); rmSync(dir, { recursive: true, force: true }); }
