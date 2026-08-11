# GitHub Import and Synchronization Contract (Milestone 2)

Status: implemented and released on GitHub `main`. Current validation and deployment evidence is recorded only in `CODEX_STATUS.md`; source text alone is not proof that a later change is live. The deployed backend inventory was reverified on 2026-08-11, while authenticated browser and physical cross-device behavior still require manual acceptance.

## Scope

The synchronization imports every repository visible to the configured read-only GitHub token:

- Public repositories
- Private repositories
- Archived repositories
- Forked repositories
- Internal repositories when the GitHub API and resource owner expose that visibility

There is no repository-selection screen, per-repository allowlist, or browser-side GitHub authorization flow. The server imports the complete repository set returned for the authenticated GitHub account and token.

A fine-grained personal access token is limited to one GitHub resource owner. Selecting All repositories covers all current and future repositories owned by that selected owner. A single token cannot cover personal repositories and repositories owned by multiple organizations at the same time. In this milestone, "all accessible repositories" means all repositories visible to the configured token for its selected resource owner. Supporting several resource owners requires a future multi-token design.

## External identity and normalized data

A GitHub repository is matched only by its immutable numeric repository ID at:

    project.externalSources.github.externalRepositoryId

Repository names and full names may change without creating a duplicate project. Normalized metadata includes:

- Owner login, repository name, and full name
- Repository URL and default branch
- Visibility, archived state, and fork state
- Description, primary language, and topics
- Created, updated, and pushed timestamps
- Open issue count and open pull-request count
- Latest personal commit timestamp and message when practical
- Synchronization timestamp and status
- Firebase association evidence
- Safe source provenance for calculated external activity

Every normalized payload is validated with Zod before the centralized GitHub merge contract is applied.

## Activity source and fallbacks

The activity source order is:

1. Latest commit attributable to the authenticated GitHub login
2. Repository pushed timestamp, labelled repository_pushed
3. Repository updated timestamp, labelled repository_updated
4. Unavailable when no safe timestamp exists

Fallback activity is repository-level activity. It must never be described as the owner's personal work. The selected source is retained in synchronization or activity-event metadata as lastWorkedAtSource so generated activity remains attributable.

Per-repository commit lookups use bounded concurrency and are skipped when repository timestamps make an additional request unnecessary or impractical.

## Protected merge policy

The implementation must call the existing centralized Milestone 1 merge contract. It must not duplicate or weaken that policy.

GitHub synchronization may update only GitHub-owned namespaced metadata and calculated external activity fields. It must preserve:

- Manual project title, purpose, status, objective, branch, blockers, and next actions
- Ideas and idea-to-task links
- Tasks and task state
- Notes and important links
- Development sessions
- Architecture decisions
- Codex prompts
- Scratchpads and brain dumps
- Manual activity history
- Resume and AI-context inputs
- Local progress timestamps and user-authored labels

A missing or inaccessible repository never causes project deletion. Existing projects are retained and may be marked unavailable through the existing synchronization status.

## Duplicate prevention and restart safety

- Immutable numeric GitHub repository ID is the sole external identity key.
- Re-importing the same ID updates the existing project.
- Renaming owner/name/full name never creates a second project.
- Source-attributed activity events use deterministic identity material so a retry does not duplicate them.
- Synchronization state is stored separately from project content below users/{uid}.
- Local migration preserves original IDs and uses bounded atomic create-if-absent transactions. A document that exists at transaction time is skipped without overwriting any remote field.
- Each repository result is independent so one failure does not discard successful results.
- A failed run retains enough state to resume safely.

## Authentication and owner restriction

Both on-demand callable functions:

- Verify Firebase Authentication on every request
- Reject a missing Firebase Auth context with unauthenticated
- Compare the authenticated UID to the server-side DASHBOARD_OWNER_UID value
- Reject any other UID with permission-denied
- Read and write only users/{uid} and its subcollections
- Never accept a UID from client request data as authority

Callable exports in region us-east4:

- getGitHubConnectionStatus
- syncGitHubRepositories

The client receives only normalized repository data or safe synchronization summaries. It never receives the GitHub token.

## Server-side secrets

Both values are stored in Firebase and Google Secret Manager and bound only to the Functions that need them:

- GITHUB_READ_TOKEN
- DASHBOARD_OWNER_UID

Neither value may enter browser code, NEXT_PUBLIC variables, Firestore, localStorage, logs, errors, status reports, fixtures, snapshots, or Git history.

## GitHub API behavior

- Request all token-visible repository metadata with pagination beyond 100 items.
- Use a bounded page limit and bounded per-repository concurrency.
- Preserve successful repository results when another repository request fails.
- Avoid unnecessary per-repository requests.
- Return rate-limit remaining, limit, resource, and reset time only.
- Convert rate exhaustion to a safe resource-exhausted callable error with a reset or retry time.
- Never include authorization headers, tokens, response bodies, config contents, commit patches, or private repository contents in errors or logs.

## Firebase association detection

Contents access is restricted to a small safe allowlist:

- .firebaserc
- firebase.json
- apphosting.yaml
- apphosting.yml
- .env.example
- .env.sample

Each candidate is requested directly by its exact allowlisted path. The worker must not enumerate recursive repository trees or request application source, secret environment files, .env.local, non-example .env files, service-account files, private keys, credentials, or arbitrary repository contents. Missing candidates proved by 404/409 are a complete no-evidence result and use `not_detected`. Inaccessible or failed candidates are non-fatal but make discovery partial; when partial discovery finds no positive evidence, the stored association status is `unknown`, never `not_detected`.

For App Hosting YAML, evidence is accepted only when a supported project-ID variable such as `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is paired with its literal `value` in the `env` list or supported inline equivalent. Unrelated environment values and malformed input are ignored.

Stored evidence contains only the safe source path and detected non-secret Firebase project ID. Associations are marked detected, never confirmed automatically. Detection must not trigger deployment, configuration changes, or writes to the discovered Firebase project. Repository-name similarity is not evidence.

## Synchronization lease

On-demand and scheduled runs share one transactional lease below the configured owner's users/{uid} tree.

- A run acquires a lease with run ID, acquisition time, and expiry.
- An unexpired lease prevents a second run and returns aborted.
- An expired lease may be reclaimed safely.
- Completion records outcome counts and releases or expires the lease.
- Deterministic external activity, unique attempt IDs, and immutable audit creation make retries non-duplicating without overwriting prior audit history.
- Scheduled synchronization remains disabled until an owner-triggered manual run successfully processes at least one repository. `firstSuccessfulManualImportAt` is write-once; failed, blocked, scheduled, or empty runs cannot enable the schedule gate.
- A successful scheduled run records `lastSuccessfulScheduledDayKey` independently of global last-run status. Later manual outcomes preserve it, duplicate delivery for that day skips, a failed scheduled attempt may retry, and the next day remains eligible.

The scheduled export is scheduledSyncGitHubRepositories in us-east4. Its cadence is 15 3 * * * with timeZone America/Toronto, once daily at 03:15 local time. Historical evidence records it deployed and enabled on 2026-08-06; that remote state was not reverified in this remediation. Any future rollout requires explicit approval.

## Safe audit information

Audits may include:

- Run ID and trigger type
- Start, completion, and duration
- Created, updated, unchanged, unavailable, and failed counts
- Scheduled day key when applicable
- Rate-limit summary
- Safe error category

Run audits are immutable per attempt and are created atomically with the corresponding completion or failure state. Audits must not contain secrets, the owner UID, authorization values, file contents, commit contents, private repository descriptions, or arbitrary upstream error bodies.

## Callable response contracts

Connection status returns:

    configured
    connected
    ownerLogin
    lastSuccessfulSyncAt
    lastSyncStatus
    synchronizationInProgress
    rateLimit
    statusMessage

Synchronization returns:

    runId
    startedAt
    completedAt
    created
    updated
    unchanged
    unavailable
    failed
    rateLimit

No callable response includes a token or secret-derived value.
