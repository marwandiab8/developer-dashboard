import type { ActivityEvent, Project, Task } from "./models";

export type ProjectDisplayStatus = "Active" | "Paused" | "Blocked";

const EMPTY_BLOCKER_VALUES = new Set([
  "none",
  "none.",
  "no blocker",
  "no blockers",
  "n/a",
  "not applicable",
]);

const taskStatusRank: Record<Task["status"], number> = {
  in_progress: 0,
  blocked: 1,
  ready: 2,
  open: 3,
  testing: 1,
  backlog: 3,
  completed: 4,
  cancelled: 5,
};

const priorityRank: Record<Task["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function hasActualBlocker(value?: string): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 && !EMPTY_BLOCKER_VALUES.has(normalized);
}

export function getCurrentTask(tasks: Task[]): Task | undefined {
  return [...tasks]
    .filter((task) => !["completed", "cancelled"].includes(task.status))
    .sort((a, b) => {
      const statusDifference = taskStatusRank[a.status] - taskStatusRank[b.status];
      if (statusDifference !== 0) return statusDifference;

      const priorityDifference = priorityRank[a.priority] - priorityRank[b.priority];
      if (priorityDifference !== 0) return priorityDifference;

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0];
}

export function getProjectDisplayStatus(project: Project, tasks: Task[] = []): ProjectDisplayStatus {
  if (project.manualStatus === "blocked") return "Blocked";
  if (["planning", "paused", "completed", "archived"].includes(project.manualStatus ?? "")) {
    return "Paused";
  }

  if (project.manualStatus !== "active" && project.status !== "active") return "Paused";
  if (hasActualBlocker(project.currentBlocker) || tasks.some((task) => task.status === "blocked")) {
    return "Blocked";
  }

  return "Active";
}

export function getProjectFocus(project: Project, tasks: Task[] = []): string {
  return project.currentObjective.trim()
    || getCurrentTask(tasks)?.title
    || project.nextRecommendedTask.trim()
    || project.purpose.trim();
}

export function projectRecency(project: Project): number {
  const value = project.lastWorkedAt || project.updatedAt;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortProjectsByRecency(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => projectRecency(b) - projectRecency(a));
}

const hiddenActivityTypes = new Set<ActivityEvent["type"]>([
  "github_repository_imported",
  "github_repository_updated",
  "github_repository_unavailable",
]);

export function getMeaningfulActivities(activities: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>();

  return [...activities]
    .filter((activity) => !hiddenActivityTypes.has(activity.type))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .filter((activity) => {
      const key = activity.summary.trim().replace(/\s+/g, " ").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
