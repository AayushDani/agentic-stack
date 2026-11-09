# One-command agentic development setup

Paste into Terminal on a fresh Mac. No Git, Node, or copied files are needed to
download the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/AayushDani/agentic-stack/main/install.sh | bash
```

The downloader fetches a versioned release, verifies its SHA-256 checksum, saves
the complete installer under `~/.local/share/agentic-stack/installers/`, and hands
control back to your Terminal for account and macOS prompts. It installs missing
Homebrew/Node prerequisites and preserves tool paths for future Terminal sessions.

This prepares the macOS tools and the project at `~/Developer/reading-list`, then
configures Supabase, PostHog, and Vercel. Existing installations and saved cloud
projects are reused. Browser sign-in pauses the command; it continues after login.
Run the same command again to resume after an interruption.

To resume only cloud setup, append arguments to bash:

```bash
curl -fsSL https://raw.githubusercontent.com/AayushDani/agentic-stack/main/install.sh | bash -s -- --cloud-only
```

Use `--download-only` as the first argument to fetch and verify files without
installing anything. `--dry-run` inspects the plan when Node is already available.
The installer supports macOS; Homebrew/app support determines the minimum OS
version. Account sign-ins, administrator permissions, provider quotas, and project
permissions still apply. A new Mac creates a new local starter; it does not restore
another Mac's application files or private cloud state.

## Automated work

- Homebrew/Node when needed; Git, GitHub CLI, Claude Code, T3 Code, Paper, Obsidian.
- Matt Pocock, VibeWise, Impeccable, Obsidian Skills, Paper plugins, and Context7 MCP.
- Next.js, TypeScript, Tailwind, shadcn, Supabase/PostHog SDKs, Vitest, Playwright.
- Project instructions, local tickets/docs, learning vault, T3 project actions,
  and a GitHub Actions check workflow.
- Supabase browser login, Free organization/project, generated database password,
  public SDK configuration, database verification function, and local CLI link.
- PostHog browser login and the project explicitly selected in that flow;
  automatic regional keys/SDK configuration and receipt of a verification event.
- Vercel browser login, Hobby project, encrypted environment variables, direct
  source deployment, and Supabase authentication redirect configuration.
- Local type/lint/unit/build/browser checks, then deployed browser/database/event
  checks. Completion requires the deployed test event to appear in PostHog.

## Sign-in and account boundaries

Use the account/project you intend for this practice app. PostHog's login flow
includes project selection; first-time accounts may require normal onboarding.
The script creates a dedicated Supabase organization named Agentic Learning on
Free and uses `us-east-1`. It chooses an unambiguous personal Vercel Hobby team;
`VERCEL_TEAM_ID` can select a different accessible Hobby team when necessary.
It never upgrades plans, purchases domains, or publishes a GitHub repository.
Cloudflare is outside this setup.

Provider quotas, missing permissions, interrupted provisioning, or an unavailable
service can stop a phase. The report identifies the failed action; rerunning
reconciles named resources and preserves modified files. A failure is never
reported as completed setup.

T3 provider settings are preserved: choose Claude when starting a session. Paper
may need its own sign-in. VibeWise learning preferences and Impeccable design
direction belong in the first agent session. Use `--start-learning` to open
Claude in VibeWise mode after setup; the default finishes and returns to Terminal.
Codex remains an optional reviewer and its settings are unchanged.

## Status, credentials, and reruns

`.agentic-setup-report.json` records local outcomes. `.agentic-cloud-report.json`
records cloud stages and the deployment URL. Neither includes credentials.
`.agentic-cloud.json` tracks resource IDs; `.agentic-cloud.private.json` and
`.env.local` contain credentials with owner-only permissions. All are ignored by
Git. The upload allowlist excludes local credentials, notes, reports, and dotfiles.
Only public SDK keys and a server-only check token are configured in Vercel;
management tokens and the database password stay on the Mac.

Supabase's management token stays in macOS Keychain. The script reads it once per
run and reuses it in memory. Credentialed Supabase child commands receive their
token/password through their environment and skip additional Keychain access;
browser login continues to use native credential storage. A denied Keychain read
stops with a clear message instead of triggering more prompts or another login.

If macOS asks to access the **Supabase CLI** item, this script's requester is
`security` (`/usr/bin/security`). Choosing **Allow Once** applies to that read;
**Always Allow**, if you trust this requester for this item, persists the permission
across runs. The script does not change Keychain access controls or copy the
management token into a plaintext file. The running website and normal local app
development use the project's SDK configuration and do not need this Keychain read.
See [Apple's explanation](https://support.apple.com/guide/keychain-access/kyca1243/mac).

An existing unmarked project is left untouched. Use `--project /absolute/path`
for a different managed starter. User-edited integration files or conflicting
environment values are preserved and reported rather than silently replaced.

- `--check` / `--dry-run`: read-only inspection / plan.
- `--local-only`: workstation and starter without cloud provisioning.
- `--cloud-only`: cloud phase for an already prepared starter.
- `--project-only`: local starter and checks, without workstation/account setup.
- `--no-login`: reuse credentials; report required sign-ins instead of prompting.
- `--no-open`: suppress opening workspaces and the final deployed URL.

The default cloud phase deploys infrastructure and a test round trip. Reading-list
features, user-facing authentication, and row-level database policies remain
product work. A successful infrastructure check does not establish those features.

## Validation and pinned tools

```bash
node --test setup/bootstrap.test.mjs setup/cloud.test.mjs distribution/download.test.mjs
```

The installer tests cover configuration preservation, credential boundaries,
deployment exclusions, and error handling. A separate temporary starter is used
for real type/lint/unit/build/Chromium checks. Live cloud verification happens
when the user runs the command with their accounts; it is not simulated into a
claim that services are connected.

Cloud CLIs are isolated in `~/.local/share/agentic-stack/cloud-tools`, pinned to
Supabase 3.0.0, PostHog 0.19.0, and Vercel 65.12.1. They are not app dependencies.
Package install scripts are disabled except the official PostHog binary installer.
Isolation does not make their upstream dependencies vulnerability-free. The
generated app's package-lock.json records its independently resolved versions.

## Official references

Checked November 8, 2026:

- [Homebrew](https://brew.sh/) and [Claude Code](https://code.claude.com/docs/en/quickstart)
- [T3 installation](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md)
- [Matt Pocock](https://github.com/mattpocock/skills), [VibeWise](https://github.com/nykooi1/vibe-wise),
  [Impeccable](https://impeccable.style/), [Obsidian Skills](https://github.com/kepano/obsidian-skills)
- [Paper MCP](https://paper.design/docs/mcp), [Context7](https://context7.com/docs/installation)
- [Next.js](https://nextjs.org/docs/app/getting-started/installation), [shadcn](https://ui.shadcn.com/docs/cli)
- [Supabase CLI](https://supabase.com/docs/reference/cli/introduction),
  [Supabase management API](https://api.supabase.com/api/v1)
- [PostHog CLI](https://posthog.com/docs/cli), [PostHog API](https://posthog.com/docs/api)
- [Vercel CLI API](https://vercel.com/docs/cli/api),
  [deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)
