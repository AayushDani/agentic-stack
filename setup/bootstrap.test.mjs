import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { options, assertTarget, writeNew, mergeScripts, readJSON, SCHEMA, command, mcpConnected } from './bootstrap.mjs';

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-bootstrap-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the bootstrap starts through a symlinked installation path', t => {
  const dir = temporary(t);
  const alias = path.join(dir, 'installed-setup');
  fs.symlinkSync(path.dirname(fileURLToPath(import.meta.url)), alias);
  const result = spawnSync(process.execPath, [path.join(alias, 'bootstrap.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: bash setup.sh/);
});

test('preserves existing nonempty projects before installation', t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'precious.txt'), 'keep me');
  assert.throws(() => assertTarget(dir), /left untouched/);
  assert.equal(fs.readFileSync(path.join(dir, 'precious.txt'), 'utf8'), 'keep me');
});

test('resumes only directories carrying our marker', t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, '.agentic-stack.json'), JSON.stringify({ schema: SCHEMA }));
  assert.doesNotThrow(() => assertTarget(dir));
});

test('does not follow a project symlink', t => {
  const dir = temporary(t);
  fs.mkdirSync(path.join(dir, 'real'));
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
  assert.throws(() => assertTarget(path.join(dir, 'link')), /real directory/);
});

test('template reruns preserve user edits', t => {
  const file = path.join(temporary(t), 'docs', 'notes.md');
  assert.equal(writeNew(file, 'original'), true);
  fs.writeFileSync(file, 'my edited instructions');
  assert.equal(writeNew(file, 'replacement'), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'my edited instructions');
});

test('existing npm commands cannot be silently replaced', () => {
  const pkg = { scripts: { test: 'my-important-tests' } };
  assert.throws(() => mergeScripts(pkg, { test: 'vitest run' }), /preserved/);
  assert.equal(pkg.scripts.test, 'my-important-tests');
});

test('adding scripts is idempotent and preserves unrelated settings', () => {
  const pkg = { scripts: { dev: 'next dev' }, private: true };
  const once = mergeScripts(pkg, { test: 'vitest run' });
  assert.deepEqual(mergeScripts(once, { test: 'vitest run' }), once);
  assert.equal(once.scripts.dev, 'next dev');
  assert.equal(once.private, true);
});

test('invalid config cannot be treated as an absent config', t => {
  const file = path.join(temporary(t), 'broken.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => readJSON(file, {}), SyntaxError);
});

test('paths with shell metacharacters remain arguments, not executable code', t => {
  const dir = temporary(t);
  const payload = `hello spaces $(touch ${dir}/pwned) \`touch ${dir}/also-pwned\``;
  const result = command(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', payload], { capture: true });
  assert.equal(result.stdout, payload);
  assert.equal(fs.existsSync(path.join(dir, 'pwned')), false);
  assert.equal(fs.existsSync(path.join(dir, 'also-pwned')), false);
});

test('failed subprocesses propagate without printing captured credentials', () => {
  assert.throws(() => command(process.execPath, ['-e', 'console.error("secret-token");process.exit(9)'], { capture: true }), e => {
    assert.match(e.message, /failed \(9\)/);
    assert.doesNotMatch(e.message, /secret-token/);
    return true;
  });
});

test('unknown options and missing paths fail rather than install with defaults', () => {
  assert.throws(() => options(['--typo']), /Unknown option/);
  assert.throws(() => options(['--project', '--check']), /needs a directory/);
  assert.equal(options(['--dry-run'])['dry-run'], true);
});

test('negative or merely configured MCP states cannot count as a connection', () => {
  assert.equal(mcpConnected('context7: not connected', 'context7'), false);
  assert.equal(mcpConnected('context7: ⚠ Needs authentication', 'context7'), false);
  assert.equal(mcpConnected('context7: https://mcp.context7.com/mcp - ✓ Connected', 'context7'), true);
  assert.equal(mcpConnected('context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected', 'context7'), true);
  assert.equal(mcpConnected('plugin:paper-desktop:paper: /path/to/paper mcp - ✔ Connected', 'paper'), true);
  assert.equal(mcpConnected('some-other-server: ✓ Connected', 'paper'), false);
});
