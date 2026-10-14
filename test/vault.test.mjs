import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDecipheriv, randomBytes } from 'node:crypto';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const worker = `import { writeFileSync } from 'node:fs';
import { createVault, depositVault, inspectVault, refuseVault, readVaultExpiry, waitVaultExpiry } from ${JSON.stringify(new URL('../dist/vault.js', import.meta.url).href)};
let input=''; for await (const chunk of process.stdin) input+=chunk;
const {op,meta,value,board,key,started,filer,timeoutMs}=JSON.parse(input);
if(started) writeFileSync(started,'started');
try { const out=await ({create:()=>createVault(meta,value===undefined?undefined:Buffer.from(value)),deposit:()=>depositVault(board,key,Buffer.from(value)),inspect:()=>inspectVault(board,key),refuse:()=>refuseVault(board,key),expiry:async()=>({event:await readVaultExpiry(board,key,filer)}),waitExpiry:async()=>({event:await waitVaultExpiry(board,key,filer,timeoutMs)})})[op](); console.log(JSON.stringify(out)); }
catch(e) { console.log(JSON.stringify({code:e.code,error:e.message})); process.exitCode=1; }`;

test('disabled vault custody across real processes: encryption, racing deposits, refusal and missing-key fail closed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sign-off-vault-')), state = join(home, 'state'), board = join(home, 'project', 'board.json');
  mkdirSync(join(home, 'project'), { mode: 0o700 });
  writeFileSync(board, JSON.stringify({ schema: 2, items: [{ key: 'ordinary', title: 'Umer: continue?' }] }));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: state, XDG_CONFIG_HOME: join(home, 'config'), TMPDIR: home };
  const outputs = [], secret = `FAKE_${randomBytes(24).toString('hex')}`, url = `https://www.npmjs.com/login/cli/${randomBytes(24).toString('hex')}`;
  const run = (input) => new Promise((ok, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', worker], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', (b) => out += b); child.stderr.on('data', (b) => err += b);
    child.on('error', reject); child.on('exit', (code) => {
      outputs.push(out, err);
      if (err || [out, err].some((s) => s.includes(secret) || s.includes(url))) return reject(new Error('Custody child output was unsafe.'));
      try { ok({ exit: code, ...JSON.parse(out) }); } catch { reject(new Error('Custody child metadata was invalid.')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
  const meta = (key, mode = 'give') => ({ board, key, mode, filer: 'demo-agent', ...(mode === 'receive' && { expires: Date.now() + 3_600_000 }),...(mode === 'give' && { destination: join(home, 'config', 'api-token') }) });
  const inspect = (key) => run({ op: 'inspect', board, key });
  const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
  try {
    const before = Date.now(), initial = await run({ op: 'create', meta: meta('give') });
    assert.equal(initial.status, 'pending');
    assert.ok(initial.expires >= before + 600_000 && initial.expires <= Date.now() + 600_000);
    const dir = join(state, 'sign-off', 'vault'), keyPath = join(dir, 'key');
    assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    const raced = await Promise.all([1, 2].map(() => run({ op: 'deposit', board, key: 'give', value: secret })));
    assert.deepEqual(raced.map((r) => r.exit).sort(), [0, 1]);
    assert.equal(raced.find((r) => r.error).error, 'Vault input is invalid: check mode, expiry, provider and destination.');
    assert.equal((await inspect('give')).status, 'ready');
    const recordPath = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => join(dir, n))[0], record = JSON.parse(readFileSync(recordPath));
    // Trusted-owner control: the synthetic private key really decrypts; altered routing cannot authenticate.
    const decrypt = (m) => {
      const cipher = createDecipheriv('aes-256-gcm', readFileSync(keyPath), Buffer.from(record.sealed.nonce, 'base64'));
      cipher.setAAD(Buffer.from(JSON.stringify([1, m.board, m.key, m.mode, m.expires, m.destination ?? null, m.filer])));
      cipher.setAuthTag(Buffer.from(record.sealed.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(record.sealed.data, 'base64')), cipher.final()]).toString();
    };
    assert.ok(decrypt(record.meta) === secret, 'Trusted-owner decryption must match without printing the payload.');
    for (const [field, value] of [['board', '/other/board.json'], ['key', 'other'], ['mode', 'receive'], ['expires', record.meta.expires + 1], ['destination', '/other/token'], ['filer', 'other']]) assert.throws(() => decrypt({ ...record.meta, [field]: value }));
    assert.equal((await run({ op: 'refuse', board, key: 'give' })).status, 'refused');
    assert.equal(JSON.parse(readFileSync(recordPath)).sealed, undefined);
    assert.equal((await run({ op: 'deposit', board, key: 'give', value: secret })).error, 'User refused this vault item; no value was delivered.');
    assert.equal((await run({ op: 'create', meta: meta('give') })).exit, 1);
    const renamed = join(home, 'project', 'renamed.json');
    renameSync(board, renamed);
    assert.equal((await run({ op: 'inspect', board: renamed, key: 'give' })).status, 'refused');
    assert.equal((await run({ op: 'create', meta: { ...meta('give'), board: renamed } })).code, 'VALIDATION_ERROR');
    renameSync(renamed, board);
    assert.equal((await run({ op: 'create', meta: meta('receive', 'receive'), value: url })).status, 'ready');
    await run({ op: 'create', meta: meta('kept', 'receive'), value: url });
    const master = readFileSync(keyPath); rmSync(keyPath);
    assert.equal((await run({ op: 'create', meta: meta('missing-key', 'receive'), value: url })).error, 'Vault key is unavailable; encrypted payload cannot be read.');
    assert.equal(existsSync(keyPath), false); writeFileSync(keyPath, master, { mode: 0o600 });
    chmodSync(keyPath, 0o644);
    assert.equal((await run({ op: 'create', meta: meta('unsafe-key', 'receive'), value: secret })).code, 'VAULT_KEY_UNAVAILABLE'); chmodSync(keyPath, 0o600);
    const fakeKey = join(home, 'fake-key'); writeFileSync(fakeKey, master, { mode: 0o600 }); rmSync(keyPath); symlinkSync(fakeKey, keyPath);
    assert.equal((await run({ op: 'create', meta: meta('linked-key', 'receive'), value: secret })).code, 'VAULT_KEY_UNAVAILABLE');
    rmSync(keyPath); writeFileSync(keyPath, master, { mode: 0o600 });
    chmodSync(dir, 0o755); assert.equal((await inspect('kept')).code, 'VAULT_KEY_UNAVAILABLE'); chmodSync(dir, 0o700);
    const interrupted = recordPath + '.0123456789abcdef.tmp'; writeFileSync(interrupted, JSON.stringify(record), { mode: 0o600 });
    assert.equal((await inspect('kept')).status, 'ready'); assert.equal(existsSync(interrupted), false);
    writeFileSync(join(dir, 'lock'), 'interrupted process', { mode: 0o600 });
    assert.equal((await inspect('kept')).error, 'Vault storage is busy or unavailable; retry later.'); rmSync(join(dir, 'lock'));
    const other = join(home, 'other'); mkdirSync(other); const linked = join(home, 'linked'); symlinkSync(other, linked);
    env.XDG_STATE_HOME = linked;
    assert.equal((await run({ op: 'create', meta: meta('symlink', 'receive'), value: secret })).exit, 1); assert.deepEqual(readdirSync(other), []);
    env.XDG_STATE_HOME = join(home, 'project');
    assert.equal((await run({ op: 'create', meta: meta('board-root', 'receive'), value: secret })).code, 'VAULT_KEY_UNAVAILABLE');
    const gitRoot = join(home, 'git-root'); mkdirSync(gitRoot); mkdirSync(join(gitRoot, '.git')); env.XDG_STATE_HOME = gitRoot;
    assert.equal((await run({ op: 'create', meta: meta('git-root', 'receive'), value: secret })).code, 'VAULT_KEY_UNAVAILABLE');
    env.XDG_STATE_HOME = join(home, 'interrupted-state');
    const interruptedDir = join(env.XDG_STATE_HOME, 'sign-off', 'vault'); mkdirSync(interruptedDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(interruptedDir, 'a'.repeat(64) + '.json.0123456789abcdef.tmp'), JSON.stringify(record), { mode: 0o600 });
    assert.equal((await run({ op: 'create', meta: meta('orphan-key', 'receive'), value: url })).code, 'VAULT_KEY_UNAVAILABLE');
    assert.equal(existsSync(join(interruptedDir, 'key')), false);
    const freshState = join(home, 'fresh-state'), freshDir = join(freshState, 'sign-off', 'vault');
    mkdirSync(join(freshState, 'sign-off'), { recursive: true, mode: 0o700 }); mkdirSync(freshDir, { mode: 0o700 });
    writeFileSync(join(freshDir, 'key.tmp'), 'partial', { mode: 0o600 });
    env.XDG_STATE_HOME = freshState;
    assert.equal((await run({ op: 'create', meta: meta('fresh-key', 'receive'), value: url })).status, 'ready');
    assert.equal(existsSync(join(freshDir, 'key.tmp')), false);
    env.XDG_STATE_HOME = state;
    for (const value of ['', 'x'.repeat(16_385)]) assert.equal((await run({ op: 'create', meta: meta('bad', 'receive'), value })).exit, 1);
    const aliasDir = join(home, 'alias'); symlinkSync(join(home, 'project'), aliasDir);
    assert.equal((await run({ op: 'create', meta: { ...meta('give'), board: join(aliasDir, 'board.json') } })).code, 'VALIDATION_ERROR');
    const movedDir = join(home, 'moved'), movedBoard = join(movedDir, 'board.json'); mkdirSync(movedDir, { mode: 0o700 });
    writeFileSync(movedBoard, JSON.stringify({ schema: 2, items: [] }));
    assert.equal((await run({ op: 'create', meta: { ...meta('moving'), board: movedBoard } })).status, 'pending');
    assert.equal((await run({ op: 'refuse', board: movedBoard, key: 'moving' })).status, 'refused');
    renameSync(movedDir, join(home, 'moved-again'));
    const movedAgain = join(home, 'moved-again', 'board.json'), linkedBoard = join(home, 'linked-board.json');
    assert.equal((await run({ op: 'create', meta: { ...meta('moving'), board: movedAgain } })).code, 'VALIDATION_ERROR');
    symlinkSync(movedAgain, linkedBoard);
    assert.equal((await run({ op: 'create', meta: { ...meta('via-alias'), board: linkedBoard } })).status, 'pending');
    assert.equal((await run({ op: 'inspect', board: movedAgain, key: 'via-alias' })).status, 'pending');
    rmSync(join(home, 'moved-again'), { recursive: true });
    mkdirSync(join(home, 'moved-again'), { mode: 0o700 });
    writeFileSync(movedAgain, JSON.stringify({ schema: 2, items: [] }));
    assert.equal((await run({ op: 'inspect', board: movedAgain, key: 'moving' })).code, 'NOT_FOUND');
    assert.equal((await run({ op: 'create', meta: { ...meta('moving'), board: movedAgain } })).status, 'pending');
    for (const args of [['post', board, '--type', 'vault', '--title', 'Give'], ['post', board, '--from', '-']]) {
      const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' }); outputs.push(r.stdout, r.stderr); assert.notEqual(r.status, 0);
    }
    // A metadata-only feed cannot sneak vault through the unknown-type fallback either.
    const feed = join(home, 'feed.json'); writeFileSync(feed, JSON.stringify({ schema: 2, items: [{ key: 'blocked', title: 'Give', type: 'vault' }] }));
    const fed = spawnSync(process.execPath, [cli, 'post', board, '--from', feed], { env, encoding: 'utf8' });
    outputs.push(fed.stdout, fed.stderr); assert.equal(fed.status, 2); assert.match(fed.stdout, /Vault is not enabled/);
    assert.equal(JSON.parse(readFileSync(board)).items[0].key, 'ordinary');
    assert.equal((await run({ op: 'create', meta: meta('sequence') })).status, 'pending');
    assert.equal((await run({ op: 'refuse', board, key: 'sequence' })).status, 'refused');
    writeFileSync(feed, JSON.stringify({ schema: 2, items: [{ contract: 1, kind: 'ask', schema: 1, key: 'raised', title: 'Raised', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], recommend_value: 'yes' }] }));
    assert.equal(spawnSync(process.execPath, [cli, 'post', board, '--from', feed], { env, encoding: 'utf8' }).status, 0);
    assert.equal((await run({ op: 'create', meta: meta('sequence') })).code, 'VALIDATION_ERROR');
    // Deadlines are private, validated before folder identity initialization, and never inferred for Receive.
    const invalidDir = join(home, 'invalid-expiry'); mkdirSync(invalidDir, { mode: 0o700 });
    const invalidBoard = join(invalidDir, 'board.json'); writeFileSync(invalidBoard, '{"schema":2,"items":[]}');
    for (const expires of [null, 0, -1, 1.5, secret, Date.now() - 1, Date.now() + 7_200_000]) {
      const r = await run({ op: 'create', meta: { ...meta('invalid-expiry'), board: invalidBoard, expires } });
      assert.equal(r.code, 'VALIDATION_ERROR');
      assert.equal(r.error, 'Vault input is invalid: check mode, expiry, provider and destination.');
    }
    const receive = meta('needs-expiry', 'receive'); delete receive.expires;
    assert.equal((await run({ op: 'create', meta: { ...receive, board: invalidBoard }, value: url })).code, 'VALIDATION_ERROR');
    assert.deepEqual(readdirSync(invalidDir), ['board.json']);
    const recordFor = (key) => readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => join(dir, n)).find((p) => JSON.parse(readFileSync(p)).meta.key === key);
    const waitFor = async (condition, deadline) => {
      while (!condition()) { assert.ok(Date.now() < deadline, 'Expiry condition timed out.'); await new Promise((ok) => setTimeout(ok, 20)); }
    };
    // Real wall clock and real child processes: no browser or timer mock is involved.
    for (const mode of ['give', 'receive']) {
      const key = `expires-${mode}`, expires = Date.now() + 3_000;
      const r = await run({ op: 'create', meta: { ...meta(key, mode), expires }, ...(mode === 'receive' && { value: url }) });
      assert.equal(r.status, mode === 'give' ? 'pending' : 'ready'); assert.equal(r.expires, expires);
      const path = recordFor(key);
      await waitFor(() => Date.now() >= expires, expires + 5_000);
      assert.equal(JSON.parse(readFileSync(path)).status, r.status); // access-driven, not a background sweep
      assert.equal((await inspect(key)).status, 'expired');
      const terminal = readFileSync(path); assert.equal(JSON.parse(terminal).sealed, undefined);
      assert.equal((await inspect(key)).status, 'expired'); assert.deepEqual(readFileSync(path), terminal);
      assert.equal((await run({ op: 'deposit', board, key, value: secret })).code, 'EXPIRED');
      assert.equal((await run({ op: 'refuse', board, key })).error, 'Vault item expired; request a fresh item.');
      assert.equal((await run({ op: 'create', meta: meta(key, mode), ...(mode === 'receive' && { value: url }) })).code, 'VALIDATION_ERROR');
    }
    const expires = Date.now() + 3_000, lock = join(dir, 'lock'), started = join(home, 'deposit-started');
    assert.equal((await run({ op: 'create', meta: { ...meta('locked-expiry'), expires } })).status, 'pending');
    await waitFor(() => Date.now() >= expires - 500, expires + 5_000);
    writeFileSync(lock, '', { mode: 0o600 });
    const waiting = run({ op: 'deposit', board, key: 'locked-expiry', value: secret, started });
    try {
      await waitFor(() => existsSync(started), expires + 5_000);
      assert.ok(Date.now() < expires, 'Deposit child must start before expiry.');
      await waitFor(() => Date.now() >= expires + 20, expires + 5_000);
    } finally { rmSync(lock, { force: true }); }
    assert.equal((await waiting).code, 'EXPIRED');
    const expiredRecord = JSON.parse(readFileSync(recordFor('locked-expiry')));
    assert.equal(expiredRecord.status, 'expired'); assert.equal(expiredRecord.sealed, undefined);
    // Legacy records without a deadline fail closed rather than receiving a fresh lifetime.
    const keptPath = recordFor('kept'), kept = readFileSync(keptPath), legacy = JSON.parse(kept);
    delete legacy.meta.expires; writeFileSync(keptPath, JSON.stringify(legacy));
    assert.equal((await inspect('kept')).code, 'VALIDATION_ERROR'); writeFileSync(keptPath, kept);
    // Actual server startup, no browser or access-time inspect to trigger these transitions.
    const warning = 'sign-off-axi: Vault startup expiry unavailable; access checks remain enforced.\n';
    const serve = async (release = async () => {}, served = board, during = async () => {}) => {
      const child = spawn(process.execPath, [cli, 'serve', served, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '', exited = false;
      child.stdout.on('data', (b) => out += b); child.stderr.on('data', (b) => err += b);
      child.once('exit', () => exited = true);
      try {
        await release();
        await waitFor(() => /url: "(http:\/\/127\.0\.0\.1:\d+\/)"/.test(out) || exited, Date.now() + 15_000);
        assert.equal(exited, false, 'Ordinary board must keep serving.');
        const origin = /url: "(http:\/\/127\.0\.0\.1:\d+\/)"/.exec(out)[1];
        assert.equal((await fetch(origin, { signal: AbortSignal.timeout(5_000) })).status, 200);
        const response = await fetch(`${origin}api/decisions`, { signal: AbortSignal.timeout(5_000) });
        assert.equal(response.status, 200); assert.ok(Array.isArray((await response.json()).decisions));
        await during({ origin, child, stderr: () => err });
        assert.ok(![out, err].some((s) => s.includes(secret) || s.includes(url)));
        return err;
      } finally {
        if (!exited) {
          child.kill('SIGTERM');
          try { await waitFor(() => exited, Date.now() + 5_000); }
          finally { if (!exited) child.kill('SIGKILL'); }
          assert.equal(child.exitCode, 0, 'Owned server must exit cleanly.');
        }
        outputs.push(out, err);
      }
    };
    const deadline = Date.now() + 4_000, due = [];
    for (const [key, mode] of [['startup-pending', 'give'], ['startup-ready', 'give'], ['startup-receive', 'receive']]) {
      await run({ op: 'create', meta: { ...meta(key, mode), expires: deadline }, ...(mode === 'receive' && { value: url }) });
      if (key === 'startup-ready') await run({ op: 'deposit', board, key, value: secret });
      due.push(recordFor(key));
    }
    const secondDir = join(home, 'second-board'); mkdirSync(secondDir, { mode: 0o700 });
    const second = join(secondDir, 'board.json'); writeFileSync(second, '{"schema":2,"items":[]}');
    await run({ op: 'create', meta: { ...meta('startup-other', 'receive'), board: second, expires: deadline }, value: url });
    due.push(recordFor('startup-other'));
    const preserved = ['kept', 'sequence', 'expires-give'].map(recordFor).map((p) => [p, readFileSync(p)]);
    // Malformed, misnamed, wrong-binding, symlinked and stray records sit beside valid elapsed ones.
    const malformed = [[join(dir, `${'b'.repeat(64)}.json`), '{"corrupt":'], [join(dir, 'stray.json'), '{"schema":1}'], [join(dir, `${'c'.repeat(64)}.json`), readFileSync(due[0])]];
    for (const [path, bytes] of malformed) writeFileSync(path, bytes, { mode: 0o600 });
    const symlinkTarget = join(home, 'symlink-target'), symlinkRecord = join(dir, `${'d'.repeat(64)}.json`);
    writeFileSync(symlinkTarget, 'target', { mode: 0o600 }); symlinkSync(symlinkTarget, symlinkRecord);
    await waitFor(() => Date.now() >= deadline, deadline + 5_000);
    for (const path of due) assert.ok(['pending', 'ready'].includes(JSON.parse(readFileSync(path)).status));
    assert.equal(await serve(), warning);
    for (const path of due) { const r = JSON.parse(readFileSync(path)); assert.equal(r.status, 'expired'); assert.equal(r.sealed, undefined); }
    for (const [path, bytes] of preserved) assert.deepEqual(readFileSync(path), bytes);
    for (const [path, bytes] of malformed) assert.deepEqual(readFileSync(path), Buffer.from(bytes));
    assert.equal(readFileSync(symlinkTarget, 'utf8'), 'target');
    for (const path of [...malformed.map(([p]) => p), symlinkRecord, symlinkTarget]) rmSync(path);
    const terminal = due.map((p) => readFileSync(p)); assert.equal(await serve(), '');
    due.forEach((p, i) => assert.deepEqual(readFileSync(p), terminal[i]));
    assert.equal((await run({ op: 'create', meta: meta('startup-pending') })).code, 'VALIDATION_ERROR');
    const queuedDeadline = Date.now() + 3_000;
    await run({ op: 'create', meta: { ...meta('startup-locked'), expires: queuedDeadline } });
    await waitFor(() => Date.now() >= queuedDeadline - 500, queuedDeadline + 5_000);
    writeFileSync(lock, '', { mode: 0o600 });
    try {
      assert.equal(await serve(async () => {
        await waitFor(() => existsSync(`${board}.lock`), queuedDeadline + 5_000);
        assert.ok(Date.now() < queuedDeadline, 'Startup must begin before the deadline.');
        await waitFor(() => Date.now() >= queuedDeadline + 20, queuedDeadline + 5_000);
        rmSync(lock);
      }), '');
    } finally { rmSync(lock, { force: true }); }
    assert.equal(JSON.parse(readFileSync(recordFor('startup-locked'))).status, 'expired');
    // Unsafe/malformed custody never prevents serving; ordinary vault operations still fail closed.
    chmodSync(dir, 0o755);
    try { assert.ok(await serve() === warning); assert.equal((await inspect('kept')).code, 'VAULT_KEY_UNAVAILABLE'); }
    finally { chmodSync(dir, 0o700); }
    for (const broken of [secret + url, JSON.stringify({ ...JSON.parse(kept), meta: { ...JSON.parse(kept).meta, key: 'wrong-binding' } })]) {
      writeFileSync(keptPath, broken);
      try { assert.ok(await serve() === warning); assert.equal((await inspect('kept')).code, 'VALIDATION_ERROR'); }
      finally { writeFileSync(keptPath, kept); }
    }
    const linkedRecord = join(home, 'linked-record'); writeFileSync(linkedRecord, secret + url, { mode: 0o600 });
    rmSync(keptPath); symlinkSync(linkedRecord, keptPath);
    try { assert.ok(await serve() === warning); assert.equal((await inspect('kept')).code, 'VAULT_KEY_UNAVAILABLE'); }
    finally { rmSync(keptPath); writeFileSync(keptPath, kept, { mode: 0o600 }); rmSync(linkedRecord); }
    const normal = join(home, 'normal-board.json'); writeFileSync(normal, '{"schema":2,"items":[]}');
    env.XDG_STATE_HOME = join(home, 'startup-empty');
    try { assert.equal(await serve(undefined, normal), ''); assert.equal(existsSync(env.XDG_STATE_HOME), false); assert.equal(existsSync(join(home, '.sign-off-vault-id')), false); }
    finally { env.XDG_STATE_HOME = state; }
    const brokenState = join(home, 'broken-folder'); mkdirSync(join(brokenState, 'sign-off'), { recursive: true, mode: 0o700 });
    writeFileSync(join(brokenState, 'sign-off', 'vault'), secret + url, { mode: 0o600 }); env.XDG_STATE_HOME = brokenState;
    try { assert.ok(await serve(undefined, normal) === warning); assert.ok(readFileSync(join(brokenState, 'sign-off', 'vault'), 'utf8') === secret + url); }
    finally { env.XDG_STATE_HOME = state; rmSync(brokenState, { recursive: true }); }
    // Custody inside the board's own folder is never swept; the ordinary board and vault access still behave.
    const containedFolder = join(home, 'contained'), containedBoard = join(containedFolder, 'board.json');
    mkdirSync(containedFolder, { mode: 0o700 }); writeFileSync(containedBoard, '{"schema":2,"items":[]}');
    const containedExpires = Date.now() + 3_000;
    await run({ op: 'create', meta: { ...meta('contained-expiring', 'receive'), board: containedBoard, expires: containedExpires }, value: url });
    await waitFor(() => Date.now() >= containedExpires, containedExpires + 5_000);
    const elapsedBytes = readFileSync(recordFor('contained-expiring')), containedVault = join(containedFolder, 'sign-off', 'vault');
    mkdirSync(containedVault, { recursive: true, mode: 0o700 });
    const copied = join(containedVault, basename(recordFor('contained-expiring')));
    writeFileSync(copied, elapsedBytes, { mode: 0o600 });
    env.XDG_STATE_HOME = containedFolder;
    try {
      assert.equal(await serve(undefined, containedBoard), warning);
      assert.deepEqual(readFileSync(copied), elapsedBytes);
      assert.equal((await run({ op: 'inspect', board: containedBoard, key: 'contained-expiring' })).code, 'VAULT_KEY_UNAVAILABLE');
    } finally { env.XDG_STATE_HOME = state; rmSync(containedFolder, { recursive: true, force: true }); }
    // Both ordinary servers stay up: no browser, restart or vault access triggers this expiry.
    const periodicWarning = 'sign-off-axi: Vault periodic expiry unavailable; access checks remain enforced.\n';
    const periodicDeadline = Date.now() + 4_000, periodic = [];
    for (const [key, mode] of [['periodic-pending', 'give'], ['periodic-ready', 'give'], ['periodic-receive', 'receive']]) {
      await run({ op: 'create', meta: { ...meta(key, mode), expires: periodicDeadline }, ...(mode === 'receive' && { value: url }) });
      if (key === 'periodic-ready') await run({ op: 'deposit', board, key, value: secret });
      periodic.push(recordFor(key));
    }
    await run({ op: 'create', meta: { ...meta('periodic-other', 'receive'), board: second, expires: periodicDeadline }, value: url });
    periodic.push(recordFor('periodic-other'));
    assert.equal(await serve(undefined, board, async (first) => {
      assert.equal(await serve(undefined, second, async (other) => {
        assert.ok(Date.now() < periodicDeadline, 'Both servers must start before expiry.');
        periodic.forEach((p) => assert.ok(['pending', 'ready'].includes(JSON.parse(readFileSync(p)).status)));
        const held = Buffer.from('owned periodic lock'); writeFileSync(lock, held, { mode: 0o600 });
        try {
          await waitFor(() => first.stderr() === periodicWarning && other.stderr() === periodicWarning, Date.now() + 15_000);
          assert.deepEqual(readFileSync(lock), held);
          periodic.forEach((p) => assert.ok(['pending', 'ready'].includes(JSON.parse(readFileSync(p)).status)));
          for (const { origin } of [first, other]) assert.equal((await fetch(`${origin}api/decisions`, { signal: AbortSignal.timeout(5_000) })).status, 200);
          const failedFolder = join(home, 'failed-bind'); mkdirSync(failedFolder, { mode: 0o700 });
          const failedBoard = join(failedFolder, 'board.json'); writeFileSync(failedBoard, '{"schema":2,"items":[]}');
          const failed = spawnSync(process.execPath, [cli, 'serve', failedBoard, '--port', new URL(first.origin).port], { env, encoding: 'utf8', timeout: 5_000 });
          outputs.push(failed.stdout, failed.stderr); assert.equal(failed.status, 1); assert.equal(failed.signal, null); assert.match(failed.stdout, /^code: SERVE_FAILED$/m);
        } finally { rmSync(lock, { force: true }); }
        await waitFor(() => periodic.every((p) => JSON.parse(readFileSync(p)).status === 'expired'), Date.now() + 15_000);
        const bytes = periodic.map((p) => readFileSync(p));
        periodic.forEach((p) => assert.equal(JSON.parse(readFileSync(p)).sealed, undefined));
        const nextTicks = Date.now() + 6_000;
        await waitFor(() => Date.now() >= nextTicks, nextTicks + 5_000);
        periodic.forEach((p, i) => assert.deepEqual(readFileSync(p), bytes[i]));
        for (const [p, bytes] of preserved) assert.deepEqual(readFileSync(p), bytes);
        assert.equal(existsSync(lock), false);
        assert.equal(first.stderr(), periodicWarning); assert.equal(other.stderr(), periodicWarning);
      }), periodicWarning);
    }), periodicWarning);
    assert.equal((await run({ op: 'create', meta: meta('periodic-ready') })).code, 'VALIDATION_ERROR');
    const periodicTerminal = periodic.map((p) => readFileSync(p)); assert.equal(await serve(), '');
    periodic.forEach((p, i) => assert.deepEqual(readFileSync(p), periodicTerminal[i]));
    // A server with initially absent custody keeps polling; later records and unsafe siblings need no restart.
    const laterState = join(home, 'periodic-state'), laterFolder = join(home, 'periodic-board'), laterBoard = join(laterFolder, 'board.json');
    mkdirSync(laterFolder, { mode: 0o700 }); writeFileSync(laterBoard, '{"schema":2,"items":[]}');
    env.XDG_STATE_HOME = laterState;
    try {
      assert.equal(await serve(undefined, laterBoard, async ({ origin, stderr }) => {
        const firstTick = Date.now() + 6_000;
        await waitFor(() => Date.now() >= firstTick, firstTick + 5_000);
        assert.equal(existsSync(laterState), false); assert.equal(existsSync(join(laterFolder, '.sign-off-vault-id')), false);
        await run({ op: 'create', meta: { ...meta('later-record', 'receive'), board: laterBoard, expires: Date.now() + 2_000 }, value: url });
        const laterVault = join(laterState, 'sign-off', 'vault');
        const path = join(laterVault, readdirSync(laterVault).find((n) => n.endsWith('.json')));
        assert.equal(JSON.parse(readFileSync(path)).status, 'ready');
        const bad = join(laterVault, `${'0'.repeat(64)}.json`), stray = join(laterVault, 'stray.json'), linked = join(laterVault, `${'f'.repeat(64)}.json`);
        writeFileSync(bad, secret + url, { mode: 0o600 }); writeFileSync(stray, '{}', { mode: 0o600 }); symlinkSync(bad, linked);
        try {
          await waitFor(() => JSON.parse(readFileSync(path)).status === 'expired' && stderr() === periodicWarning, Date.now() + 15_000);
          assert.equal(JSON.parse(readFileSync(path)).sealed, undefined);
          assert.ok(readFileSync(bad, 'utf8') === secret + url); assert.equal(readFileSync(stray, 'utf8'), '{}');
          assert.equal((await fetch(origin, { signal: AbortSignal.timeout(5_000) })).status, 200);
          chmodSync(laterVault, 0o755);
          assert.equal((await run({ op: 'inspect', board: laterBoard, key: 'later-record' })).code, 'VAULT_KEY_UNAVAILABLE');
          const anotherTick = Date.now() + 6_000;
          await waitFor(() => Date.now() >= anotherTick, anotherTick + 5_000);
          assert.equal((await fetch(origin, { signal: AbortSignal.timeout(5_000) })).status, 200);
          assert.equal(stderr(), periodicWarning);
        } finally { chmodSync(laterVault, 0o700); for (const p of [bad, stray, linked]) rmSync(p, { force: true }); }
        await run({ op: 'create', meta: { ...meta('after-repair', 'receive'), board: laterBoard, expires: Date.now() + 2_000 }, value: url });
        const repaired = readdirSync(laterVault).filter((n) => n.endsWith('.json')).map((n) => join(laterVault, n)).find((p) => JSON.parse(readFileSync(p)).meta.key === 'after-repair');
        await waitFor(() => JSON.parse(readFileSync(repaired)).status === 'expired', Date.now() + 15_000);
        assert.equal(JSON.parse(readFileSync(repaired)).sealed, undefined); assert.equal(stderr(), periodicWarning);
      }), periodicWarning);
    } finally { env.XDG_STATE_HOME = state; }
    assert.equal(existsSync(join(laterState, 'sign-off', 'vault', 'lock')), false);
    // Startup failure already warned: repeated periodic failures must not print another line.
    chmodSync(dir, 0o755);
    try {
      assert.equal(await serve(undefined, board, async ({ stderr }) => {
        const twoTicks = Date.now() + 11_000;
        await waitFor(() => Date.now() >= twoTicks, twoTicks + 5_000);
        assert.equal(stderr(), warning);
      }), warning);
    } finally { chmodSync(dir, 0o700); }
    // Expiry observation is private, non-consuming and never drives access-time expiry.
    const eventInput = (key, extra = {}) => ({ op: 'expiry', board, key, filer: 'demo-agent', ...extra });
    const eventFor = async (key, extra = {}) => (await run(eventInput(key, extra))).event;
    const legacyEventPath = recordFor('expires-give'), legacyEventBytes = readFileSync(legacyEventPath);
    const legacyEvent = await eventFor('expires-give');
    assert.deepEqual(Object.keys(legacyEvent).sort(), ['at', 'id', 'schema', 'status']);
    assert.equal(legacyEvent.schema, 1); assert.equal(legacyEvent.status, 'expired');
    assert.match(legacyEvent.id, /^[a-f0-9]{64}:expired$/); assert.equal(legacyEvent.at, JSON.parse(legacyEventBytes).at);
    for (const key of ['expires-give', 'startup-pending', 'periodic-ready']) {
      const path = recordFor(key), bytes = readFileSync(path), event = await eventFor(key);
      assert.equal(event.at, JSON.parse(bytes).at);
      assert.deepEqual((await run(eventInput(key, { op: 'waitExpiry', timeoutMs: 0 }))).event, event);
      assert.deepEqual(await eventFor(key), event); assert.deepEqual(readFileSync(path), bytes);
    }
    for (const op of ['expiry', 'waitExpiry']) {
      assert.equal((await run(eventInput('expires-give', { op, filer: 'other', timeoutMs: 0 }))).code, 'READER_MISMATCH');
      assert.equal((await run(eventInput('sequence', { op, timeoutMs: 0 }))).code, 'REFUSED');
    }
    assert.equal(await eventFor('expires-give', { board: second }), undefined);
    assert.equal((await run(eventInput('expires-give', { board: second, op: 'waitExpiry', timeoutMs: 0 }))).code, 'TIMEOUT');
    assert.deepEqual(readFileSync(legacyEventPath), legacyEventBytes);
    const probeFolder = join(home, 'event-board'), probeBoard = join(probeFolder, 'board.json'), probeState = join(home, 'event-state');
    mkdirSync(probeFolder, { mode: 0o700 }); writeFileSync(probeBoard, '{"schema":2,"items":[]}');
    assert.equal(await eventFor('missing-event', { board: probeBoard }), undefined);
    assert.equal(existsSync(join(probeFolder, '.sign-off-vault-id')), false);
    env.XDG_STATE_HOME = probeState;
    try {
      const absent = eventInput('late-event', { board: probeBoard });
      assert.equal((await run(absent)).event, undefined);
      for (const timeoutMs of [-1, 0.5, null, 3_600_001, secret]) assert.equal((await run({ ...absent, op: 'waitExpiry', timeoutMs })).code, 'VALIDATION_ERROR');
      assert.equal((await run({ ...absent, filer: '' })).code, 'VALIDATION_ERROR');
      const started = join(home, 'event-wait-started');
      const waiting = run({ ...absent, op: 'waitExpiry', timeoutMs: 15_000, started });
      assert.equal(await serve(undefined, probeBoard, async () => {
        await waitFor(() => existsSync(started), Date.now() + 5_000);
        assert.equal(existsSync(probeState), false); assert.equal(existsSync(join(probeFolder, '.sign-off-vault-id')), false);
        await run({ op: 'create', meta: { ...meta('late-event', 'receive'), board: probeBoard, expires: Date.now() + 2_000 }, value: url });
        const pdir = join(probeState, 'sign-off', 'vault'), path = join(pdir, readdirSync(pdir).find((n) => n.endsWith('.json')));
        assert.equal(JSON.parse(readFileSync(path)).status, 'ready');
        const result = await waiting; assert.equal(result.exit, 0); assert.equal(result.event.status, 'expired');
        const committed = JSON.parse(readFileSync(path)); assert.equal(committed.sealed, undefined); assert.equal(result.event.at, committed.at);
      }), '');
    } finally { env.XDG_STATE_HOME = state; }
    // Negative control: elapsed wall time without a producer does not manufacture a committed event.
    const unsweptDeadline = Date.now() + 1_000;
    await run({ op: 'create', meta: { ...meta('event-unswept'), expires: unsweptDeadline } });
    await run({ op: 'create', meta: { ...meta('expires-give'), board: second, expires: unsweptDeadline } });
    assert.equal(await eventFor('expires-give', { board: second }), undefined);
    const unsweptPath = recordFor('event-unswept'), unsweptBytes = readFileSync(unsweptPath);
    await waitFor(() => Date.now() >= unsweptDeadline, unsweptDeadline + 5_000);
    assert.equal(await eventFor('event-unswept'), undefined);
    assert.equal((await run(eventInput('event-unswept', { op: 'waitExpiry', timeoutMs: 150 }))).code, 'TIMEOUT');
    assert.deepEqual(readFileSync(unsweptPath), unsweptBytes);
    assert.equal(await serve(), ''); assert.equal((await eventFor('event-unswept')).status, 'expired');
    assert.notEqual((await eventFor('expires-give', { board: second })).id, legacyEvent.id);
    const observedDeadline = Date.now() + 5_000, observedKeys = ['event-pending', 'event-ready', 'event-receive'];
    for (const key of observedKeys) {
      const mode = key === 'event-receive' ? 'receive' : 'give';
      await run({ op: 'create', meta: { ...meta(key, mode), expires: observedDeadline }, ...(mode === 'receive' && { value: url }) });
      if (key === 'event-ready') await run({ op: 'deposit', board, key, value: secret });
    }
    const sidecars = [board, ...['answers', 'seen', 'rounds', 'messages'].map((s) => board.replace(/\.json$/, `.${s}.jsonl`))].map((p) => [p, existsSync(p) ? readFileSync(p) : undefined]);
    assert.equal(await serve(undefined, board, async ({ origin }) => {
      const starts = observedKeys.map((key) => join(home, `${key}-started`)), finished = [];
      const waits = observedKeys.map((key, i) => run(eventInput(key, { op: 'waitExpiry', timeoutMs: 15_000, started: starts[i] })).then((r) => { finished.push(key); return r; }));
      const duplicate = run(eventInput('event-ready', { op: 'waitExpiry', timeoutMs: 15_000 }));
      await waitFor(() => starts.every(existsSync), Date.now() + 5_000);
      assert.ok(Date.now() < observedDeadline, 'Observers start before expiry.'); assert.deepEqual(finished, []);
      observedKeys.forEach((key) => assert.ok(['pending', 'ready'].includes(JSON.parse(readFileSync(recordFor(key))).status)));
      const results = await Promise.all(waits), repeat = await duplicate;
      results.forEach((r, i) => {
        assert.equal(r.exit, 0); assert.equal(r.event.status, 'expired');
        const record = JSON.parse(readFileSync(recordFor(observedKeys[i]))); assert.equal(record.sealed, undefined); assert.equal(r.event.at, record.at);
      });
      assert.deepEqual(repeat.event, results[1].event);
      assert.equal((await fetch(`${origin}api/decisions`, { signal: AbortSignal.timeout(5_000) })).status, 200);
      assert.equal((await fetch(`${origin}api/vault/event-ready`, { method: 'POST', body: secret, signal: AbortSignal.timeout(5_000) })).status, 404);
    }), '');
    for (const [p, bytes] of sidecars) { if (bytes) assert.deepEqual(readFileSync(p), bytes); else assert.equal(existsSync(p), false); }
    const replay = await eventFor('event-ready'), replayBytes = readFileSync(recordFor('event-ready'));
    assert.equal(await serve(), ''); assert.deepEqual(await eventFor('event-ready'), replay); assert.deepEqual(readFileSync(recordFor('event-ready')), replayBytes);
    // Malformed transition data cannot claim ciphertext removal or leak arbitrary record properties.
    const eventRecord = JSON.parse(legacyEventBytes);
    for (const changed of [{ at: null }, { at: -1 }, { at: 1.5 }, { at: eventRecord.meta.expires - 1 }, { at: secret }, { sealed: null }, { sealed: record.sealed }, { meta: { ...eventRecord.meta, key: 'wrong' } }]) {
      const bytes = Buffer.from(JSON.stringify({ ...eventRecord, ...changed })); writeFileSync(legacyEventPath, bytes);
      try { assert.equal((await run(eventInput('expires-give'))).code, 'VALIDATION_ERROR'); assert.deepEqual(readFileSync(legacyEventPath), bytes); }
      finally { writeFileSync(legacyEventPath, legacyEventBytes); }
    }
    writeFileSync(legacyEventPath, JSON.stringify({ ...eventRecord, extra: secret, url }));
    try { assert.deepEqual(await eventFor('expires-give'), legacyEvent); } finally { writeFileSync(legacyEventPath, legacyEventBytes); }
    chmodSync(legacyEventPath, 0o644);
    try { assert.equal((await run(eventInput('expires-give'))).code, 'VAULT_KEY_UNAVAILABLE'); } finally { chmodSync(legacyEventPath, 0o600); }
    const linkedEvent = join(home, 'linked-event'); writeFileSync(linkedEvent, legacyEventBytes, { mode: 0o600 });
    rmSync(legacyEventPath); symlinkSync(linkedEvent, legacyEventPath);
    try { assert.equal((await run(eventInput('expires-give'))).code, 'VAULT_KEY_UNAVAILABLE'); }
    finally { rmSync(legacyEventPath); writeFileSync(legacyEventPath, legacyEventBytes, { mode: 0o600 }); rmSync(linkedEvent); }
    chmodSync(dir, 0o755);
    try { assert.equal((await run(eventInput('expires-give'))).code, 'VAULT_KEY_UNAVAILABLE'); } finally { chmodSync(dir, 0o700); }
    const heldEventLock = Buffer.from('owned event lock'); writeFileSync(lock, heldEventLock, { mode: 0o600 });
    try {
      assert.equal(await serve(undefined, board, async ({ origin }) => {
        assert.equal((await run(eventInput('expires-give'))).code, 'BUSY'); assert.deepEqual(readFileSync(lock), heldEventLock);
        assert.equal((await fetch(`${origin}api/decisions`, { signal: AbortSignal.timeout(5_000) })).status, 200);
      }), warning);
    }
    finally { rmSync(lock); }
    assert.deepEqual(await eventFor('expires-give'), legacyEvent); assert.deepEqual(readFileSync(legacyEventPath), legacyEventBytes);
    const cancelStarted = join(home, 'cancel-event-started'), cancelled = spawn(process.execPath, ['--input-type=module', '-e', worker], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let cancelOut = '', cancelErr = ''; cancelled.stdout.on('data', (b) => cancelOut += b); cancelled.stderr.on('data', (b) => cancelErr += b);
    const ended = new Promise((ok, no) => { cancelled.on('error', no); cancelled.on('exit', (code, signal) => ok({ code, signal })); });
    try {
      cancelled.stdin.end(JSON.stringify(eventInput('kept', { op: 'waitExpiry', timeoutMs: 3_600_000, started: cancelStarted })));
      await waitFor(() => existsSync(cancelStarted), Date.now() + 5_000);
      // Cancel during the poll's sleep: a kill inside the brief locked read would leave the documented stale lock.
      await new Promise((ok) => setTimeout(ok, 300));
      cancelled.kill('SIGTERM'); await waitFor(() => cancelled.signalCode !== null, Date.now() + 5_000);
      assert.equal((await ended).signal, 'SIGTERM'); assert.equal(cancelOut, ''); assert.equal(cancelErr, ''); assert.equal(existsSync(lock), false);
    } finally { if (cancelled.signalCode === null && cancelled.exitCode === null) cancelled.kill('SIGKILL'); outputs.push(cancelOut, cancelErr); }
    // Public filer wait: committed expiries of the filer's own items arrive once per event id, as metadata with exit 1.
    const waitState = join(home, 'wait-state'), waitFolder = join(home, 'wait-board'), wb = join(waitFolder, 'board.json');
    const otherFolder = join(home, 'wait-other'), ob = join(otherFolder, 'board.json'), vaultWarning = 'sign-off-axi: Vault expiry status unavailable; ordinary answers still arrive.\n';
    for (const [f, b] of [[waitFolder, wb], [otherFolder, ob]]) { mkdirSync(f, { mode: 0o700 }); writeFileSync(b, '{"schema":2,"items":[]}'); }
    const waitCli = (served, filer, extra = [], more = {}) => {
      const child = spawn(process.execPath, [cli, 'wait', served, ...(filer ? ['--filer', filer] : []), ...extra], { env: { ...env, ...more }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; child.stdout.on('data', (b) => out += b); child.stderr.on('data', (b) => err += b);
      const done = new Promise((ok, no) => { child.on('error', no); child.on('exit', (code) => { outputs.push(out, err); ok({ code, out, err, json: out.startsWith('{') ? JSON.parse(out) : undefined }); }); });
      return Object.assign(done, { child });
    };
    const expiredKeys = (r) => { assert.equal(r.code, 1); assert.ok(r.json, 'EXPIRED prints JSON metadata.'); for (const v of Object.values(r.json)) assert.deepEqual(Object.keys(v), ['answer', 'label', 'close', 'at']); return Object.keys(r.json).sort(); };
    const vaultOf = (key) => readdirSync(join(waitState, 'sign-off', 'vault')).filter((n) => n.endsWith('.json')).map((n) => join(waitState, 'sign-off', 'vault', n)).find((p) => JSON.parse(readFileSync(p)).meta.key === key);
    const wmeta = (key, mode, filer, expires, b = wb) => ({ ...meta(key, mode), board: b, filer, expires });
    const create = (key, mode, filer, expires, b) => run({ op: 'create', meta: wmeta(key, mode, filer, expires, b), ...(mode === 'receive' && { value: url }) });
    env.XDG_STATE_HOME = join(home, 'wait-gone-state');
    await create('identity-only', 'receive', 'filer-f', Date.now() + 3_600_000, ob);
    env.XDG_STATE_HOME = waitState;
    try {
      // Never used: no warning, state or identity, even where a permission walk would refuse HOME.
      for (const unsafe of [() => chmodSync(home, 0o775), () => mkdirSync(join(home, '.git'))]) {
        unsafe();
        try {
          for (const b of [wb, ob]) { const r = await waitCli(b, 'filer-f', ['--timeout', '0']); assert.equal(r.code, 1); assert.match(r.out, /^code: NOT_FOUND$/m); assert.equal(r.err, ''); }
        }
        finally { chmodSync(home, 0o700); rmSync(join(home, '.git'), { force: true, recursive: true }); }
      }
      assert.equal(existsSync(waitState), false);
      await create('elsewhere', 'receive', 'filer-f', Date.now() + 3_600_000, ob);
      const quiet = await waitCli(wb, 'filer-f', ['--timeout', '0']); assert.match(quiet.out, /^code: NOT_FOUND$/m); assert.equal(quiet.err, ''); assert.equal(existsSync(join(waitFolder, '.sign-off-vault-id')), false);
      const deadline = Date.now() + 5_000;
      for (const [key, mode, filer] of [['f-pending', 'give', 'filer-f'], ['f-ready', 'give', 'filer-f'], ['f-receive', 'receive', 'filer-f'], ['g-item', 'receive', 'filer-g']]) await create(key, mode, filer, deadline);
      await run({ op: 'deposit', board: wb, key: 'f-ready', value: secret });
      await create('f-other', 'receive', 'filer-f', deadline, ob);
      assert.equal(await serve(undefined, wb, async () => {
        const waits = [1, 2].map(() => waitCli(wb, 'filer-f', ['--timeout', '20', '--json']));
        await waitFor(() => Date.now() >= deadline - 1_500, deadline);
        assert.ok(waits.every((w) => w.child.exitCode === null), 'Live private items keep a filer wait waiting.');
        const results = await Promise.all(waits), got = results.filter((r) => r.json).flatMap(expiredKeys).sort();
        assert.deepEqual(got, ['f-pending', 'f-ready', 'f-receive']);
        results.filter((r) => !r.json).forEach((r) => assert.match(r.out, /^code: NOT_FOUND$/m));
        const g = await waitCli(wb, 'filer-g', ['--timeout', '5']);
        assert.equal(g.code, 1); assert.match(g.out, /^expired\[1\]\{key,at\}:\n {2}g-item,/m); assert.match(g.out, /^error: Vault item expired; request a fresh item\.$/m); assert.match(g.out, /^code: EXPIRED$/m);
        assert.ok(!g.out.includes('filer-g') && !g.out.includes(waitState));
      }), '');
      const again = await waitCli(wb, 'filer-f', ['--timeout', '2']); assert.match(again.out, /^code: NOT_FOUND$/m); assert.ok(!again.out.includes('expired'));
      assert.deepEqual(expiredKeys(await waitCli(ob, 'filer-f', ['--json'])), ['f-other']);
      const readyPath = vaultOf('f-ready'), readyBytes = readFileSync(readyPath), marker = readyPath.replace(/\.json$/, '.expired.taken');
      const keyed = await run({ op: 'expiry', board: wb, key: 'f-ready', filer: 'filer-f' });
      assert.equal(readFileSync(marker, 'utf8'), keyed.event.id); assert.equal(statSync(marker).mode & 0o777, 0o600); assert.deepEqual(readFileSync(readyPath), readyBytes);
      // No server: the wait expires its own filer's elapsed items; other filers' records stay as they are.
      const late = Date.now() + 1_500;
      for (const [key, mode, filer] of [['s-late', 'give', 'filer-s'], ['g-late', 'give', 'filer-g'], ['p-prio', 'receive', 'filer-p'], ['m-good', 'receive', 'filer-m'], ['m-corrupt', 'receive', 'filer-m'], ['r-a', 'receive', 'filer-r'], ['r-b', 'receive', 'filer-r'], ['f-held', 'give', 'filer-f']]) {
        await create(key, mode, filer, key === 'f-held' ? Date.now() + 3_600_000 : late);
      }
      await waitFor(() => Date.now() >= late, late + 5_000);
      const untouched = ['g-late', 'm-good'].map(vaultOf).map((p) => [p, readFileSync(p)]);
      assert.deepEqual(expiredKeys(await waitCli(wb, undefined, ['--json'], { SIGN_OFF_FILER: 'filer-s' })), ['s-late']);
      const lateRecord = JSON.parse(readFileSync(vaultOf('s-late'))); assert.equal(lateRecord.status, 'expired'); assert.equal(lateRecord.sealed, undefined);
      for (const [p, bytes] of untouched) assert.deepEqual(readFileSync(p), bytes);
      // Ordinary answers come first and keep exit 0; the vault expiry follows on the next wait.
      const ask = (key, filer) => ({ key, title: 'Umer: continue?', filer, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] });
      const answer = (key) => writeFileSync(wb.replace(/\.json$/, '.answers.jsonl'), `${JSON.stringify({ key, answer: 'yes', label: 'Yes', close: 'done', at: '2026-10-14T00:00:00Z' })}\n`, { flag: 'a' });
      writeFileSync(wb, JSON.stringify({ schema: 2, items: [ask('ordinary-p', 'filer-p')] })); answer('ordinary-p');
      const first = await waitCli(wb, 'filer-p', ['--json']); assert.equal(first.code, 0); assert.deepEqual(Object.keys(first.json), ['ordinary-p']);
      assert.deepEqual(expiredKeys(await waitCli(wb, 'filer-p', ['--json'])), ['p-prio']);
      // Unreadable siblings and a corrupt filer expiry are skipped with one warning; valid events still arrive.
      const corruptPath = vaultOf('m-corrupt'), corrupt = Buffer.from(JSON.stringify({ ...JSON.parse(readFileSync(corruptPath)), sealed: undefined, status: 'expired', at: late - 1 }));
      const sibling = join(waitState, 'sign-off', 'vault', `${'e'.repeat(64)}.json`);
      writeFileSync(corruptPath, corrupt); writeFileSync(sibling, '{"corrupt":', { mode: 0o600 });
      try {
        const m = await waitCli(wb, 'filer-m', ['--json']); assert.deepEqual(expiredKeys(m), ['m-good']); assert.equal(m.err, vaultWarning);
        assert.deepEqual(readFileSync(corruptPath), corrupt); assert.equal(existsSync(corruptPath.replace(/\.json$/, '.expired.taken')), false);
      } finally { rmSync(sibling); rmSync(corruptPath); }
      // A take is all or nothing: an unsafe second marker rolls back the first, and a retry delivers both.
      const [ra, rb] = ['r-a', 'r-b'].map(vaultOf).sort().map((p) => p.replace(/\.json$/, '.expired.taken'));
      mkdirSync(rb);
      try { const r = await waitCli(wb, 'filer-r', ['--timeout', '1']); assert.match(r.out, /^code: TIMEOUT$/m); assert.equal(r.err, vaultWarning); assert.equal(existsSync(ra), false); }
      finally { rmSync(rb, { recursive: true }); }
      assert.deepEqual(expiredKeys(await waitCli(wb, 'filer-r', ['--json'])), ['r-a', 'r-b']);
      // Unknown custody never reads as nothing waiting, and never delays an ordinary answer.
      const vaultLock = join(waitState, 'sign-off', 'vault', 'lock'), held = Buffer.from('owned wait lock'); writeFileSync(vaultLock, held, { mode: 0o600 });
      try {
        const busy = await waitCli(wb, 'filer-f', ['--timeout', '2']); assert.match(busy.out, /^code: TIMEOUT$/m); assert.equal(busy.err, vaultWarning);
        writeFileSync(wb, JSON.stringify({ schema: 2, items: [ask('ordinary-p', 'filer-p'), ask('ordinary-f', 'filer-f')] }));
        const pending = waitCli(wb, 'filer-f', ['--timeout', '10', '--json']);
        await new Promise((ok) => setTimeout(ok, 1_500)); const saved = Date.now(); answer('ordinary-f');
        const r = await pending; assert.equal(r.code, 0); assert.deepEqual(Object.keys(r.json), ['ordinary-f']); assert.ok(Date.now() - saved < 2_500, 'Ordinary answers do not queue behind custody.');
        assert.deepEqual(readFileSync(vaultLock), held);
      } finally { rmSync(vaultLock); }
      const live = await waitCli(wb, 'filer-f', ['--timeout', '1']); assert.match(live.out, /^code: TIMEOUT$/m); assert.equal(live.err, '');
      chmodSync(join(waitState, 'sign-off', 'vault'), 0o755);
      try { const r = await waitCli(wb, 'filer-f', ['--timeout', '1']); assert.match(r.out, /^code: TIMEOUT$/m); assert.equal(r.err, vaultWarning); }
      finally { chmodSync(join(waitState, 'sign-off', 'vault'), 0o700); }
      // Sweeps and lock cleanup leave markers alone; the board folder never learns vault routing.
      const markers = readdirSync(join(waitState, 'sign-off', 'vault')).filter((n) => n.endsWith('.taken')).map((n) => join(waitState, 'sign-off', 'vault', n)).map((p) => [p, readFileSync(p)]);
      assert.equal(markers.length, 10); assert.equal(await serve(undefined, wb), '');
      for (const [p, bytes] of markers) assert.deepEqual(readFileSync(p), bytes);
      assert.deepEqual((await run({ op: 'expiry', board: wb, key: 'f-ready', filer: 'filer-f' })).event, keyed.event);
      for (const p of readdirSync(waitFolder).map((n) => join(waitFolder, n)).filter((p) => !p.endsWith('.sign-off-vault-id'))) {
        assert.ok(!/f-pending|f-ready|f-receive|g-item|s-late|p-prio|m-good|r-a|filer-g|filer-s|filer-m|filer-r|api-token/.test(readFileSync(p, 'utf8')));
      }
    } finally { env.XDG_STATE_HOME = state; }
    assert.deepEqual(readFileSync(keptPath), kept);
    for (const text of [...outputs, ...files(home).map((p) => readFileSync(p).toString())]) {
      assert.equal(text.includes(secret) || text.includes(url), false);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
