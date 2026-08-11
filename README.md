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
- docs/SECURITY.md
- docs/FIREBASE_SETUP.md
- docs/DEPLOYMENT.md

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

Functions and Firestore validation are documented in docs/SETUP.md.

## Current release status

Firebase Authentication, UID-scoped Firestore persistence, signed-out local mode, migration, App Hosting configuration, and owner-only GitHub synchronization are implemented in the current working tree. If browser storage rejects a local save, current-tab work stays visible across authentication reruns with an explicit not-durable warning and the Dashboard remains usable. Guarded cloud-recovery replay refuses to overwrite later remote edits, including remote-only fields before a whole-document delete. Authored prose/Markdown is not trimmed by capture, reducer, persistence, or hydration paths. The first successful owner-triggered manual import enables later scheduled synchronization; successful scheduled-day completion is independent of later manual status and prevents duplicate same-day delivery from rewriting its audit.

The GitHub `main` branch is stale and does not yet contain this working tree. Historical records show that Functions, the scheduler, and App Hosting were deployed on 2026-08-06, but production and physical cross-device/browser behavior were not reverified during the current remediation and must not be described as currently verified. No deployment is authorized by this document.

See `CODEX_STATUS.md` for the sole current operational record and the exact local validation evidence.
