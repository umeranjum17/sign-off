// notify test against a stub muxr that answers 202: with delivered_to 0 the test fails, with 2 it passes; a bare 100.x link_base is refused.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2], run = promisify(execFile), cli = join(process.cwd(), 'dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'so-notify-')), muxr = join(root, 'muxr'), proj = join(root, 'proj'), so = join(proj, '.sign-off');
mkdirSync(muxr); mkdirSync(join(so, 'mocks'), { recursive: true }); writeFileSync(join(muxr, 'notify-token'), 'stub-token\n');
writeFileSync(join(so, 'decisions.json'), '{"schema": 2, "items": []}\n');
let delivered = 0;
const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 202; res.end(JSON.stringify({ id: 'sign-off-test', delivered_to: delivered })); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const config = (base) => writeFileSync(join(so, 'config.yaml'), `board: decisions.json\nport: 4471\nnotify:\n  receiver: muxr\n  url: http://127.0.0.1:${server.address().port}/v1/notify\n  link_base: ${base}\n`);
const env = { ...process.env, HOME: root, MUXR_HOME: muxr }, log = [];
const sign = async (...args) => { const r = await run(process.execPath, [cli, ...args, proj], { env }).then((o) => ({ code: 0, ...o }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr })); log.push(`$ sign-off-axi ${args.join(' ')}  (exit ${r.code})\n${r.stdout}${r.stderr}`); return r; };
config('http://100.101.102.103:4471/'); const bare = await sign('notify');
config('http://box.tail1234.ts.net:4471/'); const zero = await sign('notify', 'test');
delivered = 2; const some = await sign('notify', 'test');
server.close();
const ok = bare.code !== 0 && /\.ts\.net/.test(bare.stdout) && zero.code !== 0 && /0 devices/.test(zero.stdout) && some.code === 0 && /delivered_to: 2/.test(some.stdout);
writeFileSync(join(out, 'notify.log'), log.join('\n') + `\nresult: ${ok ? 'ok' : 'FAILED'}\n`);
writeFileSync(join(out, 'steps.json'), JSON.stringify({
  target: { version: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version },
  start: 'A throwaway board whose notify block points at a stub muxr that answers HTTP 202.',
  steps: ['notify check with a bare 100.x link_base: refused, naming the .ts.net rule.', 'notify test while the stub reports delivered_to 0: fails, saying it was sent to 0 devices.', 'notify test while the stub reports delivered_to 2: passes and prints delivered_to: 2.'],
  result: ok ? 'A 202 that reached no device is reported as a failure; one that reached devices is reported as sent with the count.' : 'FAILED',
}, null, 2));
process.exit(ok ? 0 : 1);
