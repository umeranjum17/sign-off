#!/usr/bin/env node
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type Decision, InputError, appendAnswer, loadDecisions, readAnswers } from './store.js';

const USAGE = `usage:
  sign-off serve <decisions.json> [--port 4410]   show the decisions page on 127.0.0.1 (--port 0 picks a free port)
  sign-off answers <decisions.json>               print the latest answers as JSON
  sign-off help`;
const warn = (msg: string) => console.error(`sign-off: ${msg}`);
const fail = (msg: string): never => { warn(msg); return process.exit(2); };

let cmd: string | undefined, file = '', port = 4410, decisions: Decision[] = [];
try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { port: { type: 'string', default: '4410' } } });
  [cmd, file] = positionals;
  if (cmd === 'help' || !cmd) {
    console.log(USAGE);
    process.exit(0);
  }
  if ((cmd !== 'serve' && cmd !== 'answers') || !file) throw new InputError(USAGE);
  port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new InputError('--port must be a number from 0 to 65535');
  decisions = loadDecisions(file);
} catch (e: any) {
  fail(e instanceof InputError ? e.message : `${e.message}\n${USAGE}`);
}

if (cmd === 'answers') {
  const keys = new Set(decisions.map((d) => d.key));
  const out: Record<string, object> = {};
  for (const [key, { answer, label, close, at }] of Object.entries(readAnswers(file, warn))) {
    if (keys.has(key)) out[key] = { answer, label, close, at };
    else warn(`left out the answer for ${key}: that question is no longer in ${file}`);
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

const page = readFileSync(new URL('../web/index.html', import.meta.url));
const state = () => ({ decisions: loadDecisions(file), answers: readAnswers(file, warn) });

async function route(req: IncomingMessage): Promise<[number, unknown]> {
  if (req.method === 'GET' && req.url === '/api/decisions') return [200, state()];
  if (req.method !== 'POST' || req.url !== '/api/answers') return [404, { error: 'Not found' }];
  if (!req.headers['content-type']?.startsWith('application/json')) return [415, { error: 'Send JSON' }];
  let body = '';
  for await (const chunk of req) body += chunk;
  const { key, answer } = JSON.parse(body) ?? {};
  const d = loadDecisions(file).find((x) => x.key === key);
  if (!d) return [404, { error: 'This question is no longer in the file' }];
  const option = d.options.find((o) => o.value === answer);
  if (!option) return [400, { error: 'The answer must be yes or no' }];
  appendAnswer(file, d, option);
  return [200, state()];
}

const server = createServer(async (req, res) => {
  const { port: bound } = server.address() as AddressInfo;
  // Only loopback names: blocks DNS rebinding from a web page.
  if (req.headers.host !== `127.0.0.1:${bound}` && req.headers.host !== `localhost:${bound}`) return res.writeHead(403).end('Forbidden host');
  if (req.method === 'GET' && req.url === '/') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self' 'unsafe-inline'" }).end(page);
  }
  let status: number, body: unknown;
  try {
    [status, body] = await route(req);
  } catch (e: any) {
    status = e instanceof InputError ? (req.method === 'GET' ? 422 : 409) : e instanceof SyntaxError ? 400 : 500;
    body = { error: e.message };
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});
server.on('error', (e: NodeJS.ErrnoException) => fail(e.code === 'EADDRINUSE' ? `port ${port} is in use; pass --port` : e.message));
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
