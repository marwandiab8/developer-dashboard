# GitHub synchronization security

## Trust boundaries

Browser:

- Holds Firebase browser configuration and the signed-in user's Firebase session.
- Calls owner-protected Firebase Functions.
- Never receives or stores the GitHub token.
- Never chooses an authoritative UID for backend writes.

Firebase Functions:

- Verifies Firebase Authentication.
- Enforces DASHBOARD_OWNER_UID.
- Reads GITHUB_READ_TOKEN only from Secret Manager.
- Calls GitHub with read-only permissions.
- Writes only below users/{uid}.
- Returns normalized metadata or safe summary information.

GitHub:

- Receives the fine-grained token over HTTPS.
- Permits only the selected resource owner's token-visible repositories.
- Grants no write operation.

## Required token configuration

Resource owner:

- Select the personal GitHub account that owns the intended repositories.

Repository access:

- All repositories.

Repository permissions:

- Metadata: Read-only, automatically included.
- Contents: Read-only.
- Pull requests: Read-only.
- All other permissions: No access.

Expiration:

- Recommend 90 days.
- Use a shorter expiration when reliable rotation is available.
- Rotate immediately if exposure is suspected.

Fine-grained personal access tokens select one resource owner. A single token cannot cover repositories owned by several unrelated owners. The dashboard must not claim otherwise.

## Secret handling

Secret Manager values:

- GITHUB_READ_TOKEN
- DASHBOARD_OWNER_UID

Forbidden locations:

- Browser bundles
- NEXT_PUBLIC variables
- Firestore
- localStorage or sessionStorage
- Source files
- .env.local or other developer convenience files
- Test fixtures, snapshots, or recordings
- CI logs
- Callable responses
- Status reports
- Git commits

Use interactive Firebase CLI prompts. Never include a value in the command itself.

## Authentication and authorization

Every on-demand callable must:

1. Require request.auth.
2. Compare request.auth.uid to DASHBOARD_OWNER_UID.
3. Reject missing auth with unauthenticated.
4. Reject another UID with permission-denied.
5. Derive the write path from the verified UID.
6. Ignore any caller-supplied UID as authority.

Private repository metadata must be inaccessible to every non-owner Firebase user even if that user can authenticate successfully.

## Safe GitHub requests

Allowed purposes:

- Authenticated login
- Repository listing and metadata
- Pull-request counts
- Commit metadata needed for practical personal activity attribution
- Safe allowlisted Firebase configuration detection
- Rate-limit state

Firebase association candidates are fetched only by exact allowlisted Contents paths. The worker does not call the recursive Git tree API or enumerate repository paths before filtering.

Disallowed purposes:

- Repository writes
- Branch, issue, pull-request, release, deployment, workflow, or settings mutation
- Secret-file retrieval
- Broad source-tree crawling
- Commit patch or diff retrieval
- Arbitrary file contents

## Safe Firebase association evidence

Allowed candidate paths:

- .firebaserc
- firebase.json
- apphosting.yaml
- apphosting.yml
- .env.example
- .env.sample

Forbidden candidate paths include:

- .env.local
- Non-example .env files
- Service-account JSON files
- Private keys
- Credential exports
- Arbitrary environment or secret files

Store only the evidence path and non-secret Firebase project ID. Mark positive evidence detected. A complete no-evidence scan is `not_detected`; a partial scan with no evidence is `unknown`. Never mark an association confirmed automatically, guess from repository names, deploy, or modify the discovered project.

## Logging and audit

Allowed operational data:

- Run ID
- Trigger type
- Start and completion timestamps
- Duration
- Outcome counts
- Lease result
- Rate-limit limit, remaining, resource, and reset
- Safe error category

Never log:

- Tokens or authorization headers
- Secret Manager values
- Dashboard owner UID
- Service-account credentials
- Authentication tokens or cookies
- Private keys
- Raw GitHub response bodies
- File contents
- Commit contents or patches
- Private repository descriptions
- Raw upstream errors that may contain request data
- Full callable request objects

## Error redaction

Callable errors use stable safe categories:

- unauthenticated
- permission-denied
- failed-precondition
- resource-exhausted
- aborted
- internal
- unavailable

Only safe retry or reset timestamps may be included in error details. Raw GitHub messages are never forwarded.

## Persistence safety

- Apply the centralized protected-field merge contract.
- Match by immutable numeric GitHub repository ID.
- Never delete a project because a repository disappeared.
- Use deterministic activity identities.
- Atomically create migrated local documents only when the remote ID is absent; never pre-read and later overwrite on stale inventory information.
- Store lease and run state separately from project work.
- Deny browser writes to synchronization gates, leases, scheduler state, and audit runs; those paths are Admin SDK only.
- Explicitly allow only legitimate UID-scoped Dashboard collections, migration state, and user profile writes through client rules.
- Preserve failed cloud-action projections with stable operation IDs. When browser storage is writable, persist a guarded journal; when it is not, retain current-tab memory and expose a not-durable warning instead of claiming persistence.
- Replay guarded mutations only in a Firestore transaction: a matching immutable receipt or already-reflected desired state completes without a rewrite, a matching recorded base applies once, and a diverged guarded field remains reconciliation-required without overwriting remote data.
- Preserve successful repository results during partial failures.
- Keep successful scheduled-day completion independent of global last-run status and create immutable per-attempt audits atomically with run completion/failure.
- Limit all writes to the verified owner's users/{uid} tree.

## Incident response

If token exposure is suspected:

1. Revoke the token in GitHub immediately.
2. Create a replacement with the same minimal read-only permissions.
3. Set a new GITHUB_READ_TOKEN Secret Manager version interactively.
4. Review Functions logs for safe error categories and unexpected call volume.
5. Do not paste the old or new token into an incident report.
6. Redeploy only after explicit approval if a new secret binding or code release is required.

## Historical secret metadata verification

Read-only Secret Manager metadata checks on 2026-08-06 confirmed:

- GITHUB_READ_TOKEN exists with version 1 in ENABLED state.
- DASHBOARD_OWNER_UID exists with version 1 in ENABLED state.
- No secret value was accessed, displayed, rotated, replaced, or copied.

This historical check confirmed configuration presence only. It did not disclose or validate either stored value, and it was not rerun during the current remediation.

## Dependency security disposition

### Root application

Earlier remediation resolved high-severity records under Next/PostCSS/Sharp and the dev-only brace-expansion path. Pass 4 then found two fixable high-severity transitive records in the current root lockfile:

- Production `nanoid@3.3.16` through the PostCSS instances used by `@tailwindcss/postcss` and Next.js.
- Development-only `js-yaml@4.3.0` through `eslint -> @eslint/eslintrc`.

The existing parent ranges accepted patched releases, so Pass 4 used the smallest compatible lockfile update:

- `nanoid` 3.3.16 -> 3.3.18.
- `js-yaml` 4.3.0 -> 4.3.1.
- No override, forced audit fix, framework major, or React/Next change was required.

Fresh post-fix results on 2026-08-10 are exact: root `npm audit --omit=dev` exited 0 with `found 0 vulnerabilities`, and root `npm audit` exited 0 with `found 0 vulnerabilities`.

### Firebase Functions

The initial Functions audit traced high brace-expansion records at installed nodes 2.1.3 and 1.1.17, plus moderate ts-deepmerge, exclusively through the unused firebase-functions-test@3.5.0 development dependency. Removing that unused package removed 269 packages and eliminated those Functions dev-only advisories.

Fresh sequential Pass 4 `npm audit --omit=dev` and full `npm audit` both report exactly 9 moderate, 0 high, and 0 critical vulnerabilities. They are the same underlying `uuid <11.1.1` advisory, GHSA-w5hq-g745-h8pq, counted through firebase-functions, firebase-admin, Firestore, google-gax, retry-request, gaxios, Storage, and teeny-request.

The affected uuid behavior requires v3, v5, or v6 with a caller-provided buffer. Reachability searches found only v4 calls in gaxios, google-gax, and teeny-request, no direct UUID use in functions/src, and no direct Storage use in functions/src. The vulnerable API is therefore production-installed but unreachable through the current application code.

uuid 11.1.1 contains the fix. npm's final sequential audit output offers only `npm audit fix --force`, currently proposing an unsafe breaking downgrade from installed `firebase-admin@13.10.0` to 10.3.0; another audit response during validation proposed the breaking 14.2.0 major instead. Pass 4 did not force, downgrade, override, or hide this moderate-only residual. Track the firebase-admin and Google Cloud dependency chain for an upstream compatible update.

## Advisory table

| Advisory | Package and severity | Initial scope and path | Exploit prerequisite and reachability | Patched version | Breaking requirement | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| GHSA-qx2v-qp2m-jg93 | postcss@8.4.31, moderate | Production through next@16.2.12 | Requires attacker-influenced CSS stringify output containing a closing style sequence. Build inputs are application-controlled. | postcss 8.5.10 | No direct major; resolved through same-major Next update | Remediated by next@16.3.0; retain final audit evidence. |
| GHSA-6g55-p6wh-862q | postcss@8.4.31, high | Production through next@16.2.12 | Requires attacker-controlled sourceMappingURL during CSS processing and vulnerable source-map loading behavior. | postcss 8.5.12 | No direct major; resolved through same-major Next update | Remediated by next@16.3.0. |
| GHSA-r28c-9q8g-f849 | postcss@8.4.31, high | Production through next@16.2.12 | Requires attacker-controlled previous source-map reference capable of path traversal and local map disclosure. | postcss 8.5.18 | No direct major; resolved through same-major Next update | Remediated by next@16.3.0. |
| GHSA-fxqj-rqcc-2cmp | postcss@8.4.31, moderate | Production through next@16.2.12 | Incomplete sourceMappingURL fix; requires attacker-controlled CSS with from unset. | postcss 8.5.23 | No direct major; resolved through same-major Next update | Remediated by next@16.3.0. |
| GHSA-f88m-g3jw-g9cj | sharp@0.34.5, high | Production through next@16.2.12 | Requires processing a malicious image through affected libvips behavior. Next can invoke Sharp for image optimization. | sharp 0.35.0 | No application major required; resolved through same-major Next update | Remediated by next@16.3.0 and verified by zero-vulnerability production audit. |
| GHSA-mh99-v99m-4gvg | brace-expansion, high | Dev-only root ESLint path; dev-only Functions test path | Requires attacker-controlled brace patterns large enough to exhaust memory. Not in application runtime. | 1.1.17 for the original issue; 1.1.18 required to include the later bypass fix | No | Root node patched to 1.1.18; Functions path removed. |
| GHSA-rgw5-rvv9-x895 | brace-expansion, high | Dev-only root nodes 1.1.16 and 5.0.8; dev-only Functions test path | Requires attacker-controlled brace patterns causing unbounded intermediate arrays. Not in application runtime. | 1.1.18 and 5.0.9 | No | Root nodes patched; unused Functions path removed. |
| GHSA-87mf-gv2c-c62c | ts-deepmerge, moderate | Dev-only through unused firebase-functions-test@3.5.0 | Requires attacker-controlled merge keys reaching the vulnerable deep-merge behavior. The test dependency was unused by production code. | No installed version remains; removal is the repository remediation | No; unused dev package removed | Remediated by removing firebase-functions-test and 269 transitive packages. |
| Pass 4 root nanoid advisory | nanoid@3.3.16, high | Production through PostCSS used by Tailwind and Next.js | Transitive build/runtime dependency; the existing parent ranges accept the patched package. | nanoid 3.3.17 | No | Remediated to nanoid@3.3.18 by compatible lockfile update. |
| Pass 4 root js-yaml advisory | js-yaml@4.3.0, high | Development-only through eslint and @eslint/eslintrc | Development tooling path; the existing parent range accepts the patched package. | js-yaml 4.3.1 | No | Remediated to js-yaml@4.3.1 by compatible lockfile update. |
| GHSA-w5hq-g745-h8pq | uuid@9.0.1, moderate | Production-installed through firebase-functions, firebase-admin, Firestore, google-gax, retry-request, gaxios, and dormant Storage/teeny-request paths | Requires uuid v3, v5, or v6 with caller buffer. The prior source review found only v4 calls and no direct UUID or Storage use in functions/src. | uuid 11.1.1 | Yes in npm's available force-only transitive remedies; current output proposes an unsafe firebase-admin 10.3.0 downgrade and another response proposed the 14.2.0 major | Accept documented residual risk for this deployment and track upstream; do not force, downgrade, or hide it. |

## Historical deployment security decision

As assessed on 2026-08-06, there were no production high or critical vulnerabilities and the remaining moderate advisory's affected API was unreachable in the Functions implementation reviewed that day. That reachability statement is historical application-code evidence, not physical production revalidation. The fresh 2026-08-10 package-audit counts are recorded above and in `CODEX_STATUS.md`; no deployment is authorized by either assessment alone.
