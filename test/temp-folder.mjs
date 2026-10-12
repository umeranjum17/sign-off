// Global setup for `node --test`: every test file runs with its own empty TMPDIR, and the run fails if any test leaves a file there.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
export function globalSetup() {
  dir = mkdtempSync(join(tmpdir(), 'sign-off-tests-'));
  process.env.TMPDIR = dir;
}
export function globalTeardown() {
  // node-compile-cache is Node's own module cache, not a test's scratch.
  const left = readdirSync(dir).filter((f) => f !== 'node-compile-cache');
  rmSync(dir, { recursive: true, force: true });
  if (!left.length) return;
  // The runner does not print a teardown error, so say what was left before failing the run.
  console.error(`✖ the tests left ${left.join(', ')} in their temp folder: remove each test's scratch folder when it ends`);
  throw new Error('the tests left files in their temp folder');
}
