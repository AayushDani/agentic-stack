# Project working agreements

This is a learning project: a personal reading-list web app. The bootstrap creates
the starter and tooling; its cloud phase configures Supabase, PostHog, and Vercel.
Inspect .agentic-cloud-report.json for actual cloud verification status. Saving
links, user-facing authentication, and product-specific database rules remain
feature work even after infrastructure setup passes.

- Work on one small, reviewable behavior at a time. Explain unfamiliar concepts
  briefly and ask the learner to predict or inspect the result.
- Use VibeWise for learning, Matt Pocock's skills for engineering workflow,
  and Impeccable for interface design. Check which skills are available first.
- Use Context7 for version-specific documentation. Read package.json first.
- Keep the learner's notes in `learning/`. Do not claim that writing a note
  means the learner understands it.
- Keep credentials out of source control. `.env.example` documents configuration;
  local values belong in the ignored `.env.local` file.
- Run `npm run check` for changes that affect the app. Cloud setup adds verification
  endpoint tests; add meaningful tests for product behaviors as they are built.
  The browser smoke test only checks rendering and JavaScript exceptions.
- Report code built, service deployed, and connected behavior verified separately.
- The user authorized the setup script to create free-tier cloud resources and
  deploy this starter. That authorization does not include paid upgrades or
  publishing a repository. Respect the scope of subsequent feature requests.

## Agent skills

### Issue tracker

Local files for this practice project. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical workflow labels are recorded locally. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repository. See `docs/agents/domain.md`.
