import { closeSync, createReadStream, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { homeOf } from './fleet.js';

/** Redact before a communication leaves the server, including metadata and full text. */
export function redactComms(text: string): string {
  return text
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|github_pat_[\w]{16,}|AKIA[A-Z0-9]{16})\b/g, '[key hidden]')
    .replace(/\bBearer\s+[\w.+/=-]{12,}/gi, 'Bearer [key hidden]')
    .replace(/\b([\w.-]*(?:token|secret|password|api[_-]?key|access[_-]?key)[\w.-]*\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[key hidden]')
    .replace(/([?&](?:token|key|secret|password)=)[^\s&#]+/gi, '$1[key hidden]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[key hidden]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[key hidden]')
    .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, (s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) ? '[key hidden]' : s)
    .replace(/\/home\/[^\s"'<>]+/g, '[path hidden]');
}

export type ChannelMessage = {
  id: string; at: number; channel: string; thread?: string; from: string; to: string;
  runtime: string; kind: string; state?: string; text: string; read: string; handled: string; source: string;
};
type Config = { ledger?: string; feed?: string; state?: string; homes: string[] };
type ChannelThread = { channel: string; id: string };
type ChannelPage = { configured: boolean; available: boolean; homes: string[]; threads?: ChannelThread[]; messages: ChannelMessage[]; before: number; source: string; error?: string; generation?: string; source_size?: number; updated_at?: number; partial?: boolean; unavailable_homes?: number };
const words = (v: unknown, fallback = '') => typeof v === 'string' ? redactComms(v) : fallback;
const nameOf = (v: unknown, fallback: string): string => typeof v === 'string' ? words(v) : v && typeof v === 'object' ? words((v as Record<string, unknown>).name, fallback) : fallback;
const timeOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) / 1000 : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Configuration is local to the board. No paths from an HTTP request are ever opened. */
export function commsConfig(board: string, fleetHome?: string): Config {
  let text = '';
  try { text = readFileSync(join(dirname(board), 'config.yaml'), 'utf8'); } catch {}
  const value = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(text)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return {
    ledger: homeOf(process.env.SIGN_OFF_COMMS_LEDGER || value('comms_ledger')) || (fleetHome ? join(fleetHome, 'state', 'fleet-ledger.jsonl') : undefined),
    feed: homeOf(process.env.SIGN_OFF_COMMS_FEED || value('comms_feed')),
    state: homeOf(process.env.SIGN_OFF_COMMS_STATE || value('comms_state')) || (fleetHome ? join(fleetHome, 'state') : undefined),
    homes: [...new Set(['Main', ...(process.env.SIGN_OFF_COMMS_HOMES || value('comms_homes') || '').split(',').map((s) => words(s.trim())).filter(Boolean)])],
  };
}

// Only communication files and these metadata fields are read. Endpoint records are never opened.
const entries = (path: string) => { try { return readdirSync(path).filter((s) => !s.startsWith('.')).sort(); } catch { return []; } };
function meta(path: string): Record<string, string> {
  try {
    const text = readFileSync(path, 'utf8');
    return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
      const m = /^(home|worktree|harness|model|from|sender|to|receiver|kind|at)\s*[=:]\s*(.*)$/.exec(line);
      return m ? [[m[1]!, m[2]!.trim()]] : [];
    }));
  } catch { return {}; }
}
const recentFiles = new Map<string, { stamp: string; messages: ChannelMessage[] }>();
function sourceMessages(path: string, channel: string, thread: string | undefined, runtime: string, inbox = false): ChannelMessage[] {
  try {
    const info = statSync(path), stamp = `${info.dev}-${info.ino}-${info.size}-${info.mtimeMs}-${runtime}-${inbox && path.includes('/handled/')}`;
    if (recentFiles.get(path)?.stamp === stamp) return recentFiles.get(path)!.messages;
    const fd = openSync(path, 'r');
    let text: string, start: number;
    try {
      start = Math.max(0, info.size - 64 * 1024);
      const bytes = Buffer.alloc(info.size - start), n = readSync(fd, bytes, 0, bytes.length, start);
      text = bytes.subarray(0, n).toString('utf8');
    } finally { closeSync(fd); }
    const id = `file-${encodeURIComponent(channel)}-${encodeURIComponent(thread || '')}-${info.dev}-${info.ino}`;
    let messages: ChannelMessage[] = [];
    if (inbox) {
      const split = text.indexOf('\n--\n');
      const header = split >= 0 ? text.slice(0, split) : '', body = split >= 0 ? text.slice(split + 4) : text;
      const fields = Object.fromEntries(header.split(/\r?\n/).flatMap((line) => { const m = /^(at|from|sender|to|receiver|kind)=(.*)$/.exec(line); return m ? [[m[1]!, m[2]!]] : []; }));
      const at = timeOf(fields.at);
      // A file move is an acknowledgement, never evidence that the instruction was completed.
      if (at && body.trim()) messages = [{ id, at, channel, ...(thread && { thread }), from: words(fields.from || fields.sender, 'Sender not recorded'), to: words(fields.to || fields.receiver, thread || channel), runtime: channel, kind: words(fields.kind, 'order'), text: redactComms(body.trim()), read: path.includes('/handled/') ? 'Read' : 'Not read', handled: 'Handled not recorded', source: 'Steering inbox' }];
    } else {
      let offset = start;
      for (const line of text.split('\n')) {
        if (start && offset === start) { offset += Buffer.byteLength(line) + 1; continue; }
        const at = /\[at=(\d+)\]/.exec(line), state = /^([\w-]+)/.exec(line)?.[1];
        if (at && state) messages.push({ id: `${id}-${offset}`, at: +at[1]!, channel, ...(thread && { thread }), from: thread || channel, to: 'Recipient not recorded', runtime, kind: ['blocked', 'needs-decision', 'failed'].includes(state) ? 'blocker' : state === 'resolved' ? 'answer' : 'status', state, text: redactComms(line.replace(/^[^:]*:\s*/, '')), read: 'Read not recorded', handled: 'Handled not recorded', source: 'Task status log' });
        offset += Buffer.byteLength(line) + 1;
      }
    }
    if (recentFiles.size > 4096) recentFiles.clear();
    recentFiles.set(path, { stamp, messages });
    return messages;
  } catch { return []; }
}

/** Discover every visible Main status name, then the tasks in each recorded home. Never writes fleet state. */
function fleetSources(config: Config): { homes: string[]; threads: ChannelThread[]; messages: ChannelMessage[]; unavailable: number } {
  const homes = [...config.homes], threads: ChannelThread[] = [], messages: ChannelMessage[] = [];
  let unavailable = 0;
  if (!config.state) return { homes, threads, messages, unavailable };
  for (const status of entries(config.state).filter((s) => s.endsWith('.status'))) {
    const channel = words(status.slice(0, -7)), rec = meta(join(config.state, `${status.slice(0, -7)}.meta`));
    if (!homes.includes(channel)) homes.push(channel);
    const runtime = [rec.harness, rec.model].filter(Boolean).map((s) => words(s)).join(' · ') || channel;
    messages.push(...sourceMessages(join(config.state, status), channel, undefined, runtime));
    // A lead's recorded worktree is its home; a home naming neither leaves its worker history not recorded.
    const pointer = rec.home || rec.worktree;
    if (!pointer) { unavailable++; continue; }
    const state = join(homeOf(pointer)!, 'state');
    if (!existsSync(state)) { unavailable++; continue; }
    const names = entries(state), tasks = [...new Set(names.flatMap((s) => s.endsWith('.status') ? [s.slice(0, -7)] : s.endsWith('.inbox') ? [s.slice(0, -6)] : []))];
    for (const task of tasks) {
      const thread = words(task), details = meta(join(state, `${task}.meta`));
      threads.push({ channel, id: thread });
      const model = [details.harness, details.model].filter(Boolean).map((s) => words(s)).join(' · ') || channel;
      messages.push(...sourceMessages(join(state, `${task}.status`), channel, thread, model));
      const inbox = join(state, `${task}.inbox`);
      for (const dir of [inbox, join(inbox, 'handled')]) for (const file of entries(dir).filter((s) => /^\d+\.msg$/.test(s))) {
        messages.push(...sourceMessages(join(dir, file), channel, thread, channel, true));
      }
    }
  }
  return { homes, threads, messages, unavailable };
}

/** A bounded backwards page of complete JSON lines. Byte IDs survive appends; a torn final line is retried next poll. */
function tail(path: string, before?: number): { lines: { offset: number; value: unknown }[]; before: number; size: number; version: string; modified: number } {
  const fd = openSync(path, 'r');
  try {
    const info = statSync(path), end = Math.min(before ?? info.size, info.size), start = Math.max(0, end - 512 * 1024);
    const b = Buffer.alloc(end - start), n = readSync(fd, b, 0, b.length, start);
    const lines: { offset: number; value: unknown }[] = [];
    let at = start ? b.indexOf(10) + 1 : 0;
    if (at < 0 || (start && at === 0)) at = n;
    const first = start + at;
    while (at < n) {
      const next = b.indexOf(10, at);
      if (next < 0) break;
      try { lines.push({ offset: start + at, value: JSON.parse(b.subarray(at, next).toString('utf8')) }); } catch { /* a malformed source line is not a message */ }
      at = next + 1;
    }
    return { lines, before: first, size: info.size, version: `${info.dev}-${info.ino}`, modified: Math.floor(info.mtimeMs / 1000) };
  } finally { closeSync(fd); }
}

function message(value: unknown, id: string, homes: string[], official: boolean): ChannelMessage | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as Record<string, unknown>, at = timeOf(r.at ?? r.ts), text = words(r.text);
  if (!at || !text) return;
  const task = words(r.task), home = words(r.home ?? r.channel, homes.includes(task) ? task : 'Main');
  const from = nameOf(r.from ?? r.sender, task || home), to = nameOf(r.to ?? r.receiver, 'Recipient not recorded');
  const state = words(r.state), kind = words(r.kind, state === 'blocked' || state === 'needs-decision' || state === 'failed' ? 'blocker' : state === 'resolved' ? 'answer' : 'status');
  const participant = r.from && typeof r.from === 'object' ? r.from as Record<string, unknown> : {};
  return {
    id: official ? words(r.id, id) : id, at, channel: home,
    ...((r.thread || (!homes.includes(task) && task)) && { thread: words(r.thread, task) }),
    from, to, runtime: words(r.model ?? r.runtime ?? participant.model ?? participant.runtime, 'Runtime not recorded'),
    kind, ...(state && { state }), text,
    read: r.read_at ? 'Read' : words(r.read_state, 'Read not recorded'),
    handled: r.handled_at ? 'Handled' : words(r.handled_state, 'Handled not recorded'),
    source: official ? 'Fleet feed' : 'Fleet status log',
  };
}

/** Reads a configured feed when it exists, otherwise the existing ledger. Never exports or writes fleet state. */
export function readChannels(config: Config, before?: number): ChannelPage {
  const official = !!(config.feed && existsSync(config.feed)), path = official ? config.feed : config.ledger;
  const fleet = fleetSources(config), homes = fleet.homes;
  if (!path && !config.state) return { configured: false, available: false, homes, messages: [], before: 0, source: 'Not configured', error: 'Connect a fleet communications source in the board configuration.' };
  try {
    const page = path && existsSync(path) ? tail(path, before) : config.state && existsSync(config.state) ? { lines: [], before: 0, size: 0, version: 'files', modified: 0 } : (() => { throw new Error('Unavailable source'); })();
    // A configured roster is authoritative. Without one, simple source identifiers are shown without mistaking worker task slugs for homes.
    if (homes.length === 1) for (const { value } of page.lines) {
      const r = value as Record<string, unknown>;
      const named = words(r?.home ?? r?.channel ?? r?.task);
      if (named && /^[a-z]+(?:-[a-z]+)*$/.test(named) && !homes.includes(named)) homes.push(named);
    }
    const messages = page.lines.map(({ value, offset }) => message(value, `${official ? 'feed' : 'ledger'}-${page.version}-${offset}`, homes, official)).filter((m): m is ChannelMessage => !!m);
    if (!official) {
      // Prefer status records enriched with the recorded runtime to duplicate ledger events.
      const signature = (m: ChannelMessage) => JSON.stringify([m.channel, m.thread || '', m.at, m.state, m.text.trim()]);
      const known = new Set(fleet.messages.map(signature));
      for (let i = messages.length - 1; i >= 0; i--) if (known.has(signature(messages[i]!))) messages.splice(i, 1);
      messages.push(...fleet.messages);
    }
    for (const m of messages) if (!homes.includes(m.channel)) homes.push(m.channel);
    messages.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    return { configured: true, available: true, homes, threads: fleet.threads, messages, before: page.before, generation: page.version, source_size: page.size, source: official ? 'Fleet feed' : 'Fleet files and status ledger', updated_at: page.modified, partial: !official, unavailable_homes: fleet.unavailable };
  } catch {
    return { configured: true, available: false, homes, messages: [], before: 0, source: official ? 'Fleet feed' : 'Fleet status log', error: 'The communications source could not be read. Retry when it is available.' };
  }
}

/** Resolve a deep link without retaining the source file: byte IDs seek once; official stable IDs stream until found. */
export async function findChannelMessage(config: Config, id: string): Promise<ChannelMessage | undefined> {
  if (!id || id.length > 512) return;
  const official = !!(config.feed && existsSync(config.feed)), path = official ? config.feed : config.ledger;
  if (!path) return;
  const byte = /^(ledger|feed)-(\d+)-(\d+)-(\d+)$/.exec(id);
  try {
    if (byte) {
      const info = statSync(path), offset = Number(byte[4]);
      if (byte[1] !== (official ? 'feed' : 'ledger') || `${info.dev}` !== byte[2] || `${info.ino}` !== byte[3] || !Number.isSafeInteger(offset) || offset >= info.size) return;
      const fd = openSync(path, 'r');
      try {
        const b = Buffer.alloc(Math.min(info.size - offset, 512 * 1024)), n = readSync(fd, b, 0, b.length, offset), end = b.indexOf(10);
        if (end < 0 || end >= n) return;
        return message(JSON.parse(b.subarray(0, end).toString('utf8')), id, config.homes, official);
      } finally { closeSync(fd); }
    }
    if (!official) return;
    const stream = createReadStream(path), lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        try { const r = JSON.parse(line); if (r?.id === id) return message(r, id, config.homes, true); } catch {}
      }
    } finally { lines.close(); stream.destroy(); }
  } catch { /* Missing/rotated history is unavailable, never an arbitrary path or an error containing it. */ }
}
