import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDecipheriv, randomBytes } from 'node:crypto';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const worker = `import { createVault, depositVault, inspectVault, refuseVault } from ${JSON.stringify(new URL('../dist/vault.js', import.meta.url).href)};
let input=''; for await (const chunk of process.stdin) input+=chunk;
const {op,meta,value,board,key,duration}=JSON.parse(input);
if(duration) meta.expires=Date.now()+duration; process.send?.('started');
try { const out=await ({create:()=>createVault(meta,value===undefined?undefined:Buffer.from(value)),deposit:()=>depositVault(board,key,Buffer.from(value)),inspect:()=>inspectVault(board,key),refuse:()=>refuseVault(board,key)})[op](); console.log(JSON.stringify(out)); }
catch(e) { console.log(JSON.stringify({code:e.code,error:e.message})); process.exitCode=1; }`;

test('disabled vault custody across real processes: encryption, racing deposits, expiry, refusal and missing-key fail closed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sign-off-vault-')), state = join(home, 'state'), board = join(home, 'project', 'board.json');
  mkdirSync(join(home, 'project'), { mode: 0o700 });
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: state, XDG_CONFIG_HOME: join(home, 'config'), TMPDIR: home };
  const outputs = [], secret = `FAKE_${randomBytes(24).toString('hex')}`, url = `https://www.npmjs.com/login/cli/${randomBytes(24).toString('hex')}`;
  const run = (input, onStarted) => new Promise((ok, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', worker], { env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    child.once('message', () => onStarted?.());
    let out = '', err = ''; child.stdout.on('data', (b) => out += b); child.stderr.on('data', (b) => err += b);
    child.on('error', reject); child.on('exit', (code) => {
      outputs.push(out, err);
      if (err || [out, err].some((s) => s.includes(secret) || s.includes(url))) return reject(new Error('Custody child output was unsafe.'));
      try { ok({ exit: code, ...JSON.parse(out) }); } catch { reject(new Error('Custody child metadata was invalid.')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
  const meta = (key, mode = 'give', expires = Date.now() + 60_000) => ({ board, key, mode, filer: 'demo-agent', expires, ...(mode === 'give' && { destination: join(home, 'config', 'api-token') }) });
  const inspect = (key) => run({ op: 'inspect', board, key });
  const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
  try {
    assert.equal((await run({ op: 'create', meta: meta('give') })).status, 'pending');
    const dir = join(state, 'sign-off', 'vault'), keyPath = join(dir, 'key');
    assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    const raced = await Promise.all([1, 2].map(() => run({ op: 'deposit', board, key: 'give', value: secret })));
    assert.deepEqual(raced.map((r) => r.exit).sort(), [0, 1]);
    assert.equal(raced.find((r) => r.error).error, 'Vault input is invalid: check mode, expiry, provider and destination.');
    assert.equal((await inspect('give')).status, 'ready');
    writeFileSync(join(dir, 'lock'), 'held', { mode: 0o600 });
    const lockedExpiry = await run({ op: 'create', meta: meta('locked-expiry', 'receive'), duration: 150, value: url }, () => setTimeout(() => rmSync(join(dir, 'lock')), 250));
    assert.equal(lockedExpiry.code, 'EXPIRED'); assert.equal((await inspect('locked-expiry')).code, 'NOT_FOUND');
    const recordPath = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => join(dir, n))[0], record = JSON.parse(readFileSync(recordPath));
    // Trusted-owner control: the synthetic private key really decrypts; altered routing/expiry cannot authenticate.
    const decrypt = (m) => {
      const cipher = createDecipheriv('aes-256-gcm', readFileSync(keyPath), Buffer.from(record.sealed.nonce, 'base64'));
      cipher.setAAD(Buffer.from(JSON.stringify([1, m.board, m.key, m.mode, m.expires, m.destination ?? null, m.filer])));
      cipher.setAuthTag(Buffer.from(record.sealed.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(record.sealed.data, 'base64')), cipher.final()]).toString();
    };
    assert.ok(decrypt(record.meta) === secret, 'Trusted-owner decryption must match without printing the payload.');
    for (const [field, value] of [['board', '/other/board.json'], ['key', 'other'], ['mode', 'receive'], ['expires', 0], ['destination', '/other/token'], ['filer', 'other']]) assert.throws(() => decrypt({ ...record.meta, [field]: value }));
    assert.equal((await run({ op: 'refuse', board, key: 'give' })).status, 'refused');
    assert.equal(JSON.parse(readFileSync(recordPath)).sealed, undefined);
    assert.equal((await run({ op: 'deposit', board, key: 'give', value: secret })).error, 'User refused this vault item; no value was delivered.');
    assert.equal((await run({ op: 'create', meta: meta('give') })).exit, 1);
    assert.equal((await run({ op: 'create', meta: meta('receive', 'receive', Date.now() + 800), value: url })).status, 'ready');
    let expired; const deadline = Date.now() + 5_000;
    do { expired = await inspect('receive'); assert.ok(Date.now() < deadline); } while (expired.status !== 'expired');
    assert.equal((await run({ op: 'refuse', board, key: 'receive' })).error, 'Vault item expired; request a fresh item.');
    assert.equal(files(dir).filter((p) => p.endsWith('.json')).map((p) => JSON.parse(readFileSync(p))).every((r) => !r.sealed), true);
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
    assert.equal((await inspect('kept')).error, 'Vault storage is busy or unavailable; retry before expiry.'); rmSync(join(dir, 'lock'));
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
    env.XDG_STATE_HOME = state;
    for (const value of ['', 'x'.repeat(16_385)]) assert.equal((await run({ op: 'create', meta: meta('bad', 'receive'), value })).exit, 1);
    const aliasDir = join(home, 'alias'); symlinkSync(join(home, 'project'), aliasDir);
    assert.equal((await run({ op: 'create', meta: { ...meta('give'), board: join(aliasDir, 'board.json') } })).code, 'VALIDATION_ERROR');
    const movedDir = join(home, 'moved'); mkdirSync(movedDir, { mode: 0o700 });
    assert.equal((await run({ op: 'create', meta: { ...meta('moving'), board: join(movedDir, 'board.json') } })).status, 'pending');
    assert.equal((await run({ op: 'refuse', board: join(movedDir, 'board.json'), key: 'moving' })).status, 'refused');
    renameSync(movedDir, join(home, 'moved-again'));
    assert.equal((await run({ op: 'create', meta: { ...meta('moving'), board: join(home, 'moved-again', 'board.json') } })).code, 'VALIDATION_ERROR');
    writeFileSync(board, JSON.stringify({ schema: 2, items: [{ key: 'ordinary', title: 'Umer: continue?' }] }));
    for (const args of [['post', board, '--type', 'vault', '--title', 'Give'], ['post', board, '--from', '-']]) {
      const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' }); outputs.push(r.stdout, r.stderr); assert.notEqual(r.status, 0);
    }
    // A metadata-only feed cannot sneak vault through the unknown-type fallback either.
    const feed = join(home, 'feed.json'); writeFileSync(feed, JSON.stringify({ schema: 2, items: [{ key: 'blocked', title: 'Give', type: 'vault' }] }));
    const fed = spawnSync(process.execPath, [cli, 'post', board, '--from', feed], { env, encoding: 'utf8' });
    outputs.push(fed.stdout, fed.stderr); assert.equal(fed.status, 2); assert.match(fed.stdout, /Vault is not enabled/);
    assert.equal(JSON.parse(readFileSync(board)).items[0].key, 'ordinary');
    const inGit = spawnSync('git', ['grep', '-n', '-F', '-e', secret, '-e', url, 'HEAD'], { env, encoding: 'utf8' });
    assert.equal(inGit.status, 1, 'Git must report no payload match, not a failed probe.');
    for (const text of [...outputs, ...files(home).map((p) => readFileSync(p).toString()), inGit.stdout]) {
      assert.equal(text.includes(secret) || text.includes(url), false);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
