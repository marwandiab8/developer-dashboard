# Milestone 2 deployment runbook

Target Firebase project:

    marwan-developer-dashboard

Current state: no deployment is authorized. The local working tree is ahead of the stale GitHub `main` branch and must pass pre-commit review before any release decision.

`CODEX_STATUS.md` records historical Functions, scheduler, and App Hosting deployment evidence from 2026-08-06. That evidence is useful history, but production was not reverified during the current remediation.

## Hard gates

Do not deploy until all conditions are true:

- GITHUB_READ_TOKEN is configured in Secret Manager.
- DASHBOARD_OWNER_UID is configured in Secret Manager.
- Functions lint passes.
- Functions typecheck passes.
- Functions tests pass.
- Functions build passes.
- Application lint passes.
- Full TypeScript check passes.
- Complete application tests pass.
- Firestore rules tests pass.
- Production build passes.
- Root production-only and full audits report zero high or critical vulnerabilities; the current release requires zero root vulnerabilities.
- Functions production-only and full audits are reviewed and report zero high or critical vulnerabilities; any residual lower-severity advisory is documented rather than hidden.
- The user explicitly approves the exact deployment scope.

A configured token is not deployment approval.

## Configure secrets interactively

    cd /home/marwan/Documents/developer-dashboard
    firebase functions:secrets:set GITHUB_READ_TOKEN --project marwan-developer-dashboard
    firebase functions:secrets:set DASHBOARD_OWNER_UID --project marwan-developer-dashboard

Do not put either value in the command, shell history, chat, source, or a report.

## Preflight

Confirm Firebase authentication and project access without exposing secrets:

    firebase login:list
    firebase projects:list

Run validation:

    npm --prefix functions run lint
    npm --prefix functions run typecheck
    npm --prefix functions test
    npm --prefix functions run build
    npm --prefix functions audit --omit=dev
    npm --prefix functions audit
    npm run lint
    npm run typecheck
    npm test
    npm run test:rules
    npm run build
    npm audit --omit=dev
    npm audit
    git diff --check

Stop on the first unexpected failed validation command. Audit commands may exit nonzero for documented lower-severity findings; inspect and record their exact counts, and stop for any high or critical result. Do not replace a failed aggregate suite with filtered passing tests.

## Deployment commands requiring explicit approval

Functions, including the scheduled job:

    firebase deploy --only functions:getGitHubConnectionStatus,functions:syncGitHubRepositories,functions:scheduledSyncGitHubRepositories --project marwan-developer-dashboard

The scheduled selector is:

    functions:scheduledSyncGitHubRepositories

Schedule:

    region: us-east4
    cron: 15 3 * * *
    timeZone: America/Toronto
    cadence: daily at 03:15 local time

Firestore rules and indexes, only if the final implementation changed them:

    firebase deploy --only firestore:rules,firestore:indexes --project marwan-developer-dashboard

App Hosting, only if separately approved:

    firebase deploy --only apphosting --force --project marwan-developer-dashboard

`--force` is required for the GitHub-linked App Hosting backend's non-interactive local-source rollout; it does not broaden the selected Firebase project or deployment scope. Do not combine scopes merely for convenience. Approval for Functions is not approval for rules, indexes, or App Hosting.

## Post-deployment verification

Use the owner account:

1. Sign in with the Firebase owner account.
2. Confirm GitHub reports connected without exposing the token.
3. Run the first Import GitHub Projects action.
4. Confirm public, private, archived, and forked repositories appear.
5. Confirm more than 100 repositories paginate when applicable.
6. Confirm counts and rate-limit state are safe.
7. Confirm imported projects retain the complete workbench.
8. Synchronize again and confirm no duplicates.
9. Rename-test by immutable repository ID when safe.
10. Confirm manual fields and related entities remain unchanged.

Use a different authenticated Firebase account:

1. Call connection status and expect permission-denied.
2. Call synchronization and expect permission-denied.
3. Confirm no private repository metadata is displayed or returned.

Use an unauthenticated session:

1. Call both callable endpoints.
2. Expect unauthenticated.
3. Confirm no status or repository metadata is returned.

Scheduled verification:

1. Confirm only one Cloud Scheduler job exists for scheduledSyncGitHubRepositories.
2. Confirm its region and time zone.
3. Confirm overlapping manual and scheduled runs produce one lease winner.
4. Confirm a successful scheduled day remains complete after a later manual failure and that a duplicate delivery skips without overwriting either audit.
5. Confirm a failed scheduled attempt may retry and the next day remains eligible.
6. Inspect only safe count, timing, lease, and rate-limit logs.
7. Do not print environment, secret, repository file, or authorization data.

## Failure behavior

- Authentication failure: stop and correct Firebase Auth configuration.
- Wrong owner: correct DASHBOARD_OWNER_UID through a new interactive secret version.
- Missing token: set GITHUB_READ_TOKEN interactively.
- Rate limit: wait until the reported reset time.
- Active lease: allow the existing run to finish or the lease to expire.
- Partial repository failures: preserve successful results and inspect safe categories only.
- Validation failure: do not deploy.

## Current next step

Complete the pre-commit release review of the current working tree. Do not rerun secret setup merely because the source is uncommitted: historical metadata indicates both secrets existed on 2026-08-06, while their current state would require a new read-only metadata check. A future deployment still requires explicit approval for its exact scopes.
