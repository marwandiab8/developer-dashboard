# Data model

## Core entities

- `Project`: project metadata, branch, objective, blocker, status
- `Idea`: capture items, status, priority, source, linked task
- `Task`: work items with lifecycle states and timestamps
- `BrainDump`: unstructured raw thought items
- `Scratchpad`: per-project mutable markdown
- `ArchitectureDecision`: decision log with rationale
- `CodexPrompt`: saved prompts and usage
- `Note`: per-project markdown notes
- `ImportantLink`: links with tags/context
- `DevelopmentSession`: active/completed work sessions
- `ActivityEvent`: meaningful change log

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
- Successful scheduled-day completion is stored separately from global last-run status. Each acquired scheduled attempt has a unique immutable completion/failure audit; already-completed duplicate deliveries skip without creating or overwriting an audit.
- Authored prose and Markdown strings are captured, reduced, written, and hydrated without trimming; blank-input validation may inspect a trimmed view without replacing the persisted raw string. Machine-controlled IDs, enum-like values, and other metadata retain their field-specific normalization.
- Realtime snapshots advance monotonically and cannot be replaced by an older bootstrap or post-write load.
