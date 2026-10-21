import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
