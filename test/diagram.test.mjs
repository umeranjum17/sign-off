import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { documentRevision } from '../dist/store.js';
const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const fixtures = new URL('../fixtures/contract/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'sign-off-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// The part of a rendered architecture page the post-time check reads: a drawing with a viewBox and sized text.
const page = (width, sizes, extra = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
<svg viewBox="0 0 ${width} 300" role="img">${sizes.map((s, i) => `<text x="10" y="${20 + i * 20}" font-size="${s}">Step ${i + 1}</text>`).join('')}${extra}</svg></body></html>`;

test('a diagram on a plan: post reads its page, the board serves it in the frame, and a wide, small or branded page is refused', async () => {
  const dir = join(scratch, 'diagram'), board = join(dir, 'board.json'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(join(dir, 'diagrams'), { recursive: true });
  const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', env, cwd: dir });
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v2', 'valid-full.json')));
  const view = (src) => [{ label: 'Today', src }];
  const post = (m) => spawnSync('node', [cli, 'post', board, '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify(m) });
  const withDiagram = (src) => ({ ...plan, visual: { ...plan.visual, diagram: view(src) } });
  writeFileSync(join(dir, 'diagrams', 'ok.html'), page(320, [11, 11]));
  writeFileSync(join(dir, 'diagrams', 'wide.html'), page(796, [11, 11]));
  writeFileSync(join(dir, 'diagrams', 'small.html'), page(360, [11, 9]));
  writeFileSync(join(dir, 'diagrams', 'legend.html'), page(320, [11, 10]));
  writeFileSync(join(dir, 'diagrams', 'brand.html'), page(320, [11], '<g data-brand-mark="vue"></g>'));
  writeFileSync(join(dir, 'diagrams', 'flat.html'), '<!doctype html><p>No drawing</p>');
  mkdirSync(join(scratch, 'outside'));
  writeFileSync(join(scratch, 'outside', 'o.html'), page(320, [11]));
  symlinkSync(join(scratch, 'outside', 'o.html'), join(dir, 'diagrams', 'link.html'));
  for (const [src, error] of [['diagrams/wide.html', /text of 5\.2 px at 390 \(11 in a 796 wide drawing\), under 12/], ['diagrams/small.html', /text of 9\.4 px at 390 \(9 in a 360 wide drawing\)/],
    ['diagrams/legend.html', /text of 11\.7 px at 390 \(10 in a 320 wide drawing\)/], ['diagrams/brand.html', /uses brand marks/], ['diagrams/flat.html', /no <svg> drawing with a viewBox/], ['diagrams/gone.html', /diagrams\/gone\.html\\" is not there/],
    ['diagrams/link.html', /leads outside the board file's folder/], ['../x.html', /visual\.diagram\[0\]\.src/], ['diagrams/ok.png', /visual\.diagram\[0\]\.src/]]) {
    const refused = post(withDiagram(src));
    assert.equal(refused.status, 2, `${src}: ${refused.stdout}`);
    assert.match(refused.stdout, error);
  }
  assert.match(post({ ...plan, visual: { ...plan.visual, diagram: [] } }).stdout, /visual\.diagram must list 1 to 3/);
  // The same plan with a diagram on the picture, a section and an item posts, and the views are counted in that order.
  const sec = plan.sections[0], item = { ...sec.items[0], diagram: view('diagrams/ok.html') };
  const full = { ...withDiagram('diagrams/ok.html'), sections: [{ ...sec, diagram: view('diagrams/ok.html'), items: [item, ...sec.items.slice(1)] }, ...plan.sections.slice(1)] };
  const posted = post(full);
  assert.equal(posted.status, 0, posted.stdout);
  const proc = spawn('node', [cli, 'serve', board, '--port', '0'], { cwd: tmpdir(), env });
  try {
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    for (const n of [0, 1, 2]) {
      const res = await fetch(new URL(`/mock/local/${plan.key}~diagram.${n}/ok.html`, url));
      assert.equal(res.status, 200, `diagram.${n}`);
      assert.match(res.headers.get('content-security-policy'), /sandbox allow-scripts/);
      assert.match(await res.text(), /<svg viewBox="0 0 320 300"/);
    }
    assert.equal((await fetch(new URL(`/mock/local/${plan.key}~diagram.3/ok.html`, url))).status, 404);
  } finally { proc.kill(); }
});

test('a diagram is pinned like media: the board serves only the file that was posted, the revision covers its content, and Full size has its way back', async () => {
  const dir = join(scratch, 'pin'), env = { ...process.env, HOME: join(scratch, 'home') };
  mkdirSync(join(dir, 'diagrams'), { recursive: true });
  const plan = JSON.parse(readFileSync(join(fixtures, 'plan.v3', 'valid-full.json')));
  const board = (name) => join(dir, `${name}.json`);
  const post = (name, src) => spawnSync('node', [cli, 'post', board(name), '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify({ ...plan, visual: { ...plan.visual, diagram: [{ label: 'Today', src }] } }) });
  const serve = async (name) => {
    const proc = spawn('node', [cli, 'serve', board(name), '--port', '0'], { cwd: tmpdir(), env });
    const url = await new Promise((ok) => proc.stdout.once('data', (b) => ok(/http:\/\/127\.0\.0\.1:\d+\//.exec(b)[0])));
    return { proc, url, view: (query = '') => fetch(new URL(`/mock/local/${plan.key}~diagram.0/${basename(src)}${query}`, url)), revision: async () => ((await (await fetch(new URL('/api/decisions', url))).json()).decisions).find((d) => d.key === plan.key).engagement.revision };
  };
  const src = 'diagrams/a.html', first = page(320, [12, 12]);
  writeFileSync(join(dir, src), first);
  assert.equal(post('a', src).status, 0);
  // The stored view carries the file's sha256 and byte size.
  const view = JSON.parse(readFileSync(board('a'), 'utf8')).items[0].visual.diagram[0];
  assert.deepEqual([view.sha256, view.bytes], [createHash('sha256').update(first).digest('hex'), Buffer.byteLength(first)]);
  const a = await serve('a');
  try {
    assert.equal((await a.view()).status, 200);
    const revision = await a.revision();
    // Changed after posting, to a different size or to the same size: refused either way, and served again once it is the posted file.
    writeFileSync(join(dir, src), page(320, [12, 12, 12]));
    assert.equal((await a.view()).status, 404);
    writeFileSync(join(dir, src), first.replace('Step 1', 'Step X'));
    assert.equal(Buffer.byteLength(first.replace('Step 1', 'Step X')), view.bytes);
    const refused = await a.view();
    assert.equal(refused.status, 404);
    assert.match((await refused.json()).error, /changed since it was posted/);
    writeFileSync(join(dir, src), first);
    assert.equal((await a.view()).status, 200);
    // The revision covers the file: the stored plan hashes to another revision when only its diagram file's content changed, and to the same one when it did not.
    const stored = JSON.parse(readFileSync(board('a'), 'utf8')).items[0], pinned = (hash) => ({ ...stored, visual: { ...stored.visual, diagram: [{ ...view, sha256: hash }] } });
    assert.equal(documentRevision(stored), revision);
    assert.equal(documentRevision(pinned(view.sha256)), revision);
    assert.notEqual(documentRevision(pinned(createHash('sha256').update(first.replace('Step 1', 'Step X')).digest('hex'))), revision);
    // Posting the plan over a file with other content pins that content instead.
    writeFileSync(join(dir, src), first.replace('Step 1', 'Step X'));
    assert.equal(post('b', src).status, 0);
    writeFileSync(join(dir, src), first);
    assert.notEqual(JSON.parse(readFileSync(board('b'), 'utf8')).items[0].visual.diagram[0].sha256, view.sha256);
    // A pin that does not match the file is not taken from the message: post pins what is there.
    const forged = spawnSync('node', [cli, 'post', board('d'), '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify({ ...plan, visual: { ...plan.visual, diagram: [{ label: 'Today', src, sha256: '0'.repeat(64), bytes: 1 }] } }) });
    assert.equal(forged.status, 0, forged.stdout);
    assert.deepEqual(JSON.parse(readFileSync(board('d'), 'utf8')).items[0].visual.diagram[0], view);
    // Full size is the page by itself: a way back to the plan, and on a phone's drawing-alone page the page sized to the drawing.
    for (const query of ['?theme=dark', '?theme=dark&embed=1']) {
      const html = await (await a.view(query)).text();
      assert.match(html, new RegExp(`<script data-back="/#waiting/${plan.key}" data-label="Back to the plan">`));
      assert.match(html, /if \(parent !== window\) return;/);
    }
  } finally { a.proc.kill(); }
  const bad = spawnSync('node', [cli, 'post', board('f'), '--kind', 'plan', '--from', '-'], { encoding: 'utf8', env, cwd: dir, input: JSON.stringify({ ...plan, visual: { ...plan.visual, diagram: [{ label: 'Today', src, sha256: 'xyz' }] } }) });
  assert.equal(bad.status, 2);
  assert.match(bad.stdout, /visual\.diagram\[0\]\.sha256/);
});
