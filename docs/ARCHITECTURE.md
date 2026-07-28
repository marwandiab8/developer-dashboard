# Architecture (Phase 1A)

## High-level layers

- UI (Next.js App Router)
  - Routes in `src/app`
  - Shared layout and shell in `src/components/AppShell`
- Domain layer (`src/lib`)
  - Types + schema validation
  - Repository actions in context provider
  - Markdown generators for resume/context
- Persistence layer
  - Repository abstraction (`DashboardRepository`)
  - Local adapter (`src/lib/repositories/localAdapter.ts`) backed by `localStorage`
  - Data migration via schema versioning

## Data flow

1. App initializes repository via provider
2. Provider loads and validates persisted dashboard data
3. User actions dispatch reducer updates
4. Reducer returns new state and provider persists
5. Optional activity events are appended for meaningful actions

## Repository boundary

All UI features should use `useDashboard()` methods. UI should not directly call `localStorage`.

## Future migration plan

Phase 1B adds a Firestore adapter with the same repository contract.
