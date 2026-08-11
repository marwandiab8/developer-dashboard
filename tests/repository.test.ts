import { beforeEach, describe, expect, it } from "vitest";
import { dashboardReducer } from "../src/lib/repositories/reducer";
import { seedDashboardData } from "../src/lib/seed";
import { dashboardDataSchema } from "../src/lib/validation";
import { createMigrationLayer, loadDashboardData, saveDashboardData } from "../src/lib/repositories/localAdapter";
import { SCHEMA_VERSION, STORAGE_KEY } from "../src/lib/constants";

beforeEach(() => {
  localStorage.clear();
});

describe("local dashboard repository adapter", () => {
  it("hydrates persisted dashboard data from localStorage", () => {
    const seeded = seedDashboardData();
    const withHydratedProject = {
      ...seeded,
      projects: seeded.projects.map((project) =>
        project.id === seeded.projects[0].id ? { ...project, title: "Hydrated project title" } : project,
      ),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(withHydratedProject));

    const loaded = loadDashboardData();
    expect(loaded.projects[0].title).toBe("Hydrated project title");
  });

  it("persists and reloads dashboard data", () => {
    const seed = seedDashboardData();
    saveDashboardData(seed);
    const loaded = loadDashboardData();
    expect(loaded.projects.length).toBe(seed.projects.length);
    expect(loaded.schemaVersion).toBe(seed.schemaVersion);
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });
});

describe("dashboard reducer", () => {
  it("preserves idea when converted to task", () => {
    const seed = seedDashboardData();
    const source = seed.ideas[0];
    const task = {
      id: "t-test-id",
      projectId: source.projectId,
      title: source.text,
      details: source.description,
      type: "feature" as const,
      status: "ready" as const,
      priority: source.priority,
      blockedReason: "",
      sourceIdeaId: source.id,
      acceptanceCriteria: "",
      implementationNotes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };

    const next = dashboardReducer(seed, {
      type: "idea_to_task",
      payload: {
        ideaId: source.id,
        taskId: task.id,
        task,
      },
    });

    const idea = next.ideas.find((entry) => entry.id === source.id);
    const insertedTask = next.tasks.find((item) => item.id === "t-test-id");

    expect(idea?.status).toBe("converted");
    expect(idea?.linkedTaskId).toBe("t-test-id");
    expect(insertedTask).toBeTruthy();
  });

  it("marks task complete with completedAt", () => {
    const seed = seedDashboardData();
    const id = seed.tasks[0].id;
    const next = dashboardReducer(seed, { type: "task_complete", payload: { id } });
    const task = next.tasks.find((entry) => entry.id === id);
    expect(task?.status).toBe("completed");
    expect(task?.completedAt).toBeTruthy();
  });

  it("completes a session with endedAt and status", () => {
    const seed = seedDashboardData();
    const session = seed.developmentSessions[0];
    const next = dashboardReducer(seed, {
      type: "session_end",
      payload: { id: session.id, updates: { summary: "Session complete", nextStartingPoint: "Next objective" } },
    });
    const updated = next.developmentSessions.find((entry) => entry.id === session.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.endedAt).toBeTruthy();
    expect(updated?.summary).toBe("Session complete");
  });

  it("preserves authored whitespace when appending a session note", () => {
    const seed = seedDashboardData();
    const session = seed.developmentSessions[0];
    const existingNotes = "\n  existing session note  \n";
    const appendedNote = "  indented\n    child\n\n";
    const withExactNotes = {
      ...seed,
      developmentSessions: seed.developmentSessions.map((entry) =>
        entry.id === session.id ? { ...entry, notes: existingNotes } : entry,
      ),
    };

    const next = dashboardReducer(withExactNotes, {
      type: "session_note_append",
      payload: { id: session.id, note: appendedNote },
    });

    expect(next.developmentSessions.find((entry) => entry.id === session.id)?.notes)
      .toBe(`${existingNotes}\n\n${appendedNote}`);
  });

  it("does not duplicate a deterministic GitHub activity", () => {
    const seed = seedDashboardData();
    const activity = {
      id: "89c84c74-f28d-5e09-8dd1-c6e8f5ee1fd2",
      projectId: seed.projects[0].id,
      type: "github_repository_updated" as const,
      summary: "Updated GitHub repository metadata",
      entityType: "project",
      entityId: seed.projects[0].id,
      metadata: "github:12345",
      createdAt: "2026-08-07T12:00:00.000Z",
    };

    const once = dashboardReducer(seed, { type: "activity_add", payload: activity });
    const twice = dashboardReducer(once, { type: "activity_add", payload: activity });

    expect(twice.activities.filter((entry) => entry.id === activity.id)).toHaveLength(1);
  });

  it("supports schema migrations with local storage fallback", () => {
    const oldPayload = { ...seedDashboardData(), schemaVersion: SCHEMA_VERSION - 1, activities: [] };
    const migrated = createMigrationLayer(oldPayload);
    expect(dashboardDataSchema.parse(migrated)).toBeTruthy();
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);

    const raw = JSON.stringify(oldPayload);
    localStorage.setItem(STORAGE_KEY, raw);
    const loaded = loadDashboardData();
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
