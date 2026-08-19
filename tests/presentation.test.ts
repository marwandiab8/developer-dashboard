import { describe, expect, it } from "vitest";
import type { ActivityEvent, Task } from "../src/lib/models";
import {
  getCurrentTask,
  getMeaningfulActivities,
  getProjectDisplayStatus,
  hasActualBlocker,
  sortProjectsByRecency,
} from "../src/lib/presentation";
import { seedDashboardData } from "../src/lib/seed";

describe("dashboard presentation rules", () => {
  it("distinguishes Active, Paused, and Blocked without treating placeholder text as a blocker", () => {
    const data = seedDashboardData();
    const gridline = data.projects[0];
    const timeLeft = data.projects[1];
    const darts = data.projects[3];

    expect(hasActualBlocker("None.")).toBe(false);
    expect(hasActualBlocker("  no blocker ")).toBe(false);
    expect(hasActualBlocker("Waiting for API access")).toBe(true);
    expect(getProjectDisplayStatus(gridline, data.tasks.filter((task) => task.projectId === gridline.id)))
      .toBe("Blocked");
    expect(getProjectDisplayStatus(timeLeft)).toBe("Active");
    expect(getProjectDisplayStatus(darts)).toBe("Paused");
    expect(getProjectDisplayStatus({ ...timeLeft, manualStatus: "blocked" })).toBe("Blocked");
  });

  it("selects the most actionable task and sorts projects by last-worked recency", () => {
    const data = seedDashboardData();
    const readyTask = data.tasks[0];
    const inProgressTask: Task = {
      ...readyTask,
      id: "99999999-1111-4111-8111-111111111111",
      title: "Already in progress",
      status: "in_progress",
      priority: "low",
    };

    expect(getCurrentTask([readyTask, inProgressTask])?.id).toBe(inProgressTask.id);

    const older = { ...data.projects[0], lastWorkedAt: "2026-08-10T00:00:00.000Z" };
    const newer = { ...data.projects[1], lastWorkedAt: "2026-08-18T00:00:00.000Z" };
    expect(sortProjectsByRecency([older, newer]).map((project) => project.id))
      .toEqual([newer.id, older.id]);
  });

  it("removes raw GitHub activity and repeated summaries from meaningful changes", () => {
    const base: ActivityEvent = {
      id: "77777777-1111-4111-8111-111111111111",
      projectId: "11111111-1111-4111-8111-111111111111",
      type: "task_completed",
      summary: "Finished the navigation redesign.",
      entityType: "task",
      entityId: "88888888-1111-4111-8111-111111111111",
      metadata: "",
      createdAt: "2026-08-18T13:00:00.000Z",
    };
    const activities: ActivityEvent[] = [
      base,
      { ...base, id: "77777777-1111-4111-8111-111111111112", createdAt: "2026-08-18T12:00:00.000Z" },
      {
        ...base,
        id: "77777777-1111-4111-8111-111111111113",
        type: "github_repository_updated",
        summary: "[github_repository_updated] Repository metadata refreshed.",
      },
    ];

    expect(getMeaningfulActivities(activities)).toEqual([base]);
  });
});
