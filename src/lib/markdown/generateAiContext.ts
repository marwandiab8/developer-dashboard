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
    item.updatedAt || item.createdAt || item.endedAt || item.startedAt || 0;
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

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isMeaningfulBlocker(value: string): boolean {
  return !/^(none|no blocker)\.?$/i.test(value.trim());
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
  const recentSessions = recentByUpdatedWithDate(sessions);
  const sessionCompleted = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.completedItems ?? []),
  );
  const sessionUnfinished = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.unfinishedItems ?? []),
  );
  const sessionProblems = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.problemsDiscovered),
  );
  const sessionCurrentBlockers = uniqueNonEmpty(
    recentSessions.flatMap((session) =>
      session.currentBlocker && isMeaningfulBlocker(session.currentBlocker)
        ? [session.currentBlocker]
        : [],
    ),
  );
  const sessionDecisions = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.decisionsMade),
  );
  const sessionFiles = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.filesModified),
  );
  const sessionCommits = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.commits),
  );
  const nextSteps = uniqueNonEmpty([
    project.nextRecommendedTask,
    ...recentSessions.map((session) => session.nextStartingPoint),
    ...sessionUnfinished,
  ]);

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
    `- Completed work: ${toBullets([
      ...completedTasks.map((task: Task) => task.title),
      ...sessionCompleted,
    ])}`,
    `- In-progress work: ${inProgressTask ? inProgressTask.title : "None"}`,
    `- Active blockers: ${toBullets([
      ...blockers.map((task) => `${task.title}: ${task.blockedReason || "No reason captured"}`),
      ...sessionCurrentBlockers,
    ])}`,
    `- Last worked: ${formatDate(project.lastWorkedAt)}`,
    "",
    "## Recent architecture decisions",
    `${toBullets(
      [
        ...recentByUpdatedWithDate(decisions).map(
          (item) => `${item.title} (${item.status}) — ${item.decision}`,
        ),
        ...sessionDecisions,
      ],
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
      recentSessions.map((session: DevelopmentSession) => {
        const attribution = session.source === "codex" ? " [Codex]" : "";
        const branch = session.branch ? ` [branch ${session.branch}]` : "";
        const summary = session.summary ? ` — ${session.summary}` : "";
        return `${formatDate(session.startedAt)} — ${session.objective}${attribution}${branch}${summary}`;
      }),
    )}`,
    "",
    "## Unfinished session work",
    `${toBullets(sessionUnfinished)}`,
    "",
    "## Problems discovered during recent sessions",
    `${toBullets(sessionProblems)}`,
    "",
    "## Files modified in recent sessions",
    `${toBullets(sessionFiles)}`,
    "",
    "## Commits from recent sessions",
    `${toBullets(sessionCommits)}`,
    "",
    "## Next recommended work",
    `${toBullets(nextSteps)}`,
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
