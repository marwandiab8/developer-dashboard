# Data model

## Core entities

- `Project`: project metadata, branch, objective, blocker, status
- `Idea`: capture items, status, priority, source, linked task, and optional external session identity
- `Task`: work items with lifecycle states and timestamps
- `BrainDump`: unstructured raw thought items
- `Scratchpad`: per-project mutable markdown
- `ArchitectureDecision`: decision log with rationale
- `CodexPrompt`: saved prompts and usage, with optional automatic Codex source/session provenance
- `Note`: per-project markdown notes
- `ImportantLink`: links with tags/context
- `DevelopmentSession`: active/completed work sessions, including optional Codex provenance and semantic completion, unfinished-work, branch, blocker, file, commit, problem, and decision context
- `ActivityEvent`: meaningful change log with optional Codex source/session provenance

## Storage

- `SchemaVersion`: `SCHEMA_VERSION`
- `Storage key`: `developer-dashboard:data:v1`
- On load: if no data exists, seed data is loaded and persisted when browser storage is writable; seed-save failure still completes readiness with the seed in current-tab memory
- On mismatch/invalid payload: migration/fallback keeps app usable
- Signed-out, authentication-loading, and cloud-failure operation uses the local repository. Successful browser saves are durable; rejected saves preserve a dedicated unscoped projection only in current-tab memory across authentication reruns and expose `localPersistenceStatus: "degraded"` plus a storage error until a later successful full ordinary-local save. UID-scoped cloud recovery is never placed in that unscoped slot.
- Authenticated cloud data is scoped below `users/{uid}` in Firestore.
- Local-to-cloud migration preserves entity IDs and creates only documents that are absent remotely.
- Retriable session-note appends use immutable receipts at `users/{uid}/sessions/{sessionId}/reconciliationReceipts/{operationId}`; the receipt, note append, activity, and project recency commit in one transaction.
- General replayable mutations carry guarded original/desired field values and use immutable receipts at `users/{uid}/reconciliationReceipts/{operationId}`. Replay applies only when the guarded base still matches, completes without rewriting when the receipt or desired state proves prior application, and leaves divergent work reconciliation-required. Whole-document deletes also reject remote keys absent from the recorded base.
- A local acknowledgement marker distinguishes data already reconciled with cloud from newer or unmarked legacy work.
- GitHub synchronization state and audit records are backend-controlled and separate from client-owned Dashboard collections.
- Codex ingestion throttle state is backend-owned in one document per UTC-minute bucket at `users/{uid}/codexIngestion/minute-<UTC-minute-key>`, so out-of-order transactions cannot roll back a newer bucket.
- Idempotency receipts are backend-owned at `users/{uid}/codexIngestionReceipts/{receiptId}`. A receipt stores the canonical payload fingerprint and deterministic result identities, not the credential.
- Per-project Codex continuity ownership is backend-owned at `users/{uid}/codexContinuity/{projectId}`. It records hashes of the last values written by Codex and permanent observed-manual-divergence markers so later manual edits cannot be mistaken for stale Codex ownership.
- A successful V1 ingestion transaction writes one completed DevelopmentSession, one used CodexPrompt linked to that session, exactly one `session_completed` ActivityEvent, zero to 25 inbox ideas, the receipt, throttle state, and any allowed continuity changes as one logical commit.
- Session, prompt, activity, receipt, and idea IDs are deterministic UUIDs derived from the resolved project ID, external session ID, schema version, record kind, and idea index. Retrying an identical payload returns the stored result rather than duplicating records.
- V1 does not create projects, tasks, or architecture-decision records. Problems and implementation decisions remain session context; reported ideas enter the Ideas Inbox with source `Codex` and are not converted into tasks.
- Codex ingestion may advance `lastWorkedAt` and `updatedAt` monotonically. Objective, blocker, and next recommended task change only when initially blank with no prior Codex ownership or when the current value still matches the last Codex-owned value; a later manual edit, clear, or deletion is protected. Purpose, project status, manual status, current branch, tasks, and unrelated Dashboard entities are never ingestion-owned.
- Successful scheduled-day completion is stored separately from global last-run status. Each acquired scheduled attempt has a unique immutable completion/failure audit; already-completed duplicate deliveries skip without creating or overwriting an audit.
- Authored prose and Markdown strings are captured, reduced, written, and hydrated without trimming; blank-input validation may inspect a trimmed view without replacing the persisted raw string. Machine-controlled IDs, enum-like values, and other metadata retain their field-specific normalization.
- Realtime snapshots advance monotonically and cannot be replaced by an older bootstrap or post-write load.
