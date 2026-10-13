// Internal custody foundation only. No CLI/browser route imports this until all vault gates are proved.
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { isKey } from './store.js';

export type VaultMeta = { board: string; key: string; mode: 'give' | 'receive'; filer: string; expires: number; destination?: string };
type Status = 'pending' | 'ready' | 'refused' | 'expired';
type Sealed = { nonce: string; tag: string; data: string };
type Record = { schema: 1; meta: VaultMeta; status: Status; at: number; sealed?: Sealed };
const errors = {
  VALIDATION_ERROR: 'Vault input is invalid: check mode, expiry, provider and destination.',
  EXPIRED: 'Vault item expired; request a fresh item.',
  VAULT_KEY_UNAVAILABLE: 'Vault key is unavailable; encrypted payload cannot be read.',
  BUSY: 'Vault storage is busy or unavailable; retry later.',
  NOT_FOUND: 'Vault item was not found.',
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
function root() {
  const state = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  if (!isAbsolute(state) || !process.getuid) bad('VAULT_KEY_UNAVAILABLE');
  const owner = join(state, 'sign-off'), vault = join(owner, 'vault');
  let path = parse(vault).root;
  for (const part of vault.slice(path.length).split('/')) {
    path = join(path, part);
    try { mkdirSync(path, { mode: 0o700 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
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
async function operate<T>(board: string, key: string, create: boolean, fn: (dir: string, path: string, record: Record | undefined, id: string) => T): Promise<T> {
  if (!isKey(key)) bad('VALIDATION_ERROR');
  let lock: string | undefined;
  try {
    const file = boardFile(board), parent = dirname(file), dir = root(), candidate = join(dir, 'lock');
    if (dir === parent || dir.startsWith(parent + '/')) bad('VAULT_KEY_UNAVAILABLE');
    // ponytail: one global lock; split by board only if custody throughput requires it. Stale locks fail closed.
    for (let tries = 0; ; tries++) {
      try { const fd = openSync(candidate, 'wx', 0o600); closeSync(fd); lock = candidate; break; }
      catch (e: any) { if (e.code !== 'EEXIST' || tries === 49) bad('BUSY'); }
      await new Promise((ok) => setTimeout(ok, 20));
    }
    rmSync(join(dir, 'key.tmp'), { force: true });
    // Keep interrupted ciphertext when its key vanished; never turn cleanup into silent key replacement.
    if (!lstatSync(join(dir, 'key'), { throwIfNoEntry: false }) && readdirSync(dir).some((n) => n.endsWith('.tmp'))) bad('VAULT_KEY_UNAVAILABLE');
    // No writer can still own these under the lock; only ciphertext ever enters a temp record.
    for (const n of readdirSync(dir).filter((n) => /^[a-f0-9]{64}\.json\.[a-f0-9]{16}\.tmp$/.test(n))) rmSync(join(dir, n));
    syncDir(dir);
    const id = boardId(file, create), path = join(dir, `${digest(id, key)}.json`);
    let record: Record | undefined;
    if (lstatSync(path, { throwIfNoEntry: false })) {
      privateFile(path);
      try { record = JSON.parse(readFileSync(path, 'utf8')); } catch { bad('VALIDATION_ERROR'); }
      if (!record || record.schema !== 1 || record.meta.board !== id || record.meta.key !== key
        || JSON.stringify(metadata(record.meta)) !== JSON.stringify(record.meta) || !['pending', 'ready', 'refused', 'expired'].includes(record.status)) bad('VALIDATION_ERROR');
      // ponytail: expire on access; startup/background sweeps and wake events are required before activation.
      if (['pending', 'ready'].includes(record.status) && record.meta.expires <= Date.now()) {
        record = { schema: 1, meta: record.meta, status: 'expired', at: Date.now() };
        publish(path, JSON.stringify(record));
      }
    }
    return fn(dir, path, record, id);
  } catch (e) { throw e instanceof VaultError ? e : new VaultError('BUSY'); }
  finally { if (lock) { try { rmSync(lock, { force: true }); } catch { /* a stale lock already fails closed */ } } }
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
