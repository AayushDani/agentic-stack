#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupCloud, redact } from './cloud.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLUGINS = [
  ['mattpocock-skills', 'mattpocock', 'mattpocock/skills'],
  ['vibe-wise', 'vibe-wise', 'nykooi1/vibe-wise'],
  ['impeccable', 'impeccable', 'pbakaus/impeccable'],
  ['obsidian', 'obsidian-skills', 'kepano/obsidian-skills'],
  ['paper-desktop', 'paper', 'paper-design/agent-plugins'],
];
const APPS = [
  ['T3 Code', 't3-code', ['T3 Code (Beta).app', 'T3 Code.app']],
  ['Paper', 'paper-design', ['Paper.app']],
  ['Obsidian', 'obsidian', ['Obsidian.app']],
];
const MARKER = '.agentic-stack.json';
export const SCHEMA = 'agentic-stack-v1';

export function options(args) {
  const o = { project: path.join(os.homedir(), 'Developer', 'reading-list') };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--project needs a directory');
      o.project = path.resolve(args[++i]);
    } else if (['--check', '--dry-run', '--no-login', '--no-open', '--project-only', '--local-only', '--cloud-only', '--start-learning'].includes(a)) {
      o[a.slice(2)] = true;
    } else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return o;
}

export function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

export function writeNew(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, content, { flag: 'wx' }); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}

export function assertTarget(project) {
  if (!fs.existsSync(project)) return;
  if (fs.lstatSync(project).isSymbolicLink() || !fs.statSync(project).isDirectory()) {
    throw new Error(`Project target must be a real directory: ${project}`);
  }
  if (!fs.readdirSync(project).length) return;
  if (readJSON(path.join(project, MARKER))?.schema !== SCHEMA) {
    throw new Error(`Existing project left untouched: ${project}. Use --project with a new or empty folder.`);
  }
}

export function mergeScripts(pkg, additions) {
  pkg.scripts ??= {};
  for (const [key, value] of Object.entries(additions)) {
    if (pkg.scripts[key] && pkg.scripts[key] !== value) {
      throw new Error(`Existing npm script '${key}' differs; it was preserved.`);
    }
    pkg.scripts[key] = value;
  }
  return pkg;
}

function executable(name) {
  return process.env.PATH.split(path.delimiter).some(dir => {
    try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { return false; }
  });
}

function appPath(names) {
  for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    for (const name of names) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

export function command(cmd, args = [], { cwd, capture = false, allowFailure = false, env = {} } = {}) {
  const result = spawnSync(cmd, args, {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if ((result.error || result.status !== 0) && !allowFailure) {
    // Avoid persisting account details, OAuth links, or tokens from command output.
    throw new Error(`${path.basename(cmd)} failed (${result.error?.code || result.status}). Rerun the same setup command to retry.`);
  }
  return result;
}

function jsonCommand(cmd, args) {
  const r = command(cmd, args, { capture: true, allowFailure: true });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function installedPlugins() {
  const list = jsonCommand('claude', ['plugin', 'list', '--json']);
  if (!Array.isArray(list)) throw new Error('Cannot inspect Claude plugins; run claude --version to check the installation.');
  return list;
}

function pluginMatch(list, name) {
  return list.find(p => p.id.split('@')[0] === name && p.scope === 'user');
}

export function mcpConnected(output, name) {
  return output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')
    .some(line => line.toLowerCase().includes(name.toLowerCase()) && /[✓✔]\s*Connected\b/i.test(line));
}

function installPlugin([name, market, repo]) {
  const existing = pluginMatch(installedPlugins(), name);
  if (existing) {
    if (!existing.enabled) command('claude', ['plugin', 'enable', existing.id, '--scope', 'user']);
    return;
  }
  const markets = jsonCommand('claude', ['plugin', 'marketplace', 'list', '--json']);
  if (!Array.isArray(markets)) throw new Error('Cannot inspect Claude marketplaces.');
  const sameName = markets.find(m => m.name === market);
  if (sameName && sameName.repo !== repo) throw new Error(`Marketplace '${market}' already points elsewhere; existing settings preserved.`);
  if (!sameName) command('claude', ['plugin', 'marketplace', 'add', repo]);
  command('claude', ['plugin', 'install', `${name}@${market}`, '--scope', 'user']);
  if (!pluginMatch(installedPlugins(), name)?.enabled) throw new Error(`${name} did not become enabled.`);
}

function ensureTool(name, brewArgs) {
  if (!executable(name)) command('brew', ['install', ...brewArgs]);
  if (!executable(name)) throw new Error(`${name} is still unavailable after installation.`);
}

function createProject(project) {
  assertTarget(project);
  if (!fs.existsSync(path.join(project, MARKER))) {
    fs.mkdirSync(path.dirname(project), { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(path.dirname(project), 'agentic-start-'));
    // npm names reject capitals; mkdtemp's random suffix can contain capitals.
    const staging = path.join(stagingRoot, 'starter');
    try {
      command('npx', ['--yes', 'create-next-app@latest', staging, '--typescript', '--tailwind', '--eslint', '--app', '--src-dir', '--use-npm', '--import-alias', '@/*', '--disable-git', '--yes'], { env: { CI: '1' } });
      fs.writeFileSync(path.join(staging, MARKER), JSON.stringify({ schema: SCHEMA, createdAt: new Date().toISOString() }, null, 2) + '\n');
      // Never move over an existing user's directory if it gained files while scaffolding.
      if (fs.existsSync(project) && fs.readdirSync(project).length) throw new Error('Target gained files during setup; generated project retained in staging.');
      fs.renameSync(staging, project);
      fs.rmdirSync(stagingRoot);
    } catch (e) { throw new Error(`${e.message}\nScaffold retained at ${staging}`); }
  }
  if (!fs.existsSync(path.join(project, '.git'))) command('git', ['init', '-b', 'main'], { cwd: project });
  const pkgFile = path.join(project, 'package.json');
  const pkg = readJSON(pkgFile);
  if (!pkg?.dependencies?.next) throw new Error('Generated Next.js project is incomplete.');
  const prod = ['@supabase/supabase-js', '@supabase/ssr', 'posthog-js'];
  const dev = ['vitest', '@playwright/test'];
  const missingProd = prod.filter(p => !pkg.dependencies?.[p]);
  const missingDev = dev.filter(p => !pkg.devDependencies?.[p]);
  // create-next-app currently selects Node 20 types; current Vitest needs 22+.
  if (!/^\^?24(?:\.|$)/.test(pkg.devDependencies?.['@types/node'] || '')) missingDev.push('@types/node@24');
  if (missingProd.length) command('npm', ['install', ...missingProd], { cwd: project });
  if (missingDev.length) command('npm', ['install', '--save-dev', ...missingDev], { cwd: project });
  command('npm', ['install'], { cwd: project });
  if (!fs.existsSync(path.join(project, 'components.json'))) {
    command('npx', ['--yes', 'shadcn@latest', 'init', '--defaults', '--yes'], { cwd: project, env: { CI: '1' } });
  }
  command('npx', ['playwright', 'install', 'chromium'], { cwd: project });

  // These are configuration/health-check templates, not a completed reading-list app.
  const templates = path.join(HERE, 'templates');
  for (const name of fs.readdirSync(templates, { recursive: true })) {
    const source = path.join(templates, name);
    if (fs.statSync(source).isFile()) writeNew(path.join(project, name), fs.readFileSync(source));
  }
  // Next.js creates AGENTS.md itself; append our separate managed block instead
  // of treating its existence as proof that the project workflow was configured.
  const agentsFile = path.join(project, 'AGENTS.md');
  const agentContent = fs.readFileSync(agentsFile, 'utf8');
  if (!agentContent.includes('## Agent skills') && !agentContent.includes('BEGIN:agentic-working-agreements')) {
    fs.appendFileSync(agentsFile, '\n<!-- BEGIN:agentic-working-agreements -->\n' + fs.readFileSync(path.join(templates, 'AGENTS.md'), 'utf8') + '\n<!-- END:agentic-working-agreements -->\n');
  }
  const updated = mergeScripts(readJSON(pkgFile), {
    'typecheck': 'tsc --noEmit', 'test': 'vitest run',
    'test:e2e': 'playwright test', 'check': 'npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e',
  });
  fs.writeFileSync(pkgFile, JSON.stringify(updated, null, 2) + '\n');
  const ignore = path.join(project, '.gitignore');
  const existingIgnore = fs.readFileSync(ignore, 'utf8');
  const entries = ['!.env.example', '/test-results/', '/playwright-report/', '/.agentic-stack.json', '/.agentic-setup-report.json'];
  for (const entry of entries) if (!existingIgnore.split('\n').includes(entry)) fs.appendFileSync(ignore, `\n${entry}\n`);
  const vault = path.join(project, 'learning');
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  writeNew(path.join(vault, 'Start here.md'), '# My engineering notebook\n\nAfter each small change, write what you expected, what happened, and how you checked it.\n');
}

function inspect(o) {
  console.log('Installed software (this does not verify connected accounts):');
  for (const tool of ['node', 'npm', 'git', 'claude', 'gh']) console.log(`  ${executable(tool) ? 'FOUND' : 'MISSING'} ${tool}`);
  for (const [name, , names] of APPS) console.log(`  ${appPath(names) ? 'FOUND' : 'MISSING'} ${name}`);
  if (executable('claude')) {
    const auth = jsonCommand('claude', ['auth', 'status']);
    console.log(`  Claude sign-in: ${auth?.loggedIn ? 'signed in' : 'not verified / signed out'}`);
    const plugins = installedPlugins();
    for (const [name] of PLUGINS) console.log(`  ${pluginMatch(plugins, name)?.enabled ? 'ENABLED' : 'MISSING'} ${name}`);
  }
  assertTarget(o.project);
  console.log(`Project: ${o.project}`);
}

export function plan(project) {
  return [
    'Reuse installed apps; install missing Git, GitHub CLI, Claude Code, T3 Code, Paper, Obsidian.',
    'Install Matt Pocock, VibeWise, Impeccable, Obsidian Skills, and Paper plugins into Claude Code.',
    'Connect Context7 through MCP; preserve existing configuration.',
    `Create/resume the managed Next.js + TypeScript + Tailwind + shadcn project at ${project}.`,
    'Add Supabase/PostHog libraries, Vitest, Playwright, project instructions, cloud-service notes, and a learning vault.',
    'Run type checking, unit-test discovery, production build, and a Chromium homepage smoke test.',
    'Guide Claude, GitHub, Context7, Supabase, PostHog, and Vercel browser sign-ins when needed.',
    'Create/reuse a Free Supabase project, connect the PostHog project selected at sign-in, and configure a Vercel Hobby project.',
    'Wire the SDKs, protect local credentials, deploy the starter, verify a database round trip and receipt of a PostHog test event.',
    'Open T3/Paper/Obsidian and the verified site. No paid-plan upgrade or custom domain purchase.',
  ];
}

export function recordCloudOutcome(project, cloud, error) {
  const file = path.join(project, '.agentic-setup-report.json');
  const report = readJSON(file);
  if (!report) return;
  const name = 'Cloud services and deployed round trip';
  report.results = (report.results || []).filter(row => row.name !== name);
  report.results.push(error ? { name, status: 'needs-attention', detail: redact(error.message) } : { name, status: 'passed' });
  report.cloud = error ? undefined : cloud;
  // Preserve the timestamp and results of the earlier workstation checks.
  report.cloudCheckedAt = new Date().toISOString();
  report.limitations = (report.limitations || []).filter(text => !text.startsWith('Cloud '));
  report.limitations.push(error ? 'Cloud services are not verified; inspect .agentic-cloud-report.json.' : 'Cloud infrastructure and a test round trip are verified. Reading-list features and a user-facing sign-in flow remain product work.');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
}

export async function main(args = process.argv.slice(2)) {
  const o = options(args);
  if (o.help) {
    console.log('Usage: bash setup.sh [--project PATH] [--check | --dry-run] [--local-only | --cloud-only | --project-only] [--no-login] [--no-open] [--start-learning]\n\nDefault: local setup, cloud sign-ins/configuration/deployment, and connected checks.\n--check / --dry-run: read-only. --project-only: local starter only. --local-only: no cloud services.\n--cloud-only: resume the cloud phase of an already prepared starter. Rerun to resume.');
    return 0;
  }
  if (o.check || o['dry-run']) {
    inspect(o);
    if (o['dry-run']) console.log('\nWould perform:\n' + plan(o.project).map((s, i) => `  ${i + 1}. ${s}`).join('\n'));
    return 0;
  }
  if (process.platform !== 'darwin') throw new Error('This bootstrapper supports macOS.');
  assertTarget(o.project); // Preflight before any workstation changes.
  if (o['cloud-only']) {
    try { const cloud = await setupCloud(o); recordCloudOutcome(o.project, cloud); return 0; }
    catch (error) { recordCloudOutcome(o.project, undefined, error); throw error; }
  }
  const results = [];
  function step(name, fn) {
    console.log(`\n→ ${name}`);
    try { fn(); results.push({ name, status: 'passed' }); return true; }
    catch (e) { console.error(`  ${e.message}`); results.push({ name, status: 'needs-attention', detail: e.message }); return false; }
  }
  if (!o['project-only']) {
    step('Git', () => ensureTool('git', ['git']));
    step('GitHub CLI', () => ensureTool('gh', ['gh']));
    step('Claude Code', () => ensureTool('claude', ['--cask', 'claude-code']));
    for (const [name, cask, names] of APPS) step(name, () => {
      if (!appPath(names)) command('brew', ['install', '--cask', cask]);
      if (!appPath(names)) throw new Error(`${name} app not found after installation.`);
    });
    for (const plugin of PLUGINS) step(`${plugin[0]} plugin`, () => installPlugin(plugin));
    step('Context7 connection', () => {
      const config = readJSON(path.join(os.homedir(), '.claude.json'), {});
      const current = config.mcpServers?.context7;
      if (!current) command('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'context7', 'https://mcp.context7.com/mcp']);
      else if (current.url !== 'https://mcp.context7.com/mcp') throw new Error('Existing Context7 configuration preserved; its endpoint differs from this preset.');
    });
  }
  const created = step('Starter project and project configuration', () => createProject(o.project));
  const localVerified = created && step('Build and browser checks', () => command('npm', ['run', 'check'], { cwd: o.project }));
  if (!o['project-only'] && !o['no-login']) {
    const interactive = process.stdin.isTTY;
    const login = (name, fn) => step(name, () => {
      if (!interactive) throw new Error('Run the same setup command in Terminal to complete browser sign-in.');
      fn();
    });
    login('Claude account', () => {
      if (!jsonCommand('claude', ['auth', 'status'])?.loggedIn) command('claude', ['auth', 'login']);
      if (!jsonCommand('claude', ['auth', 'status'])?.loggedIn) throw new Error('Claude is not signed in yet.');
    });
    login('GitHub account', () => {
      if (command('gh', ['auth', 'status'], { capture: true, allowFailure: true }).status !== 0) {
        command('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
      }
      command('gh', ['auth', 'status'], { capture: true });
    });
    login('Context7 account', () => {
      const health = command('claude', ['mcp', 'list'], { capture: true, allowFailure: true });
      if (!mcpConnected(health.stdout || '', 'context7')) command('claude', ['mcp', 'login', 'context7']);
    });
  }
  let cloud;
  if (!o['project-only'] && !o['local-only'] && localVerified) {
    try {
      cloud = await setupCloud(o);
      results.push({ name: 'Cloud services and deployed round trip', status: 'passed' });
    } catch (e) {
      console.error(e.message);
      results.push({ name: 'Cloud services and deployed round trip', status: 'needs-attention', detail: e.message });
    }
  }
  if (!o['project-only'] && !o['no-open'] && created) {
    step('Open your workspace', () => {
      const t3 = appPath(APPS[0][2]);
      if (t3) command('open', [t3]);
      const paper = appPath(APPS[1][2]);
      if (paper) command('open', [paper]);
      if (appPath(APPS[2][2])) command('open', [`obsidian://open?path=${encodeURIComponent(path.join(o.project, 'learning', 'Start here.md'))}`]);
      const cli = path.join(os.homedir(), '.t3', 'bin', 't3');
      if (fs.existsSync(cli)) {
        let opened = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          if (command(cli, ['app', o.project], { capture: true, allowFailure: true }).status === 0) { opened = true; break; }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
        }
        if (!opened) throw new Error('T3 opened, but its project handoff did not respond. Your Claude session can use the project directly.');
      } else throw new Error('T3 opened; its bundled command has not initialized. Rerun setup after T3 finishes its first launch.');
    });
    step('MCP connection check', () => {
      const result = command('claude', ['mcp', 'list'], { cwd: o.project, capture: true });
      if (!mcpConnected(result.stdout, 'context7')) throw new Error('Context7 installed but a live connection was not verified.');
      if (!mcpConnected(result.stdout, 'paper')) throw new Error('Paper installed but a live connection was not verified; its app may require sign-in.');
    });
  }
  const report = {
    checkedAt: new Date().toISOString(), project: o.project, results,
    cloud,
    limitations: ['T3 provider selection is not changed; choose Claude when starting a T3 session.', 'VibeWise and Impeccable project-specific coaching/design preferences are set in the agent session.', cloud ? 'Cloud infrastructure and a test round trip are verified. Reading-list features and a user-facing sign-in flow remain product work.' : 'Cloud services are not verified; inspect .agentic-cloud-report.json if the cloud phase was attempted.'],
  };
  if (created) fs.writeFileSync(path.join(o.project, '.agentic-setup-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('\nSetup results:');
  for (const r of results) console.log(`  ${r.status === 'passed' ? '✓' : '!'} ${r.name}`);
  console.log(`\nProject: ${o.project}\n${cloud ? 'Cloud services verified: ' + cloud.url : 'Cloud services not verified; see the setup report.'}`);
  const failed = results.some(r => r.status !== 'passed');
  if (failed) console.log('Some steps need attention. Rerun this same command after resolving the reported item; completed installs are reused.');
  if (o['start-learning'] && !o['no-login'] && !o['no-open'] && !o['project-only'] && created && jsonCommand('claude', ['auth', 'status'])?.loggedIn && process.stdin.isTTY) {
    console.log('\nStarting your first Claude learning session. T3 is also open; select Claude for its sessions.');
    command('claude', ['/vibe-wise:learn'], { cwd: o.project, allowFailure: true });
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
