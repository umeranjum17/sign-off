#!/usr/bin/env node
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { type Decision, InputError, appendAnswer, loadDecisions, readAnswers } from './store.js';

const USAGE = `usage:
  sign-off serve <decisions.json> [--port 4410] [--evidence-root <dir>]   show the local board
  sign-off answers <decisions.json>               print the latest answers as JSON
  sign-off help`;
const warn = (msg: string) => console.error(`sign-off: ${msg}`);
const fail = (msg: string): never => { warn(msg); return process.exit(2); };
class EvidenceError extends Error {}

let cmd: string | undefined, file = '', port = 4410, evidenceRoot = '', decisions: Decision[] = [];
try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { port: { type: 'string', default: '4410' }, 'evidence-root': { type: 'string', default: '' } } });
  [cmd, file] = positionals;
  if (cmd === 'help' || !cmd) {
    console.log(USAGE);
    process.exit(0);
  }
  if ((cmd !== 'serve' && cmd !== 'answers') || !file) throw new InputError(USAGE);
  port = Number(values.port);
  evidenceRoot = values['evidence-root'] ? resolve(values['evidence-root']) : '';
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
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const state = () => ({
  decisions: loadDecisions(file).map((d) => ({ ...d, evidenceCard: d.evidence ? evidenceCard(d.evidence) : null })),
  answers: readAnswers(file, warn),
});
const mediaTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function contained(path: string): string {
  let root: string, actual: string;
  try {
    root = realpathSync(evidenceRoot);
    actual = realpathSync(resolve(root, path));
  } catch { throw new EvidenceError('no matching evidence file'); }
  if (!actual.startsWith(root + sep)) throw new EvidenceError('evidence path escapes the selected root');
  return actual;
}
function evidenceCard(link: NonNullable<Decision['evidence']>) {
  try {
    if (!evidenceRoot) throw new EvidenceError('no evidence root was selected');
    const recordPath = contained(`.done-done/runs/${link.run_id}.json`);
    if (statSync(recordPath).size > 1_000_000) throw new EvidenceError('run record is too large');
    const run = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new EvidenceError('run record is malformed or its media is unavailable');
    if (run.schema !== 1 || run.run_id !== link.run_id || run.commit !== link.commit || !/^[a-f0-9]{40}$/.test(run.tree ?? '')
      || typeof run.dirty !== 'boolean' || !(run.exit === null || Number.isInteger(run.exit)) || !Array.isArray(run.files)
      || run.files.some((f: any) => !f || typeof f !== 'object' || typeof f.path !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256 ?? '') || !Number.isInteger(f.bytes) || f.bytes < 0)) {
      throw new EvidenceError('run record is malformed or commit does not match');
    }
    const media: { path: string; url: string; type: string }[] = run.files.flatMap((f: any) => {
      const type = mediaTypes[extname(f.path ?? '').toLowerCase()];
      if (!type) return [];
      const path = contained(f.path);
      if (statSync(path).size > 20_000_000) throw new EvidenceError('media is unavailable or too large');
      const bytes = readFileSync(path);
      if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) throw new EvidenceError('evidence hash does not match the run record');
      return [{ path: f.path, url: `/api/evidence?run=${encodeURIComponent(link.run_id)}&file=${encodeURIComponent(f.path)}`, type }];
    });
    const result = !Number.isInteger(run.exit) ? 'INCONCLUSIVE' : run.exit !== 0 || run.dirty || !run.files.length ? 'RUN FAIL' : 'RUN PASS';
    return { status: 'verified', result, commit: run.commit, media };
  } catch (e: any) {
    const reason = e instanceof EvidenceError ? e.message
      : e?.code ? 'no matching run record or media'
      : 'run record is malformed or its media is unavailable';
    return { status: 'unverified', result: 'UNVERIFIED', reason, commit: '', media: [] };
  }
}

async function route(req: IncomingMessage): Promise<[number, unknown]> {
  if (req.method === 'GET' && req.url?.startsWith('/api/evidence?')) {
    const q = new URL(req.url, 'http://localhost').searchParams, runId = q.get('run') ?? '', path = q.get('file') ?? '';
    const decision = loadDecisions(file).find((d) => d.evidence?.run_id === runId);
    if (!decision?.evidence || !path) return [404, { error: 'Evidence is unavailable' }];
    const card = evidenceCard(decision.evidence);
    if (card.status !== 'verified' || !card.media.some((m) => m.path === path)) return [404, { error: 'Evidence is unavailable' }];
    const actual = contained(path), type = mediaTypes[extname(path).toLowerCase()];
    return [200, { media: readFileSync(actual), type }];
  }
  if (req.method === 'GET' && req.url === '/api/decisions') {
    return [200, state()];
  }
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
  if (body && typeof body === 'object' && 'media' in body) {
    const media = body as { media: Buffer; type: string };
    return res.writeHead(status, { 'content-type': media.type, 'x-content-type-options': 'nosniff' }).end(media.media);
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});
server.on('error', (e: NodeJS.ErrnoException) => fail(e.code === 'EADDRINUSE' ? `port ${port} is in use; pass --port` : e.message));
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
