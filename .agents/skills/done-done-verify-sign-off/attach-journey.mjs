// One journey for `post --attach`: a 176 MB file is posted on an update, its file row is read on the card at 390 and 1280, and the
// download is done for real, over the board link with its token when this machine has a private address: the bytes saved match the source.
// Usage: node .agents/skills/done-done-verify-sign-off/attach-journey.mjs <output>
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] ?? process.env.DONE_DONE_EVIDENCE_ROOT), repo = resolve(import.meta.dirname, '../../..');
mkdirSync(out, { recursive: true });
const dd = dirname(realpathSync(spawnSync('which', ['done-done'], { encoding: 'utf8' }).stdout.trim()));
const { LOOK, SQUASHED_TEXT, lookIssues } = await import(pathToFileURL(join(dd, 'dom.js')));
const work = mkdtempSync(join(tmpdir(), 'sign-off-attach-journey-'));
const env = { ...process.env, HOME: work, XDG_CONFIG_HOME: `${work}/.config`, XDG_DATA_HOME: `${work}/.local/share`, XDG_STATE_HOME: `${work}/.local/state`, XDG_CACHE_HOME: `${work}/.cache`, SIGN_OFF_FILER: 'verify' };
const run = (bin, args, options = {}) => { const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, env, ...options }); assert.equal(r.status, 0, `${bin} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const so = (...args) => run(process.execPath, [join(repo, 'dist/cli.js'), ...args]);
const browserEnv = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: `so-attach-${process.pid}` };
const browser = (...args) => run('chrome-devtools-axi', args, { env: browserEnv });
const evalIn = (fn) => JSON.parse(run('chrome-devtools-axi', ['run'], { env: browserEnv, input: `console.log(JSON.stringify(await page.eval(${fn})));` }).trim().split('\n').pop());
const sha = (path) => new Promise((ok) => { const h = createHash('sha256'); createReadStream(path).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))); });
const BYTES = 176_000_000, apk = join(work, 'muxr-release.apk'), board = join(work, 'board.json');
let stop;
try {
  // Random bytes, so the hash proves the right file arrived, not just its length.
  spawnSync('sh', ['-c', 'head -c "$1" /dev/urandom > "$0"', apk, String(BYTES)]);
  assert.equal(statSync(apk).size, BYTES);
  so('init', work);
  const shot = join(repo, 'docs/media/phone-light.webp');
  so('post', board, '--type', 'evidence', '--title', 'Android build', '--about', 'The app installs and signs in on a phone.', '--media', shot, '--attach', apk);
  const lan = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(i.address));
  let link;
  if (lan) { link = /url: "(.+)"/.exec(so('open', board, '--port', '0', '--bind', lan.address))[1]; stop = () => so('stop', board); }
  else {
    const server = spawn(process.execPath, [join(repo, 'dist/cli.js'), 'serve', board, '--port', '0'], { env });
    link = await new Promise((ok) => server.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    stop = () => server.kill();
  }
  const base = new URL(link).origin, failures = [];
  for (const width of [390, 1280]) {
    // The link sets the token cookie and redirects; the browser tool reports the redirect as an error, so the loaded tab is selected instead.
    if (spawnSync('chrome-devtools-axi', ['open', link], { env: browserEnv }).status) spawnSync('sleep', ['1']), browser('selectpage', [...browser('pages').matchAll(/^\s*(\d+),http\S*,/gm)].at(-1)[1]);
    browser('emulate', '--viewport', width === 390 ? '390x844x2,mobile,touch' : '1280x800x1');
    for (const [stem, hash] of [['list', '#evidence'], ['update', '#evidence/update-1']]) {
      browser('open', `${base}/${hash}`);
      evalIn(`async () => { for (let i = 0; i < 100 && !document.querySelector('${stem === 'list' ? '.ev-card' : '.file'}'); i++) await new Promise((r) => setTimeout(r, 50)); return 1; }`);
      if (stem === 'update') {
        // The row: name, size and a Download button big enough to tap, inside the screen, with no sideways scroll.
        const row = evalIn(`async () => { const a = document.querySelector('a.file'), r = a.querySelector('.dl').getBoundingClientRect();
          return { text: a.innerText.replace(/\\s+/g, ' '), href: a.getAttribute('href'), download: a.getAttribute('download'), h: r.height, right: a.getBoundingClientRect().right, vw: innerWidth, scroll: document.documentElement.scrollWidth }; }`);
        assert.match(row.text, /muxr-release\.apk 176 MB Download/, `${width}w row: ${row.text}`);
        assert.ok(row.h >= 44, `${width}w Download is ${row.h}px high`);
        assert.ok(row.right <= row.vw && row.scroll <= row.vw, `${width}w row overflows: ${JSON.stringify(row)}`);
        // The tap: a real fetch of the href by the page (its cookie), read to the end, with its header and byte count.
        const got = evalIn(`async () => { const r = await fetch(document.querySelector('a.file').href), reader = r.body.getReader(); let n = 0;
          for (;;) { const c = await reader.read(); if (c.done) break; n += c.value.length; }
          return { status: r.status, type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition'), bytes: n }; }`);
        assert.deepEqual(got, { status: 200, type: 'application/vnd.android.package-archive', disposition: 'attachment; filename="muxr-release.apk"', bytes: BYTES }, `${width}w in-page download`);
      }
      browser('screenshot', join(out, `attach-${stem}.${width}w.png`));
      const look = evalIn(`async () => ({ url: location.href, ...(${LOOK})(), squashed_text: (${SQUASHED_TEXT})() })`);
      failures.push(...lookIssues(look).map((m) => `${stem} ${width}w look: ${m}`));
    }
  }
  assert.deepEqual(failures, []);
  // The saved file, over the same link: the cookie the link sets carries the token, and the bytes match the source.
  const cookie = (await fetch(link, { redirect: 'manual' })).headers.get('set-cookie')?.split(';')[0];
  if (lan) assert.equal((await fetch(`${base}/api/attachment?key=update-1&i=0`)).status, 401, 'no token, no download');
  const res = await fetch(`${base}/api/attachment?key=update-1&i=0`, { headers: cookie ? { cookie } : {} }), saved = join(out, 'downloaded-muxr-release.apk');
  assert.equal(res.status, 200);
  const hash = createHash('sha256'); let bytes = 0;
  const sink = createWriteStream(saved);
  for await (const chunk of res.body) { hash.update(chunk); bytes += chunk.length; sink.write(chunk); }
  sink.end();
  assert.equal(bytes, BYTES);
  assert.equal(hash.digest('hex'), await sha(apk), 'the downloaded bytes are the posted file');
  rmSync(saved, { force: true });
  console.log(`attach journey ok: ${lan ? `private ${lan.address} with token` : 'loopback'}, ${bytes} bytes, hash matches`);
} finally {
  try { stop?.(); } catch {}
  spawnSync('chrome-devtools-axi', ['stop'], { env: browserEnv });
  rmSync(work, { recursive: true, force: true });
}
