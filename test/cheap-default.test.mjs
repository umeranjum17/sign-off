import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// sign-off itself makes no model calls: it is a local CLI plus a 127.0.0.1 web
// server plus a short skill stub. This guard locks that property in: no
// expensive model-default strings in the shipped source text, and no LLM
// provider SDK in the dependencies.
// Only src/, skills/, README.md and docs/ are scanned, so this test file's own
// fixture strings (the pattern below names them) can never trip the scan.
const repo = join(new URL('.', import.meta.url).pathname, '..');
const SCAN_DIRS = ['src', 'skills', 'docs'];
const SCAN_FILES = ['README.md'];
const TEXT_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.svg', '.html', '.css']);
const EXPENSIVE_MODEL_PATTERN = /\b(opus|sonnet|sol)\b/i;
const PROVIDER_SDK_PATTERN = /anthropic|openai|cohere|mistral|gemini|vertex|bedrock|groq|together|replicate|langchain/i;

function textFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...textFiles(path));
    else if ([...TEXT_EXTENSIONS].some((ext) => path.endsWith(ext))) found.push(path);
  }
  return found;
}

test('cheap-default: no expensive model-default strings in shipped source text', () => {
  const files = [...SCAN_FILES.map((f) => join(repo, f)), ...SCAN_DIRS.flatMap((d) => textFiles(join(repo, d)))];
  assert.ok(files.length > 0, 'expected to scan at least one source file');
  const hits = [];
  for (const file of files) {
    const match = EXPENSIVE_MODEL_PATTERN.exec(readFileSync(file, 'utf8'));
    if (match) hits.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(hits, [], `expensive model-default strings found: ${hits.join(', ')}`);
});

test('cheap-default: no LLM provider SDK in package dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  const hits = deps.filter((name) => PROVIDER_SDK_PATTERN.test(name));
  assert.deepEqual(hits, [], `LLM provider SDK dependencies found: ${hits.join(', ')}`);
});

test('cheap-default: the no-model docs note is present', () => {
  for (const file of [join(repo, 'README.md'), join(repo, 'skills', 'sign-off-axi', 'SKILL.md')]) {
    assert.match(readFileSync(file, 'utf8'), /calls no model/, `${file} must state that sign-off calls no model`);
  }
});
