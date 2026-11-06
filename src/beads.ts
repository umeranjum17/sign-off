import { execFileSync } from 'node:child_process';
import type { Ticket, TicketActivity } from './store.js';

/** Beads as the ticket source. Both variables name a store the Juggernaut wrapper (`jg-beads.sh`) may open: SIGN_OFF_BEADS_DIR is the store's `.beads` folder and SIGN_OFF_BEADS_WRAPPER the
 * wrapper itself. Set, the board reads and writes tickets there and never opens its own tickets file; unset, nothing changes. sign-off never calls `bd` itself. */
export const beadsOn = () => !!(process.env.SIGN_OFF_BEADS_DIR && process.env.SIGN_OFF_BEADS_WRAPPER);
const run = (args: string[]) => execFileSync(process.env.SIGN_OFF_BEADS_WRAPPER!, args, { env: { ...process.env, BEADS_DIR: process.env.SIGN_OFF_BEADS_DIR! }, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });

/** One read of the store serves every request for this long: the board polls, and each read starts the wrapper. */
const CACHE_MS = 3000;
let cache: { at: number; rows: any[] } | undefined;
const rowsNow = (warn: (msg: string) => void): any[] => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const rows = JSON.parse(run(['list', '--all', '--limit', '0', '--json']) || '[]');
    if (!Array.isArray(rows)) throw new Error('the list was not a list of rows');
    return (cache = { at: Date.now(), rows }).rows;
  } catch (e: any) {
    warn(`could not read Beads: ${String(e?.stderr || e?.message || e).trim().split('\n')[0]}`);
    return cache?.rows ?? [];
  }
};

const HELD = ['on_hold', 'blocked', 'deferred'];
const metaList = (v: unknown) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
/** A Beads row as a ticket. State comes from the status (a held row is on hold whatever it was doing); progress, stage, the pull requests and the rest of what a row shows are in its metadata. */
export function ticketOf(row: any, open: Set<string> = new Set()): Ticket {
  const meta = row.metadata ?? {}, labels: string[] = row.labels ?? [], held = HELD.includes(row.status), done = row.status === 'closed';
  const edge = (type: string) => (row.dependencies ?? []).filter((d: any) => d.type === type).map((d: any) => d.depends_on_id as string);
  const project = labels.find((l) => l.startsWith('project:'))?.slice(8), prs = [...new Set([row.external_ref, ...metaList(meta.prs)].filter(Boolean))];
  const waits = edge('blocks').filter((id: string) => open.has(id)), type = meta.type ?? ({ epic: 'epic', bug: 'bug', decision: 'decision' } as Record<string, string>)[row.issue_type] ?? 'ticket';
  return { id: row.id, title: row.title, progress: done ? 100 : Number.isInteger(meta.progress) ? meta.progress : 0, type: type as Ticket['type'],
    state: done ? 'done' : held ? 'on hold' : row.status === 'in_progress' ? 'in progress' : 'queued',
    ...(edge('parent-child')[0] && { parent: edge('parent-child')[0] }), ...(Number.isInteger(row.priority) && row.priority <= 3 && { priority: `P${row.priority}` }),
    ...(project && { project }), ...(held && { hold: true as const }), ...(held && meta.hold_reason && { hold_reason: meta.hold_reason }), ...(labels.includes('asked') && { asked: true }),
    // The tickets it waits on (blocks edges to rows not yet closed): a held ticket's sheet names them.
    ...(waits.length && { blocked_by: waits }),
    ...(meta.release && { release: meta.release }), ...(prs.length && { prs }), ...(meta.stage && { stage: meta.stage }), ...(done && !meta.stage && { stage: 'done' as const }),
    ...(Number.isInteger(meta.last_event_at) && { last_event_at: meta.last_event_at }), ...(meta.key && { key: meta.key }), ...(row.description && { description: row.description }),
    at: row.updated_at ?? row.created_at } as Ticket;
}
export const readBeadsTickets = (warn: (msg: string) => void) => {
  const rows = rowsNow(warn), open = new Set<string>(rows.filter((r) => r.status !== 'closed').map((r) => r.id));
  return rows.map((r) => ticketOf(r, open));
};

/** The week's finished work and the activity feed, from rows alone: Beads rows carry no earlier states, so the feed has what the rows say now (created, held, finished). */
export function beadsEvents(warn: (msg: string) => void = () => {}) {
  const events: TicketActivity[] = [], at = (s: string) => (s ?? '').replace(/(\.\d+)?(Z|[+-]\d\d:\d\d)$/, 'Z');
  for (const row of rowsNow(warn)) {
    const t = ticketOf(row), tags = { ...(t.project && { project: t.project }), ...(t.priority && { priority: t.priority }), ...(t.prs && { prs: t.prs }), ...(t.stage && { stage: t.stage }), ...(t.state && { state: t.state }) };
    const add = (kind: TicketActivity['kind'], text: string, when: string) => events.push({ ticket: t.id, title: t.title, kind, text, at: at(when), ...tags });
    add('created', 'Ticket created', row.created_at);
    if (t.hold) add('hold', t.hold_reason ? `Put on hold: ${t.hold_reason}` : 'Put on hold', row.updated_at);
    if (row.closed_at) add('state', 'State changed to done', row.closed_at);
  }
  return events.filter((e) => Number.isFinite(Date.parse(e.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Writes a ticket as the board has it: a new id is created, a known one updated to match. Held and done are statuses; everything else a row shows is a label or metadata. */
export function writeBeadsTicket(t: Omit<Ticket, 'at'>) {
  const meta: Record<string, unknown> = { progress: t.progress, ...(t.type && { type: t.type }), ...(t.stage && { stage: t.stage }), ...(t.hold_reason && { hold_reason: t.hold_reason }), ...(t.prs?.length && { prs: t.prs.join(',') }),
    ...(t.release && { release: t.release }), ...(t.last_event_at !== undefined && { last_event_at: t.last_event_at }), ...(t.key && { key: t.key }) };
  const status = t.state === 'done' || t.progress >= 100 ? 'closed' : t.hold || t.state === 'on hold' ? 'on_hold' : t.state === 'in progress' ? 'in_progress' : 'open';
  const labels = [...(t.project ? [`project:${t.project}`] : []), ...(t.asked ? ['asked'] : [])], kind = ({ epic: 'epic', bug: 'bug', decision: 'decision' } as Record<string, string>)[t.type ?? ''] ?? 'task';
  const had = rowsNowFresh().find((r) => r.id === t.id), p = t.priority?.slice(1) ?? '2';
  if (!had) {
    run(['create', t.title, '--id', t.id, '--force', '-t', kind, '-p', p, '-s', status === 'closed' ? 'open' : status, ...(t.description ? ['-d', t.description] : []), ...(labels.length ? ['-l', labels.join(',')] : []), '--metadata', JSON.stringify(meta), '--silent']);
    if (t.parent) run(['dep', 'add', t.id, t.parent, '--type', 'parent-child']);
    if (status === 'closed') run(['close', t.id]);
  } else {
    // A held ticket put back to work loses its reason: clear it, since a row that is not held has none to show.
    const cleared = ['hold_reason', 'stage', 'prs', 'release', 'key'].filter((k) => meta[k] === undefined && had.metadata?.[k] !== undefined).flatMap((k) => ['--unset-metadata', k]);
    run(['update', t.id, '--title', t.title, '-p', p, '-s', status, '-d', t.description ?? '', '--set-labels', labels.join(','), '--parent', t.parent ?? '', ...Object.entries(meta).flatMap(([k, v]) => ['--set-metadata', `${k}=${v}`]), ...cleared]);
  }
  cache = undefined;
}
const rowsNowFresh = () => { cache = undefined; return rowsNow(() => {}); };
