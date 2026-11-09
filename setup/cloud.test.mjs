import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchEnv, safeURL, deploymentFiles, chooseHobbyTeam, privateJSON, jsonFile, api, redact, acquireCloudLock, SUPABASE_LOGIN_ARGS, configureVercelEnv, posthogReceiptQuery, createSupabaseTokenReader, supabaseCommandEnv } from './cloud.mjs';
const temp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-setup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const installedSupabase = path.join(os.homedir(), '.local/share/agentic-stack/cloud-tools/node_modules/.bin/supabase');
test('the real Supabase login command reaches authentication instead of failing profile loading', {
  skip: !fs.existsSync(installedSupabase),
}, t => {
  const result = spawnSync(installedSupabase, SUPABASE_LOGIN_ARGS, {
    cwd: temp(t), encoding: 'utf8', input: '', timeout: 15_000,
    env: { ...process.env, SUPABASE_HOME: temp(t), SUPABASE_NO_KEYRING: '1',
      SUPABASE_PROFILE: '', SUPABASE_ACCESS_TOKEN: '' },
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /ProfileLoadError|failed to read profile|unsupported config file type/);
  assert.match(output, /Cannot use automatic login flow/);
});
test('environment merge preserves unrelated settings and supports repeat runs', () => {
  const initial = '# My settings\nANOTHER_KEY=keep\nNEXT_PUBLIC_POSTHOG_KEY=\n';
  const next = patchEnv(initial, { NEXT_PUBLIC_POSTHOG_KEY: 'phc_example' });
  assert.match(next, /ANOTHER_KEY=keep/);
  assert.equal(patchEnv(next, { NEXT_PUBLIC_POSTHOG_KEY: 'phc_example' }), next);
});
test('existing service configuration cannot be silently replaced', () => {
  assert.throws(() => patchEnv('NEXT_PUBLIC_POSTHOG_KEY=other\n', { NEXT_PUBLIC_POSTHOG_KEY: 'new' }), /preserved/);
  assert.throws(() => patchEnv('FOO=a\nFOO=b\n', { FOO: 'new' }), /Duplicate/);
});
test('only previously managed values can be rotated', () => {
  assert.equal(patchEnv('FOO="old"\n', { FOO: 'new' }, { FOO: 'old' }), 'FOO="new"\n');
  assert.throws(() => patchEnv('FOO=edited\n', { FOO: 'new' }, { FOO: 'old' }), /preserved/);
});
test('dotenv injection is rejected', () => {
  assert.throws(() => patchEnv('', { BAD: 'abc\nINJECTED=true' }), /Invalid/);
  assert.throws(() => patchEnv('', { 'NOT=AN_ENV': 'abc' }), /Invalid/);
});
test('credentials cannot follow pagination or redirects to another host', () => {
  assert.equal(safeURL('https://us.posthog.com', '/api/projects/1/').hostname, 'us.posthog.com');
  assert.throws(() => safeURL('https://us.posthog.com', 'https://evil.example/api'), /different host/);
  assert.throws(() => safeURL('https://us.posthog.com', '//evil.example/api'), /different host/);
  assert.throws(() => safeURL('http://us.posthog.com', '/api'), /Unrecognized/);
});
test('deployment excludes env files, reports, notebooks, and arbitrary files', t => {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/app.ts'), 'export {};');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=never-upload');
  fs.writeFileSync(path.join(dir, '.agentic-cloud.private.json'), '{"secret":"never-upload"}');
  fs.writeFileSync(path.join(dir, 'personal-notes.md'), 'never-upload');
  const files = deploymentFiles(dir);
  assert.deepEqual(files.map(f => f.file), ['src/app.ts', 'package.json']);
  assert.ok(!JSON.stringify(files).includes(Buffer.from('never-upload').toString('base64')));
});
test('deployment rejects symlinks escaping the project', t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, 'src'));
  fs.symlinkSync('/etc/hosts', path.join(dir, 'src/leak.ts'));
  assert.throws(() => deploymentFiles(dir), /symlink/);
});
test('private keys or hidden directories inside source cannot be uploaded', t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, 'src/.git'), { recursive: true });
  assert.throws(() => deploymentFiles(dir), /Sensitive/);
});
test('paid teams and ambiguous accounts cannot be selected by accident', () => {
  const pro = { id: 'pro', slug: 'work', billing: { plan: 'pro' } };
  const hobby = { id: 'hobby', slug: 'me', billing: { plan: 'hobby' } };
  assert.equal(chooseHobbyTeam([pro, hobby], { defaultTeamId: 'pro' }).id, 'hobby');
  assert.throws(() => chooseHobbyTeam([pro], {}), /Hobby/);
  assert.throws(() => chooseHobbyTeam([pro, hobby], {}, 'pro'), /No other team/);
  assert.throws(() => chooseHobbyTeam([hobby, { ...hobby, id: 'other' }], {}), /unambiguous/);
});
test('credential/state files use owner-only permissions and atomic replacement', t => {
  const file = path.join(temp(t), 'state.json');
  privateJSON(file, { a: 1 });
  privateJSON(file, { a: 2 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(jsonFile(file), { a: 2 });
});
test('API errors do not disclose response bodies or retry resource creation', async t => {
  const original = global.fetch; let calls = 0;
  t.after(() => { global.fetch = original; });
  global.fetch = async () => { calls++; return new Response('{"secret":"sensitive-value"}', { status: 403 }); };
  await assert.rejects(() => api('https://api.supabase.com', '/v1/projects', 'secret', 'POST', {}), e => {
    assert.equal(e.status, 403); assert.ok(!e.message.includes('sensitive-value')); return true;
  });
  assert.equal(calls, 1);
});
test('common credential forms are redacted from reports', () => {
  assert.equal(redact('sbp_123abc phx_abc Bearer anything'), '[redacted] [redacted] Bearer [redacted]');
});
test('concurrent setup cannot create duplicate cloud resources', t => {
  const dir = temp(t);
  const release = acquireCloudLock(dir);
  assert.throws(() => acquireCloudLock(dir), /already running/);
  release();
  const again = acquireCloudLock(dir); again();
  assert.ok(!fs.existsSync(path.join(dir, '.agentic-cloud.lock.json')));
});
test('an interrupted setup can recover its stale lock', t => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, '.agentic-cloud.lock.json'), JSON.stringify({ pid: 2147483647, owner: 'old' }));
  const release = acquireCloudLock(dir); release();
  assert.ok(!fs.existsSync(path.join(dir, '.agentic-cloud.lock.json')));
});
test('Vercel environment writes use individual objects, retain all targets, and upsert on reruns', () => {
  const calls = [];
  const request = (endpoint, method, body, scope) => {
    calls.push({ endpoint, method, body, scope });
    assert.equal(Array.isArray(body), false);
    return { created: { key: body.key }, failed: [] };
  };
  const values = { NEXT_PUBLIC_POSTHOG_KEY: 'public-test', SETUP_CHECK_TOKEN: 'private-test' };
  configureVercelEnv('prj_test', values, 'my-team', request);
  configureVercelEnv('prj_test', values, 'my-team', request);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0], { endpoint: '/v10/projects/prj_test/env?upsert=true', method: 'POST',
    body: { key: 'NEXT_PUBLIC_POSTHOG_KEY', value: 'public-test', type: 'encrypted', target: ['production', 'preview', 'development'] }, scope: 'my-team' });
  assert.deepEqual(calls[0], calls[2]);
});
test('Vercel per-entry failures and missing confirmations stop setup without disclosing secrets', () => {
  for (const result of [{ failed: [{ error: { message: 'private-test' } }] }, {}, { created: { key: 'WRONG_KEY' } }]) {
    let calls = 0;
    assert.throws(() => configureVercelEnv('prj_test', { SETUP_CHECK_TOKEN: 'private-test', SECOND: 'next' }, 'my-team', () => { calls++; return result; }), error => {
      assert.match(error.message, /incomplete/); assert.ok(!error.message.includes('private-test')); return true;
    });
    assert.equal(calls, 1);
  }
});
test('analytics receipt polling bypasses stale empty results and rejects untrusted SQL fragments', () => {
  const request = posthogReceiptQuery('a'.repeat(32));
  assert.equal(request.refresh, 'force_blocking');
  assert.ok(request.query.query.includes('a'.repeat(32)));
  assert.throws(() => posthogReceiptQuery("'; DROP TABLE events"), /Invalid/);
});
test('Supabase credentials are reused in memory and refreshed only after a new login', t => {
  let reads = 0;
  const home = temp(t);
  const token = createSupabaseTokenReader({ env: {}, home, execute: () => {
    reads++;
    return { status: 0, stdout: 'go-keyring-base64:' + Buffer.from(`token-${reads}`).toString('base64') };
  } });
  assert.equal(token(), 'token-1'); assert.equal(token(), 'token-1'); assert.equal(reads, 1);
  assert.equal(token({ refresh: true }), 'token-2'); assert.equal(reads, 2);
  assert.deepEqual(fs.readdirSync(home), []);
});
test('denied Keychain access stops without probing more accounts or starting a login loop', t => {
  let reads = 0;
  const token = createSupabaseTokenReader({ env: {}, home: temp(t), execute: () => {
    reads++; return { status: 51, stdout: '', stderr: 'sensitive OS details' };
  } });
  assert.throws(() => token(), error => {
    assert.match(error.message, /Keychain access was not granted/);
    assert.ok(!error.message.includes('sensitive OS details')); return true;
  });
  assert.equal(reads, 1);
});
test('a missing Keychain item can use a legacy item, but inherited tokens need no Keychain access', t => {
  let reads = 0;
  const token = createSupabaseTokenReader({ env: {}, home: temp(t), execute: () => {
    reads++; return reads === 1 ? { status: 44 } : { status: 0, stdout: 'legacy-token' };
  } });
  assert.equal(token(), 'legacy-token'); assert.equal(token(), 'legacy-token'); assert.equal(reads, 2);
  const inherited = createSupabaseTokenReader({ env: { SUPABASE_ACCESS_TOKEN: 'inherited-token' }, execute: () => assert.fail('Must not access Keychain') });
  assert.equal(inherited(), 'inherited-token');
});
test('credentialed Supabase child commands do not reopen Keychain or change the parent environment', () => {
  const previous = process.env.SUPABASE_NO_KEYRING;
  assert.deepEqual(supabaseCommandEnv('token', 'password'), { SUPABASE_NO_KEYRING: '1', SUPABASE_ACCESS_TOKEN: 'token', SUPABASE_DB_PASSWORD: 'password' });
  assert.equal(process.env.SUPABASE_NO_KEYRING, previous);
});
