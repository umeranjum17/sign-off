// Vault remains OFF. The server imports only expiry functions; `wait --into` reaches payload only through deliverVault.
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isKey } from './store.js';

export type VaultMeta = { board: string; key: string; mode: 'give' | 'receive'; filer: string; expires: number; destination?: string; provider?: string };
type Status = 'pending' | 'ready' | 'refused' | 'expired' | 'claimed' | 'delivered';
type Sealed = { nonce: string; tag: string; data: string };
type Record = { schema: 1; meta: VaultMeta; status: Status; at: number; sealed?: Sealed };
export type VaultExpiry = { schema: 1; id: string; status: 'expired' | 'refused' | 'delivery-uncertain' | 'delivered'; at: number };
export const errors = {
  VALIDATION_ERROR: 'Vault input is invalid: check mode, expiry, provider and destination.',
  EXPIRED: 'Vault item expired; request a fresh item.',
  VAULT_KEY_UNAVAILABLE: 'Vault key is unavailable; encrypted payload cannot be read.',
  BUSY: 'Vault storage is busy or unavailable; retry later.',
  NOT_FOUND: 'Vault item was not found.',
  TIMEOUT: 'Vault expiry wait timed out; retry status later.',
  READER_MISMATCH: 'This item belongs to a different filer or destination.',
  REFUSED: 'User refused this vault item; no value was delivered.',
  DESTINATION_DENIED: 'Destination is outside an approved private config root or has unsafe permissions.',
  DESTINATION_EXISTS: 'Destination exists; nothing was overwritten.',
  ALREADY_READ: 'Vault item was already delivered; value is unavailable.',
  DELIVERY_UNCERTAIN: 'Delivery interrupted; do not retry this item. Check destination locally, then request a fresh item if needed.',
};
export class VaultError extends Error {
  constructor(readonly code: keyof typeof errors) { super(errors[code]); }
}
function bad(code: keyof typeof errors): never { throw new VaultError(code); }
const digest = (board: string, key: string) => createHash('sha256').update(JSON.stringify([board, key])).digest('hex');
const aad = (meta: VaultMeta) => Buffer.from(JSON.stringify([1, meta.board, meta.key, meta.mode, meta.expires, meta.destination ?? null, meta.filer, ...(meta.provider === undefined ? [] : [meta.provider])]));
const VAULT_ID = /^[a-f0-9]{32}$/;
function boardFile(board: unknown) {
  if (typeof board !== 'string' || !isAbsolute(board)) bad('VALIDATION_ERROR');
  try { return realpathSync(board); } catch { bad('NOT_FOUND'); }
}
// Never used: callers stay silent with no permission walk, lock or state creation.
const unused = (file: string) => {
  try { return !lstatSync(join(stateHome(), 'sign-off', 'vault'), { throwIfNoEntry: false }) || !lstatSync(join(dirname(file), '.sign-off-vault-id'), { throwIfNoEntry: false }); }
  catch (e: any) { if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return true; throw e; }
};
function boardId(file: string, create: boolean) {
  const side = join(dirname(file), '.sign-off-vault-id');
  if (!lstatSync(side, { throwIfNoEntry: false })) {
    if (!create) bad('NOT_FOUND');
    publish(side, `${randomBytes(16).toString('hex')}\n`);
  }
  privateFile(side);
  const id = readFileSync(side, 'utf8').trim();
  if (!VAULT_ID.test(id)) bad('VALIDATION_ERROR');
  return id;
}

// Absolute and free of raw '.' or '..' segments, which resolve() would otherwise hide.
const plain = (p: string) => isAbsolute(p) && !p.split('/').some((s) => s === '.' || s === '..');
function metadata(m: VaultMeta): VaultMeta {
  if (!m || typeof m.board !== 'string' || !VAULT_ID.test(m.board) || !isKey(m.key) || !isKey(m.filer) || !['give', 'receive'].includes(m.mode)
    || !Number.isSafeInteger(m.expires) || m.expires <= 0
    || (m.mode === 'give' ? typeof m.destination !== 'string' || !plain(m.destination) || m.provider !== undefined : m.destination !== undefined || !isKey(m.provider))) bad('VALIDATION_ERROR');
  return { board: m.board, key: m.key, mode: m.mode, filer: m.filer, expires: m.expires,
    ...(m.destination !== undefined && { destination: resolve(m.destination) }), ...(m.provider !== undefined && { provider: m.provider }) };
}
function privateFile(path: string) {
  const s = lstatSync(path);
  if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o600 || s.size > 32_768) bad('VAULT_KEY_UNAVAILABLE');
}
const stateHome = () => process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
function root(create = true) {
  const state = stateHome();
  if (!isAbsolute(state) || !process.getuid) bad('VAULT_KEY_UNAVAILABLE');
  const owner = join(state, 'sign-off'), vault = join(owner, 'vault');
  let path = parse(vault).root;
  for (const part of vault.slice(path.length).split('/')) {
    path = join(path, part);
    if (!create && !lstatSync(path, { throwIfNoEntry: false })) return '';
    try { if (create) mkdirSync(path, { mode: 0o700 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
    const s = lstatSync(path);
    if (existsSync(join(path, '.git'))) bad('VAULT_KEY_UNAVAILABLE');
    if (!s.isDirectory() || (s.mode & 0o022) && !(s.mode & 0o1000) || (path === owner || path === vault) && (s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o700)) bad('VAULT_KEY_UNAVAILABLE');
  }
  return vault;
}
const within = (child: string, parent: string) => child === parent || child.startsWith(parent.replace(/\/$/, '') + '/');
function gitFree(path: string) {
  let p = parse(path).root;
  for (const part of path.slice(p.length).split('/')) { p = join(p, part); if (existsSync(join(p, '.git'))) return false; }
  return true;
}
// Owner-only list of approved destination directories: one canonical absolute path per line, `#` comments. Any bad line denies all.
// ponytail: exact-directory approvals, so a destination must be a direct child; ancestors get only the .git walk.
function approvedDirs(file: string, dir: string): string[] {
  const list = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sign-off', 'vault-destinations');
  if (!isAbsolute(list)) bad('DESTINATION_DENIED');
  let text: string;
  try { privateFile(list); text = readFileSync(list, 'utf8'); } catch { bad('DESTINATION_DENIED'); }
  const vaultDir = realpathSync(dir), home = realpathSync(homedir()), boardDir = dirname(file);
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
    const s = lstatSync(line, { throwIfNoEntry: false });
    if (!plain(line) || !s?.isDirectory() || realpathSync(line) !== line || s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o700
      || !gitFree(line) || within(home, line) || [vaultDir, boardDir].some((o) => within(o, line) || within(line, o))) bad('DESTINATION_DENIED');
    return line;
  });
}
// Owner-only list of approved Receive sites: `<provider> <https-origin>` per line, `#` comments. Any bad line denies all.
// Host rules live here; a link must then match one listed origin exactly, which carries them over.
function approvedProviders() {
  const list = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sign-off', 'vault-providers'), sites = new Map<string, string>();
  let text = '';
  try { if (isAbsolute(list)) { privateFile(list); text = readFileSync(list, 'utf8'); } } catch { /* denied below */ }
  if (!text) bad('VALIDATION_ERROR');
  for (const line of text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    const [name, origin, extra] = line.split(/\s+/);
    let host = '';
    try { const u = new URL(origin); if (u.protocol === 'https:' && u.origin === origin && !u.port) host = u.hostname; } catch { /* denied below */ }
    if (extra !== undefined || !isKey(name) || sites.has(name) || !host.includes('.') || host.endsWith('.') || isIP(host)) bad('VALIDATION_ERROR');
    sites.set(name, origin);
  }
  return sites;
}
/** A Receive link: one https URL whose exact origin the owner listed for its provider. Fails only with VALIDATION_ERROR, never echoing it. */
export function checkReceiveUrl(value: Buffer, provider: string) {
  const origin = approvedProviders().get(provider);
  let url: URL | undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/\r?\n$/, '');
    // The URL parser silently drops tabs and newlines and trims spaces, so any space or control is refused before it.
    if (!/[\x00-\x20\x7f-\x9f]/.test(text) && Buffer.byteLength(text) <= 8192) url = new URL(text);
  } catch { /* refused below */ }
  if (!origin || !url || url.username || url.password || url.origin !== origin) bad('VALIDATION_ERROR');
}
function checkDestination(dest: string, file: string, dir: string) {
  if (!approvedDirs(file, dir).includes(dirname(dest))) bad('DESTINATION_DENIED');
  if (lstatSync(dest, { throwIfNoEntry: false })) bad('DESTINATION_EXISTS'); // any entry, including a dangling symlink
}
function syncDir(path: string) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function master(dir: string) {
  const path = join(dir, 'key');
  if (!lstatSync(path, { throwIfNoEntry: false })) {
    // Even an interrupted record write forbids replacing a missing key.
    if (readdirSync(dir).some((n) => n.endsWith('.json') || n.endsWith('.tmp'))) bad('VAULT_KEY_UNAVAILABLE');
    publish(path, randomBytes(32), join(dir, 'key.tmp'));
  }
  privateFile(path);
  const bytes = readFileSync(path);
  if (bytes.length !== 32) bad('VAULT_KEY_UNAVAILABLE');
  return bytes;
}
function publish(path: string, data: string | Buffer, tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`) {
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
  } finally { rmSync(tmp, { force: true }); }
  try { syncDir(dirname(path)); } catch {}
}
const sized = (value: unknown): value is Buffer => Buffer.isBuffer(value) && value.length > 0 && value.length <= 16_384;
function seal(dir: string, meta: VaultMeta, value: Buffer): Sealed {
  if (!sized(value)) bad('VALIDATION_ERROR');
  const key = master(dir), nonce = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(meta));
    const data = Buffer.concat([cipher.update(value), cipher.final()]);
    return { nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  } finally { key.fill(0); }
}
function unseal(key: Buffer, meta: VaultMeta, s: Sealed) {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.nonce, 'base64'));
  d.setAAD(aad(meta)); d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]);
}
// A stop signal with no listener ends the process at once, even inside the locked section, and the lock it leaves fails closed for good.
// So a listener takes each stop signal the process has none for: it runs only between turns of the event loop, after a section has
// removed its lock, and raises the signal again with no listener, so the process still ends by it. It stays on once added, since
// Node drops a signal that came just before its listener was removed.
const STOPS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
function raise(signal: NodeJS.Signals) {
  for (const s of STOPS) process.off(s, raise);
  if (!process.listenerCount(signal)) process.kill(process.pid, signal);
}
async function lockedVault<T>(dir: string, fn: () => T, attempts = 50): Promise<T> {
  for (const s of STOPS) if (!process.listenerCount(s)) process.on(s, raise);
  let lock: string | undefined;
  try {
    const candidate = join(dir, 'lock');
    // ponytail: one global lock; split by board only if custody throughput requires it. Stale locks fail closed.
    for (let tries = 1; ; tries++) {
      try { const fd = openSync(candidate, 'wx', 0o600); closeSync(fd); lock = candidate; break; }
      catch (e: any) { if (e.code !== 'EEXIST' || tries === attempts) bad('BUSY'); }
      await new Promise((ok) => setTimeout(ok, 20));
    }
    rmSync(join(dir, 'key.tmp'), { force: true });
    // Keep interrupted ciphertext when its key vanished; never turn cleanup into silent key replacement.
    if (!lstatSync(join(dir, 'key'), { throwIfNoEntry: false }) && readdirSync(dir).some((n) => n.endsWith('.tmp'))) bad('VAULT_KEY_UNAVAILABLE');
    // No writer can still own these under the lock; only ciphertext ever enters a temp record.
    for (const n of readdirSync(dir).filter((n) => /^[a-f0-9]{64}\.json\.[a-f0-9]{16}\.tmp$/.test(n))) rmSync(join(dir, n));
    syncDir(dir);
    return fn();
  } catch (e) { throw e instanceof VaultError ? e : new VaultError('BUSY'); }
  finally { if (lock) { try { rmSync(lock, { force: true }); } catch { /* a stale lock already fails closed */ } } }
}
function readRecord(path: string): Record {
  privateFile(path);
  let record: Record;
  try { record = JSON.parse(readFileSync(path, 'utf8')); } catch { bad('VALIDATION_ERROR'); }
  if (!record || record.schema !== 1 || !VAULT_ID.test(record.meta.board)
    || JSON.stringify(metadata(record.meta)) !== JSON.stringify(record.meta) || !['pending', 'ready', 'refused', 'expired', 'claimed', 'delivered'].includes(record.status)
    || path !== join(dirname(path), `${digest(record.meta.board, record.meta.key)}.json`)) bad('VALIDATION_ERROR');
  return record;
}
// A refusal is admitted only while the item is live (`operate` expires first), so only an expiry is bound to the deadline.
function expiryEvent(id: string, record: Record): VaultExpiry {
  const status = (record.status === 'claimed' ? 'delivery-uncertain' : record.status) as VaultExpiry['status'];
  if (!Number.isSafeInteger(record.at) || record.at <= 0 || (status === 'expired' && record.at < record.meta.expires) || record.at > 8.64e15 || Object.hasOwn(record, 'sealed')) bad('VALIDATION_ERROR');
  return { schema: 1, id: `${digest(id, record.meta.key)}:${status}`, status, at: record.at };
}
function expire(path: string, record: Record): Record {
  if (['pending', 'ready'].includes(record.status) && record.meta.expires <= Date.now()) {
    record = { schema: 1, meta: record.meta, status: 'expired', at: Date.now() };
    publish(path, JSON.stringify(record));
  }
  return record;
}
function custody(board: string, create: boolean) {
  const file = boardFile(board), parent = dirname(file), dir = root(create);
  if (dir === parent || dir.startsWith(parent + '/')) bad('VAULT_KEY_UNAVAILABLE');
  return { file, dir };
}
function boundRecord(file: string, dir: string, key: string, create: boolean) {
  const id = boardId(file, create), path = join(dir, `${digest(id, key)}.json`);
  const record = lstatSync(path, { throwIfNoEntry: false }) ? readRecord(path) : undefined;
  if (record && (record.meta.board !== id || record.meta.key !== key)) bad('VALIDATION_ERROR');
  return { id, path, record };
}
async function operate<T>(board: string, key: string, create: boolean, fn: (dir: string, path: string, record: Record | undefined, id: string) => T): Promise<T> {
  if (!isKey(key)) bad('VALIDATION_ERROR');
  try {
    const { file, dir } = custody(board, true);
    return await lockedVault(dir, () => {
      const { id, path, record } = boundRecord(file, dir, key, create);
      return fn(dir, path, record && expire(path, record), id);
    });
  } catch (e) { throw e instanceof VaultError ? e : new VaultError('BUSY'); }
}
export async function sweepVault(board: string) {
  try {
    const { dir } = custody(board, false);
    if (!dir) return true;
    return await lockedVault(dir, () => {
      // ponytail: linear global scan; batch records if custody size delays ordinary serving. Durable wake events remain owed.
      let clean = true;
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        try { const path = join(dir, name); expire(path, readRecord(path)); } catch { clean = false; }
      }
      return clean;
    });
  } catch { return false; }
}
/** Replayable expiry observation; never a payload consumer. The public keyed wait (`publicWait`) also expires its own item on access,
 * gets a refusal, delivery or uncertain delivery as an event and tries the lock once; the private observer reports only expiry. */
export async function readVaultExpiry(board: string, key: string, filer: string, publicWait = false): Promise<VaultExpiry | undefined> {
  if (!isKey(key) || !isKey(filer)) bad('VALIDATION_ERROR');
  try {
    // Never used: silent before any custody or permission walk.
    const file = boardFile(board);
    if (unused(file)) return;
    const { dir } = custody(board, false);
    if (!dir) return;
    return await lockedVault(dir, () => {
      if (!lstatSync(join(dirname(file), '.sign-off-vault-id'), { throwIfNoEntry: false })) return;
      const { id, path, record } = boundRecord(file, dir, key, false);
      if (!record) return;
      if (record.meta.filer !== filer) bad('READER_MISMATCH');
      if (record.status === 'refused' && !publicWait) bad('REFUSED');
      const current = publicWait ? expire(path, record) : record;
      const terminal = publicWait ? ['expired', 'refused', 'claimed', 'delivered'] : ['expired', 'refused'];
      return terminal.includes(current.status) ? expiryEvent(id, current) : undefined;
    }, publicWait ? 1 : 50);
  } catch (e) { throw e instanceof VaultError ? e : new VaultError('BUSY'); }
}
/** For an ordinary filer wait: expires this filer's elapsed items in the board's folder, then takes each untaken terminal event once.
 * A private `.<kind>.taken` marker per event dedupes filer waits; markers are durable before any event is returned.
 * One kind per poll (expired, refused, delivery-uncertain, delivered), so one output never mixes two codes and a failure is never
 * hidden behind a delivery's exit 0. */
export async function takeVaultExpiries(board: string, filer: string) {
  if (!isKey(filer)) bad('VALIDATION_ERROR');
  const none = { events: [] as { key: string; at: number; status: VaultExpiry['status'] }[], live: 0, clean: true };
  try {
    // Never used: silent, with no permission walk, lock or state creation.
    const file = boardFile(board);
    if (unused(file)) return none;
    const { dir } = custody(board, false);
    if (!dir) return none;
    // One try: an ordinary wait never queues behind custody; BUSY means unknown this poll.
    return await lockedVault(dir, () => {
      const id = boardId(file, false), found: { path: string; key: string; event: VaultExpiry }[] = [], made: string[] = [];
      let live = 0, clean = true;
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
        try {
          const path = join(dir, name), record = readRecord(path);
          if (record.meta.board !== id || record.meta.filer !== filer) continue;
          const r = expire(path, record);
          if (r.status === 'pending' || r.status === 'ready') live++;
          else found.push({ path, key: r.meta.key, event: expiryEvent(id, r) });
        } catch { clean = false; }
      }
      try {
        const take = (kind: VaultExpiry['status']) => found.filter(({ path, event }) => {
          if (event.status !== kind) return false;
          const marker = path.replace(/\.json$/, `.${kind}.taken`);
          let fd;
          try { fd = openSync(marker, 'wx', 0o600); } catch (e: any) {
            if (e.code !== 'EEXIST') throw e;
            privateFile(marker);
            return false;
          }
          made.push(marker);
          try { writeFileSync(fd, event.id); fsyncSync(fd); } finally { closeSync(fd); }
          return true;
        });
        let fresh: typeof found = [];
        for (const kind of ['expired', 'refused', 'delivery-uncertain', 'delivered'] as const) if (!fresh.length) fresh = take(kind);
        if (made.length) syncDir(dir);
        return { events: fresh.map(({ key, event }) => ({ key, at: event.at, status: event.status })), live, clean };
      } catch (e) { for (const m of made) rmSync(m, { force: true }); throw e; }
    }, 1);
  } catch (e) { throw e instanceof VaultError ? e : new VaultError('BUSY'); }
}
export async function waitVaultExpiry(board: string, key: string, filer: string, timeoutMs: number): Promise<VaultExpiry> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 3_600_000) bad('VALIDATION_ERROR');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const event = await readVaultExpiry(board, key, filer);
    if (event) return event;
    const left = deadline - performance.now();
    if (left <= 0) bad('TIMEOUT');
    // ponytail: 1s keyed polling under the existing global lock; batch readers if measured contention matters.
    await new Promise((ok) => setTimeout(ok, Math.min(1_000, left)));
  }
}
const summary = (r: Record) => ({ ...r.meta, status: r.status, at: r.at });
const active = (r?: Record) => {
  if (!r) bad('NOT_FOUND');
  if (r.status === 'refused') bad('REFUSED');
  if (r.status === 'expired') bad('EXPIRED');
  if (r.status === 'delivered') bad('ALREADY_READ');
  if (r.status === 'claimed') bad('DELIVERY_UNCERTAIN');
  return r;
};

export async function createVault(input: Omit<VaultMeta, 'expires'> & { expires?: number }, value?: Buffer) {
  const now = Date.now();
  const fixed = metadata({ ...input, board: '0'.repeat(32), expires: input.expires === undefined ? (input.mode === 'give' ? now + 600_000 : NaN) : input.expires });
  if (fixed.expires <= now || fixed.expires > now + 3_600_000) bad('VALIDATION_ERROR');
  if ((fixed.mode === 'receive') !== (value !== undefined) || (value !== undefined && !sized(value))) bad('VALIDATION_ERROR');
  // Before custody: a refused link leaves no folder, folder id, key or record.
  if (fixed.mode === 'receive') checkReceiveUrl(value as Buffer, fixed.provider as string);
  return operate(input.board, fixed.key, true, (dir, path, old, id) => {
    const meta = { ...fixed, board: id };
    if (old) bad('VALIDATION_ERROR'); // Terminal keys are tombstones, never reusable.
    if (meta.expires <= Date.now()) bad('EXPIRED');
    if (meta.destination !== undefined) checkDestination(meta.destination, boardFile(input.board), dir);
    if (!value) master(dir);
    const record: Record = { schema: 1, meta, status: value ? 'ready' : 'pending', at: Date.now(), ...(value && { sealed: seal(dir, meta, value) }) };
    publish(path, JSON.stringify(record));
    return summary(record);
  });
}
export async function inspectVault(board: string, key: string) {
  return operate(board, key, false, (_, __, r) => r ? summary(r) : bad('NOT_FOUND'));
}
export async function depositVault(board: string, key: string, value: Buffer) {
  return operate(board, key, false, (dir, path, old) => {
    const r = active(old);
    if (r.meta.mode !== 'give' || r.status !== 'pending') bad('VALIDATION_ERROR');
    const record: Record = { ...r, status: 'ready', at: Date.now(), sealed: seal(dir, r.meta, value) };
    publish(path, JSON.stringify(record));
    return summary(record);
  });
}
export async function refuseVault(board: string, key: string) {
  return operate(board, key, false, (_, path, old) => {
    const r = active(old), record: Record = { schema: 1, meta: r.meta, status: 'refused', at: Date.now() };
    publish(path, JSON.stringify(record));
    return summary(record);
  });
}
/** Give delivery for the bound filer and destination. Pending, or a never-used vault (nothing is created), returns undefined so the
 * caller keeps waiting. Any failure after the claim leaves the record `claimed`, which is terminal (DELIVERY_UNCERTAIN) and never
 * decrypts again. */
export async function deliverVault(board: string, key: string, filer: string, into: string, afterClaim?: () => void) {
  if (!isKey(key) || !isKey(filer) || typeof into !== 'string' || !plain(into)) bad('VALIDATION_ERROR');
  try { if (unused(boardFile(board))) return undefined; } catch (e) { throw e instanceof VaultError ? e : new VaultError('BUSY'); }
  return operate(board, key, false, (dir, path, old) => {
    if (old && old.meta.filer !== filer) bad('READER_MISMATCH');
    const r = active(old);
    if (r.meta.mode !== 'give' || resolve(into) !== r.meta.destination) bad(r.meta.mode === 'give' ? 'READER_MISMATCH' : 'VALIDATION_ERROR');
    if (r.status === 'pending') return undefined;
    const dest = r.meta.destination as string;
    checkDestination(dest, boardFile(board), dir); // pre-claim: the payload stays ready on any denial
    const secret = master(dir);
    // Commit point: the ciphertext leaves disk here, so no later process can decrypt it.
    publish(path, JSON.stringify({ schema: 1, meta: r.meta, status: 'claimed', at: Date.now() }));
    let made: { dev: number; ino: number } | undefined;
    try {
      afterClaim?.();
      const value = unseal(secret, r.meta, r.sealed as Sealed);
      try {
        const fd = openSync(dest, 'wx', 0o600);
        try {
          const st = fstatSync(fd);
          made = { dev: st.dev, ino: st.ino };
          writeFileSync(fd, value); fsyncSync(fd);
        } finally { closeSync(fd); }
      } finally { value.fill(0); } // also when openSync or closeSync throws
      syncDir(dirname(dest));
      const done: Record = { schema: 1, meta: r.meta, status: 'delivered', at: Date.now() };
      publish(path, JSON.stringify(done));
      return { key: r.meta.key, at: done.at, status: 'delivered' as const };
    } catch {
      // Remove only a file this call created; a lost wx race is someone else's file and stays.
      try { const s = lstatSync(dest); if (made && s.dev === made.dev && s.ino === made.ino) rmSync(dest); } catch { /* best effort */ }
      bad('DELIVERY_UNCERTAIN');
    } finally { secret.fill(0); }
  });
}
