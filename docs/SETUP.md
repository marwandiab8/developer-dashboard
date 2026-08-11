# Setup and runbook

## Prerequisites

- Node.js 20 or the Functions runtime version declared by the repository
- npm
- Firebase CLI authenticated to the intended account
- Access to Firebase project marwan-developer-dashboard
- A Firebase Authentication user for the dashboard owner
- A read-only fine-grained GitHub token created according to docs/FIREBASE_SETUP.md

## Application setup

    cd /home/marwan/Documents/developer-dashboard
    npm install
    npm run dev

Open http://localhost:3000.

The complete Dashboard remains available in local mode without signing in. Authentication enables UID-scoped Firestore persistence, migration/reconciliation, and GitHub synchronization; it is not a prerequisite for Quick Capture or the workbench. If browser storage rejects a local write, the latest projection remains usable in the current tab and the shell warns that it is not durably stored. A later successful local write saves the full projection and clears that degraded status.

## Functions setup

    cd /home/marwan/Documents/developer-dashboard/functions
    npm install

Do not add a GitHub token or owner UID to a local environment file for convenience. Callable authentication tests must use mocks or emulator-safe fixtures, never the real token.

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

Follow docs/FIREBASE_SETUP.md. Store both values through interactive prompts:

    firebase functions:secrets:set GITHUB_READ_TOKEN --project marwan-developer-dashboard
    firebase functions:secrets:set DASHBOARD_OWNER_UID --project marwan-developer-dashboard

Never paste either value into Codex or chat.

Historical read-only metadata checks dated 2026-08-06 recorded both secret versions as enabled. They were not reverified in the current remediation; do not infer current production state from local source alone.

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

## Deployment gate

Do not deploy Functions, Firestore rules, Firestore indexes, Cloud Scheduler jobs, or App Hosting until:

1. Current secret metadata is checked without accessing values.
2. All required validation passes for the exact source to deploy.
3. The intended Firebase project and deployment scopes are confirmed.
4. The user explicitly approves that deployment.

Historical 2026-08-06 deployments do not authorize a new rollout. See `docs/DEPLOYMENT.md` and `CODEX_STATUS.md`.
