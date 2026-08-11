# Setup and runbook

## Prerequisites

- Node.js 20 or the Functions runtime version declared by the repository
- npm
- Firebase CLI authenticated to the intended account
- Access to Firebase project marwan-developer-dashboard
- A Firebase Authentication user for the dashboard owner
- A read-only fine-grained GitHub token created according to docs/FIREBASE_SETUP.md
- A unique purpose-limited Codex ingestion credential kept in Secret Manager and a trusted local secret store

## Application setup

    cd /home/marwan/Documents/developer-dashboard
    npm install
    npm run dev

Open http://localhost:3000.

The complete Dashboard remains available in local mode without signing in. Authentication enables UID-scoped Firestore persistence, migration/reconciliation, and GitHub synchronization; it is not a prerequisite for Quick Capture or the workbench. If browser storage rejects a local write, the latest projection remains usable in the current tab and the shell warns that it is not durably stored. A later successful local write saves the full projection and clears that degraded status.

## Functions setup

    cd /home/marwan/Documents/developer-dashboard/functions
    npm install

Do not add a GitHub token, Codex ingestion credential, or owner UID to a local environment file for convenience. Authentication tests must use mocks or emulator-safe fixtures, never a real credential.

## Required validation before deployment

Run from the repository root unless a command changes directory:

    npm run lint
    npm run typecheck
    npm test
    npm run test:rules
    npm run build
    npm --prefix functions run lint
    npm --prefix functions run typecheck
    npm --prefix functions test
    npm --prefix functions run build
    npm audit --omit=dev
    npm audit
    npm --prefix functions audit --omit=dev
    npm --prefix functions audit
    git diff --check

If the final package scripts use different Functions command names, use the checked-in scripts as the source of truth and record their exact output in CODEX_STATUS.md. Audit commands can exit nonzero for documented lower-severity findings; any high or critical finding remains a release stop.

No validation result is considered passed until the command exits successfully. A filtered passing test is not a substitute for the complete suite.

## Credential setup and historical state

Follow docs/FIREBASE_SETUP.md. Store server-side values through interactive prompts:

    firebase functions:secrets:set GITHUB_READ_TOKEN --project marwan-developer-dashboard
    firebase functions:secrets:set DASHBOARD_OWNER_UID --project marwan-developer-dashboard
    firebase functions:secrets:set CODEX_INGEST_TOKEN --project marwan-developer-dashboard

Never paste any secret value into Codex or chat.

Historical read-only metadata checks dated 2026-08-06 recorded only GITHUB_READ_TOKEN and DASHBOARD_OWNER_UID as enabled. They did not include CODEX_INGEST_TOKEN and were not reverified in the current remediation; do not infer current production state from local source alone.

## Codex reporting helper

The shared helper is dependency-free and can be called from another repository by absolute path:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs complete --file /path/to/codex-session.json

It requires `DEVELOPER_DASHBOARD_CODEX_INGEST_URL` and `DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN` in the process environment. Load the credential through a non-echoing prompt or trusted local secret-store integration; never pass it as a command argument. The helper also accepts the report on stdin:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs complete < /path/to/codex-session.json

See `docs/CODEX_SESSION_INGESTION.md` for the exact payload and the copyable per-project `AGENTS.md` instruction. Reporting is automatic only for projects that opt in to that instruction and provide the environment safely.

## Manual local checks

Without real credentials, verify mocked states for:

- Connection checking
- Not configured
- Wrong owner authorization
- First import
- Subsequent synchronization
- Loading and overlapping-run states
- Rate-limit reset guidance
- Partial result counts
- Public, private, archived, and forked badges
- Repository links and synchronization status
- Manual project cards with no GitHub metadata
- Valid, missing, and invalid Codex ingestion authentication using fixtures only
- Exact Dashboard ID, GitHub numeric ID, and normalized full-name project resolution
- Identical Codex session retry with unchanged IDs and no duplicate visible records
- Codex continuity protection after a manual objective, blocker, or next-step edit

## Deployment gate

Do not deploy Functions, Firestore rules, Firestore indexes, Cloud Scheduler jobs, or App Hosting until:

1. Current secret metadata required by the selected deployment scope is checked without accessing values.
2. All required validation passes for the exact source to deploy.
3. The intended Firebase project and deployment scopes are confirmed.
4. The user explicitly approves that deployment.

Historical 2026-08-06 deployments do not authorize a new rollout. See `docs/DEPLOYMENT.md` and `CODEX_STATUS.md`.
