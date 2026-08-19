# CODEX_STATUS

Current record date: 2026-08-19

This is the sole current operational and release-status record. `CODEX-STATUS.md` is an obsolete pointer only.

## Local shared-workflow candidate — not deployed

- The current dirty working tree contains the schema version 2 shared Idea → Task → ChatGPT prompt → Codex work-session workflow, task/project timelines and active-time totals, task detail route, simplified navigation/dashboard/project surfaces, and an OAuth-protected bounded MCP resource server.
- Existing local-first storage, Firebase Authentication, UID-scoped Firestore, rules, GitHub synchronization ownership, routes, and Codex ingestion are extended rather than replaced. The local migration preserves legacy status values and document IDs.
- The MCP implementation is not connected to ChatGPT. No OAuth provider/client was configured, no secret was created, no Function/rules/frontend was deployed, and no authenticated live MCP tool call has occurred.
- Production migration remains prohibited until explicit approval. The migration and rollback plan is `docs/MIGRATION_V2.md`; OAuth setup and the connection gate are `docs/CHATGPT_MCP.md`.
- Local verification is complete and recorded below. The only visible local warning is the expected Firebase-configuration banner because this preview intentionally has no Firebase environment values; local mode remains usable.

## Local shared-workflow validation — 2026-08-19

- Root `npm run lint`: exit 0 with no warnings.
- Root `npm run typecheck`: exit 0.
- Root `npm test`: exit 0; 24 files passed, the emulator-only rules file was skipped, 272 tests passed, and 8 were skipped.
- Root `npm run test:rules`: exit 0; all 8 Firestore emulator authorization and ownership tests passed.
- Root `npm run build`: exit 0; Next.js 16.3.0 produced all 9 routes, including the new task-detail route.
- Functions `npm run lint`: exit 0 with the existing pages-directory rule notice.
- Functions `npm run typecheck`: exit 0.
- Functions `npm test`: exit 0; all 8 compiled suites passed, including MCP authorization/input/idempotency and extended Codex-ingestion coverage.
- Functions `npm run build`: exit 0.
- Desktop browser verification passed for Home, Projects, Project Overview, Project Timeline, Ideas, and task detail/completed states.
- Mobile browser verification passed at 390 x 844 for Home, Project, and task detail.
- Browser interaction checks passed for idea conversion, start/pause work, task completion, and reopening to Ready.
- Every checked page had zero application console errors, overlays, horizontal overflow, raw internal event names, duplicate menus, or unlabeled visible controls. Keyboard focus was visibly rendered.
- Non-failing validation noise was limited to existing React test `act(...)` warnings, expected Firestore rule-denial logs, the Firebase CLI `punycode` deprecation, the Functions lint notice above, and external headless-Chrome service logs that were not page console errors.

## Current working-tree status

- Confirmed branch: `main`.
- Automatic Codex session ingestion release commit `b302e8dd4dd80d2f5b35ddc52ff3fcf669ff5c96` (`feat: add automatic Codex session ingestion`) is on local `main` and `origin/main`. It follows project-route hotfix `75e519d706e1ee54f87dd5ced5767342096cb699` and validated Firebase/GitHub release commit `04c02a6a572ae728dfdbc39f9ae651db6ca1a62d`.
- The automatic Codex session ingestion Function, backend-only Firestore rules, and App Hosting frontend are deployed to `marwan-developer-dashboard`. The exact production evidence is recorded below.
- Firebase Authentication, UID-scoped Firestore persistence, signed-out local mode, safe local migration, App Hosting, and owner-only GitHub synchronization remain part of the released baseline.
- Remediation Pass 2 adds legacy-local-data protection, durable and ordered local fallback after failed cloud actions, atomic create-if-absent migration, immutable session-note reconciliation receipts, backend-only synchronization rules, bounded direct-path GitHub configuration discovery with explicit partial/unknown results, and release-document reconciliation.
- Remediation Pass 3 hardens account-scoped recovery isolation, UID-switch and stale-auth guards, revision-aware import/keep-cloud decisions, invocation-ordered cloud replay, deferred realtime snapshots during dependent queued actions, Firestore parent-recency consistency, GitHub synchronization transaction conflicts, and concurrent rate-limit metadata merging.
- Remediation Pass 4 resolves the seven final-review P2 blocker groups listed below, plus the focused authenticated-UID reset and manual `currentBranch` ownership regressions.
- Remediation Pass 5 resolves the four confirmed final blockers listed below: atomic local payload/revision durability, pending-mutation recovery projection, observable Quick Capture acceptance, and fatal GitHub enrichment rate exhaustion.
- `CODEX_INGEST_TOKEN` version 1 is enabled in Secret Manager. Only metadata was displayed; the value was passed transiently to the helper and was never printed, logged, stored in Git, or written to an application data record.
- Live endpoint checks and one synthetic transaction verify authenticated creation followed by an idempotent duplicate response. An independent production Firestore count was intentionally not attempted because the available CLI has no safe query command and no separately authenticated read-only Firestore client; authenticated UI confirmation of the visible cards remains a manual acceptance check.
- Automated repository, rules, and ordering tests are not physical cross-device validation.

## Remediation Pass 4 — seven final-review findings

1. **Local persistence failure:** signed-out/local writes now retain a dedicated unscoped in-memory projection even if browser persistence rejects a save. It survives authentication-status/UID reruns without containing UID-scoped cloud recovery data, stale local loads/listeners are bypassed while degraded, readiness completes after initial seed-save failure, and the UI warns without claiming durability. Only a later successful full ordinary-local save restores durable status and listener behavior.
2. **Conflict-safe recovery replay:** every replayable Dashboard mutation journals its original guarded fields, desired fields, and a deterministic contract fingerprint. Firestore transactions use immutable operation receipts and field-level base checks to distinguish a never-committed write, an already-applied write, and later remote divergence. Already-reflected work is acknowledged without rewriting; safe base matches apply once; divergence remains reconciliation-required and blocks later queued replay from passing it. A guarded whole-document delete also refuses any remote field absent from its recorded base. Existing atomic session-note receipts remain in force.
3. **Snapshot ordering:** Firestore adapter subscriptions no longer start their own independent bootstrap load. The provider subscribes before its optional guarded load; accepted listener snapshots carry monotonic versions, so an older load cannot replace them. Post-write full reloads were removed, the newest versioned listener snapshot deferred during queued writes becomes authoritative afterward, and repository state cannot regress behind the latest accepted authoritative snapshot/projection.
4. **Exact authored whitespace:** Firestore hydration separates machine-field normalization from authored prose and Markdown. Reducer, Quick Capture, scratchpad append, and project-detail submission paths validate nonblank input without trimming persisted authored content. Notes, prompts, scratchpads, brain dumps, decisions, task details, session notes, and other authored text preserve leading/trailing whitespace, blank lines, indentation, and line breaks exactly.
5. **Scheduled GitHub deduplication:** successful scheduled completion is recorded independently as `lastSuccessfulScheduledDayKey`; later manual outcomes cannot erase it. Scheduled attempts have unique IDs, immutable audit records are created atomically with state completion/failure, same-day duplicates skip without overwriting history, failed scheduled attempts remain retryable, and the shared lease still protects concurrency.
6. **Root high advisories:** compatible lockfile updates moved `nanoid` from 3.3.16 to 3.3.18 and `js-yaml` from 4.3.0 to 4.3.1. No override, forced audit fix, framework major, or React/Next compatibility change was required.
7. **Authoritative documentation:** this record and the affected architecture, data-model, security, setup, deployment, compliance, roadmap, GitHub-contract, and README claims now distinguish current local evidence from unverified production and historical 2026-08-06 evidence.

Focused observations were also closed: `GitHubSyncPanel` remounts its state when the authenticated UID changes, and the GitHub ownership contract explicitly protects a manually managed project's `currentBranch` while allowing namespaced GitHub `defaultBranch` metadata to refresh.

## Remediation Pass 5 — four confirmed final blockers

1. **Atomic local payload and marker durability:** localStorage saves now use a fingerprint-bound prepare -> payload -> final-marker protocol. The payload is never touched if preparation fails; a payload failure restores the exact prior marker; an unconfirmable rollback or failed final-marker write retains an explicit pending revision. Reload promotes a pending revision only when its fingerprint matches the stored payload, and no pending transaction can be treated as cloud-acknowledged. Existing Phase 1A payloads and timestamp-only markers remain readable.
2. **Pending cloud recovery projection:** one `buildRecoveryProjection(remoteBase, pendingMutations)` rule overlays ordered mutation contracts on every raw cloud base while preserving unrelated remote fields and stable IDs. Current-tab in-memory entries protect the projection if a later journal read fails. Already-arrived/deferred snapshots cannot roll back a newly acknowledged write, while the first later raw snapshot becomes authoritative so newer cloud edits are not masked. Failed or conflicting journal entries remain visible and reconciliation-required in invocation order.
3. **Observable Quick Capture acceptance:** `runQuickCapture` now returns an awaited `MutationResult`, validates without throwing, rejects not-ready/auth-transition no-ops before reduction or persistence, and reports storage failures explicitly. The dialog disables Save while data is not ready but still checks the returned result to close the race; it preserves the exact draft and error on failure and clears/closes or reports `Saved` only for `{ ok: true }`.
4. **Fatal GitHub enrichment rate exhaustion:** authoritative rate-limit responses are latched with the best known reset/remaining/limit metadata. Pull, commit, and safe-config enrichment propagate `rate_limited`; bounded workers stop scheduling new work after exhaustion, wait only for already-started calls, and abort before partial persistence or first-import gates. Manual callers retain the sanitized `resource-exhausted` contract, while failed manual and scheduled attempts release lease state and never mark synchronization successful.

## Automatic Codex session ingestion release candidate

1. **Owner-scoped HTTPS boundary:** `ingestCodexSession` is a Firebase Functions v2 `onRequest` export in `us-east4`. It accepts POST only, uses a purpose-limited `CODEX_INGEST_TOKEN` bearer credential from Secret Manager, derives the write owner only from `DASHBOARD_OWNER_UID`, disables CORS, and returns sanitized no-store responses without logging request content or credentials.
2. **Strict V1 contract and matching:** bounded Zod validation preserves authored text, rejects unsupported schemas, unreasonable payloads, and credential-shaped or configured-secret content. Project resolution uses explicit Dashboard UUID, immutable GitHub numeric repository ID, or exact normalized GitHub full name in that order. V1 does not fuzzy-match titles, resolve local paths, create projects, or accept caller-selected UIDs.
3. **Atomic and idempotent persistence:** deterministic IDs and a transactionally checked receipt make ambiguous-response retries safe. One Firestore transaction creates exactly one completed DevelopmentSession, one used CodexPrompt, one primary `session_completed` ActivityEvent, bounded Codex Ideas, the receipt, one per-minute throttle update, and permitted project-continuity changes. A changed payload under the same project/session identity conflicts without rewriting prior records.
4. **Additive ownership:** project recency advances monotonically. Objective, blocker, and next-step values update only when initially blank with no prior Codex ownership or still equal the last Codex-owned value. Observed manual edits, clears, or deletions receive a permanent backend-only manual-divergence marker. Ingestion never owns project purpose, status, manual status, current branch, tasks, existing ideas, notes, scratchpads, or architecture-decision records; GitHub synchronization remains facts-only.
5. **Reusable helper and UI provenance:** `tools/report-codex-session.mjs` accepts a JSON file or stdin, reads only `DEVELOPER_DASHBOARD_CODEX_INGEST_URL` and `DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN`, never accepts a credential argument, sends the original JSON body over HTTPS, validates the complete success envelope and session identity, and emits only fixed sanitized failures. Development Sessions and Codex Prompts expose compact Codex source/session provenance, while resume and AI-context generators include the ingested semantic context.
6. **Focused blocker review:** backend, domain/UI, and helper/security/rules/documentation reviewers completed a read-only feature review after the corrective tests. Result: P0 none, P1 none, P2 none.

## Automatic Codex session ingestion production verification

- Git: release commit `b302e8dd4dd80d2f5b35ddc52ff3fcf669ff5c96` pushed successfully to `origin/main`.
- Secret Manager: `CODEX_INGEST_TOKEN` version 1 exists in `ENABLED` state. The existing `DASHBOARD_OWNER_UID` remains a server-only binding; neither value was printed.
- Functions: `ingestCodexSession` deployed successfully as an ACTIVE Node.js 24 v2 HTTPS Function in `us-east4`, with 256 MiB memory, a 60-second timeout, maximum two instances, and only `CODEX_INGEST_TOKEN` plus `DASHBOARD_OWNER_UID` bound.
- Firestore: the changed `firestore.rules` compiled and released successfully. Indexes were not changed or deployed.
- App Hosting: the first CLI attempt failed before build creation on a transient Resource Manager request. The retry uploaded the release but the CLI lost OAuth authorization while polling; after normal reauthentication, the already-started `build-2026-08-11-006` rollout was verified `SUCCEEDED`, its build was `READY`, and both reported `reconciling: false`. No third rollout was started.
- Endpoint security: live requests with a missing credential and a fabricated invalid credential both returned sanitized HTTP 401 `unauthenticated` responses with `Cache-Control: no-store` and no write.
- Synthetic ingestion: a seeded local Dashboard UUID was safely rejected as `project_not_associated` before any write because it was not the owner's production project identity. Retrying the same session using exact normalized GitHub full name `marwandiab8/developer-dashboard` succeeded. The byte-identical payload retry returned `duplicate`; sanitized Function log aggregates recorded exactly one `created`, one `duplicate`, zero ideas, and zero ERROR/CRITICAL entries.
- Exactly-once evidence: the created response was returned only after the atomic transaction committed deterministic session, prompt, and activity IDs plus its receipt; the duplicate response reused that receipt and performed no entity writes. This is strong transactional proof of one DevelopmentSession, one CodexPrompt, one Activity, and zero Ideas for the synthetic session, but it is not an independent Firestore collection count. The single clearly labeled synthetic record set remains as deployment audit evidence because deleting visible entities while retaining the idempotency receipt would create an inconsistent audit trail.
- Production browser smoke: a fresh signed-out Chrome profile loaded and hydrated `/`, `/sessions`, `/projects`, and the Developer Dashboard project's Sessions, Codex Prompts, and Activity sections. All six main documents returned HTTP 200 and rendered their expected markers in local mode, with zero console errors, runtime exceptions, HTTP error responses, non-cancelled network failures, or hydration-error markers. App runtime Cloud Logging aggregation was unavailable because gcloud had no active account; no credentials were broadened solely for that check.

## Current local validation

Automatic Codex session ingestion release-candidate validation completed locally on 2026-08-11:

- Focused root feature tests: exit 0; 5 files and 58 tests passed.
- Focused Functions feature tests: exit 0; 2 compiled test files representing 20 source test cases passed.
- Root `npm run lint`: exit 0; 0 errors and 1 existing `@next/next/no-img-element` warning.
- Root `npm run typecheck`: exit 0.
- Root `npm test`: exit 0; 21 test files passed and 1 rules file was skipped in the non-emulator run; 254 tests passed and 8 were skipped (262 total).
- Root `npm run test:rules`: exit 0; 1 Firestore emulator test file and all 8 tests passed.
- Root `npm run build`: exit 0; Next.js 16.3.0 production build completed and 9 of 9 application pages generated successfully.
- Root `npm audit --omit=dev`: exit 0; `found 0 vulnerabilities`.
- Root `npm audit`: exit 0; `found 0 vulnerabilities`.
- Functions `npm run lint`: exit 0; the existing Next.js pages-directory rule notice was emitted.
- Functions `npm run typecheck`: exit 0.
- Functions `npm test`: exit 0; all 7 compiled test files passed, representing 91 source test cases.
- Functions `npm run build`: exit 0.
- Functions `npm audit --omit=dev`: exit 1; 9 moderate, 0 high, and 0 critical vulnerabilities in the transitive `uuid` chain.
- Functions `npm audit`: exit 1; 8 moderate, 0 high, and 0 critical vulnerabilities in the same transitive `uuid` advisory chain.
- Focused read-only P0/P1/P2 review: no blockers found.
- Markdown structure/reference sanity checks and `git diff --check`: exit 0 after the operational documentation update.

Non-failing console noise consisted of existing React test-environment `act(...)` warnings, expected Firestore rules-denial logs, the Firebase CLI `punycode` deprecation notice, and the lint notices above. No assertion was weakened or skipped to obtain these results.

## Historical operational record — 2026-08-06

Everything below this heading records observations and deployment work performed on 2026-08-06. It is preserved for traceability and was not reverified during the 2026-08-10 local remediation.

## Milestone

Milestone 2: secure GitHub repository import and synchronization.

Implementation, dependency remediation, validation, Functions deployment, and App Hosting deployment are complete. Read-only metadata checks confirm both required secrets exist and are enabled. No secret value was accessed or displayed. No commit or push was performed.

## Architecture implemented

- Firebase Functions v2 callable boundary in us-east4
- Firebase Authentication verification for every on-demand request
- DASHBOARD_OWNER_UID comparison for owner-only access
- GITHUB_READ_TOKEN and DASHBOARD_OWNER_UID as server-side Secret Manager values
- Read-only GitHub API access
- Complete token-visible repository pagination with no selection UI
- Bounded per-repository enrichment and partial-failure preservation
- Existing Zod-normalized GitHub import contract
- Existing immutable repository ID matching
- Existing centralized protected-field merge policy
- User-scoped Firestore persistence below users/{uid}
- Separate synchronization state, shared lease, safe audits, and bounded batches
- Idempotent deterministic source-attributed activity
- Daily scheduled synchronization implemented; later entries in this historical record document its 2026-08-06 deployment and verification

## Backend entrypoints

Region: us-east4

- getGitHubConnectionStatus
- syncGitHubRepositories
- scheduledSyncGitHubRepositories

Schedule:

    15 3 * * *
    timeZone: America/Toronto
    daily at 03:15 local time

## Backend implementation files

- functions/src/index.ts
- functions/src/githubSyncPolicy.ts
- functions/src/github/auth.ts
- functions/src/github/client.ts
- functions/src/github/firebaseDetection.ts
- functions/src/github/normalize.ts
- functions/src/github/persistence.ts
- functions/src/github/syncService.ts
- functions/src/github/types.ts
- functions/test/auth.test.ts
- functions/test/client.test.ts
- functions/test/firebaseDetection.test.ts
- functions/test/persistence.test.ts
- functions/test/syncService.test.ts
- functions/package.json
- functions/tsconfig.json
- package.json
- firebase.json
- tests/firestoreRules.test.ts

## Repository scope

The backend imports every repository visible to the configured token, including public, private, archived, and forked repositories. There is no selection screen or per-repository allowlist.

Fine-grained GitHub tokens are restricted to one resource owner. A single token cannot provide complete coverage across a personal owner and multiple organizations. This limitation is documented rather than hidden.

## Security controls

- Missing Firebase auth is rejected.
- An authenticated non-owner UID is rejected.
- Only the configured owner path may be read or written.
- The GitHub token never enters browser code or responses.
- Raw upstream errors and private file contents are not logged.
- Firebase configuration detection uses a strict safe-file allowlist.
- Secret environment files and service-account credentials are never requested.
- Detected Firebase associations are never automatically confirmed or deployed.

## Dashboard UI

- GitHub connection status
- Not-configured and authorization states
- Import GitHub Projects before first success
- Sync GitHub after first success
- Loading and overlapping-run state
- Last successful synchronization
- Created, updated, unchanged, unavailable, and failed counts
- Safe rate-limit messaging
- GitHub source and visibility badges
- Archived and fork labels
- Repository links
- Per-project synchronization status
- No GitHub metadata UI for manual projects

Existing project workbench behavior remains intact.

## Documentation updated

- README.md
- docs/ARCHITECTURE.md
- docs/DEPLOYMENT.md
- docs/FEATURE_COMPLIANCE.md
- docs/FIREBASE_SETUP.md
- docs/GITHUB_IMPORT_CONTRACT.md
- docs/ROADMAP.md
- docs/SECURITY.md
- docs/SETUP.md
- CODEX_STATUS.md

## GitHub permissions required

Resource owner:

- The personal GitHub account that owns the repositories to import
- One resource owner per fine-grained token

Repository access:

- All repositories

Repository permissions:

- Metadata: Read-only, automatically included
- Contents: Read-only
- Pull requests: Read-only
- Every other permission: No access
- No write permissions

Expiration recommendation:

- 90 days, or shorter if regular rotation is practical

## Server-side secret metadata

Read-only metadata verification confirms:

- GITHUB_READ_TOKEN: version 1, ENABLED.
- DASHBOARD_OWNER_UID: version 1, ENABLED.
- No value access, display, rotation, replacement, or new secret version occurred.

## Validation status

Final command evidence:

- Local validation used Node.js 22 while Functions declares Node.js 24; the engine warning remains and deployment should use the declared runtime.
- Root application lint: exit 0; 9 warnings and 0 errors.
- npx tsc --noEmit --incremental false: exit 0.
- Root tests: exit 0; 16 files and 68 tests passed, with the Firestore rules file skipped in the root suite.
- Firestore rules emulator suite: exit 0; 1 test passed.
- Root production build on Next.js 16.3.0: exit 0; 9 routes built.
- Functions lint: exit 0; one Next.js pages-rule warning.
- Functions typecheck: exit 0.
- Functions tests: exit 0; 5 test files passed.
- Standalone Functions build: exit 0.

## Dependency audit outcome

Root application:

- Initial audit: 4 high package records; 3 production records under next@16.2.12 through postcss@8.4.31 and sharp@0.34.5, plus dev-only brace-expansion@1.1.16 and 5.0.8.
- Remediation: next 16.2.12 -> 16.3.0 and eslint-config-next 16.2.12 -> 16.3.0.
- Non-forced npm audit fix changed only brace-expansion 1.1.16 -> 1.1.18 and 5.0.8 -> 5.0.9.
- Final full audit: 0 vulnerabilities.
- Final production-only audit: 0 vulnerabilities.

Firebase Functions:

- Initial high brace-expansion and moderate ts-deepmerge paths were dev-only and exclusively introduced by unused firebase-functions-test@3.5.0.
- Removing firebase-functions-test removed 269 packages and all Functions dev-only advisories.
- Final audit has zero high and zero critical vulnerabilities.
- Final production audit retains one underlying moderate uuid advisory, GHSA-w5hq-g745-h8pq, represented across 9 nodes.
- Installed uuid@9.0.1 is reached through firebase-functions@7.3.2, firebase-admin@13.10.0, Firestore, google-gax, retry-request, gaxios, and dormant Storage/teeny-request packages.
- The advisory requires uuid v3, v5, or v6 with caller buffer. Searches found only v4 calls and no direct UUID or Storage use in functions/src, so the affected API is unreachable.
- Patched uuid is 11.1.1. A non-forced audit-fix dry run changes zero packages; npm offers only firebase-admin 14.2 major or an unsafe downgrade. No incompatible fix was applied.
- Decision: track the upstream firebase-admin/Google Cloud chain and accept this documented moderate unreachable-API risk for deployment.

## Deployment status

Functions and App Hosting deployment completed with the evidence below. No Firestore rules, Firestore indexes, Firebase Hosting classic, or unrelated Functions were changed. No commit or push was performed.

Functions deployment command:

    firebase deploy --only functions:getGitHubConnectionStatus,functions:syncGitHubRepositories,functions:scheduledSyncGitHubRepositories --project marwan-developer-dashboard

App Hosting deployment command:

    firebase deploy --only apphosting --force --project marwan-developer-dashboard

## Final deployment record

### Persistence hardening before deployment

- Enforced a strict syncEnabled gate before GitHub synchronization can run.
- Added firstSuccessfulManualImportAt to distinguish the first owner-triggered import from scheduled synchronization.
- Preserved synchronization metadata during merge and lease release operations.
- Applied withoutUndefined to failure-state writes so Firestore never receives undefined values.

### Final Functions validation

- Functions lint: exit 0.
- Functions typecheck: exit 0.
- Functions tests: exit 0; 5 files and 32 cases passed.
- Standalone Functions build: exit 0.

### Functions deployment and inventory

- Predeployment remote Functions inventory was empty.
- Postdeployment inventory contains exactly these three intended Node.js 24, Gen2, us-east4 Functions:
  - getGitHubConnectionStatus: ACTIVE.
  - syncGitHubRepositories: ACTIVE.
  - scheduledSyncGitHubRepositories: ACTIVE.
- No unrelated Function existed before deployment and no unrelated Function was created or changed.
- Deployment metadata binds GITHUB_READ_TOKEN version 1 and DASHBOARD_OWNER_UID version 1.
- Secret values were never accessed, displayed, rotated, or copied.
- Deployment and runtime logs showed secret identifiers only, never values or private repository contents.

The Functions deploy CLI exited 1 only after all three Functions were created successfully. The remaining prompt concerned an optional Artifact Registry cleanup policy. That policy was intentionally left unchanged rather than applying an unapproved retention setting. Remote inventory confirms all three intended Functions are ACTIVE despite the final CLI exit code.

### Scheduler verification

- Remote scheduler metadata request returned HTTP 200.
- Job: firebase-schedule-scheduledSyncGitHubRepositories-us-east4.
- Status: ENABLED.
- Cron: 15 3 * * *.
- Time zone: America/Toronto.
- Target: scheduledSyncGitHubRepositories in us-east4.

### App Hosting deployment

- Command: firebase deploy --only apphosting --force --project marwan-developer-dashboard.
- CLI exit: 0.
- Backend: developer-dashboard.
- Rollout: complete.
- Live URL: https://developer-dashboard--marwan-developer-dashboard.us-east4.hosted.app
- Live HTTP check: 200.

### Live browser and authorization verification

- A clean temporary Chrome profile initialized Firebase Auth successfully.
- The initial Authenticating state settled to the unauthenticated Google sign-in UI within approximately one second.
- The Google sign-in entry point reached the expected Google Accounts handoff for marwan-developer-dashboard.firebaseapp.com without entering credentials.
- The unauthenticated getGitHubConnectionStatus callable check returned HTTP 401 with UNAUTHENTICATED.
- No syncGitHubRepositories request occurred and no repository import was triggered.
- The authenticated owner-only GitHub panel and first-import button could not be rendered without entering the user's Google credentials.

Two harmless 404 responses occurred inside the Firebase auth handler for firebaseapp.com/favicon.ico and /__/firebase/init.json; they did not prevent Firebase initialization or the Google handoff. Non-blocking tool/browser warnings included the Firebase CLI punycode and update-check warnings plus Chrome GCM deprecated-endpoint and GPU capability warnings.

### Change boundaries

- No commit or push was performed.
- No Firestore rules deployment occurred.
- No Firestore indexes deployment occurred.
- No Firebase Hosting classic deployment occurred.
- No secret value operation occurred.
- No private repository content appeared in deployment or runtime logs.

## Exact next manual step

In the existing Projects tab, click Import GitHub Projects exactly once. If it fails, do not repeat the import. Report the screenshot and exact time so the sanitized failureStage can be read safely. Do not send or display either secret value.

## Production first-import follow-up

At 2026-08-06 13:53, the user's screenshot showed:

- Owner connection established as @marwandiab8.
- GitHub rate limit at 4999 of 5000.
- Last successful synchronization: Never.
- Import GitHub Projects button present.
- Generic first-import failure with zero projects imported.

Sanitized production logs showed two authenticated manual synchronization attempts ending in internal failures. They contained no secret values or private repository data.

Root cause and corrective changes:

- Applied recursive undefined omission at the Firestore persistence boundary.
- Omitted absent Firebase association fields instead of writing undefined values.
- Added safe SyncFailureStage attribution and redaction for actionable diagnostics without exposing upstream or repository data.

Post-fix Functions evidence:

- Lint passed.
- Typecheck passed.
- All 5 Functions test files passed.
- Standalone Functions build passed.
- All three Functions were successfully updated in us-east4.
- Active runtime is Node.js 24.
- Active source hash is 42f5266c13add9a43781b5eb60601cea38b1788c.
- The optional Artifact Registry cleanup-policy warning remains intentionally unchanged.
- The frontend was not redeployed because frontend code was unchanged.

No commit or push was performed. No secret value was accessed or displayed.
## GitHub missing-repository follow-up (2026-08-06)

### Observed behavior and root cause

- Successful GitHub synchronizations created 12 projects and consistently reported 2 partial failures.
- The **All projects** UI does not filter repositories based on public/private visibility, archived status, or fork status.
- `TimeLeftToLive` is a public repository with immutable GitHub repository ID `1251546307`; its public pull-request endpoint returned HTTP 200.
- The missing project was caused by a contract mismatch: Functions permitted a `null` pull-request count after partial enrichment, while the root project schema required numeric issue and pull-request counts.
- GitHub's `open_issues_count` cannot provide a truthful issue-only count because it includes open pull requests.

### Contract correction

- `openIssueCount` and `openPullRequestCount` are now nullable, source-owned fields across the domain model, Zod schemas, and centralized GitHub import contract.
- The protected-field merge policy was not weakened or changed.
- When enrichment partially fails, the repository project is still persisted with `null` counts and source provenance rather than being dropped.
- A later successful synchronization replaces those nullable values with numeric counts.

### Validation evidence

- Application lint: exit 0 with 9 warnings.
- Exact TypeScript check (`npx tsc --noEmit --incremental false`): exit 0.
- Application tests: 16 files passed, 1 skipped; 69 tests passed, 1 skipped.
- Firestore rules tests: 1 of 1 passed.
- Production application build: exit 0.
- Functions lint: exit 0.
- Functions typecheck: exit 0.
- Functions tests: 5 of 5 passed.
- Functions build: exit 0.

### Deployment status

- All three Functions updated successfully in `us-east4`.
- The existing Functions cleanup-policy warning was unchanged.
- The Developer Dashboard App Hosting rollout completed with exit 0.
- Live URL: https://developer-dashboard--marwan-developer-dashboard.us-east4.hosted.app

### Production Firebase-association diagnosis and fix

- Post-null-fix manual synchronizations at 19:39 and 19:40 each reported 12 updated, 0 created, and 2 failed.
- The public repository inventory contained 10 repositories, including `TimeLeftToLive` with immutable GitHub repository ID `1251546307`.
- The dual-inventory union was deployed, and a forced scheduled synchronization at 19:55 reported 12 updated and 0 created. This proved the `TimeLeftToLive` GitHub repository project was already persisted; the missing data was its Firebase association.
- Root cause: the repository appeared in the authenticated inventory, so Firebase inspection used the token-authenticated Contents request. The token's repository scope returned HTTP 403 for `.firebaserc`, while the anonymous public-repository fallback was previously limited to IDs originating only from the public inventory.
- The anonymous Contents fallback now applies to every public repository after a non-rate-limit HTTP 403 or 404, regardless of which inventory supplied the repository.
- Anonymous fallback results are cached by immutable repository ID.
- Anonymous fallback is never used for private or internal repositories.
- Anonymous fallback is not attempted for HTTP 401, rate-limit responses, or 5xx failures.
- Token-derived rate-limit state remains authoritative and is preserved.

### Association-fix validation and deployment

- Functions lint: passed.
- Functions typecheck: passed.
- Functions tests: all 5 test files passed.
- Functions build: passed.
- On-demand synchronization and scheduled synchronization Functions deployed successfully.
- The existing Functions cleanup-policy warning was unchanged.
- No frontend deployment was performed for this backend-only fix.

### Exact next manual step

Click **Sync GitHub** once because today's scheduled synchronization key is already complete, then inspect the `TimeLeftToLive` project card for the detected Firebase association `timelefttolive`.

## Seven-project client display correction (2026-08-06)

### Root cause and correction

- Production synchronization had persisted 12 GitHub-backed project documents, while the client rendered only 7.
- Five repositories with blank GitHub descriptions produced blank generated `purpose` values. The client project schema requires a non-empty purpose, so the Firestore read adapter rejected those otherwise valid GitHub documents.
- New GitHub workbench shells now use `Imported GitHub repository workbench` only when the source description is blank. The source-owned GitHub description remains accurately blank.
- The Firestore read boundary supplies the same fallback in memory for legacy GitHub-backed documents with a missing or blank purpose. It performs no migration or Firestore writeback.
- Non-GitHub invalid documents remain rejected, and every existing non-empty/manual protected purpose remains unchanged.
- Regression coverage includes detected Firebase evidence, nullable enrichment counts, dashboard UUID restoration, immutable numeric GitHub ID preservation, and protected-purpose preservation.

### Final validation

- Application lint: passed with 9 existing warnings.
- Exact TypeScript check (`npx tsc --noEmit --incremental false`): passed.
- Application tests: 16 files passed, 1 skipped; 72 tests passed, 1 skipped.
- Firestore rules emulator tests: passed, 1 of 1.
- Production application build: passed.
- Functions lint, typecheck, all 5 test files, and standalone build: passed.

### Final deployment

- `syncGitHubRepositories` and `scheduledSyncGitHubRepositories` updated successfully in `us-east4`.
- The Functions CLI returned its existing optional Artifact Registry cleanup-policy warning only after both function updates succeeded; no cleanup policy was changed.
- The App Hosting rollout for backend `developer-dashboard` completed successfully.
- Live URL: https://developer-dashboard--marwan-developer-dashboard.us-east4.hosted.app
- No commit, push, secret-value access, Firestore rules deployment, index deployment, or data migration occurred.

### Exact next manual step

Hard-refresh the live `/projects` page with `Ctrl+Shift+R`, then inspect **All projects** before pressing **Sync GitHub**. The expected inventory is 12 GitHub-backed projects, including `timelefttolive`, `aigridline`, and `GridlineAI`. If the page remains at exactly 7 after the hard refresh, the authenticated client is retaining the local repository source rather than the Firestore repository; that source-selection path is the next narrow correction.
