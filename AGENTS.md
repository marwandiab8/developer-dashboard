# AGENTS

## Project purpose

Developer Dashboard is a local-first development brain for capture and continuity.

## Repository map

- `src/app/` – app routes (`/`, `/projects`, `/ideas`, `/tasks`, `/sessions`, `/search`)
- `src/components/` – shell/navigation + global quick capture dialog
- `src/lib/` – domain models, validation, repository layer, seed, markdown generators
- `src/lib/repositories/` – reducer, local and Firestore adapters, migration, and context provider
- `src/lib/auth/` and `src/lib/firebase/` – browser authentication and Firebase client boundaries
- `functions/src/` – owner-only GitHub synchronization backend
- `tests/` and `functions/test/` – application, repository, rules, and backend tests
- `docs/` – architecture, data model, setup, roadmap

## Commands

- `npm install`
- `npm run dev`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:rules`
- `npm run build`
- Run the same lint, typecheck, test, and build commands from `functions/`.

## Coding conventions

- Strict TypeScript for app and library code
- Validation at repository boundaries with Zod
- Repository-first architecture with adapters in `src/lib/repositories/`
- Repository logic and UI components separated (`src/lib` vs `src/components`)
- Avoid placeholder actions; destructive actions should confirm

## Test expectations

- Local persistence load/save and seed initialization
- Quick capture validation
- Idea -> task conversion
- Search output correctness
- Session completion
- Resume and AI context generation
- Repository mapping and schema validation
- Signed-out local durability and authenticated migration recovery
- Firestore owner isolation and backend-only synchronization state
- GitHub synchronization merge, lease, rate-limit, and safe-content discovery behavior

## Safety rules

- No automatic git scans or destructive writes outside requested commands
- Preserve unrelated existing work
- Keep the dashboard fully usable in local mode without Firebase or authentication.
- Treat GitHub as additive source context; it must not overwrite Dashboard-owned work.
- Keep GitHub tokens, owner UIDs, service-account credentials, and other secrets out of browser code, Firestore, logs, tests, and Git.
- Do not deploy without an explicit project/scope approval.

## Definition of done

- Dashboard is usable locally without backend services
- Quick capture works from common screens
- Critical Phase 1A entities are persisted and searchable
- Resume and AI context artifacts are generated and copy/downloadable
- Cloud persistence failures preserve the projected action locally and expose reconciliation state
- Lint, typecheck, tests, and build succeed

## Notes

- Firebase Authentication, UID-scoped Firestore persistence, safe local migration, App Hosting configuration, and secure GitHub synchronization are implemented in the current working tree.
- `CODEX_STATUS.md` is the sole current operational/status record. Deployment evidence dated 2026-08-06 is historical until production is reverified.

<!-- developer-dashboard-codex-ingestion:start -->
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
<!-- developer-dashboard-codex-ingestion:end -->
