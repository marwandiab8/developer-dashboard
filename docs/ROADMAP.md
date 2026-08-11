# Roadmap

## Phase 1A: local development brain

Complete:

- Dashboard home and per-project workbench
- Quick Capture, ideas, tasks, brain dumps, scratchpads, and sessions
- Architecture decisions, Codex prompts, notes, links, and activity
- Search and seed data
- PROJECT_RESUME.md and AI_CONTEXT.md generation

## Phase 1B Milestone 1: Firebase foundation and GitHub merge contract

Complete:

- Firebase Authentication
- User-scoped Firestore repository architecture
- Immutable GitHub repository ID
- Centralized protected-field merge policy
- Zod validation
- Duplicate prevention and rename handling

## Phase 1B Milestone 2: secure GitHub synchronization

Implemented in the current local working tree:

- Owner-only Firebase Functions v2 callables
- Server-side Secret Manager token and owner UID
- All token-visible repositories with no selection UI
- Public, private, archived, and forked repository support
- Pagination beyond 100 repositories
- Bounded enrichment and partial-failure preservation
- Rate-limit reporting
- Safe Firebase association detection
- Conflict-safe Firestore mutation replay, immutable receipts, and deterministic activity
- Shared lease plus status-independent successful-day deduplication for callable and daily scheduled synchronization
- Dashboard connection, import, sync, count, error, badge, link, and project-status UI
- Manual-first-import gate and write-once first-success timestamp
- Signed-out local mode, current-tab continuity on browser-storage failure, and explicit persistence-degraded status
- Atomic create-if-absent local-to-cloud migration
- Backend-only synchronization state enforced by Firestore rules
- Direct allowlisted Firebase configuration discovery without repository-tree enumeration

Current release state:

- GitHub `main` contains the released Firebase/GitHub baseline and project-workbench dynamic-route repair.
- Current validation and deployment evidence belongs only in `CODEX_STATUS.md`; a changed working tree is not implicitly live.
- Production routes and backend inventory were reverified on 2026-08-11, while authenticated physical multi-device/browser acceptance remains a manual requirement.
- Any later deployment or live verification requires a separately approved operation.

## Later phases

- Multi-token support for repositories spanning several GitHub resource owners
- GitHub App installation model if organization-wide coverage is required
- Broader conflict-resolution UI for concurrent manual edits
- Live Codex or assistant process control
- Voice and Apple Shortcuts capture
- Automatic architecture and changelog summaries
