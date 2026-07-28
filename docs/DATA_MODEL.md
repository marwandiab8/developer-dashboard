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
- On load: if no data exists, seed data is loaded and persisted
- On mismatch/invalid payload: migration/fallback keeps app usable
