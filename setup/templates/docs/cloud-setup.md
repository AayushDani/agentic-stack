# Cloud connections

The one-command setup handles Supabase, PostHog, and Vercel after browser sign-in.
Rerun the same command to resume. See `.agentic-cloud-report.json` for the current
status: installed tools, a deployed site, and verified connections are separate
milestones.

- Supabase: a dedicated Free organization/project, public client configuration,
  browser/server helpers, a database probe, and local CLI link.
- PostHog: the project selected during browser login, regional ingestion settings,
  pageview tracking, and a test event whose arrival is checked through the API.
- Vercel: a Hobby project, encrypted environment settings, and a production
  deployment of the starter. No GitHub repository is published or required.

The script uses the US region for a new Supabase project. PostHog follows the
region selected at sign-in. It never upgrades a plan to get around a quota.
Account onboarding, organization permissions, and exhausted quotas can require
action in the provider dashboard; the script reports that failure and can resume.

Credentials belong in ignored `.env.local` and `.agentic-cloud.private.json`.
Never print or commit them. The public Supabase and PostHog SDK keys are intended
for browser use. Management tokens and database passwords are not uploaded to
Vercel or bundled into the client. The private setup-check token is server-only.

The connected check calls a harmless database function and records one analytics
event. This does not implement saving links or a user-facing sign-in flow. Build
those features with appropriate row-level policies, token refresh, and tests
using two different accounts.

Official references:

- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [PostHog CLI and browser login](https://posthog.com/docs/cli)
- [Vercel API through its authenticated CLI](https://vercel.com/docs/cli/api)
