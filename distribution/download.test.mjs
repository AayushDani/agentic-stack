import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(here, 'install.sh.in'), 'utf8');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
function fixture(t, { unexpected = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-download-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const payload = path.join(dir, 'source');
  fs.mkdirSync(path.join(payload, 'setup'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'setup.sh'), '#!/bin/bash\nif [ -t 0 ]; then echo TERMINAL_PRESERVED; else exit 9; fi\nprintf "ARG:%s\\n" "$@"\n');
  for (const name of ['bootstrap.mjs', 'cloud.mjs']) fs.writeFileSync(path.join(payload, 'setup', name), '// fixture\n');
  if (unexpected) fs.writeFileSync(path.join(payload, 'personal-notes.txt'), 'must not extract');
  const archive = path.join(dir, 'payload.tar.gz');
  const tar = spawnSync('/usr/bin/tar', ['-czf', archive, 'setup.sh', 'setup', ...(unexpected ? ['personal-notes.txt'] : [])], { cwd: payload, env: { ...process.env, COPYFILE_DISABLE: '1' } });
  assert.equal(tar.status, 0);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const curl = path.join(dir, 'curl');
  fs.writeFileSync(curl, '#!/bin/bash\nif [ "${FIXTURE_CURL_FAIL:-}" = 1 ]; then exit 22; fi\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then /bin/cp "$FIXTURE_ARCHIVE" "$2"; exit; fi; shift; done\nexit 2\n', { mode: 0o755 });
  const script = template.replaceAll('@@VERSION@@', '1.0.0').replaceAll('@@SHA256@@', sha).replaceAll('@@REPOSITORY@@', 'fixture/installer').replaceAll('/usr/bin/curl', quote(curl));
  const file = path.join(dir, 'install.sh'); fs.writeFileSync(file, script);
  const installRoot = path.join(dir, 'fresh path with spaces');
  const env = { ...process.env, AGENTIC_INSTALL_ROOT: installRoot, FIXTURE_ARCHIVE: archive };
  return { dir, file, archive, installRoot, env };
}
test('fresh download extracts complete verified files without running setup or requiring Node/Git', t => {
  const f = fixture(t);
  const result = spawnSync('/bin/bash', [f.file, '--download-only'], { env: { ...f.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const entries = fs.readdirSync(f.installRoot);
  assert.equal(entries.length, 1);
  assert.ok(fs.existsSync(path.join(f.installRoot, entries[0], 'setup/cloud.mjs')));
  assert.doesNotMatch(result.stdout, /TERMINAL_PRESERVED/);
});
test('download failure never executes setup and cleans staging', t => {
  const f = fixture(t);
  const result = spawnSync('/bin/bash', [f.file, '--download-only'], { env: { ...f.env, FIXTURE_CURL_FAIL: '1' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(f.installRoot), []);
});
test('changed archive bytes are rejected before extraction', t => {
  const f = fixture(t); fs.appendFileSync(f.archive, 'tampered');
  const result = spawnSync('/bin/bash', [f.file, '--download-only'], { env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
  assert.deepEqual(fs.readdirSync(f.installRoot), []);
});
test('unexpected archive roots are rejected even if the checksum matches', t => {
  const f = fixture(t, { unexpected: true });
  const result = spawnSync('/bin/bash', [f.file, '--download-only'], { env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected archive content/);
  assert.deepEqual(fs.readdirSync(f.installRoot), []);
});
test('piped installation reconnects its Terminal and preserves argument boundaries', t => {
  const f = fixture(t);
  const command = `/bin/cat ${quote(f.file)} | /bin/bash -s -- --project ${quote('/tmp/my project; literal')}`;
  const pty = `import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.execv('/bin/bash', ['bash', '-c', sys.argv[1]])
while True:
    try:
        data = os.read(fd, 65536)
        if not data: break
        os.write(1, data)
    except OSError: break
os.close(fd)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;
  const result = spawnSync('/usr/bin/python3', ['-c', pty, command], { env: f.env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TERMINAL_PRESERVED/);
  assert.match(result.stdout, /ARG:--project/);
  assert.match(result.stdout, /ARG:\/tmp\/my project; literal/);
});
test('partial downloader content never begins the download', t => {
  const f = fixture(t);
  const script = fs.readFileSync(f.file, 'utf8');
  const result = spawnSync('/bin/bash', [], { input: script.slice(0, script.indexOf('  local stack_destination')), env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.ok(!fs.existsSync(f.installRoot));
});
