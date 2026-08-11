# Developer Dashboard architecture

## Purpose

Developer Dashboard is a personal external development brain. GitHub repositories are imported as project sources, not as a replacement for project ideas, tasks, sessions, decisions, prompts, notes, scratchpads, blockers, next actions, or generated context.

## Layers

### Browser application

- Next.js App Router routes and existing workbench UI
- Complete local repository and workbench access while signed out, while authentication is loading, or when Firebase is unavailable
- In-memory continuity plus an explicit persistence-degraded warning when browser storage rejects a write; durability is claimed only after a successful save
- Optional Firebase Authentication for cloud features
- UID-scoped Firestore-backed dashboard repository after safe migration/reconciliation
- Firebase Functions callable client in region us-east4
- No GitHub token, owner UID secret, GitHub API request, or direct privileged Firestore write

### Firebase Functions v2

- getGitHubConnectionStatus callable
- syncGitHubRepositories callable
- scheduledSyncGitHubRepositories scheduled function
- Firebase Auth verification and owner UID enforcement
- Secret Manager access
- GitHub API pagination, normalization, enrichment, and rate-limit handling
- Centralized GitHub import contract application
- Firestore lease, state, audit, project, and activity writes

### GitHub

- One read-only fine-grained personal access token
- All repositories visible to that token for its selected resource owner
- Metadata, Contents read-only, and Pull requests read-only access only
- No mutation, deployment, workflow dispatch, issue mutation, or repository configuration change

### Firestore

All GitHub synchronization data is scoped below:

    users/{uid}

Projects continue to use the existing user-scoped repository architecture. Synchronization control state and audit information are stored separately enough to recover from a partial run without corrupting project content.

Browser-writable Dashboard collections and migration/profile records are explicitly allowlisted by security rules. GitHub synchronization state, leases, gates, and audit runs are backend-controlled; browser clients cannot write those paths. Admin SDK Functions bypass client rules and remain responsible for backend state.

Realtime listeners are the authoritative cloud hydration stream. The Firestore adapter subscription does not start an independent bootstrap load; the provider subscribes before its optional guarded load. Listener snapshots have monotonic repository versions, bootstrap loads cannot replace an accepted listener snapshot, and writes do not perform an unguarded post-write full reload. While dependent projected actions finish, only the newest versioned deferred snapshot is retained and it becomes authoritative afterward; successive non-deferred snapshots advance in arrival order. This ordering is covered by deterministic automated tests; it was not physically reverified across devices in this remediation.

## Local-first and migration flow

1. The local repository hydrates independently of authentication.
2. Pristine seed data does not require migration.
3. Unmarked legacy user data and newer work after an acknowledgement require an explicit import or keep-cloud choice.
4. Import preserves local IDs and atomically creates only documents absent from Firestore.
5. A failed cloud action enters local fallback/reconciliation-required mode with a stable operation ID and guarded mutation contract.
6. When browser storage is writable, recovery is durably journaled. If it is not writable, the current projection remains available in memory for the tab and the UI explicitly reports that the latest work is not durably stored.
7. Initial seed-save failure cannot block readiness, and a later successful full-projection save clears the persistence-degraded state.
8. Cloud data cannot silently replace unacknowledged local work.

## Recovery replay contract

Every replayable mutation records the original and desired values for its changed fields. A Firestore transaction reads those guarded documents together with an immutable `users/{uid}/reconciliationReceipts/{operationId}` receipt:

- A matching receipt means the original write committed; replay completes without rewriting later remote data.
- Desired values already present with no receipt produce the receipt only.
- Original guarded values still present allow the mutation to apply once while unrelated remote fields are preserved.
- Diverged guarded values produce an explicit reconciliation conflict and no automatic write. Later journal items do not pass an unresolved earlier conflict.
- Whole-document deletion additionally requires every present remote field to have been represented in the recorded base; a newer remote-only field prevents automatic deletion.

Session-note appends retain their nested atomic receipt and serialized note-append behavior; the general mutation contract also protects any project-recency or activity changes in that action.

## On-demand status flow

1. Browser invokes getGitHubConnectionStatus.
2. Callable verifies Firebase Auth.
3. Callable compares request.auth.uid to DASHBOARD_OWNER_UID.
4. Callable reports configured or not configured without reading a token into the response.
5. When configured, the backend performs only the minimum safe connection or rate-limit check needed.
6. Callable returns safe connection, last-success, lease, and rate-limit metadata.

## On-demand synchronization flow

1. Browser invokes syncGitHubRepositories with no authoritative UID.
2. Callable verifies Firebase Auth and owner UID.
3. Backend acquires the shared transactional lease.
4. Backend identifies the authenticated GitHub login.
5. Backend retrieves all token-visible repositories across every page.
6. Bounded workers normalize repository metadata and practical enrichment.
7. Safe allowlisted configuration paths are fetched directly for Firebase project IDs; the worker never enumerates a repository source tree.
8. Each normalized repository passes Zod validation.
9. Existing projects are matched by immutable numeric GitHub repository ID.
10. The centralized Milestone 1 merge contract is applied.
11. Safe Firestore batches persist project and deterministic activity changes.
12. Per-repository failures are counted without discarding successful work.
13. A transaction finalizes synchronization state, creates the immutable attempt audit, and releases the lease.
14. Browser receives counts and safe rate-limit information only.

## Scheduled flow

scheduledSyncGitHubRepositories runs in us-east4 with:

    schedule: 15 3 * * *
    timeZone: America/Toronto

The job resolves the owner from DASHBOARD_OWNER_UID and uses the same worker, lease, merge policy, batching, and audit path as the callable. It has no browser authentication context, so it must not accept a caller-provided UID.

A successful scheduled run permanently records its day in `lastSuccessfulScheduledDayKey`, independently of the global last-run status. A later manual success or failure cannot erase that marker. Every acquired scheduled attempt receives a unique ID and an immutable completion/failure audit; a duplicate delivery for an already-completed day is skipped before creating an attempt and cannot overwrite the original successful audit. A failed scheduled attempt may retry, and the shared lease still serializes concurrent manual and scheduled deliveries.

Historical evidence in `CODEX_STATUS.md` records this scheduler as deployed and enabled on 2026-08-06. That remote state was not reverified during the current remediation. Any new deployment still requires explicit approval.

## Authentication boundary

On-demand requests require:

- A valid Firebase ID token
- request.auth.uid equal to DASHBOARD_OWNER_UID

Missing authentication returns unauthenticated. Any other authenticated UID returns permission-denied. Private repository metadata must never be returned to another UID.

Security rules remain a second boundary. Backend writes remain explicitly limited to the configured users/{uid} path.

## Import and merge boundary

The backend must import the central contract rather than reimplement field ownership. GitHub may update only namespaced source data and calculated external activity. Manual fields and all workbench entities remain protected.

Repositories that disappear or become inaccessible are never deleted. Existing projects remain usable and may carry unavailable synchronization status.

## Pagination and concurrency

- Repository pagination continues until GitHub indicates completion.
- Page size may be 100, but the implementation must support more than 100 repositories.
- Per-repository requests use bounded concurrency.
- Successful repository results survive unrelated failures.
- Rate exhaustion stops unsafe additional work and returns the reset time.
- Deterministic external activity and immutable scheduled attempt audits make safe retries non-duplicating; replayed Dashboard mutations additionally require a receipt or matching recorded base state rather than last-write-wins.

## Activity attribution

Latest personal commit data is used only when attributable to the authenticated GitHub login. Repository pushed or updated timestamps are labelled fallbacks. The source used for lastWorkedAt is retained in synchronization or event metadata. Repository-level activity is never labelled personal work.

## Firebase association detection

Allowed content paths are narrowly enumerated and requested directly. Secret files, arbitrary application files, and recursive repository trees are never requested. A complete scan with no evidence is `not_detected`; an incomplete scan with no evidence is `unknown`. Evidence stores a path and non-secret project ID only. Every positive automated association starts as detected, not confirmed, and neither absent nor partial evidence can downgrade a detected or manually confirmed association. Detection never initiates a Firebase write or deployment.

## Audit boundary

Operational audits contain counts, timings, trigger, scheduled day when applicable, rate-limit summary, and safe error category. Attempt records are immutable and are created atomically with completion/failure state. Lease ownership is maintained in synchronization state rather than copied into every run audit. Audits exclude tokens, authorization headers, private file contents, commit bodies, repository file bodies, and raw GitHub errors.
