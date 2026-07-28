import { ActivityEvent, DashboardData, DevelopmentSession, Task } from "../models";
import { toDisplayDate } from "../utils/time";

const formatDate = (value?: string | null) => {
  return toDisplayDate(value || undefined);
};

type SortableRecord = {
  updatedAt?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

function dateOf<T extends SortableRecord>(item: T): number {
  const date =
    item.updatedAt || item.createdAt || item.startedAt || item.endedAt || 0;
  return new Date(typeof date === "string" ? date : 0).getTime();
}

function recentByUpdatedWithDate<T extends SortableRecord>(items: T[], limit = 8): T[] {
  return [...items]
    .sort((a, b) => dateOf(b) - dateOf(a))
    .slice(0, limit);
}

function toBullets(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

export function generateAiContext(data: DashboardData, projectId: string): string {
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");

  const tasks = data.tasks.filter((task) => task.projectId === projectId);
  const sessions = data.developmentSessions.filter((session) => session.projectId === projectId);
  const decisions = data.architectureDecisions.filter((decision) => decision.projectId === projectId);
  const prompts = data.codexPrompts.filter((prompt) => prompt.projectId === projectId);
  const links = data.importantLinks.filter((link) => link.projectId === projectId);
  const notes = data.notes.filter((note) => note.projectId === projectId);
  const scratchpads = data.scratchpads.filter((scratch) => scratch.projectId === projectId);
  const activities = data.activities.filter((item) => item.projectId === projectId) as ActivityEvent[];

  const inProgressTask = tasks.find((task) => task.status === "in_progress");
  const completedTasks = recentByUpdatedWithDate(tasks.filter((task) => task.status === "completed"));
  const blockers = tasks.filter((task) => task.status === "blocked");

  return [
    "# AI_CONTEXT.md",
    `Generated: ${toDisplayDate(new Date().toISOString())}`,
    "",
    "## Project",
    `- What: ${project.title}`,
    `- Purpose: ${project.purpose}`,
    `- Current status: ${project.status}`,
    `- Current branch: ${project.currentBranch}`,
    `- Current objective: ${project.currentObjective || "Not defined"}`,
    `- Current blocker: ${project.currentBlocker || "None"}`,
    `- Next recommended task: ${project.nextRecommendedTask || "Not defined"}`,
    "",
    "## Recent progress",
    `- Completed work: ${toBullets(completedTasks.map((task: Task) => task.title))}`,
    `- In-progress work: ${inProgressTask ? inProgressTask.title : "None"}`,
    `- Active blockers: ${toBullets(blockers.map((task) => `${task.title}: ${task.blockedReason || "No reason captured"}`))}`,
    `- Last worked: ${formatDate(project.lastWorkedAt)}`,
    "",
    "## Recent architecture decisions",
    `${toBullets(
      recentByUpdatedWithDate(decisions).map((item) => `${item.title} (${item.status}) — ${item.decision}`),
    )}`,
    "",
    "## Important prompts",
    `${toBullets(
      recentByUpdatedWithDate(prompts).map(
        (item) => `${item.title} [${item.status}] (${item.lastUsedAt ? `last used ${formatDate(item.lastUsedAt)}` : "not used"})`,
      ),
    )}`,
    "",
    "## Outstanding bugs",
    `${toBullets(
      blockers
        .filter((task) => task.type === "bug")
        .map((task) => `${task.title} — ${task.blockedReason || "open"}`),
    )}`,
    "",
    "## Recent sessions",
    `${toBullets(
      recentByUpdatedWithDate(sessions).map((session: DevelopmentSession) => {
        return `${formatDate(session.startedAt)} — ${session.objective}`;
      }),
    )}`,
    "",
    "## Links",
    `${toBullets(links.map((link) => `${link.title}: ${link.url}`))}`,
    "",
    "## Scratchpad snapshot",
    `${toBullets(
      scratchpads.map((scratch) => scratch.markdown.split(/\n{2,}/).at(0)?.slice(0, 200) || "(empty)"),
    )}`,
    "",
    "## Recent notes",
    `${toBullets(notes.map((note) => `${note.title} (${note.section})`))}`,
    "",
    "## Recent activity",
    `${recentByUpdatedWithDate(activities).map((item: ActivityEvent) => `- ${formatDate(item.createdAt)} ${item.summary}`).join("\n") || "- None"}`,
    "",
    "> Warning: the AI agent must inspect the repository directly and should not assume this summary is complete.",
    "",
  ].join("\n");
}
