# AGENTS

## Project purpose

Developer Dashboard is a local-first development brain for capture and continuity.

## Repository map

- `src/app/` – app routes (`/`, `/projects`, `/ideas`, `/tasks`, `/sessions`, `/search`)
- `src/components/` – shell/navigation + global quick capture dialog
- `src/lib/` – domain models, validation, repository layer, seed, markdown generators
- `src/lib/repositories/` – reducer + local adapter + context provider
- `tests/` – unit tests for validation, reducer, search, and generation
- `docs/` – architecture, data model, setup, roadmap

## Commands

- `npm install`
- `npm run dev`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Coding conventions

- Strict TypeScript for app and library code
- Validation at repository boundaries with Zod
- Repository-first architecture with adapters in `src/lib/repositories/adapters`
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

## Safety rules

- No Firebase/Auth/firestore integration in Phase 1A
- No automatic git scans or destructive writes outside requested commands
- Preserve unrelated existing work

## Definition of done

- Dashboard is usable locally without backend services
- Quick capture works from common screens
- Critical Phase 1A entities are persisted and searchable
- Resume and AI context artifacts are generated and copy/downloadable
- Lint, typecheck, tests, and build succeed

## Notes

- Firebase/Auth/Firestore integration deferred to Phase 1B.
