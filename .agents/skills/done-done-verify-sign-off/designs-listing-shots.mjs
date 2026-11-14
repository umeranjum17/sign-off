// The Designs listing requirement at 1440 dark, driven in an isolated board.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const out = resolve(process.argv[2]), repo = resolve('.'), dir = mkdtempSync(join(tmpdir(), 'so-designs-')), board = join(dir, 'board.json');
const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_STATE_HOME: join(dir, 'state'), XDG_CACHE_HOME: join(dir, 'cache') };
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-design-list-${process.pid}` };
const browser = (...args) => { const r = spawnSync('chrome-devtools-axi', args, { env: browserEnv, encoding: 'utf8' }); assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}\n${r.stderr}`); return r.stdout; };
const evaluate = (fn) => { const r = spawnSync('chrome-devtools-axi', ['run'], { env: browserEnv, encoding: 'utf8', input: `console.log(JSON.stringify(await page.eval(${fn})));` }); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
mkdirSync(join(dir, 'mocks')); copyFileSync(join(repo, 'docs/media/phone-light.webp'), join(dir, 'mocks/a.webp')); copyFileSync(join(repo, 'docs/media/phone-dark.webp'), join(dir, 'mocks/b.webp'));
const posted = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'post', board, '--type', 'design', '--key', 'layout', '--title', 'Which settings layout should ship?', '--option', 'a=One column', '--option', 'b=Two columns', '--mock', 'a=mocks/a.webp', '--mock', 'b=mocks/b.webp', '--tradeoff', 'One column is simpler; two columns scan faster.', '--recommend', 'a', '--filer', 'verify'], { env, encoding: 'utf8' });
assert.equal(posted.status, 0, posted.stdout + posted.stderr);
const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
try {
  let url; for (let i = 0; i < 100 && !url; i++) { await new Promise(r => setTimeout(r, 100)); url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0]; } assert.ok(url, log);
  browser('open', url); browser('emulate', '--viewport', '1440x900x1', '--color-scheme', 'dark'); browser('open', `${url}#designs`);
  const state = evaluate(`async () => { for (let i = 0; i < 100 && !document.querySelector('.dz-card, .dz-list > li'); i++) await new Promise(r => setTimeout(r, 50)); const link = document.querySelector('#nav a[href="#designs"] .n'); return { title: document.body.innerText, count: link?.textContent, rows: document.querySelectorAll('.dz-card, .dz-list > li').length, dark: matchMedia('(prefers-color-scheme: dark)').matches, overflow: document.documentElement.scrollWidth > innerWidth, surface: getComputedStyle(document.body).backgroundColor }; }`);
  assert.equal(state.dark, true); assert.equal(state.overflow, false); assert.equal(state.count, String(state.rows), JSON.stringify(state)); assert.ok(state.rows >= 1 && state.title.includes('Which settings layout should ship?'), JSON.stringify(state));
  browser('screenshot', join(out, 'designs.1440.dark.png'));
  writeFileSync(join(out, 'designs.1440.dark.json'), JSON.stringify(state, null, 2));
} finally { spawnSync(process.execPath, [join(repo, 'dist/cli.js'), 'stop', board], { env, encoding: 'utf8' }); spawnSync('chrome-devtools-axi', ['stop'], { env: browserEnv }); }
