import { spawn } from 'node:child_process';

/** The ticket adapter client (docs/ticket-adapter.md). The tickets live in the system behind one executable, named by SIGN_OFF_TICKETS_ADAPTER and called as `adapter <operation>`:
 * one JSON request on stdin, one JSON response on stdout. This file holds no ticket data, no cache and no rule about tickets; every read goes to the adapter again, and an error is
 * thrown as it came, never turned into an empty list or older rows. */
export const ADAPTER_VAR = 'SIGN_OFF_TICKETS_ADAPTER';
const INTERFACE = 1;
const TIMEOUT_MS = 20_000;
/** A ticket record as the adapter sends it: the named fields and anything else the backend has, kept whole. */
export type Ticket = { id: string; rev: string; title: string; body: string; kind: string; status: string; assignee: string | null; labels: string[]; parent: string | null; links: { type: string; id: string }[];
  created_at: string; updated_at: string; extra: Record<string, unknown>; [unknown: string]: unknown };
export type TicketEvent = { id: string; at: string; actor: string | null; type: string; text: string | null; changes: { field: string; from: unknown; to: unknown }[]; extra: Record<string, unknown>; [unknown: string]: unknown };
export type FieldSpec = { name: string; type: string; label?: string; values?: { value: string; label?: string }[]; required?: boolean; readonly?: boolean };
export type Describe = { interface: number; backend: string; capabilities: string[]; fields: FieldSpec[] };
export type Patch = { id: string; rev: string; set?: Record<string, unknown>; unset?: string[] };

/** A failure as the adapter reports it (`code`, `message`, `retryable`, `detail`), or one the client itself makes: no adapter named (`not_configured`), or one that did not answer (`timeout`, `internal`). */
export class TicketError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false, readonly detail?: unknown) { super(message); }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable, ...(this.detail !== undefined && { detail: this.detail }) }; }
}
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One operation: the request goes in on stdin, and the exit status is read before stdout. */
export function call(operation: string, request: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const adapter = process.env[ADAPTER_VAR];
  if (!adapter) return Promise.reject(new TicketError('not_configured', `No ticket adapter is set. Name the adapter executable in ${ADAPTER_VAR}.`));
  return new Promise((resolve, reject) => {
    let out = '', err = '', over = false;
    const child = spawn(adapter, [operation], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { over = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.stdin.on('error', () => {});
    child.on('error', (e) => { clearTimeout(timer); reject(new TicketError('unavailable', `The ticket adapter could not be started: ${e.message}`, true)); });
    child.on('close', (status) => {
      clearTimeout(timer);
      if (over) return reject(new TicketError('timeout', `The ticket adapter did not answer ${operation} within ${TIMEOUT_MS / 1000} seconds.`, true));
      let body: unknown;
      try { body = JSON.parse(out); } catch { /* answered below */ }
      const bad = (why: string) => reject(new TicketError('internal', `The ticket adapter ${why}${err.trim() ? `: ${err.trim().slice(0, 500)}` : '.'}`, true));
      if (!isObject(body)) return bad(`exited ${status} without one JSON response`);
      if (status !== 0) {
        const e = body.error;
        return isObject(e) && typeof e.code === 'string' && typeof e.message === 'string' ? reject(new TicketError(e.code, e.message, e.retryable === true, e.detail)) : bad(`exited ${status} without an error response`);
      }
      if ('error' in body) return bad('answered an error with exit 0');
      resolve(body);
    });
    child.stdin.end(JSON.stringify({ interface: INTERFACE, ...request }));
  });
}

/** What the backend is and which fields it knows; an adapter that answers another interface number is refused. */
export async function describe(): Promise<Describe> {
  const r = await call('describe');
  if (r.interface !== INTERFACE) throw new TicketError('unsupported', `The ticket adapter speaks interface ${JSON.stringify(r.interface)}; this board speaks ${INTERFACE}.`);
  if (typeof r.backend !== 'string' || !Array.isArray(r.capabilities) || !Array.isArray(r.fields)) throw new TicketError('internal', 'The ticket adapter answered describe without its backend, capabilities and fields.', true);
  return r as Describe;
}

/** Every ticket, page after page. A page that is not `complete: true` is refused as `incomplete`: a partial list is never shown. */
export async function list(): Promise<Ticket[]> {
  const tickets: Ticket[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10_000; page++) {
    const r = await call('list', cursor === undefined ? {} : { cursor });
    if (r.complete !== true || !Array.isArray(r.tickets)) throw new TicketError('incomplete', 'The ticket adapter did not vouch for a whole list (complete is not true), so no tickets are shown.', true);
    tickets.push(...r.tickets);
    if (typeof r.next_cursor !== 'string') return tickets;
    cursor = r.next_cursor;
  }
  throw new TicketError('incomplete', 'The ticket list did not end after 10000 pages, so no tickets are shown.', true);
}

const ticketOf = (r: Record<string, any>): Ticket => {
  if (!isObject(r.ticket) || typeof r.ticket.id !== 'string') throw new TicketError('internal', 'The ticket adapter answered without a ticket.', true);
  return r.ticket as Ticket;
};
export const get = async (id: string) => ticketOf(await call('get', { id }));
export const create = async (ticket: Record<string, unknown>, op_id: string) => ticketOf(await call('create', { ticket, op_id }));
/** A patch: only what the person changed and the rev they read. Nothing is rewritten from a copy of the ticket. */
export const update = async (p: Patch, op_id: string) => ticketOf(await call('update', { id: p.id, rev: p.rev, ...(p.set && { set: p.set }), ...(p.unset?.length && { unset: p.unset }), op_id }));
/** Every event of one ticket, oldest first. */
export async function history(id: string): Promise<TicketEvent[]> {
  const events: TicketEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10_000; page++) {
    const r = await call('history', { id, ...(cursor !== undefined && { cursor }) });
    if (!Array.isArray(r.events)) throw new TicketError('internal', 'The ticket adapter answered history without events.', true);
    events.push(...r.events);
    if (typeof r.next_cursor !== 'string') return events;
    cursor = r.next_cursor;
  }
  throw new TicketError('internal', 'The history did not end after 10000 pages.', true);
}
export async function comment(id: string, text: string, op_id: string): Promise<TicketEvent> {
  const r = await call('comment', { id, text, op_id });
  if (!isObject(r.event)) throw new TicketError('internal', 'The ticket adapter answered comment without an event.', true);
  return r.event as TicketEvent;
}

/** The HTTP status a failure is sent with: the code says whose fault it is. */
export const STATUS: Record<string, number> = { not_found: 404, conflict: 409, invalid: 422, denied: 403, unsupported: 501, timeout: 504, not_configured: 503 };
export const statusOf = (e: TicketError) => STATUS[e.code] ?? 502;
