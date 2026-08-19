# Developer Dashboard

Personal external development brain for fast idea capture, project continuity, architectural memory, and resume-ready context.

## Capabilities

- Dashboard home and complete per-project workbench
- Global and project-specific Quick Capture
- Ideas with idea-to-task conversion
- Tasks, sessions, blockers, and next actions
- Notes, links, architecture decisions, and Codex prompts
- Scratchpads and brain dumps
- Continue Where You Left Off
- PROJECT_RESUME.md and AI_CONTEXT.md generation
- Firebase Authentication and user-scoped Firestore persistence
- Secure server-side GitHub repository import and synchronization
- Owner-scoped Codex session ingestion for prompts, sessions, activity, ideas, and continuity
- A shared Idea → Task → ChatGPT prompt → Codex work-session workflow with active-time totals and meaningful timelines
- An OAuth-protected remote MCP resource server with bounded Dashboard tools (implemented locally; not connected until a real authenticated call succeeds)

GitHub-backed projects remain normal dashboard workbenches. Synchronization adds namespaced source metadata without replacing protected manual project fields or related work.

## GitHub synchronization

Milestone 2 imports every repository visible to the configured fine-grained GitHub token:

- Public
- Private
- Archived
- Forked

There is no repository-selection screen or per-repository allowlist.

The GitHub token and dashboard owner UID are server-side Secret Manager values. They never enter browser code, NEXT_PUBLIC variables, Firestore, localStorage, logs, tests, reports, or Git.

A fine-grained token is limited to one selected resource owner. All repositories therefore means all token-visible repositories for that owner. Repositories spanning several owners require a future multi-token or GitHub App design.

See:

- docs/GITHUB_IMPORT_CONTRACT.md
- docs/CODEX_SESSION_INGESTION.md
- docs/SECURITY.md
- docs/FIREBASE_SETUP.md
- docs/DEPLOYMENT.md

## Codex session ingestion

The `ingestCodexSession` HTTPS Function accepts a bounded V1 session report from the shared local helper. It records semantic work context—why work happened, what Codex completed, what remains, and what should happen next—without replacing GitHub repository facts or unrelated Dashboard-owned data. Matching is exact and identity-based; V1 never fuzzy-matches a title or creates a project automatically.

After the Function and its purpose-limited credential are configured, another repository can report a prepared JSON payload with:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs complete --file /path/to/codex-session.json

It can first verify the exact GitHub association with a zero-write request; `--json` emits only the safe project ID, title, and match method needed for an inventory:

    node /home/marwan/Documents/developer-dashboard/tools/report-codex-session.mjs verify --github-full-name example-owner/example-repository --json

The helper reads its endpoint and credential from `DEVELOPER_DASHBOARD_CODEX_INGEST_URL` and `DEVELOPER_DASHBOARD_CODEX_INGEST_TOKEN`. Never put the credential in a command argument or repository file. See `docs/CODEX_SESSION_INGESTION.md` for the exact payload, setup, safety policy, and reusable `AGENTS.md` instruction.

This capability does not make every Codex session automatic by itself. Each external project must opt in by configuring the environment and adopting the end-of-session instruction.

## Technology

- Next.js App Router
- Strict TypeScript
- React
- Tailwind CSS
- Zod
- Firebase Authentication
- Cloud Firestore
- Firebase Functions v2
- Firebase App Hosting

## Local commands

    npm install
    npm run dev
    npm run lint
    npm run typecheck
    npm test
    npm run test:rules
    npm run build
    npm run report:codex-session -- complete --file /path/to/codex-session.json
    npm run report:codex-session -- verify --github-full-name example-owner/example-repository --json

Functions and Firestore validation are documented in docs/SETUP.md.

The complete shared workflow is documented in [docs/SHARED_WORKFLOW.md](docs/SHARED_WORKFLOW.md). The ChatGPT connection and tool contracts are in [docs/CHATGPT_MCP.md](docs/CHATGPT_MCP.md), and the compatibility/rollback plan is in [docs/MIGRATION_V2.md](docs/MIGRATION_V2.md).

## Current release status

Firebase Authentication, UID-scoped Firestore persistence, signed-out local mode, migration, App Hosting configuration, and owner-only GitHub synchronization are implemented in the current working tree. If browser storage rejects a local save, current-tab work stays visible across authentication reruns with an explicit not-durable warning and the Dashboard remains usable. Guarded cloud-recovery replay refuses to overwrite later remote edits, including remote-only fields before a whole-document delete. Authored prose/Markdown is not trimmed by capture, reducer, persistence, or hydration paths. The first successful owner-triggered manual import enables later scheduled synchronization; successful scheduled-day completion is independent of later manual status and prevents duplicate same-day delivery from rewriting its audit.

The Firebase/GitHub release and project-workbench dynamic-route repair are on GitHub `main`. The production App Hosting routes and backend inventory were reverified on 2026-08-11; that automated evidence is not a substitute for authenticated physical cross-device acceptance. A changed working tree or documented capability is live only after its own deployment evidence is recorded. No deployment is authorized by this document.

See `CODEX_STATUS.md` for the sole current operational record and the exact local validation evidence.
