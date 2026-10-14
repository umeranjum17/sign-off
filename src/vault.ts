// Vault remains OFF. The server and `wait` import only expiry functions, never payload access.
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { isKey } from './store.js';

export type VaultMeta = { board: string; key: string; mode: 'give' | 'receive'; filer: string; expires: number; destination?: string };
type Status = 'pending' | 'ready' | 'refused' | 'expired';
type Sealed = { nonce: string; tag: string; data: string };
type Record = { schema: 1; meta: VaultMeta; status: Status; at: number; sealed?: Sealed };
export type VaultExpiry = { schema: 1; id: string; status: 'expired' | 'refused'; at: number };
export const errors = {
  VALIDATION_ERROR: 'Vault input is invalid: check mode, expiry, provider and destination.',
  EXPIRED: 'Vault item expired; request a fresh item.',
  VAULT_KEY_UNAVAILABLE: 'Vault key is unavailable; encrypted payload cannot be read.',
  BUSY: 'Vault storage is busy or unavailable; retry later.',
  NOT_FOUND: 'Vault item was not found.',
  TIMEOUT: 'Vault expiry wait timed out; retry status later.',
  READER_MISMATCH: 'This item belongs to a different filer or destination.',
  REFUSED: 'User refused this vault item; no value was delivered.',
};
export class VaultError extends Error {
  constructor(readonly code: keyof typeof errors) { super(errors[code]); }
}
function bad(code: keyof typeof errors): never { throw new VaultError(code); }
const digest = (board: string, key: string) => createHash('sha256').update(JSON.stringify([board, key])).digest('hex');
const aad = (meta: VaultMeta) => Buffer.from(JSON.stringify([1, meta.board, meta.key, meta.mode, meta.expires, meta.destination ?? null, meta.filer]));
const VAULT_ID = /^[a-f0-9]{32}$/;
function boardFile(board: unknown) {
  if (typeof board !== 'string' || !isAbsolute(board)) bad('VALIDATION_ERROR');
  try { return realpathSync(board); } catch { bad('NOT_FOUND'); }
}
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

function metadata(m: VaultMeta): VaultMeta {
  if (!m || typeof m.board !== 'string' || !VAULT_ID.test(m.board) || !isKey(m.key) || !isKey(m.filer) || !['give', 'receive'].includes(m.mode)
    || !Number.isSafeInteger(m.expires) || m.expires <= 0
    || (m.mode === 'give' ? typeof m.destination !== 'string' || !isAbsolute(m.destination) : m.destination !== undefined)) bad('VALIDATION_ERROR');
  return { board: m.board, key: m.key, mode: m.mode, filer: m.filer, expires: m.expires,
    ...(m.destination !== undefined && { destination: resolve(m.destination) }) };
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
async function lockedVault<T>(dir: string, fn: () => T, attempts = 50): Promise<T> {
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
    || JSON.stringify(metadata(record.meta)) !== JSON.stringify(record.meta) || !['pending', 'ready', 'refused', 'expired'].includes(record.status)
    || path !== join(dirname(path), `${digest(record.meta.board, record.meta.key)}.json`)) bad('VALIDATION_ERROR');
  return record;
}
// A refusal is admitted only while the item is live (`operate` expires first), so only an expiry is bound to the deadline.
function expiryEvent(id: string, record: Record): VaultExpiry {
  const status = record.status as VaultExpiry['status'];
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
/** Private, replayable expiry observation; never a payload or public answer consumer. */
export async function readVaultExpiry(board: string, key: string, filer: string): Promise<VaultExpiry | undefined> {
  if (!isKey(key) || !isKey(filer)) bad('VALIDATION_ERROR');
  try {
    const { file, dir } = custody(board, false);
    if (!dir) return;
    return await lockedVault(dir, () => {
      if (!lstatSync(join(dirname(file), '.sign-off-vault-id'), { throwIfNoEntry: false })) return;
      const { id, record } = boundRecord(file, dir, key, false);
      if (!record) return;
      if (record.meta.filer !== filer) bad('READER_MISMATCH');
      if (record.status === 'refused') bad('REFUSED');
      return record.status === 'expired' ? expiryEvent(id, record) : undefined;
    });
  } catch (e) { throw e instanceof VaultError ? e : new VaultError('BUSY'); }
}
/** For an ordinary filer wait: expires this filer's elapsed items in the board's folder, then takes each untaken expiry or refusal once.
 * A private `.expired.taken` or `.refused.taken` marker per event dedupes filer waits; markers are durable before any event is returned.
 * One kind per poll, expired first, so one output never mixes two codes; refusals come on the next poll. */
export async function takeVaultExpiries(board: string, filer: string) {
  if (!isKey(filer)) bad('VALIDATION_ERROR');
  const none = { events: [] as { key: string; at: number; status: VaultExpiry['status'] }[], live: 0, clean: true };
  try {
    // Never used: silent, with no permission walk, lock or state creation.
    const file = boardFile(board);
    if (!lstatSync(join(stateHome(), 'sign-off', 'vault'), { throwIfNoEntry: false }) || !lstatSync(join(dirname(file), '.sign-off-vault-id'), { throwIfNoEntry: false })) return none;
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
          if (r.status === 'expired' || r.status === 'refused') found.push({ path, key: r.meta.key, event: expiryEvent(id, r) });
          else live++;
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
        const expired = take('expired'), fresh = expired.length ? expired : take('refused');
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
  return r;
};

export async function createVault(input: Omit<VaultMeta, 'expires'> & { expires?: number }, value?: Buffer) {
  const now = Date.now();
  const fixed = metadata({ ...input, board: '0'.repeat(32), expires: input.expires === undefined ? (input.mode === 'give' ? now + 600_000 : NaN) : input.expires });
  if (fixed.expires <= now || fixed.expires > now + 3_600_000) bad('VALIDATION_ERROR');
  if ((fixed.mode === 'receive') !== (value !== undefined) || (value !== undefined && !sized(value))) bad('VALIDATION_ERROR');
  return operate(input.board, fixed.key, true, (dir, path, old, id) => {
    const meta = { ...fixed, board: id };
    if (old) bad('VALIDATION_ERROR'); // Terminal keys are tombstones, never reusable.
    if (meta.expires <= Date.now()) bad('EXPIRED');
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
