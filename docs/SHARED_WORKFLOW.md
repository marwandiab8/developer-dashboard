# Shared project-development workflow

Status: implemented locally in schema version 2. This document is not deployment evidence and does not authorize a production migration.

Developer Dashboard is the shared record of intent and work between Marwan, ChatGPT, and Codex. ChatGPT reads bounded Dashboard context and prepares a prompt; Codex works in the repository and reports results; Marwan retains control over task completion and deployment.

## Lifecycle

1. Marwan or ChatGPT creates an idea under one exact project. It starts in `inbox`.
2. Review moves the idea to `ready_for_review`; it may instead be archived.
3. Conversion creates one `ready` task, preserves the idea, sets `idea.linkedTaskId`, sets `task.sourceIdeaId`, and records `convertedAt` plus a plain-language timeline event. Repeating the conversion returns the existing task rather than creating another.
4. The task queue orders `in_progress`, `blocked`, `ready`, then `open`; completed and cancelled tasks remain available through filters and history.
5. ChatGPT retrieves the task by exact project ID and task ID, along with its source idea, project purpose and repository identity, acceptance criteria, earlier prompts and work, accepted decisions, resume, AI context, blocker, unfinished work, and next step.
6. ChatGPT prepares a Codex prompt. The Dashboard stores the mandatory plain-language summary as a new sequential prompt record before the prompt is handed to Codex. Earlier prompts are never overwritten.
7. A work session explicitly starts or resumes active-time tracking. Paused time does not count. A running but unclosed interval is capped at four hours until corrected, preventing unlimited totals.
8. Codex reports against the exact project, task, prompt record, work session, and external session IDs. The ingestion transaction updates the linked records and adds one meaningful timeline event. An identical retry does not duplicate duration or history.
9. Codex completing one prompt does not complete the task. Marwan explicitly moves the task to Completed, reopens it as Ready/Open, blocks it, or cancels it.

## Status meanings

Ideas use `inbox`, `ready_for_review`, `converted`, and `archived`. Legacy `reviewed` and `accepted` values read as Ready for review; legacy `rejected` reads as Archived.

Tasks use:

- `open`: accepted but not implementation-ready.
- `ready`: available for ChatGPT to prepare for Codex.
- `in_progress`: actively being worked.
- `blocked`: cannot proceed until its blocker is resolved.
- `completed`: explicitly accepted as finished.
- `cancelled`: intentionally closed without implementation.

Legacy `backlog` reads as Open and legacy `testing` reads as In progress.

Prompt records use `prepared`, `started`, `completed`, `failed`, or `superseded`. Work sessions use `active`, `paused`, `completed`, or `abandoned`.

## Time rules

- Task time is the sum of non-abandoned sessions linked to that exact task.
- Project time is the sum of non-abandoned task sessions linked to that project.
- Only accumulated active intervals count. Paused intervals do not.
- An active interval is provisionally capped at four hours until the session is finished or corrected.
- Finishing or correcting a session replaces that session's contribution; it does not add the whole value a second time.
- MCP and Codex reports are idempotent. A byte-equivalent retry returns the original result without adding duration.
- A manual correction creates an audit/timeline event.

## Timelines

Project timelines group meaningful idea, task, prompt, work-session, decision, progress, and blocker events by work date. They include the actor and daily active-time total. Routine GitHub import and synchronization messages are excluded.

Task timelines are chronological and include the source idea, conversion, status changes, prompt summaries, work sessions, blockers, decisions, completion/reopening, and active session duration.

## End-to-end example

1. Marwan captures idea `Add offline reconciliation status` in Project `Developer Dashboard`.
2. Marwan marks it Ready for review, then converts it. The original idea remains and links to Task `task-…`; the task links back and enters Ready.
3. ChatGPT calls `get_task_context` with the exact project/task IDs and drafts the required 14-section Codex prompt.
4. ChatGPT calls `create_task_prompt_record`. Prompt 1 stores the summary `Show a clear offline reconciliation state without hiding local work.`
5. `start_task_work_session` links Work Session 1 to Task 1 and Prompt 1. Codex implements locally for 1h 20m and reports completed work, tests, remaining work, and the next step.
6. The completion report changes Prompt 1 to Completed, finishes Work Session 1, adds exactly 1h 20m to the task/project totals, and creates one Codex timeline event. The task remains In progress.
7. Marwan reviews the result and explicitly marks the task Completed. The task timeline now shows Idea → Conversion → Prompt 1 → Codex session → Result → 1h 20m total → Completion.

## Data-preservation boundary

All workflow records remain under `users/{uid}`. GitHub synchronization owns only namespaced repository facts and calculated source activity. It cannot overwrite ideas, tasks, prompts, sessions, timelines, manual completion state, resumes, or AI context. No workflow step executes repository commands or deploys code.
