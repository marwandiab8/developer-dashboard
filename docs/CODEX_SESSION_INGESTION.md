# Codex session ingestion V1

## Purpose and status boundary

Codex session ingestion records the semantic context of a coding session: why the work happened, what Codex did, what remains, and what should happen next. GitHub synchronization remains responsible for repository facts. Neither integration owns the user's unrelated Dashboard data.

The HTTPS export is `ingestCodexSession`. This document defines its V1 contract and configuration procedure. It does not claim that the Function, Secret Manager value, rules, or frontend changes are deployed or live. Current operational evidence belongs only in `CODEX_STATUS.md`.

This feature also does not make every Codex session automatic merely by existing in Developer Dashboard. Each external project must opt in by loading the two helper environment variables and adopting the end-of-session instruction below.

## Endpoint and authentication

Send one HTTPS POST to the deployed `ingestCodexSession` URL with:

    Authorization: Bearer <value loaded from a trusted local secret store>
    Content-Type: application/json

The value is stored server-side as `CODEX_INGEST_TOKEN` in Firebase Secret Manager. The Function independently binds `DASHBOARD_OWNER_UID` and derives the Firestore owner path from that server-side value. The request cannot choose a UID.

The bearer credential is purpose-limited to this ingestion endpoint. It is not a Firebase Admin credential, service-account key, Firebase ID token, GitHub token, or direct Firestore credential. Keep it out of repositories, `.env` files, command arguments, shell history, browser storage, Firestore, logs, tests, documentation, and chat.

The endpoint runs in us-east4 as a Firebase Functions v2 HTTPS `onRequest` Function with a 60-second timeout, 256 MiB memory, at most two instances, and CORS disabled. It binds only `CODEX_INGEST_TOKEN` and `DASHBOARD_OWNER_UID`. It accepts POST only and returns `Cache-Control: no-store`. It never logs the authorization header, owner UID, full request body, raw prompt, or raw exception.

## V1 payload

The request body is a strict JSON object. Unknown fields are rejected.

```json
{
  "schemaVersion": 1,
  "source": "codex",
  "project": {
    "githubFullName": "example-owner/example-repository"
  },
  "session": {
    "externalSessionId": "session-2026-08-11-example",
    "startedAt": "2026-08-11T14:00:00.000-04:00",
    "endedAt": "2026-08-11T15:00:00.000-04:00",
    "prompt": "Implement the approved project change and preserve existing behavior.",
    "objective": "Complete the approved implementation safely.",
    "summary": "Implemented and validated the approved change.",
    "completed": [
      "Added the bounded ingestion path",
      "Added regression coverage"
    ],
    "unfinished": [
      "Complete the manual browser acceptance test"
    ],
    "problemsDiscovered": [
      "The external project still needs the opt-in instruction"
    ],
    "decisionsMade": [
      "Use exact repository identity instead of title matching"
    ],
    "filesModified": [
      "src/example.ts"
    ],
    "commits": [
      "0123456789abcdef"
    ],
    "branch": "main",
    "currentBlocker": null,
    "nextRecommendedTask": "Run the manual acceptance test",
    "ideas": [
      {
        "text": "Add an ingestion health indicator",
        "description": "Consider only after the V1 workflow is proven.",
        "priority": "low"
      }
    ]
  }
}
```

At least one project selector is required. `localPath` is accepted as a bounded compatibility field, but V1 does not register or resolve local paths. A payload with only `localPath` returns `project_not_associated`.

### Exact validation bounds

String limits below are JavaScript string-length limits. The separate total limit is measured as UTF-8 bytes after the strict payload has been parsed and normalized.

| Field | Requirement and bound |
| --- | --- |
| Entire payload | Both the raw HTTP body and `Buffer.byteLength(JSON.stringify(validatedPayload), "utf8")` must be at most 262,144 bytes |
| `schemaVersion` | Exactly `1` |
| `source` | Exactly `"codex"` |
| `project.dashboardProjectId` | Optional UUID |
| `project.githubRepositoryId` | Optional positive safe integer, at most 9,007,199,254,740,991 |
| `project.githubFullName` | Optional; at most 256 characters; exactly one slash with non-whitespace owner and repository segments; trimmed and normalized to lowercase |
| `project.localPath` | Optional; nonblank after trimming; at most 2,048 characters; not used for V1 matching |
| `session.externalSessionId` | Required machine identity; at most 256 characters; starts alphanumeric and then uses only letters, digits, `.`, `_`, `:`, `@`, `/`, or `-` |
| `session.startedAt` | Optional ISO datetime with a timezone offset; defaults to `endedAt`; must not be later than `endedAt` |
| `session.endedAt` | Required ISO datetime with a timezone offset |
| `session.prompt` | Required and nonblank after trimmed validation; authored value preserved; at most 131,072 characters |
| `session.objective` | Optional and nonblank after trimmed validation; authored value preserved; at most 16,384 characters |
| `session.summary` | Required and nonblank after trimmed validation; authored value preserved; at most 32,768 characters |
| `completed`, `unfinished`, `problemsDiscovered`, `decisionsMade` | Required arrays; at most 100 items each; every item nonblank and at most 4,096 characters |
| `filesModified` | Required array; at most 250 items; every item nonblank and at most 4,096 characters |
| `commits` | Required array; at most 100 items; every item nonblank and at most 4,096 characters |
| `session.branch` | Optional; nonblank after trimming; normalized trimmed value; at most 512 characters |
| `session.currentBlocker` | Optional string or `null`; at most 16,384 characters; clear semantics are ownership-guarded |
| `session.nextRecommendedTask` | Optional and nonblank after trimmed validation; authored value preserved; at most 16,384 characters |
| `session.ideas` | Optional array; at most 25 items |
| `idea.text` | Required and nonblank after trimmed validation; authored value preserved; at most 4,096 characters |
| `idea.description` | Optional; authored value preserved; at most 16,384 characters |
| `idea.priority` | Optional `low`, `medium`, `high`, or `critical`; defaults to `medium` |

To allow ordinary clock skew, `endedAt` may be at most ten minutes later than the server receive time. A later value is rejected as `invalid_request`. Project recency updates are monotonic, so an older report cannot move recency backward.

Obvious embedded GitHub access tokens, bearer credentials, private keys, and service-account private-key material are rejected as `sensitive_content`. After authentication, the Function also rejects any payload string containing its configured ingestion credential or owner UID. The response and safe logs never repeat the detected value. This is a last safety boundary, not permission to place credentials in prompts or session reports.

## Exact project matching

Resolution uses the strongest supplied identity in this order:

1. `dashboardProjectId`: read that exact project UUID. If it does not exist, stop with `project_not_associated`; do not fall through.
2. `githubRepositoryId`: match the exact immutable numeric GitHub repository ID. Zero matches returns `project_not_associated`; more than one returns `project_ambiguous`.
3. `githubFullName`: normalize to lowercase and match the exact normalized owner/repository name. Zero matches returns `project_not_associated`; more than one returns `project_ambiguous`.
4. `localPath`: unsupported for matching in V1.

When more than one supported selector is supplied, every additional selector must identify the same resolved project. A conflict returns `selector_mismatch` before any write. V1 never fuzzy-matches a title or slug, never silently selects among ambiguous matches, and never creates a project automatically.

### Read-only association verification

The same authenticated endpoint can verify an exact association before a Codex session is reported. This operation applies the same selector precedence, mismatch, ambiguity, authentication, content-type, body-size, and sanitized-error rules as ingestion:

```json
{
  "schemaVersion": 1,
  "operation": "verify_project",
  "project": {
    "githubFullName": "example-owner/example-repository"
  },
  "source": "codex"
}
```

A successful verification returns only these safe inventory fields:

```json
{
  "ok": true,
  "matched": true,
  "status": "associated",
  "dashboardProjectId": "33333333-3333-4333-8333-333333333333",
  "dashboardProjectTitle": "Example project",
  "matchedBy": "githubFullName"
}
```

`matchedBy` is exactly one of `dashboardId`, `githubRepositoryId`, or `githubFullName`. Verification runs in an explicitly read-only Firestore transaction. It creates no ingestion receipt, throttle document, session, prompt, activity, idea, continuity metadata, or project update. It never returns the owner UID, project continuity, notes, purpose, status, credentials, or other project contents. Because it performs zero writes, it does not consume an ingestion rate-limit slot.

## Records created

A new accepted report creates the following visible Dashboard records:

- One completed `DevelopmentSession` with source `codex`, external session ID, timestamps, objective, summary, completion and unfinished prose, problems, decisions, files, commits, branch, blocker context, and next starting point.
- One `CodexPrompt` with source `codex`, the complete authored prompt, a safely generated title, objective/purpose, status `used`, result summary, related session ID, and timestamps.
- Exactly one primary `ActivityEvent` of type `session_completed` summarizing the session without noisy per-field activity duplication.
- Zero to 25 `Idea` records with source `Codex`, status `inbox`, external session identity, preserved description, and supplied or default priority.

Reported problems and implementation decisions remain DevelopmentSession context. V1 does not create tasks, convert ideas into tasks, or create `ArchitectureDecision` records.

The existing realtime repository stream makes these entities available to the Project Workbench, Development Sessions, Codex Prompts, Activity, Continue Where I Left Off, PROJECT_RESUME.md, and AI_CONTEXT.md. The small source indicator distinguishes automatically ingested Codex records from manual records.

## Idempotency and atomicity

The idempotency scope is `codex:v1:<resolvedProjectId>:<externalSessionId>`.

The backend derives UUID-shaped IDs from SHA-256 namespace material:

    codex:v1:<projectId>:<externalSessionId>:<record-kind>
    codex:v1:<projectId>:<externalSessionId>:idea:<zero-based-index>

The receipt lives at:

    users/{uid}/codexIngestionReceipts/{deterministicReceiptId}

It stores the canonical payload fingerprint and deterministic result IDs, never the bearer credential. The fingerprint canonicalizes schema version, source, and session content; selector syntax is excluded because the resolved project is already part of the receipt identity. The same session content may therefore retry through another exact selector for the same project and still return the original IDs with `idempotent: true` and `status: "duplicate"`. Changed session content under the same resolved project and external session ID returns `idempotency_conflict`; it does not rewrite the original records or project continuity.

The receipt is checked before throttling, so an ambiguous-response retry does not consume another rate-limit slot. For a new report, the Function writes the session, prompt, single activity, bounded ideas, receipt, throttle state, and allowed project continuity changes in one Firestore transaction. A failed transaction leaves none of those logical changes committed.

Browser clients cannot read or write `codexIngestion`, `codexIngestionReceipts`, or `codexContinuity`. The visible session, prompt, activity, and idea records remain normal owner-visible Dashboard entities.

## Rate policy

Throttle state is stored at:

    users/{uid}/codexIngestion/minute-<UTC-minute-key>

V1 uses a separate transactionally incremented document for each UTC-minute bucket and permits at most 30 new ingestions in that bucket. Per-minute documents prevent an older in-flight request from rolling back a newer minute's count. Request 31 receives `rate_limited` and performs no entity or project write. An identical receipt-backed retry is returned before this check and remains safe even when the current minute is full.

## Continuity ownership policy

Automatic ingestion is additive. It never changes project purpose, project status, manual status, current branch, tasks, existing ideas, architecture-decision records, notes, scratchpads, or unrelated Dashboard data. A session's reported branch is stored on the DevelopmentSession only.

Project continuity uses a backend-only ownership record:

    users/{uid}/codexContinuity/{projectId}

That record keeps hashes of values last written by Codex and a permanent manual-divergence marker once ingestion observes that the visible value no longer matches Codex ownership. The policy is:

- `lastWorkedAt` and `updatedAt` advance monotonically from `endedAt`; they never move backward.
- A supplied `objective` may update `currentObjective` only when the field has no prior Codex ownership and is blank, or its current value still hashes to the last Codex-written value.
- A supplied `nextRecommendedTask` follows the same initially-blank-or-unchanged-Codex-owned rule.
- An omitted objective, blocker, or next task is always a no-op.
- A non-empty `currentBlocker` may fill a blocker that is blank and has no prior Codex ownership, or replace an unchanged Codex-owned blocker.
- `null`, an empty blocker, or case-insensitive `None` requests a clear. The clear succeeds only when the blocker has no prior Codex ownership and is blank, or when it is unchanged and Codex-owned. An initially blank field remains visibly unchanged while recording the explicit no-blocker watermark. A manually cleared or deleted field no longer matches its prior Codex hash and is preserved.
- Per-field ownership timestamps are monotonic. A delayed older report cannot replace a newer Codex-owned objective, blocker, or next task, including a newer explicit no-blocker state.
- If the user edits, clears, or deletes any of these fields after ingestion, the hash no longer matches. The next applicable report records a backend-only manual-divergence marker, and later automatic ingestion preserves the field even if the user eventually chooses text equal to an older Codex value.

GitHub synchronization remains facts-only and does not write these continuity fields or the Codex ownership record.

## Response contract

Success returns HTTP 200:

```json
{
  "ok": true,
  "idempotent": false,
  "status": "created",
  "projectId": "33333333-3333-4333-8333-333333333333",
  "externalSessionId": "session-2026-08-11-example",
  "sessionId": "44444444-4444-5444-8444-444444444444",
  "promptId": "55555555-5555-5555-8555-555555555555",
  "activityId": "66666666-6666-5666-8666-666666666666",
  "ideaIds": []
}
```

An identical retry returns the same IDs with `idempotent: true` and `status: "duplicate"`.

Failures use a sanitized body shaped as `{ "ok": false, "error": { "code": "...", "message": "..." } }`:

| HTTP | Safe code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request`, `unsupported_schema`, `sensitive_content` | Malformed, unsupported, excessive field, or credential-bearing payload |
| 401 | `unauthenticated` | Missing or invalid bearer credential |
| 404 | `project_not_associated` | No project matched the strongest identity |
| 405 | `method_not_allowed` | Request was not POST |
| 409 | `project_ambiguous`, `selector_mismatch`, `idempotency_conflict` | Matching or retry identity cannot be resolved safely |
| 429 | `rate_limited` | Thirty new ingestions already entered the current UTC-minute bucket |
| 500 | `internal` | Safe internal failure with no raw exception detail |
| 503 | `configuration_unavailable` | Required Secret Manager configuration is unavailable |

## Shared helper

The dependency-free helper is:

    /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs

It reads exactly these environment variables:

- `DEVELOPER_DASHBOARD_CODEX_INGEST_URL`
- `DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN`

Load the public endpoint URL and use a non-echoing prompt or trusted secret-store integration for the credential:

    export DEVELOPER_DASHBOARD_CODEX_INGEST_URL="<deployed-ingestCodexSession-https-url>"
    read -rsp "Developer Dashboard Codex ingestion credential: " DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN
    export DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN

Submit a JSON file from any repository:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs complete --file /path/to/codex-session.json

Or submit JSON through stdin:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs complete < /path/to/codex-session.json

From the Developer Dashboard repository itself, the equivalent npm wrapper is:

    npm run report:codex-session -- complete --file /path/to/codex-session.json

Before reporting from a GitHub repository, verify its exact association without writing Dashboard data:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs verify --github-full-name example-owner/example-repository

For a machine-readable inventory result, add `--json`:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs verify --github-full-name example-owner/example-repository --json

The JSON output is restricted to `ok`, `matched`, `status`, `dashboardProjectId`, `dashboardProjectTitle`, and `matchedBy`. The helper rejects a nominal success response containing any undeclared field instead of printing it.

The helper verifies that the input is a JSON object with an external session identity but sends the original JSON text unchanged. It uses `Authorization: Bearer`, times out the request and response body, never accepts a token argument, never prints the token or raw response body, and converts server and network failures into fixed safe messages. It claims success only after validating the complete success-result shape and confirming the returned external session ID matches the submitted report. A sanitized `idempotency_conflict` receives a distinct retry-conflict message; an unexpected or incomplete HTTP 200 response is a failure. An ingestion failure does not alter or undo the coding work.

## Copyable `AGENTS.md` instruction

Copy this section into an external project's `AGENTS.md` only after its environment can securely provide both helper variables:

```text
## Report completed Codex sessions to Developer Dashboard

At the end of a successful coding session:

1. Determine this repository's strongest stable Developer Dashboard identity: explicit Dashboard project UUID, immutable GitHub numeric repository ID, or exact GitHub owner/repository full name. Never guess from a project title.
2. Build one strict Codex session ingestion V1 JSON object. Use a stable externalSessionId for this Codex session and reuse the identical ID and payload for retries.
3. Include the actual driving prompt, objective, summary, completed and unfinished work, discovered problems, implementation decisions, modified files, commits, branch, explicit blocker, next recommended task, ideas, and start/end timestamps. Use empty arrays when a required list has no items. Never include credentials, tokens, authorization headers, private keys, service-account data, or secret values.
4. Save the payload outside the repository or pipe it directly to the shared helper. Run:

   node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs complete --file /path/to/codex-session.json

5. The helper must read DEVELOPER_DASHBOARD_CODEX_INGEST_URL and DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN from the process environment. Never read, print, log, inspect, request, or pass the credential as a command argument.
6. Treat a successful helper response, including an already-recorded idempotent response, as reported. If ingestion fails, report the sanitized failure to the user but do not undo, reset, amend, or otherwise change the completed coding work.
7. Do not fuzzy-match, create a Dashboard project automatically, change the external session ID to evade a conflict, or claim ingestion succeeded without a successful helper response.
```

Adding this instruction is an explicit per-project opt-in. Until it and the environment are configured in another project, that project's Codex sessions still require manual reporting or an explicit helper invocation.
