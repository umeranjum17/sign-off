import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDecipheriv, randomBytes } from 'node:crypto';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const worker = `import { writeFileSync } from 'node:fs';
import { createVault, depositVault, inspectVault, refuseVault } from ${JSON.stringify(new URL('../dist/vault.js', import.meta.url).href)};
let input=''; for await (const chunk of process.stdin) input+=chunk;
const {op,meta,value,board,key,started}=JSON.parse(input);
if(started) writeFileSync(started,'started');
try { const out=await ({create:()=>createVault(meta,value===undefined?undefined:Buffer.from(value)),deposit:()=>depositVault(board,key,Buffer.from(value)),inspect:()=>inspectVault(board,key),refuse:()=>refuseVault(board,key)})[op](); console.log(JSON.stringify(out)); }
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
    writeFileSync(feed, JSON.stringify({ schema: 2, items: [{ key: 'raised', title: 'Raised' }] }));
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
    const serve = async (release = async () => {}, served = board) => {
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
        assert.ok(![out, err].some((s) => s.includes(secret) || s.includes(url)));
        return err;
      } finally {
        if (!exited) { const closed = new Promise((ok) => child.once('exit', ok)); child.kill('SIGTERM'); await closed; }
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
    for (const text of [...outputs, ...files(home).map((p) => readFileSync(p).toString())]) {
      assert.equal(text.includes(secret) || text.includes(url), false);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
