# Schema version 2 migration and rollback

Status: implemented locally and tested with representative legacy seed data. No production migration has been run.

## Purpose

Version 2 adds canonical idea/task/prompt/session lifecycle fields and exact cross-record links while preserving every existing collection and document ID. The local storage key intentionally remains `developer-dashboard:data:v1`; the payload's `schemaVersion` distinguishes the model revision and avoids abandoning existing browser data under a new key.

## Idempotent transformations

- Ideas: map `reviewed`/`accepted` to `ready_for_review`, `rejected` to `archived`, preserve the original value in `legacyStatus`, and add nullable `convertedAt`.
- Tasks: map `backlog` to `open`, `testing` to `in_progress`, preserve `legacyStatus`, and add ready/last-worked timestamps, active-duration total, prompt/session ID arrays, next step, and optional GitHub references.
- Prompts: map draft/ready/used/archived to prepared/started/completed/superseded as applicable, preserve `legacyStatus`, assign stable per-task sequence numbers, and add result/history fields.
- Sessions: retain the legacy session record, add exact task/prompt links when known, explicit source/status, active interval/duration fields, resume/blocker/next-step fields, and test/build/deployment summaries.
- Activities: retain existing events and add optional actor/task/prompt/session relationships.
- Relationships: rebuild a task's prompt/session ID arrays from the preserved records without deleting unmatched legacy records.

Applying the migration again to a version 2 payload produces the same semantic result. Repository validation remains at the adapter boundary.

## Production migration plan

Do not run this plan without explicit approval.

1. Finish local lint, typecheck, full tests, emulator rules tests, Functions tests, build, and browser acceptance.
2. Export/backup the owner-scoped Firestore data with an approved mechanism; verify the backup without printing record content or secrets.
3. Deploy backward-compatible code and rules only after reviewing the exact diff and deployment scope.
4. Sign in as the owner and let the existing repository hydration path read documents through schema defaults; do not bulk-delete or recreate collections.
5. Run an explicitly approved bounded migration only if stored canonical fields must be materialized. Use deterministic IDs, create-if-absent/transaction guards, and a version receipt.
6. Verify counts, stable IDs, bidirectional idea/task links, prompt/session links, time totals, and cross-user denial.
7. Record deployment/migration evidence in `CODEX_STATUS.md`.

## Rollback

1. Stop writes or disable only the newly deployed MCP endpoint.
2. Roll back application/Functions source using the normal reviewed release mechanism; never use a destructive local Git reset on an unreviewed worktree.
3. Keep new fields and collections. Older code ignores unknown fields, and deleting history would break audit/idempotency guarantees.
4. If a materialized migration wrote incorrect values, restore only affected fields from the pre-migration backup through a separately reviewed, exact-ID transactional repair. Preserve `legacyStatus`, audit events, and receipts.
5. Re-read repaired records and re-run ownership/rules checks before restoring writes.

Rollback does not require deleting ideas, tasks, sessions, prompts, activity, resumes, AI context, GitHub metadata, MCP audit events, or idempotency receipts.
