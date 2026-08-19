import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/lib/constants";
import { generateTaskPrompt } from "../src/lib/markdown/generateTaskPrompt";
import { createMigrationLayer } from "../src/lib/repositories/localAdapter";
import { dashboardReducer } from "../src/lib/repositories/reducer";
import { seedDashboardData } from "../src/lib/seed";
import {
  buildProjectTimeline,
  buildTaskQueue,
  calculateProjectActiveDuration,
  calculateSessionActiveDuration,
  formatActiveDuration,
  groupTimelineByDate,
} from "../src/lib/workflow";

describe("shared development workflow", () => {
  it("migrates V1 lifecycle values idempotently without dropping records", () => {
    const legacy = structuredClone(seedDashboardData());
    legacy.schemaVersion = 1;
    legacy.ideas[1].status = "accepted";
    legacy.tasks[0].status = "backlog";
    legacy.codexPrompts[0].status = "used";

    const migrated = createMigrationLayer(legacy);
    const retried = createMigrationLayer(migrated);

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.projects).toHaveLength(legacy.projects.length);
    expect(migrated.ideas[1]).toMatchObject({ status: "ready_for_review", legacyStatus: "accepted" });
    expect(migrated.tasks[0]).toMatchObject({ status: "open", legacyStatus: "backlog" });
    expect(migrated.codexPrompts[0]).toMatchObject({ status: "completed", legacyStatus: "used" });
    expect(retried).toEqual(migrated);
  });

  it("orders the task queue by lifecycle, priority, then recency", () => {
    const data = seedDashboardData();
    const template = data.tasks[0];
    const queue = buildTaskQueue([
      { ...template, id: "10000000-0000-4000-8000-000000000001", status: "open", priority: "critical" },
      { ...template, id: "10000000-0000-4000-8000-000000000002", status: "ready", priority: "low" },
      { ...template, id: "10000000-0000-4000-8000-000000000003", status: "blocked", priority: "medium" },
      { ...template, id: "10000000-0000-4000-8000-000000000004", status: "in_progress", priority: "low" },
    ]);
    expect(queue.map((task) => task.status)).toEqual(["in_progress", "blocked", "ready", "open"]);
  });

  it("counts only bounded active work and never grows an abandoned timer without limit", () => {
    const session = {
      ...seedDashboardData().developmentSessions[0],
      id: "20000000-0000-4000-8000-000000000001",
      status: "active" as const,
      startedAt: "2026-08-19T08:00:00.000Z",
      activeStartedAt: "2026-08-19T08:00:00.000Z",
      activeDurationMs: 30 * 60_000,
      endedAt: null,
    };
    const duration = calculateSessionActiveDuration(session, new Date("2026-08-20T08:00:00.000Z"));
    expect(duration).toBe(4.5 * 60 * 60_000);
    expect(formatActiveDuration(duration)).toBe("4h 30m");
  });

  it("pauses, resumes, and finishes a task session without counting paused time twice", () => {
    const data = seedDashboardData();
    const task = data.tasks[0];
    const session = {
      ...data.developmentSessions[0],
      id: "20000000-0000-4000-8000-000000000002",
      taskId: task.id,
      startedAt: "2026-08-19T09:00:00.000Z",
      endedAt: null,
      status: "active" as const,
      activeStartedAt: "2026-08-19T09:00:00.000Z",
      activeDurationMs: 0,
    };
    const started = dashboardReducer({ ...data, developmentSessions: [session] }, { type: "seed", payload: { ...data, developmentSessions: [session] } });
    const paused = dashboardReducer(started, {
      type: "session_pause",
      payload: { id: session.id, at: "2026-08-19T10:00:00.000Z" },
    });
    const resumed = dashboardReducer(paused, {
      type: "session_resume",
      payload: { id: session.id, at: "2026-08-19T12:00:00.000Z" },
    });
    const finished = dashboardReducer(resumed, {
      type: "session_finish",
      payload: { id: session.id, at: "2026-08-19T12:30:00.000Z", status: "completed", updates: {} },
    });
    expect(finished.developmentSessions[0].activeDurationMs).toBe(90 * 60_000);
    expect(calculateProjectActiveDuration(finished.developmentSessions, task.projectId)).toBe(90 * 60_000);
  });

  it("links a started work session to its prompt and task in both directions", () => {
    const data = seedDashboardData();
    const task = data.tasks[0];
    const prompt = { ...data.codexPrompts[0], relatedTaskId: task.id, status: "prepared" as const };
    const session = {
      ...data.developmentSessions[0],
      id: "20000000-0000-4000-8000-000000000003",
      projectId: task.projectId,
      taskId: task.id,
      promptRecordId: prompt.id,
      status: "active" as const,
      startedAt: "2026-08-19T13:00:00.000Z",
      activeStartedAt: "2026-08-19T13:00:00.000Z",
      endedAt: null,
    };
    const next = dashboardReducer({ ...data, codexPrompts: [prompt] }, {
      type: "session_start",
      payload: session,
    });
    expect(next.tasks.find((candidate) => candidate.id === task.id)?.workSessionIds).toContain(session.id);
    expect(next.codexPrompts[0]).toMatchObject({ relatedSessionId: session.id, status: "started" });
  });

  it("builds meaningful daily timelines without routine GitHub synchronization", () => {
    const data = seedDashboardData();
    data.activities.push({
      id: "30000000-0000-4000-8000-000000000001",
      projectId: data.projects[0].id,
      type: "github_repository_updated",
      summary: "[github_repository_updated] refreshed",
      entityType: "project",
      entityId: data.projects[0].id,
      metadata: "internal",
      createdAt: "2026-08-19T12:00:00.000Z",
    });
    const timeline = buildProjectTimeline(data, data.projects[0].id);
    expect(timeline.some((entry) => entry.summary.includes("github_repository_updated"))).toBe(false);
    expect(groupTimelineByDate(timeline).every((day) => day.entries.length > 0)).toBe(true);
    expect(timeline.filter((entry) => entry.kind === "prompt").every((entry) => entry.activeDurationMs === 0)).toBe(true);
  });

  it("generates all required Codex prompt sections with the dashboard summary last", () => {
    const data = seedDashboardData();
    const prompt = generateTaskPrompt(
      data,
      data.projects[0].id,
      data.tasks[0].id,
      "Implement the queued location matching task safely.",
    );
    for (let section = 1; section <= 13; section += 1) {
      expect(prompt).toContain(`## ${section}.`);
    }
    expect(prompt.trim().endsWith("Implement the queued location matching task safely.")).toBe(true);
    expect(prompt).toContain("## Dashboard change summary");
  });
});
