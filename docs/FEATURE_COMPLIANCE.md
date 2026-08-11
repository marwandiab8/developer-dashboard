# Developer Dashboard Feature Compliance Matrix

Date: 2026-08-10

Status scale: Complete, Implemented locally, Partially implemented, Requires manual verification.

## Milestone 2 release gate

The secure GitHub synchronization implementation, local-first fallback, atomic migration, and backend-only synchronization rules are present in the current working tree. Current local validation evidence belongs in `CODEX_STATUS.md`. GitHub `main` remains stale until this work is reviewed, committed, and pushed. Historical 2026-08-06 deployment and secret-metadata evidence is not a claim that production was reverified today, and it does not authorize another deployment.

## Compliance

### 1) GitHub repository import

- Status: Implemented locally.
- Behavior: owner-only callable imports all repositories visible to the configured token, including public, private, archived, and forked repositories.
- Selection: no repository-selection UI and no per-repository allowlist.
- Identity: immutable numeric repository ID prevents duplicates and preserves rename continuity.
- Merge: centralized Milestone 1 policy preserves all protected dashboard work.
- Tests: backend and UI coverage cover pagination, owner authorization, merging, first-import gating, leases, rate limits, and bounded Firebase detection.

### 2) Public and private repository access

- Status: Implemented locally; live private-repository behavior requires manual verification after an approved release.
- Token: server-side fine-grained read-only PAT in Secret Manager.
- Permissions: Metadata read-only automatically, Contents read-only, Pull requests read-only.
- Limitation: one fine-grained token covers one selected resource owner. All repositories means all token-visible repositories for that owner.
- Isolation: browser, Firestore, localStorage, logs, errors, reports, and tests never receive the token.

### 3) Project creation and duplicate prevention

- Status: Complete for the GitHub import path.
- GitHub imports match immutable repository ID and handle renames without duplicate shells.
- Manual project creation remains independent and intentionally supports user-authored projects.

### 4) Quick Capture

- Status: Complete.
- GitHub-backed projects use the same project ID and remain available in global and project-specific Quick Capture.

### 5) Project-specific idea capture

- Status: Complete.
- Imported projects use the existing repository and workbench path without a reduced project type.

### 6) Idea backlog

- Status: Implemented.
- GitHub synchronization does not overwrite, archive, or reclassify ideas.

### 7) Idea-to-task conversion

- Status: Complete.
- Conversion links and task history are protected during synchronization.

### 8) Task workflow

- Status: Implemented.
- GitHub metadata never mutates manual task states or task content.

### 9) Sessions and last-worked tracking

- Status: Implemented locally.
- Personal commit time is preferred; pushed and updated timestamps are explicitly labelled repository-level fallbacks.
- The selected source is recorded and fallback activity is not labelled as personal work.

### 10) Blockers and next actions

- Status: Partially implemented.
- Existing project-level editing limitations remain, but synchronization preserves all blocker and next-action fields.

### 11) Notes and links

- Status: Complete.
- Notes and important links remain attached to imported projects and are protected from GitHub writes.

### 12) Architecture decisions

- Status: Complete.
- Architecture decisions remain fully available and protected on imported projects.

### 13) Codex prompts

- Status: Complete.
- Codex prompts remain fully available and protected on imported projects.

### 14) Scratchpads and brain dumps

- Status: Complete.
- Both remain fully available and protected on imported projects.

### 15) Activity history

- Status: Implemented locally.
- GitHub events are source-attributed and deterministic so a retry does not duplicate them.
- Repository-level fallbacks are clearly distinguished from personal commits.

### 16) Continue Where You Left Off

- Status: Complete.
- Imported projects appear in the existing continuation UI without removing manual context.

### 17) PROJECT_RESUME.md

- Status: Complete.
- Existing generation remains available for every imported project.

### 18) AI_CONTEXT.md

- Status: Complete.
- Existing generation and repository-inspection warning remain available for every imported project.

### 19) Firestore persistence

- Status: Implemented locally.
- Client writes are limited to explicit Dashboard-owned paths under `users/{uid}`; synchronization gates, leases, and audits are backend-only.
- Project merge and synchronization state are separated for partial-failure recovery.
- Local-to-cloud migration uses bounded atomic create-if-absent transactions and preserves original IDs.
- Missing repositories are never deleted.

### 20) Cross-device synchronization

- Status: Implemented and covered by deterministic repository/listener ordering tests; physical multi-device and production-browser behavior was not reverified in this remediation.
- GitHub synchronization uses owner-scoped server writes and the existing client repository flow.
- Accepted realtime snapshots are monotonic; older bootstrap data and post-write loads cannot regress repository state.
- Broader concurrent manual-edit conflict UX remains outside this milestone.

### 21) Manual-field protection during GitHub sync

- Status: Implemented.
- The backend applies the centralized Milestone 1 contract rather than a second merge implementation.
- Protected project fields, including manually managed `currentBranch`, and all user-created entity collections remain unchanged.
- Duplicate, rename, retry, partial-failure, and manual-branch ownership regressions have automated coverage.

### 22) Mobile and iPad usability

- Status: Implemented, requires manual verification.
- Connection, import, sync, progress, errors, result counts, source badges, visibility, archive/fork labels, repository links, and per-project status use responsive existing surfaces.
- No repository-selection screen was added.

### 23) Local-first durability

- Status: Implemented locally.
- The complete workbench remains usable while signed out or when Firebase/Auth is unavailable.
- A rejected browser-storage save never rolls the visible projection back. The tab retains the work in memory, clearly reports that it is not durable, and recovers its durable status only after a later successful full-projection save.
- The unscoped volatile projection survives authentication reruns without being used for UID-scoped cloud recovery, and cloud activation remains blocked until the local work is reviewed.
- Failed Firestore actions use stable operation IDs and a guarded recovery journal when browser storage is writable. Automatic replay cannot overwrite a guarded field changed remotely after the recorded base; conflicts remain visible and reconciliation-required.
- A whole-document delete also conflicts when the remote document gained a field absent from the recorded base.
- Unmarked non-seed legacy data and newer post-acknowledgement local work require an explicit migration choice.

## Security verification expectations

Before release, validation must prove:

- Missing auth is rejected.
- A wrong authenticated UID is rejected.
- Only DASHBOARD_OWNER_UID can read private repository metadata.
- Missing GITHUB_READ_TOKEN reports not configured.
- Secrets are redacted from errors, logs, reports, and tests.
- Safe configuration detection never reads secret files.
- Concurrent and scheduled runs share the same lease.
