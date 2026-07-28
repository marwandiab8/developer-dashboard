# Developer Dashboard

Personal external development brain for fast idea capture, project continuity, architectural memory, and resume-ready context.

## Purpose

The app is designed to keep you productive across many software projects by making it easy to:

- Capture ideas quickly from any device
- Preserve architecture decisions and project rationale
- Track tasks, sessions, prompts, links, notes, and activity
- Generate resume/context artifacts for humans and AI coding assistants

## Tech stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Local-first persistence via browser storage (Phase 1A)
- Firebase Authentication + Firestore + Hosting planned for Phase 1B

## Current status

Phase 1A is implemented as a local-first brain with these capabilities:

- Dashboard home with project/task/idea/session views
- Per-project Workbench
- Quick Capture (project + text, classification optional)
- Idea inbox + task conversion flow
- Brain Dump and Scratchpad
- Development sessions
- Architecture Decisions, Codex prompts, notes, links, activity
- Resume generation (`PROJECT_RESUME.md`) and AI context generation (`AI_CONTEXT.md`)
- Seed data for core projects
- Search across major entities

## Scripts

- `npm run install` (if needed) to install dependencies
- `npm run dev` – start local dev server
- `npm run lint` – run linting
- `npm run typecheck` – run TypeScript check
- `npm test` – run Vitest suite
- `npm run build` – build Next.js production bundle

## Developer notes

Data is intentionally repository-agnostic and persisted locally so you can start using the dashboard immediately. Future releases swap the repository layer for Firebase without changing the app domain model.
