import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function copySource(from, to) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Release sources must be regular files or directories.');
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()) copySource(path.join(from, name), path.join(to, name));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o644);
  }
}
export function packageRelease(output, root = source) {
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Release output must be empty.');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'distribution/release-config.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(config.version) || !/^[\w.-]+\/[\w.-]+$/.test(config.repository)) throw new Error('Invalid release configuration.');
  const repo = path.join(output, 'repository');
  fs.mkdirSync(repo, { recursive: true });
  // Explicit roots: never package the user's project, home directory, credentials,
  // lifecycle artifact, account state, or this workspace's Git history.
  for (const name of ['setup.sh', 'setup']) copySource(path.join(root, name), path.join(repo, name));
  const assetName = `agentic-stack-v${config.version}.tar.gz`;
  const archive = path.join(output, assetName);
  const packed = spawnSync('/usr/bin/tar', ['-czf', archive, 'setup.sh', 'setup'], { cwd: repo,
    env: { ...process.env, COPYFILE_DISABLE: '1' }, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error('Could not package the installer.');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const template = fs.readFileSync(path.join(root, 'distribution/install.sh.in'), 'utf8');
  const installer = template.replaceAll('@@VERSION@@', config.version).replaceAll('@@SHA256@@', sha256).replaceAll('@@REPOSITORY@@', config.repository);
  if (/@@[A-Z]+@@/.test(installer)) throw new Error('Unresolved downloader template.');
  fs.writeFileSync(path.join(repo, 'install.sh'), installer, { mode: 0o755 });
  fs.copyFileSync(path.join(root, 'setup/README.md'), path.join(repo, 'README.md'));
  copySource(path.join(root, 'distribution'), path.join(repo, 'distribution'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.DS_Store\n.release/\nnode_modules/\n.env*\n!.env.example\n');
  const checksums = path.join(output, 'SHA256SUMS');
  fs.writeFileSync(checksums, `${sha256}  ${assetName}\n`);
  const manifest = { ...config, repo, archive, checksums, sha256, assetName };
  fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node distribution/package.mjs /absolute/empty/output-directory');
  console.log(JSON.stringify(packageRelease(path.resolve(process.argv[2])), null, 2));
}
