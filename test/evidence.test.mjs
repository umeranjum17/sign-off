import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { asked } from './ask.mjs';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-evidence-'));
const so = join(scratch, '.sign-off');
const board = join(so, 'decisions.json');
// No PATH: init finds no agent to install the skill for.
const run = (...args) => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...asked(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: '' } }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout}`, code: e.status };
  }
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
// A rendered log (text only) and a real capture of the running board, from the repo's fixtures.
const fixtures = new URL('../fixtures/evidence/', import.meta.url).pathname;
const textLog = join(fixtures, 'text-log.png'), colourBars = join(fixtures, 'colour-bars.png'), capture = join(fixtures, 'product-board.png');
// A mostly empty but real chat screen (header, message, composer, tab bar) and a flat card with a label: generated shapes, no private data.
const sparseScreen = join(fixtures, 'sparse-screen.png'), placeholderCard = join(fixtures, 'placeholder-card.png');
const clip = Buffer.from('0123456789 a short recording stand-in');
const procs = [];
after(async () => {
  // A dying serve removes its own run record; removing the scratch folder under it leaves the folder behind.
  await Promise.all(procs.map((p) => p.exitCode ?? p.signalCode ?? new Promise((ok) => p.once('exit', ok).kill())));
  rmSync(scratch, { recursive: true, force: true });
});

test('evidence journey: post numbered updates with media, serve them hash-checked, verdict reads back', async () => {
  run('init', scratch);
  const shot = join(scratch, 'phone.png'), rec = join(scratch, 'flow.webm');
  writeFileSync(shot, png);
  writeFileSync(rec, clip);
  const evidence = (...more) => run('post', board, '--type', 'evidence', ...more);
  assert.equal(evidence('--title', 'No media', '--about', 'Note.').code, 2);
  assert.equal(evidence('--title', 'No note', '--media', shot).code, 2);
  assert.equal(evidence('--title', 'Bad type', '--about', 'Note.', '--media', join(scratch, 'notes.txt')).code, 2);
  // A picture of text is refused before anything is copied, and the refusal says what to post instead.
  const refused = evidence('--title', 'Rendered log', '--about', 'Note.', '--media', textLog);
  assert.equal(refused.code, 2);
  assert.match(refused.out, /is mostly text: a picture of a log, receipt or summary is not evidence/);
  assert.match(refused.out, /Post a real capture of the running product/);
  assert.match(refused.out, /project .*--name <project> --terminal-app/);
  // The board owner declares this product surface once; the declaration is persisted and readable.
  const terminalBoard = join(so, 'terminal', 'board.json');
  assert.equal(run('project', terminalBoard, '--name', 'Muxr', '--terminal-app').code, 0);
  assert.match(run('project', terminalBoard, '--json').out, /\"terminalApp\":true/);
  const terminalLog = run('post', terminalBoard, '--type', 'evidence', '--title', 'Terminal output', '--about', 'A terminal screen.', '--media', textLog);
  assert.equal(terminalLog.code, 0, terminalLog.out);
  assert.match(terminalLog.out, /update-1,1,1/);
  // Other refusal checks stay active after the declaration.
  const terminalBars = run('post', terminalBoard, '--type', 'evidence', '--title', 'Test card', '--about', 'Note.', '--media', colourBars);
  assert.match(terminalBars.out, /is a colour-bar test card, not evidence/);
  const terminalPlaceholder = run('post', terminalBoard, '--type', 'evidence', '--title', 'Placeholder', '--about', 'Note.', '--media', placeholderCard);
  assert.match(terminalPlaceholder.out, /is a placeholder card, not evidence/);
  assert.deepEqual(readdirSync(join(so, 'terminal', 'evidence')), ['1']);
  // A colour-bar test card is refused the same way, not posted as evidence.
  assert.match(evidence('--title', 'Test card', '--about', 'Note.', '--media', colourBars).out, /is a colour-bar test card, not evidence/);
  // A flat placeholder card is refused; a real screen that is mostly empty is not.
  assert.match(evidence('--title', 'Placeholder', '--about', 'Note.', '--media', placeholderCard).out, /is a placeholder card, not evidence/);
  assert.match(evidence('--title', 'Missing', '--about', 'Note.', '--media', join(scratch, 'gone.png')).out, /gone\.png is not there/);
  assert.equal(evidence('--title', 'Bad link', '--about', 'Note.', '--media', shot, '--link', 'javascript:alert(1)').code, 2);
  assert.equal(evidence('--title', 'Options', '--about', 'Note.', '--media', shot, '--option', 'a=A', '--option', 'b=B').code, 2);
  assert.deepEqual(readdirSync(join(so, 'evidence')), []);

  assert.match(evidence('--title', 'Sign-in screen', '--about', 'The screen loads.', '--media', capture, '--media', sparseScreen).out, /update-1,1,2/);
  assert.match(evidence('--title', 'Sign-in flow', '--about', 'Umer signs in on a phone.', '--media', capture, '--media', rec,
    '--link', 'https://github.com/acme/app/pull/12').out, /update-2,2,2/);
  // A still gets a light copy, a thumb and a tile beside its original; a recording is copied as it is.
  assert.deepEqual(readdirSync(join(so, 'evidence', '2')).sort(), ['1-light.jpg', '1-thumb.jpg', '1-tile.jpg', '1.png', '2.webm']);
  assert.deepEqual(readFileSync(join(so, 'evidence', '2', '2.webm')), clip);
  const [shrunk, tall] = JSON.parse(readFileSync(board, 'utf8')).items[0].media, sha = (p) => createHash('sha256').update(readFileSync(join(so, p))).digest('hex');
  assert.deepEqual([shrunk.light.width, shrunk.light.height, shrunk.thumb.width, shrunk.thumb.height], [1280, 860, 720, 484]);
  assert.deepEqual([shrunk.tile.width, shrunk.tile.height, tall.tile.width, tall.tile.height], [264, 177, 264, 528]);
  // A phone capture taller than twice its width keeps a thumb of its top at full width, and the light copy whole.
  assert.deepEqual([tall.light.width, tall.light.height, tall.thumb.width, tall.thumb.height], [1170, 2532, 720, 1440]);
  for (const c of [shrunk.light, shrunk.thumb, shrunk.tile, tall.light, tall.thumb, tall.tile]) assert.deepEqual([sha(c.path), readFileSync(join(so, c.path)).length], [c.sha256, c.bytes]);
  assert.ok(shrunk.light.bytes < shrunk.bytes && shrunk.thumb.bytes < shrunk.light.bytes && shrunk.tile.bytes < shrunk.thumb.bytes, 'each copy weighs less than what it stands in for');
  // The same capture posted twice gives the same copies, byte for byte.
  const again = JSON.parse(readFileSync(board, 'utf8')).items[1].media[0];
  assert.deepEqual([again.light.sha256, again.thumb.sha256], [shrunk.light.sha256, shrunk.thumb.sha256]);
  assert.equal(JSON.parse(readFileSync(board, 'utf8')).items[1].media[1].light, undefined);
  // Each post records when it was filed.
  for (const item of JSON.parse(readFileSync(board, 'utf8')).items) assert.ok(Date.now() - Date.parse(item.filed) < 60_000, item.key);
  // A second board in the same folder shares evidence/: it takes the next free number and never writes into a used one.
  const other = join(so, 'other.json');
  assert.match(run('post', other, '--type', 'evidence', '--title', 'Other board', '--about', 'Note.', '--media', rec).out, /update-3,3,1/);
  run('raise', other, '--title', 'Manual?', '--key', 'update-4');
  assert.match(run('post', other, '--type', 'evidence', '--title', 'After a raised key', '--about', 'Note.', '--media', rec).out, /update-5,5,1/);
  assert.equal(run('post', other, '--type', 'evidence', '--title', 'Bad link', '--about', 'Note.', '--media', rec, '--link', 'nope').code, 2);
  assert.deepEqual(readdirSync(join(so, 'evidence')).sort(), ['1', '2', '3', '5']);
  assert.deepEqual(readFileSync(join(so, 'evidence', '1', '1.png')), readFileSync(capture));

  // A card posted before the guard can hold a colour-bar test card: the board does not show that card, and keeps the real ones.
  const stored = JSON.parse(readFileSync(board, 'utf8')), bars = readFileSync(colourBars);
  mkdirSync(join(so, 'evidence', '9'), { recursive: true });
  writeFileSync(join(so, 'evidence', '9', '1.png'), bars);
  const legacy = { ...stored.items[0], key: 'legacy-bars', number: 9, title: 'Old test card',
    media: [{ path: 'evidence/9/1.png', sha256: createHash('sha256').update(bars).digest('hex'), bytes: bars.length }] };
  writeFileSync(board, JSON.stringify({ ...stored, items: [...stored.items, legacy] }));

  // A recording is not a still: loading a card that holds one must never push it through ImageMagick. This convert would leave a marker
  // and stall the request, so a guarded board answers at once and leaves no marker.
  const fakeBin = join(scratch, 'fake-bin'), marked = join(scratch, 'convert-called');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'convert'), `#!/bin/sh\ntouch '${marked}'\nsleep 5\n`, { mode: 0o755 });
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], {
    cwd: tmpdir(), env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const started = Date.now();
  const first = await (await fetch(`${url}api/decisions`)).json();
  assert.ok(Date.now() - started < 3000, `first board read took ${Date.now() - started} ms`);
  assert.equal(existsSync(marked), false, 'a recording was handed to ImageMagick');
  // The old test card is measured off the request path: it leaves the board once the warm pass reports.
  let api;
  for (let i = 0; i < 60; i++) {
    api = await (await fetch(`${url}api/decisions`)).json();
    if (!api.decisions.some((d) => d.key === 'legacy-bars')) break;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.ok(first.decisions.some((d) => d.key === 'update-2'));
  assert.deepEqual(api.decisions.map((d) => [d.key, d.number, d.media.length]), [['update-1', 1, 2], ['update-2', 2, 2]]);
  assert.deepEqual(api.decisions[1].options.map((o) => o.value), ['pass', 'fail', 'needs-work']);
  assert.equal(api.decisions[1].link, 'https://github.com/acme/app/pull/12');

  // The export runs in its own process and must hide the same pre-guard test card the served board hides.
  const html = join(scratch, 'board.export.html'), exported = run('export', board, '--out', html);
  assert.equal(exported.code, 0);
  const frozen = JSON.parse(/window\.FROZEN = (.*?);<\/script>/s.exec(readFileSync(html, 'utf8'))[1]);
  assert.deepEqual(frozen.decisions.map((d) => d.key).sort(), ['update-1', 'update-2']);

  const media = await fetch(`${url}api/media?key=update-2&i=1`);
  assert.equal(media.headers.get('content-type'), 'video/webm');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), clip);
  const part = await fetch(`${url}api/media?key=update-2&i=1`, { headers: { range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 2-5/${clip.length}`);
  assert.equal(await part.text(), '2345');
  assert.equal((await fetch(`${url}api/media?key=update-2&i=9`)).status, 404);
  assert.equal((await fetch(`${url}api/media?key=update-2`)).status, 404);
  // The light copy and the thumb are served as posted, hash-checked like the original; a clip has none, and no other size is served.
  for (const [v, ref] of [['light', again.light], ['thumb', again.thumb], ['tile', again.tile]]) {
    const copy = await fetch(`${url}api/media?key=update-2&i=0&v=${v}`);
    assert.deepEqual([copy.status, copy.headers.get('content-type'), (await copy.arrayBuffer()).byteLength], [200, 'image/jpeg', ref.bytes]);
  }
  assert.deepEqual(Buffer.from(await (await fetch(`${url}api/media?key=update-2&i=0`)).arrayBuffer()), readFileSync(capture));
  for (const q of ['i=1&v=light', 'i=0&v=full', 'i=0&v=']) assert.equal((await fetch(`${url}api/media?key=update-2&${q}`)).status, 404, q);
  appendFileSync(join(so, again.thumb.path), 'x');
  assert.equal((await fetch(`${url}api/media?key=update-2&i=0&v=thumb`)).status, 404);
  // The export carries each copy under the URL the page asks for.
  assert.ok(['', '&v=light', '&v=thumb', '&v=tile'].every((v) => frozen.files[`/api/media?key=update-2&i=0${v}`]?.startsWith(v ? 'data:image/jpeg;base64,' : 'data:image/png;base64,')));
  // A file changed after posting is refused, never served as the posted proof.
  appendFileSync(join(so, 'evidence', '1', '1.png'), 'x');
  assert.equal((await fetch(`${url}api/media?key=update-1&i=0`)).status, 404);

  const waiting = spawn('node', [cli, 'wait', board, '--key', 'update-2', '--json', '--timeout', '20']);
  let waited = '';
  waiting.stdout.on('data', (b) => (waited += b));
  const exited = new Promise((ok) => waiting.on('exit', ok));
  await new Promise((ok) => setTimeout(ok, 500));
  const verdict = await fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'update-2', answer: 'needs-work', note: 'Umer: the button is cut on a small phone.' }) });
  assert.equal(verdict.status, 200);
  assert.equal(await exited, 0);
  assert.equal(JSON.parse(waited)['update-2'].answer, 'needs-work');
  const read = JSON.parse(run('answers', board, '--json').out)['update-2'];
  assert.deepEqual([read.answer, read.label, read.note], ['needs-work', 'Needs work', 'Umer: the button is cut on a small phone.']);

  // A media path edited to leave the evidence folder makes the board invalid instead of serving it.
  const doc = JSON.parse(readFileSync(board, 'utf8'));
  doc.items[0].media[0].path = 'evidence/1/../../../etc/passwd.png';
  writeFileSync(board, JSON.stringify(doc));
  assert.equal((await fetch(`${url}api/media?key=update-1&i=0`)).status, 422);
  proc.kill();
});

test('an evidence post tells the agent no wait or open hint: it is not an ask the user answers', () => {
  const file = join(so, 'hints.json');
  const posted = run('post', file, '--type', 'evidence', '--title', 'Sign-in screen', '--about', 'The screen loads.', '--media', capture);
  assert.equal(posted.code, 0);
  assert.match(posted.out, /update-\d+,\d+,1/);
  assert.doesNotMatch(posted.out, /help\[/);
});

test('a still is shown upright and lighter: a phone photo turned by its EXIF, a transparent capture kept clear, a colour-tagged one kept PNG, an unreadable one at full size', () => {
  const file = join(so, 'stills.json'), dir = mkdtempSync(join(scratch, 'stills-')), stored = () => JSON.parse(readFileSync(file, 'utf8')).items.at(-1);
  // A photo stored on its side: 3400 by 1000 with its left half blue-free and its right half blue, and EXIF orientation 6 (turn clockwise).
  const [w, h] = [3400, 1000], rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set([x % 256, y % 256, x < w / 2 ? 0 : 255, 255], (y * w + x) * 4);
  const tiff = Buffer.from('4d4d002a000000080001011200030000000100060000000000000000', 'hex'), exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]), photo = jpeg.encode({ data: rgba, width: w, height: h }, 95).data;
  writeFileSync(join(dir, 'photo.jpg'), Buffer.concat([photo.subarray(0, 2), app1, photo.subarray(2)]));
  assert.equal(run('post', file, '--type', 'evidence', '--title', 'Photo of the phone', '--about', 'Umer holds it sideways.', '--media', join(dir, 'photo.jpg')).code, 0);
  const { light, thumb } = stored().media[0];
  assert.deepEqual([light.width, light.height, thumb.width, thumb.height, light.path.endsWith('.jpg')], [1000, 3400, 720, 1440, true]);
  // Turned clockwise, the photo's left half is the top: no blue there, all blue at the bottom.
  const upright = jpeg.decode(readFileSync(join(so, light.path))), blue = (x, y) => upright.data[(y * upright.width + x) * 4 + 2];
  assert.deepEqual([blue(500, 40) < 64, blue(500, 3360) > 192], [true, true]);

  // A capture with transparency gets PNG copies with an alpha channel, never a JPEG on a black or white ground. A wide one keeps a thumb of
  // its centre, twice as wide as tall, so it still fills a list card's height.
  const [cw, ch] = [2000, 800], raw = Buffer.alloc((cw * 4 + 1) * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) raw.set([(x * 255 / cw) | 0, (y * 255 / ch) | 0, 90, x < 200 ? 0 : 255], y * (cw * 4 + 1) + 1 + x * 4);
  const chunk = (name, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(name, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cw); ihdr.writeUInt32BE(ch, 4); ihdr.set([8, 6], 8);
  writeFileSync(join(dir, 'clear.png'), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  assert.equal(run('post', file, '--type', 'evidence', '--title', 'Floating panel', '--about', 'Its edge is clear.', '--media', join(dir, 'clear.png')).code, 0);
  const { light: clear, thumb: centre } = stored().media[0], head = readFileSync(join(so, clear.path));
  assert.deepEqual([clear.path.endsWith('-light.png'), clear.width, clear.height, head[25], centre.width, centre.height], [true, 1600, 640, 6, 720, 360]);

  // An opaque capture tagged with cICP (here BT.709) keeps that tag on PNG copies: a JPEG cannot carry it, and without it a browser shows other tones.
  const flat = Buffer.alloc((cw * 3 + 1) * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) flat.set([(x * 255 / cw) | 0, (y * 255 / ch) | 0, (x * y) & 255], y * (cw * 3 + 1) + 1 + x * 3);
  ihdr.set([8, 2], 8);
  const cicp = chunk('cICP', Buffer.from([1, 1, 0, 1]));
  writeFileSync(join(dir, 'tagged.png'), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), cicp, chunk('IDAT', deflateSync(flat)), chunk('IEND', Buffer.alloc(0))]));
  assert.equal(run('post', file, '--type', 'evidence', '--title', 'Tagged colours', '--about', 'Umer checks the tones.', '--media', join(dir, 'tagged.png')).code, 0);
  for (const c of Object.values(stored().media[0]).filter((v) => v?.path)) assert.ok(c.path.endsWith('.png') && readFileSync(join(so, c.path)).includes(cicp), c.path);

  // A still the board cannot read is posted and shown as it is, and the post says so.
  writeFileSync(join(dir, 'odd.webp'), Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), Buffer.alloc(64, 7)]));
  const odd = run('post', file, '--type', 'evidence', '--title', 'Odd file', '--about', 'It is not a real WebP.', '--media', join(dir, 'odd.webp'));
  assert.equal(odd.code, 0);
  assert.match(odd.out, /Capture 1 shows at full size: reading a WebP needs ImageMagick \(convert\), which is not installed/);
  assert.deepEqual(Object.keys(stored().media[0]).sort(), ['bytes', 'path', 'sha256']);
  rmSync(dir, { recursive: true, force: true });
});

test('a proof posted as a Pass/Fail ask is refused and pointed to evidence', () => {
  const file = join(so, 'guard.json');
  const asks = run('post', file, '--title', 'Does the sign-in screen pass?', '--option', 'pass=Pass', '--option', 'fail=Fail', '--recommend', 'pass');
  assert.equal(asks.code, 2);
  assert.match(asks.out, /offers Pass and Fail[^]*post --type evidence/);
  assert.equal(existsSync(file), false);
  assert.equal(run('post', file, '--title', 'Ship it?', '--option', 'yes=Yes', '--option', 'no=No').code, 0);
});

test('refile turns an old Pass/Fail proof ask into an evidence update that never waits', () => {
  const file = join(so, 'refile.json');
  mkdirSync(so, { recursive: true });
  const old = { key: 'sign-in-proof', type: 'decision', title: 'Sign-in screen proof', about: 'The screen loads in a second.', options: [{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }], filed: new Date().toISOString() };
  writeFileSync(file, JSON.stringify({ schema: 2, items: [old] }));
  assert.match(run('list', file).out, /waiting\[1\]\{key,title\}:\n  sign-in-proof,/);
  assert.equal(run('refile', 'sign-in-proof', file).code, 2);
  const done = run('refile', 'sign-in-proof', file, '--media', capture);
  assert.equal(done.code, 0);
  assert.match(done.out, /update-\d+,\d+,1,Sign-in screen proof/);
  const after = run('list', file, '--full').out;
  assert.match(after, /update-\d+,shown,Sign-in screen proof,The screen loads in a second\./);
  assert.match(after, /sign-in-proof,dismissed,/);
  assert.match(run('list', file).out, /nothing is waiting/);
  assert.equal(run('refile', 'sign-in-proof', file, '--media', capture).code, 2);
});

test('a still whose measurement hangs never holds the board', async () => {
  // A convert that never returns: the worker measuring this still is stuck for the whole request, so every answer below must come from
  // what is already known, never from waiting on a measurement or running one on the server's thread.
  const fakeBin = join(scratch, 'hang-bin'), marked = join(scratch, 'hang-convert-called');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'convert'), `#!/bin/sh
touch '${marked}'
sleep 10
`, { mode: 0o755 });
  const bytes = Buffer.from('a still ImageMagick must decode'), hangBoard = join(so, 'hang.json');
  mkdirSync(join(so, 'evidence', '20'), { recursive: true });
  writeFileSync(join(so, 'evidence', '20', '1.jpg'), bytes);
  writeFileSync(hangBoard, JSON.stringify({ schema: 2, items: [{ key: 'hang-still', type: 'evidence', number: 20, title: 'Hanging still',
    about: 'Note.', filed: new Date().toISOString(), media: [{ path: 'evidence/20/1.jpg', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }] }] }));
  const proc = spawn('node', [cli, 'serve', hangBoard, '--port', '0'], {
    cwd: tmpdir(), env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const timed = async (path, init) => {
    const at = Date.now(), response = await fetch(`${url}${path}`, init);
    assert.ok(Date.now() - at < 3000, `${path} took ${Date.now() - at} ms`);
    return response;
  };
  assert.equal((await timed('api/board')).status, 200);
  const cards = await (await timed('api/decisions')).json();
  assert.deepEqual(cards.decisions.map((d) => d.key), ['hang-still']);
  assert.equal((await timed('api/decisions')).status, 200);
  const media = await timed('api/media?key=hang-still&i=0');
  assert.equal(media.status, 200);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);
  const posted = await timed('api/messages', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'prompt', text: 'Still there?' }) });
  assert.equal(posted.status, 200);
  assert.equal(existsSync(marked), true, 'the hanging still was never measured');
  proc.kill();
});

test('a report a day old archives on its own and restore keeps it; a proof a day old is never archived', () => {
  const file = join(so, 'archive.json');
  mkdirSync(so, { recursive: true });
  const filed = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  const proof = (key, hours, n) => ({ key, type: 'evidence', title: key, about: 'Umer checked it.', filed: filed(hours), number: n, media: [{ path: `evidence/${n}/1.png`, sha256: 'a'.repeat(64), bytes: png.length }] });
  const items = [proof('old-proof', 25, 1), proof('new-proof', 23, 2), { key: 'old-ask', type: 'decision', title: 'Keep the digest?', options: yesNo, filed: filed(48) },
    // A report archives like an update: the one dated a day back leaves, the one filed now stays (the CLI lists a report as open, though it asks nothing); a seeded board must date its reports now.
    ...[['old-report', 25], ['new-report', 1]].map(([key, hours]) => ({ contract: 1, kind: 'report', schema: 2, key, title: key, about: 'Umer read it.', filed: filed(hours), view: 'page/index.html', preview: 'page/preview.svg' }))];
  writeFileSync(file, JSON.stringify({ schema: 2, items }));
  const status = () => Object.fromEntries(run('list', file, '--full').out.split('\n').map((l) => l.trim().split(',')).filter((c) => c.length > 2 && !c[0].startsWith('decisions')).map(([key, state]) => [key, state]));
  assert.deepEqual(status(), { 'old-proof': 'shown', 'new-proof': 'shown', 'old-ask': 'waiting', 'old-report': 'dismissed', 'new-report': 'waiting' });
  assert.match(run('list', file).out, /waiting\[1\]\{key,title\}:\n  old-ask,/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.length, 5);
  assert.equal(existsSync(join(so, 'archive.dismissed.jsonl')), false, 'nothing wrote a dismissal line for the old proof');
  assert.equal(run('restore', 'old-report', file).code, 0);
  assert.equal(status()['old-report'], 'waiting');
});

test('a second ask on the same decision is not posted; merging it, or a dismissed first card, allows it', () => {
  const file = join(so, 'repeat.json');
  const ask = (key, title, ...more) => run('post', file, '--key', key, '--title', title, ...more);
  assert.equal(ask('main-ship', 'Ship the new sign-in screen this week?', '--filer', 'main').code, 0);
  const lead = ask('lead-ship', 'Should we ship the new sign-in screen this week?', '--filer', 'lead');
  assert.notEqual(lead.code, 0);
  assert.match(lead.out, /key lead-ship asks what main-ship already asks, and main-ship still waits/);
  assert.match(lead.out, /wait .*--key main-ship/);
  assert.match(run('list', file).out, /waiting\[1\]\{key,title\}:\n  main-ship,/);
  assert.equal(ask('other', 'Which day should the release ship?').code, 0);
  assert.equal(ask('lead-ship', 'Should we ship the new sign-in screen this week?', '--filer', 'lead', '--merge', 'main-ship').code, 0);
  assert.equal(run('dismiss', 'other', file).code, 0);
  assert.equal(ask('other-again', 'Which day should the release ship?').code, 0);
});

test('answering a decision takes every open ask on it off Decide, and its undo puts them back', async () => {
  const file = join(so, 'twins.json');
  const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
  const twin = (key, title, filer) => ({ key, type: 'decision', title, options: yesNo, close: 'done', filer, filed: new Date().toISOString() });
  writeFileSync(file, JSON.stringify({ schema: 2, items: [twin('main-ship', 'Ship the new sign-in screen this week?', 'main'), twin('lead-ship', 'Should we ship the new sign-in screen this week?', 'lead'), twin('other', 'Which day should the release ship?', 'main')] }));
  const proc = spawn(process.execPath, [cli, 'serve', file, '--port', '0'], { cwd: scratch });
  procs.push(proc);
  const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
  const answer = (key, value) => fetch(`${url}api/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, answer: value }) });
  assert.equal((await answer('main-ship', 'yes')).status, 200);
  const saved = JSON.parse(run('answers', file, '--json').out);
  assert.equal(saved['lead-ship'].answer, 'yes');
  assert.equal(saved['lead-ship'].note, 'Answered with main-ship');
  assert.equal(saved.other, undefined);
  assert.match(run('list', file).out, /waiting\[1\]\{key,title\}:\n  other,/);
  assert.equal((await answer('main-ship', '')).status, 200);
  assert.equal(JSON.parse(run('answers', file, '--json').out)['lead-ship'], undefined);
  assert.match(run('list', file).out, /waiting\[3\]/);
});

test('dismiss --filer closes a finished task: only that filer\'s waiting cards leave', () => {
  const file = join(so, 'task.json');
  const ask = (key, title, filer) => run('post', file, '--key', key, '--title', title, '--filer', filer);
  assert.equal(ask('lead-a', 'Ship the sign-in screen?', 'lead-9').code, 0);
  assert.equal(ask('lead-b', 'Which day should the release ship?', 'lead-9').code, 0);
  assert.equal(ask('main-a', 'Keep the weekly digest?', 'main').code, 0);
  const closed = run('dismiss', '--filer', 'lead-9', file);
  assert.equal(closed.code, 0);
  assert.match(closed.out, /lead-a/);
  assert.match(run('list', file).out, /waiting\[1\]\{key,title\}:\n  main-a,/);
  assert.match(run('dismiss', '--filer', 'lead-9', file).out, /0 cards of lead-9 were waiting/);
  assert.equal(run('restore', 'lead-a', file).code, 0);
  assert.match(run('list', file).out, /waiting\[2\]/);
});
