import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = path.join(os.homedir(), '.local/share/agentic-stack/cloud-tools');
const TOOL_VERSIONS = { supabase: '3.0.0', '@posthog/cli': '0.19.0', vercel: '65.12.1' };
// --profile selects a built-in endpoint profile or a configuration-file path;
// it is not an arbitrary credential label. Use the CLI's normal login flow.
export const SUPABASE_LOGIN_ARGS = ['login'];
const HOSTS = new Set(['api.supabase.com', 'api.vercel.com', 'us.posthog.com', 'eu.posthog.com']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export class SetupError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export function jsonFile(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new SetupError(`Cannot read JSON configuration: ${file}. Existing file preserved.`); }
}
export function privateJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + crypto.randomBytes(5).toString('hex');
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}
export function redact(message) {
  return String(message).replace(/\b(?:sbp_|sb_secret_|phx_|phc_|vcp_|vcr_)[A-Za-z0-9_.-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}
export function run(cmd, args, { cwd, input, interactive = false, env = {} } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env }, stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) {
    // Command output can contain API keys or bodies. Keep it out of error reports.
    const httpStatus = /\(([45]\d{2})\)/.exec(r.stderr || '')?.[1];
    throw new SetupError(`${path.basename(cmd)} ${args[0] || ''} failed (${r.error?.code || r.status}).`, httpStatus ? Number(httpStatus) : undefined);
  }
  return r.stdout || '';
}
function bin(name) { return path.join(TOOL_DIR, 'node_modules/.bin', name); }
function ensureTools() {
  fs.mkdirSync(TOOL_DIR, { recursive: true });
  const installed = jsonFile(path.join(TOOL_DIR, 'package.json'), {});
  const missing = Object.entries(TOOL_VERSIONS).filter(([name, version]) =>
    installed.dependencies?.[name]?.replace(/^[~^]/, '') !== version || !fs.existsSync(path.join(TOOL_DIR, 'node_modules', name)));
  if (missing.length) run('npm', ['install', '--prefix', TOOL_DIR, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', ...missing.map(([n, v]) => `${n}@${v}`)], { interactive: true });
  try { run(bin('posthog-cli'), ['--version']); }
  catch { run(process.execPath, [path.join(TOOL_DIR, 'node_modules/@posthog/cli/install.js')], { interactive: true }); }
  for (const name of ['supabase', 'posthog-cli', 'vercel']) run(bin(name), ['--version']);
}
export function safeURL(origin, endpoint) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || !HOSTS.has(base.hostname) || base.username || base.password) throw new SetupError('Unrecognized cloud API host.');
  const url = new URL(endpoint, base);
  if (url.origin !== base.origin) throw new SetupError('Refusing to send credentials to a different host.');
  return url;
}
export async function api(origin, endpoint, token, method = 'GET', body) {
  const url = safeURL(origin, endpoint);
  let response;
  try {
    response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new SetupError(`Network request to ${url.hostname}${url.pathname} failed. Rerun to reconcile existing resources.`); }
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const help = response.status === 401 ? ' Sign in again.' : response.status === 403 ? ' The signed-in account lacks access or the required scope.' :
      response.status === 429 ? ' The service is rate-limiting this account.' : response.status === 402 ? ' The free tier or account quota cannot fulfill this request; no upgrade was made.' : '';
    throw new SetupError(`${url.hostname}${url.pathname}: HTTP ${response.status}.${help}`, response.status);
  }
  return data;
}
export function createSupabaseTokenReader({ env = process.env, home = os.homedir(), execute = spawnSync } = {}) {
  let cached;
  return ({ refresh = false } = {}) => {
    if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
    if (refresh) cached = undefined;
    if (cached !== undefined) return cached;
    for (const account of ['supabase', 'access-token']) {
      const r = execute('/usr/bin/security', ['find-generic-password', '-s', 'Supabase CLI', '-a', account, '-w'], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout?.trim()) {
        const value = r.stdout.trim();
        // Keep this token in process memory only; persistent storage stays in Keychain.
        cached = value.startsWith('go-keyring-base64:') ? Buffer.from(value.slice(18), 'base64').toString() : value;
        return cached;
      }
      // security exits 44 for an absent item. A denial/locked Keychain is not a
      // missing login: stop instead of probing another item and prompting again.
      if (r.status !== 44 && r.status !== 0) throw new SetupError('Supabase Keychain access was not granted. Approve the expected Supabase CLI item request from security, then resume. No browser re-login is needed.');
    }
    const file = path.join(env.SUPABASE_HOME || path.join(home, '.supabase'), 'access-token');
    cached = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() || null : null;
    return cached;
  };
}
export const supabaseToken = createSupabaseTokenReader();
export function supabaseCommandEnv(token, databasePassword) {
  // Only child commands that already have credentials get this flag. Browser
  // login still uses native Keychain storage; no credential file is created.
  return { SUPABASE_NO_KEYRING: '1', SUPABASE_ACCESS_TOKEN: token,
    ...(databasePassword ? { SUPABASE_DB_PASSWORD: databasePassword } : {}) };
}
function posthogCredentials() {
  const stored = jsonFile(path.join(os.homedir(), '.posthog/credentials.json'), {});
  const fromEnv = process.env.POSTHOG_CLI_API_KEY;
  const result = {
    token: fromEnv || stored.token,
    host: fromEnv ? (process.env.POSTHOG_CLI_HOST || 'https://us.posthog.com') : (stored.host || 'https://us.posthog.com'),
    projectId: fromEnv ? process.env.POSTHOG_CLI_PROJECT_ID : stored.env_id,
  };
  if (result.host === 'https://us.i.posthog.com') result.host = 'https://us.posthog.com';
  if (result.host === 'https://eu.i.posthog.com') result.host = 'https://eu.posthog.com';
  return result;
}
function vapi(endpoint, method = 'GET', body, scope) {
  // vercel api parses --input JSON but its client serializes only plain objects.
  // A top-level array reaches the server as invalid JSON in CLI 65.12.1.
  if (Array.isArray(body)) throw new SetupError('Vercel CLI requests require an object body. Send bulk entries individually.');
  const args = ['api', endpoint, '--method', method, '--raw'];
  if (scope) args.push('--scope', scope);
  if (body !== undefined) args.push('--input', '-');
  let output;
  try { output = run(bin('vercel'), args, { input: body === undefined ? undefined : JSON.stringify(body), env: { VERCEL_TELEMETRY_DISABLED: '1' } }); }
  catch (e) {
    const detail = e.status === 400 ? ' The API rejected the request format or values.' : e.status === 401 ? ' Sign in to Vercel again.' : e.status === 403 ? ' This account lacks permission for that action.' : '';
    throw new SetupError(`Vercel ${method} ${endpoint.split('?')[0]} failed${e.status ? ` (HTTP ${e.status})` : ''}.${detail}`, e.status);
  }
  try { return JSON.parse(output); } catch { throw new SetupError('Vercel returned an unexpected API response.'); }
}
export function configureVercelEnv(projectId, values, scope, request = vapi) {
  for (const [key, value] of Object.entries(values)) {
    const result = request(`/v10/projects/${projectId}/env?upsert=true`, 'POST',
      { key, value, type: 'encrypted', target: ['production', 'preview', 'development'] }, scope);
    // The API may report an entry failure in an otherwise successful HTTP response.
    if (result?.failed?.length || result?.error) throw new SetupError(`Vercel did not save ${key}. Environment configuration is incomplete.`);
    const created = Array.isArray(result?.created) ? result.created : [result?.created];
    if (!created.some(entry => entry?.key === key)) throw new SetupError(`Vercel did not confirm ${key}. Environment configuration is incomplete.`);
  }
}
export function posthogReceiptQuery(runId) {
  if (!/^[a-f0-9]{32}$/.test(runId)) throw new SetupError('Invalid analytics verification run ID.');
  return {
    // An initial zero can be cached while ingestion catches up. Each poll must
    // query fresh data and return a result, rather than an asynchronous job ID.
    refresh: 'force_blocking',
    query: { kind: 'HogQLQuery', query: `SELECT count() FROM events WHERE event = 'agentic_setup_verified' AND properties.setup_run_id = '${runId}'` },
  };
}
function signIn(name, cmd, args, o) {
  if (o['no-login'] || !process.stdin.isTTY) throw new SetupError(`${name} needs sign-in. Run the same setup command in Terminal to continue.`);
  console.log(`\nSign in to ${name} in the browser. Setup will continue automatically.`);
  run(cmd, args, { interactive: true });
}

export function patchEnv(text, values, previous = {}) {
  let lines = text.split('\n');
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) throw new SetupError('Invalid environment variable.');
    const indexes = lines.flatMap((line, i) => new RegExp(`^(?:export\\s+)?${key}\\s*=`).test(line) ? [i] : []);
    if (indexes.length > 1) throw new SetupError(`Duplicate ${key} in .env.local; existing file preserved.`);
    const encoded = JSON.stringify(value);
    if (indexes.length) {
      const raw = lines[indexes[0]].slice(lines[indexes[0]].indexOf('=') + 1).trim();
      let existing = raw;
      if (raw.startsWith('"')) { try { existing = JSON.parse(raw); } catch { /* preserve and reject below */ } }
      else if (raw.startsWith("'") && raw.endsWith("'")) existing = raw.slice(1, -1);
      if (existing && existing !== value && existing !== previous[key]) throw new SetupError(`${key} already belongs to a different configuration. Existing value preserved.`);
      lines[indexes[0]] = `${key}=${encoded}`;
    } else lines.push(`${key}=${encoded}`);
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}
export function deploymentFiles(project) {
  // An allowlist, independent of gitignore: never upload local credentials, notebooks,
  // reports, auth files, node_modules, or arbitrary untracked files.
  const roots = ['src', 'public'];
  const top = ['package.json', 'package-lock.json', 'next.config.ts', 'next.config.mjs', 'next.config.js', 'tsconfig.json', 'next-env.d.ts', 'postcss.config.mjs', 'postcss.config.js', 'eslint.config.mjs', 'components.json'];
  const files = [];
  const add = relative => {
    const file = path.join(project, relative);
    if (!fs.existsSync(file)) return;
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) throw new SetupError(`Deployment contains a symlink: ${relative}. No files uploaded.`);
    if (/^\.|\.(?:pem|key|p12|pfx)$|(?:credentials|secret)/i.test(path.basename(relative))) throw new SetupError(`Sensitive-looking file excluded from deployment: ${relative}.`);
    if (st.isDirectory()) { for (const name of fs.readdirSync(file).sort()) add(path.join(relative, name)); return; }
    if (st.size > 8 * 1024 * 1024) throw new SetupError(`Deployment file is too large for inline upload: ${relative}.`);
    files.push({ file: relative.split(path.sep).join('/'), data: fs.readFileSync(file).toString('base64'), encoding: 'base64' });
  };
  for (const relative of [...roots, ...top]) add(relative);
  if (JSON.stringify(files).length > 20 * 1024 * 1024) throw new SetupError('Starter exceeds the inline deployment size limit.');
  return files;
}
export function chooseHobbyTeam(teams, user, selected) {
  const eligible = teams.filter(t => t.billing?.plan === 'hobby');
  if (selected && !eligible.some(t => t.id === selected)) throw new SetupError('The saved or requested Vercel team is inaccessible or is not on Hobby. No other team was substituted.');
  const match = eligible.find(t => t.id === selected) || eligible.find(t => t.id === user.defaultTeamId) ||
    eligible.find(t => t.slug === user.username) || (eligible.length === 1 ? eligible[0] : null);
  if (!match) throw new SetupError('No unambiguous Vercel Hobby team is available. Select/create your personal Hobby team in Vercel, or set VERCEL_TEAM_ID. No paid plan was selected.');
  return match;
}
async function until(label, check, attempts = 90, interval = 4000) {
  for (let i = 0; i < attempts; i++) {
    const result = await check();
    if (result) return result;
    if (i % 5 === 0) console.log(`  Waiting for ${label}…`);
    await pause(interval);
  }
  throw new SetupError(`Timed out waiting for ${label}. Rerun the same command to resume.`);
}
function mergeBlock(file, content, label) {
  const start = `<!-- BEGIN:${label} -->`, end = `<!-- END:${label} -->`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(start)) return;
  fs.appendFileSync(file, `\n${start}\n${content}\n${end}\n`);
}
function installIntegration(project, state, save) {
  const root = path.join(HERE, 'cloud-templates');
  state.files ||= {};
  for (const relative of fs.readdirSync(root, { recursive: true })) {
    const from = path.join(root, relative);
    if (!fs.statSync(from).isFile()) continue;
    const target = path.join(project, relative), content = fs.readFileSync(from);
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (fs.existsSync(target)) {
      const current = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      if (current !== digest && current !== state.files[relative]) throw new SetupError(`${relative} has your changes. The setup will not replace them.`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content); state.files[relative] = digest; save();
  }
  mergeBlock(path.join(project, 'AGENTS.md'), fs.readFileSync(path.join(HERE, 'templates/AGENTS.md'), 'utf8'), 'agentic-working-agreements');
  mergeBlock(path.join(project, 'AGENTS.md'), 'Cloud resources and verification are recorded in .agentic-cloud-report.json. Never print credentials. Supabase and PostHog are configured in .env.local. Use the installed PostHog CLI for analytics queries. Cloud setup does not implement the reading-list product or its sign-in UI.', 'agentic-cloud');
  const notes = path.join(project, 'docs/cloud-setup.md');
  // Upgrade only the exact obsolete note generated by the earlier installer.
  if (!fs.existsSync(notes) || crypto.createHash('sha256').update(fs.readFileSync(notes)).digest('hex') === 'e88a05dbb07c2847a74eb1056ab5b3569bf20d645699d94ed3eec94455741938') {
    fs.mkdirSync(path.dirname(notes), { recursive: true });
    fs.copyFileSync(path.join(HERE, 'templates/docs/cloud-setup.md'), notes);
  }
}

export function acquireCloudLock(project) {
  const file = path.join(project, '.agentic-cloud.lock.json');
  const owner = crypto.randomBytes(16).toString('hex');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, owner }), { flag: 'wx', mode: 0o600 });
      return () => { if (jsonFile(file)?.owner === owner) fs.unlinkSync(file); };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const previous = jsonFile(file);
      if (!Number.isInteger(previous?.pid) || previous.pid < 1) throw new SetupError(`Unrecognized setup lock at ${file}. Existing file preserved.`);
      let alive = true;
      try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) throw new SetupError('Another cloud setup is already running for this project. Continue in that Terminal window.');
      fs.unlinkSync(file);
    }
  }
  throw new SetupError('Could not acquire the project setup lock. Rerun to continue.');
}
export async function setupCloud(o, hooks = {}) {
  if (!fs.existsSync(path.join(o.project, '.agentic-stack.json'))) throw new SetupError('Cloud setup requires the managed starter project.');
  const release = acquireCloudLock(o.project);
  try { return await setupCloudUnlocked(o, hooks); } finally { release(); }
}
async function setupCloudUnlocked(o, hooks) {
  const project = o.project;
  if (!fs.existsSync(path.join(project, '.agentic-stack.json'))) throw new SetupError('Cloud setup requires the managed starter project.');
  const ignore = path.join(project, '.gitignore');
  const ignored = fs.readFileSync(ignore, 'utf8');
  for (const rule of ['/.agentic-cloud*.json', '/.vercel/', '.env.local', '/supabase/.temp/']) if (!ignored.split('\n').includes(rule)) fs.appendFileSync(ignore, `\n${rule}\n`);
  const stateFile = path.join(project, '.agentic-cloud.json');
  const privateFile = path.join(project, '.agentic-cloud.private.json');
  const state = jsonFile(stateFile, { version: 1, id: crypto.randomBytes(6).toString('hex') });
  if (state.supabase?.id && !fs.existsSync(privateFile)) throw new SetupError('Saved cloud credentials are missing. Restore .agentic-cloud.private.json from your local backup before resuming; no project or password was replaced.');
  const secrets = jsonFile(privateFile, { dbPassword: crypto.randomBytes(30).toString('base64url'), probeToken: crypto.randomBytes(32).toString('hex') });
  const save = () => privateJSON(stateFile, state);
  save(); privateJSON(privateFile, secrets);
  state.name ||= `${path.basename(project).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 35)}-${state.id}`; save();
  const outcomes = [];
  const report = () => privateJSON(path.join(project, '.agentic-cloud-report.json'), {
    checkedAt: new Date().toISOString(), outcomes, project: state.name,
    supabaseProject: state.supabase?.id, posthogProject: state.posthog?.id,
    vercelProject: state.vercel?.id, deployment: state.deployment?.url,
    complete: outcomes.length === 6 && outcomes.every(x => x.status === 'passed'),
    note: 'Infrastructure setup and a test round trip. The reading-list feature and user-facing authentication flow are not implemented by this installer.',
  });
  const step = async (name, fn) => {
    console.log(`\n→ ${name}`);
    try { await fn(); outcomes.push({ name, status: 'passed' }); report(); }
    catch (e) { outcomes.push({ name, status: 'needs-attention', detail: redact(e.message) }); report(); throw e; }
  };
  const request = hooks.api || api;
  let sbToken, ph, scope;
  await step('Cloud command-line tools and sign-ins', async () => {
    ensureTools();
    if (!process.env.SUPABASE_ACCESS_TOKEN) console.log('  Reading Supabase sign-in from Keychain; macOS may identify the requesting tool as security.');
    sbToken = supabaseToken();
    try { if (!sbToken) throw new SetupError('Sign-in required.', 401); await request('https://api.supabase.com', '/v1/organizations', sbToken); }
    catch (e) {
      if (e.status !== 401) throw e;
      signIn('Supabase', bin('supabase'), SUPABASE_LOGIN_ARGS, o);
      sbToken = supabaseToken({ refresh: true });
      if (!sbToken) throw new SetupError('Supabase sign-in did not produce a readable credential.');
      await request('https://api.supabase.com', '/v1/organizations', sbToken);
    }
    ph = posthogCredentials();
    try { if (!ph.token || !ph.projectId) throw new SetupError('Sign-in required.', 401); await request(ph.host, `/api/projects/${encodeURIComponent(ph.projectId)}/`, ph.token); }
    catch (e) {
      if (e.status !== 401) throw e;
      signIn('PostHog (choose the project for this app during sign-in)', bin('posthog-cli'), ['login'], o);
      ph = posthogCredentials();
      if (!ph.token || !ph.projectId) throw new SetupError('PostHog sign-in did not select a project.');
      await request(ph.host, `/api/projects/${encodeURIComponent(ph.projectId)}/`, ph.token);
    }
    try { vapi('/v2/user'); } catch { signIn('Vercel', bin('vercel'), ['login'], o); vapi('/v2/user'); }
  });
  await step('Supabase project, database probe, and local link', async () => {
    const orgs = await request('https://api.supabase.com', '/v1/organizations', sbToken);
    let org = state.supabaseOrg ? orgs.find(x => (x.slug || x.id) === state.supabaseOrg) : orgs.find(x => x.name === 'Agentic Learning');
    if (state.supabaseOrg && !org) throw new SetupError('Previously selected Supabase organization is inaccessible. Sign in to the original account to resume.');
    if (!org) org = await request('https://api.supabase.com', '/v1/organizations', sbToken, 'POST', { name: 'Agentic Learning' });
    state.supabaseOrg = org.slug || org.id; save();
    const detail = await request('https://api.supabase.com', `/v1/organizations/${state.supabaseOrg}`, sbToken);
    if (detail.plan !== 'free') throw new SetupError('Supabase organization is not confirmed on the Free plan. No paid project was created.');
    const projects = await request('https://api.supabase.com', '/v1/projects', sbToken);
    let remote = projects.find(x => state.supabase?.id ? x.id === state.supabase.id : (x.name === state.name && (x.organization_slug || x.organization_id) === state.supabaseOrg));
    if (state.supabase?.id && !remote) throw new SetupError('Previously linked Supabase project is missing or inaccessible. Refusing to create a duplicate.');
    if (!remote) remote = await request('https://api.supabase.com', '/v1/projects', sbToken, 'POST', {
      name: state.name, organization_slug: state.supabaseOrg, db_pass: secrets.dbPassword, region: 'us-east-1',
    });
    state.supabase = { id: remote.id }; save();
    await until('Supabase to become healthy', async () => {
      const p = await request('https://api.supabase.com', `/v1/projects/${remote.id}`, sbToken);
      if (['CREATE_FAILED', 'REMOVED', 'RESTORE_FAILED'].includes(p.status)) throw new SetupError(`Supabase provisioning failed: ${p.status}.`);
      return p.status === 'ACTIVE_HEALTHY';
    });
    const keys = await request('https://api.supabase.com', `/v1/projects/${remote.id}/api-keys?reveal=true`, sbToken);
    const key = keys.find(k => k.type === 'publishable' && k.api_key) || keys.find(k => k.name === 'anon' && k.api_key);
    if (!key) throw new SetupError('Supabase did not return a public client key.');
    secrets.supabaseURL = `https://${remote.id}.supabase.co`; secrets.supabaseKey = key.api_key; privateJSON(privateFile, secrets);
    await request('https://api.supabase.com', `/v1/projects/${remote.id}/database/query`, sbToken, 'POST', {
      query: 'create or replace function public.agentic_setup_ping() returns boolean language sql stable security invoker set search_path = pg_catalog as $$ select true $$; grant execute on function public.agentic_setup_ping() to anon, authenticated;',
    });
    if (!fs.existsSync(path.join(project, 'supabase/config.toml'))) run(bin('supabase'), ['init', '--yes'], { cwd: project, env: supabaseCommandEnv(sbToken) });
    run(bin('supabase'), ['link', '--project-ref', remote.id, '--yes'], { cwd: project, env: supabaseCommandEnv(sbToken, secrets.dbPassword) });
    fs.mkdirSync(path.join(project, 'supabase/migrations'), { recursive: true });
    const migration = path.join(project, 'supabase/migrations/20261108000000_setup_probe.sql');
    if (!fs.existsSync(migration)) fs.writeFileSync(migration, 'create or replace function public.agentic_setup_ping() returns boolean language sql stable security invoker set search_path = pg_catalog as $$ select true $$;\ngrant execute on function public.agentic_setup_ping() to anon, authenticated;\n');
  });
  await step('PostHog project and application integration', async () => {
    // The browser login explicitly scopes the credential to a project. Respect it;
    // don't create an inaccessible duplicate with the project-scoped credential.
    const selected = await request(ph.host, `/api/projects/${encodeURIComponent(ph.projectId)}/`, ph.token);
    if (state.posthog?.id && String(state.posthog.id) !== String(selected.id)) throw new SetupError('PostHog login selected a different project from the saved setup. Sign in to the original project to resume.');
    if (!selected.api_token) throw new SetupError('PostHog did not return the project ingestion key.');
    state.posthog = { id: selected.id, host: ph.host }; save();
    secrets.posthogKey = selected.api_token;
    secrets.posthogHost = new URL(ph.host).hostname === 'eu.posthog.com' ? 'https://eu.i.posthog.com' : 'https://us.i.posthog.com';
    const values = { NEXT_PUBLIC_SUPABASE_URL: secrets.supabaseURL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secrets.supabaseKey,
      NEXT_PUBLIC_POSTHOG_KEY: secrets.posthogKey, NEXT_PUBLIC_POSTHOG_HOST: secrets.posthogHost, SETUP_CHECK_TOKEN: secrets.probeToken };
    const envFile = path.join(project, '.env.local');
    const previous = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    const next = patchEnv(previous, values, secrets.previousEnv || {});
    if (previous && next !== previous) fs.writeFileSync(envFile + '.agentic-backup', previous, { mode: 0o600 });
    fs.writeFileSync(envFile, next, { mode: 0o600 }); fs.chmodSync(envFile, 0o600);
    secrets.previousEnv = values; privateJSON(privateFile, secrets);
    installIntegration(project, state, save);
    run('npm', ['run', 'check'], { cwd: project, interactive: true });
  });
  await step('Vercel project and encrypted environment configuration', async () => {
    const user = vapi('/v2/user').user;
    const teams = vapi('/v2/teams?limit=100').teams;
    const team = chooseHobbyTeam(teams, user, state.vercel?.teamId || process.env.VERCEL_TEAM_ID);
    scope = team.slug;
    let remote;
    if (state.vercel?.id) remote = vapi(`/v9/projects/${state.vercel.id}`, 'GET', undefined, scope);
    else remote = vapi(`/v10/projects?limit=100&search=${encodeURIComponent(state.name)}`, 'GET', undefined, scope).projects.find(p => p.name === state.name);
    if (!remote) remote = vapi('/v11/projects', 'POST', { name: state.name, framework: 'nextjs', publicSource: false,
      ssoProtection: null, buildCommand: 'npm run build', installCommand: 'npm ci' }, scope);
    state.vercel = { id: remote.id, teamId: team.id, slug: scope }; save();
    configureVercelEnv(remote.id, secrets.previousEnv, scope);
    privateJSON(path.join(project, '.vercel/project.json'), { projectId: remote.id, orgId: team.id, projectName: state.name });
  });
  await step('Vercel deployment', async () => {
    const files = deploymentFiles(project);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(files)).update(JSON.stringify(secrets.previousEnv)).digest('hex');
    const recent = vapi(`/v6/deployments?projectId=${state.vercel.id}&limit=100`, 'GET', undefined, scope).deployments;
    let deployment = recent.find(d => d.meta?.agenticSetup === state.id && d.meta?.sourceHash === fingerprint && !['ERROR', 'CANCELED'].includes(d.state || d.readyState));
    if (!deployment && state.deployment?.fingerprint === fingerprint) {
      const saved = vapi(`/v13/deployments/${state.deployment.id}`, 'GET', undefined, scope);
      if (!['ERROR', 'CANCELED'].includes(saved.readyState)) deployment = saved;
    }
    if (!deployment) deployment = vapi('/v13/deployments', 'POST', { name: state.name, project: state.vercel.id, target: 'production', files,
      projectSettings: { framework: 'nextjs', buildCommand: 'npm run build', installCommand: 'npm ci', nodeVersion: '24.x' },
      meta: { agenticSetup: state.id, sourceHash: fingerprint } }, scope);
    state.deployment = { id: deployment.id || deployment.uid, url: `https://${deployment.url}`, fingerprint }; save();
    await until('Vercel build', async () => {
      const d = vapi(`/v13/deployments/${state.deployment.id}`, 'GET', undefined, scope);
      if (['ERROR', 'CANCELED'].includes(d.readyState)) throw new SetupError(`Vercel build ${d.readyState.toLowerCase()}. Inspect the deployment in Vercel; setup is not complete.`);
      return d.readyState === 'READY';
    }, 120, 5000);
    const current = await request('https://api.supabase.com', `/v1/projects/${state.supabase.id}/config/auth`, sbToken);
    const redirects = new Set((current.uri_allow_list || '').split(',').filter(Boolean));
    redirects.add('http://localhost:3000/**'); redirects.add(`${state.deployment.url}/**`);
    await request('https://api.supabase.com', `/v1/projects/${state.supabase.id}/config/auth`, sbToken, 'PATCH', { site_url: state.deployment.url, uri_allow_list: [...redirects].join(',') });
  });
  await step('Deployed browser, database round trip, and analytics receipt', async () => {
    const require = createRequire(path.join(project, 'package.json'));
    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const response = await page.goto(state.deployment.url, { waitUntil: 'networkidle', timeout: 60_000 });
      if (response?.status() !== 200 || !(await page.locator('main').isVisible()) || errors.length) throw new SetupError('The deployed homepage did not pass its browser check.');
    } finally { await browser.close(); }
    const runId = crypto.randomBytes(16).toString('hex');
    const response = await fetch(`${state.deployment.url}/api/agentic-setup-check`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Token': secrets.probeToken }, body: JSON.stringify({ runId }), signal: AbortSignal.timeout(30_000) });
    const body = await response.json();
    if (!response.ok || body.database !== true || body.analyticsAccepted !== true) throw new SetupError('Deployed service round trip failed. Deployment exists but connected behavior is not verified.');
    await until('the deployed test event to appear in PostHog', async () => {
      const result = await request(ph.host, `/api/projects/${state.posthog.id}/query/`, ph.token, 'POST', posthogReceiptQuery(runId));
      return Number(result.results?.[0]?.[0]) > 0;
    }, 45, 4000);
    state.verifiedAt = new Date().toISOString(); save();
  });
  console.log(`\nCloud setup verified: ${state.deployment.url}`);
  if (!o['no-open']) run('open', [state.deployment.url]);
  return { url: state.deployment.url, report: path.join(project, '.agentic-cloud-report.json') };
}
