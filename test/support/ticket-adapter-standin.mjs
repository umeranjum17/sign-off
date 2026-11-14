#!/usr/bin/env node
// A small ticket adapter for the conformance script (docs/ticket-adapter.md): called as `adapter <operation>` with one JSON request on stdin, it keeps its tickets in
// $TICKET_STANDIN_DIR/store.json and answers with one JSON response on stdout. Its words (stage-1, kind-a) are its own; nothing in sign-off may depend on them.
// The fault file next to the store (written by ticket-adapter-standin-faults.mjs) makes its backend unreadable or readable only in part, as the conformance script asks.
// TICKET_STANDIN_ACTOR=<name> is who this backend says did a write: its history events carry that name, and nothing else changes. The interface gives an actor no meaning.
// TICKET_STANDIN_BUG=<name> makes it break one rule on purpose, so the tests can show the conformance script catches each break:
//   empty-on-failure (an unreadable backend lists as empty), complete-false (a partial list answered as a success), drops-extra (an update forgets the extra keys it did
//   not name), ignores-rev (a stale rev is accepted), no-op-id (a repeated create makes a second ticket).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.TICKET_STANDIN_DIR, bug = process.env.TICKET_STANDIN_BUG ?? '', actor = process.env.TICKET_STANDIN_ACTOR || null, [op] = process.argv.slice(2);
const values = (...v) => v.map((value) => ({ value }));
const fields = [{ name: 'title', type: 'string', required: true }, { name: 'body', type: 'text' }, { name: 'kind', type: 'enum', values: values('kind-a', 'kind-b') },
  { name: 'status', type: 'enum', values: values('stage-1', 'stage-2', 'stage-3') }, { name: 'assignee', type: 'string' }, { name: 'labels', type: 'set' }, { name: 'parent', type: 'ref' },
  { name: 'links', type: 'links' }, { name: 'created_at', type: 'datetime', readonly: true }, { name: 'updated_at', type: 'datetime', readonly: true }, { name: 'extra.estimate', type: 'string' }];
const EDITABLE = ['title', 'body', 'kind', 'status', 'assignee', 'labels', 'parent', 'links', 'extra'];
const SHAPE = { describe: [[], []], list: [[], ['cursor', 'limit']], get: [['id'], []], create: [['ticket', 'op_id'], []], update: [['id', 'rev', 'op_id'], ['set', 'unset']], history: [['id'], ['cursor']], comment: [['id', 'text', 'op_id'], []] };

const send = (body, code = 0) => { writeFileSync(1, JSON.stringify(body) + '\n'); process.exit(code); };
const fail = (code, message, retryable = false, detail) => send({ error: { code, message, retryable, ...(detail && { detail }) } }, 1);
const invalid = (...fieldMessages) => fail('invalid', 'The request was refused.', false, { fields: fieldMessages.map(([field, message]) => ({ field, message })) });
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

if (!SHAPE[op]) fail('unsupported', `The operation ${op} is not one of ${Object.keys(SHAPE).join(', ')}.`);
let input = '';
for await (const chunk of process.stdin) input += chunk;
let req;
try { req = JSON.parse(input); } catch { /* answered below */ }
if (req === null || typeof req !== 'object' || Array.isArray(req)) invalid(['request', 'stdin is not one JSON object']);
if (req.interface !== 1) fail('unsupported', `This adapter speaks interface 1, not ${JSON.stringify(req.interface)}.`);
const [required, optional] = SHAPE[op], unknown = Object.keys(req).filter((k) => k !== 'interface' && ![...required, ...optional].includes(k));
if (unknown.length) fail('unsupported', `${op} has no request key ${unknown.join(', ')}.`);
const missing = required.filter((k) => !(k in req));
if (missing.length) invalid(...missing.map((k) => [k, 'is required']));
for (const k of ['id', 'rev', 'op_id', 'text', 'cursor']) if (k in req && (typeof req[k] !== 'string' || !req[k])) invalid([k, 'must be a non-empty string']);
if ('limit' in req && !(Number.isInteger(req.limit) && req.limit > 0)) invalid(['limit', 'must be a positive integer']);

if (op === 'describe') send({ interface: 1, backend: 'stand-in', capabilities: ['history', 'comment'], fields });
if (!dir) fail('unavailable', 'TICKET_STANDIN_DIR is not set.', true);
const file = join(dir, 'store.json'), faultFile = join(dir, 'fault');
const fault = existsSync(faultFile) ? readFileSync(faultFile, 'utf8').trim() : 'none';
const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { counter: 0, tickets: [], events: {}, ops: {} };
if (fault === 'unreadable' && !(bug === 'empty-on-failure' && op === 'list')) fail('unavailable', 'The stand-in store cannot be read.', true);
const save = () => writeFileSync(file, JSON.stringify(store));
const find = (id) => store.tickets.find((t) => t.id === id) ?? fail('not_found', `No ticket ${id}.`);
const rev = () => `r-${++store.counter}`;
const record = (id, type, text, changes = [], actor = null) => { const e = { id: `e-${(store.events[id] ??= []).length + 1}`, at: now(), actor, type, text, changes, extra: {} }; store.events[id].push(e); return e; };
// A write is remembered by its op_id: the same request again is the first result; another request under the same op_id is refused.
const replayed = () => {
  const seen = store.ops[req.op_id];
  if (!seen || (bug === 'no-op-id' && op === 'create')) return;
  if (seen.op !== op || seen.request !== canon(req)) invalid(['op_id', 'was used for another request']);
  send(seen.response);
};
const done = (response) => { store.ops[req.op_id] = { op, request: canon(req), response }; save(); send(response); };
const refuse = (patch, allowed) => { const bad = Object.keys(patch).filter((k) => !allowed.includes(k)); if (bad.length) invalid(...bad.map((k) => [k, 'is not a field a client may set'])); };
const enums = (t) => { for (const f of ['kind', 'status']) if (f in t && !fields.find((x) => x.name === f).values.some((v) => v.value === t[f])) invalid([f, `${t[f]} is not one of ${fields.find((x) => x.name === f).values.map((v) => v.value).join(', ')}`]); };

if (op === 'list') {
  if (fault === 'partial') {
    if (bug !== 'complete-false') fail('incomplete', 'Only part of the stand-in store could be read.', true);
    send({ tickets: store.tickets.slice(0, Math.ceil(store.tickets.length / 2)), complete: false });
  }
  const from = Number(req.cursor ?? 0), size = req.limit ?? store.tickets.length, next = from + size;
  send({ tickets: store.tickets.slice(from, next), ...(next < store.tickets.length && { next_cursor: String(next) }), complete: true });
}
if (op === 'get') send({ ticket: find(req.id) });
if (op === 'history') { find(req.id); send({ events: store.events[req.id] ?? [] }); }
if (op === 'comment') {
  replayed(); find(req.id);
  done({ event: record(req.id, 'comment', req.text, [], actor) });
}
if (op === 'create') {
  replayed();
  const t = req.ticket, extra = t.extra ?? {};
  if (typeof t.title !== 'string' || !t.title.trim()) invalid(['title', 'is required']);
  refuse(t, ['title', 'body', 'kind', 'status', 'assignee', 'labels', 'parent', 'links', 'extra']); enums(t);
  if (t.parent && !store.tickets.some((x) => x.id === t.parent)) invalid(['parent', `No ticket ${t.parent}.`]);
  const made = { id: `tk-${store.tickets.length + 1}`, rev: rev(), title: t.title, body: t.body ?? '', kind: t.kind ?? 'kind-a', status: t.status ?? 'stage-1', assignee: t.assignee ?? null,
    labels: t.labels ?? [], parent: t.parent ?? null, links: t.links ?? [], created_at: now(), updated_at: now(), extra };
  store.tickets.push(made); record(made.id, 'created', null, [], actor);
  done({ ticket: made });
}
if (op === 'update') {
  replayed();
  const t = find(req.id), set = req.set ?? {}, unset = req.unset ?? [], keys = Object.keys(set.extra ?? {});
  if (!Object.keys(set).length && !unset.length) invalid(['set', 'there is nothing to change']);
  refuse(set, EDITABLE); enums(set);
  if (keys.some((k) => unset.includes(k))) invalid(['unset', 'names a key that set.extra also names']);
  if (req.rev !== t.rev && bug !== 'ignores-rev') fail('conflict', `${t.id} changed since it was read (rev ${req.rev}, now ${t.rev}).`, false, { current: t });
  const next = { ...t, ...set, extra: { ...t.extra, ...set.extra } };
  for (const k of unset) delete next.extra[k];
  if (bug === 'drops-extra') next.extra = { ...set.extra };
  const changes = [...EDITABLE.filter((k) => k !== 'extra' && canon(next[k]) !== canon(t[k])).map((field) => ({ field, from: t[field], to: next[field] })),
    ...[...new Set([...Object.keys(t.extra), ...Object.keys(next.extra)])].filter((k) => canon(t.extra[k]) !== canon(next.extra[k])).map((k) => ({ field: `extra.${k}`, from: t.extra[k] ?? null, to: next.extra[k] ?? null }))];
  if (!changes.length) done({ ticket: t });
  Object.assign(t, next, { rev: rev(), updated_at: now() });
  record(t.id, 'changed', null, changes, actor);
  done({ ticket: t });
}
