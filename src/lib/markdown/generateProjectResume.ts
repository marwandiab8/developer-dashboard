import { ActivityEvent, DashboardData, Idea, ArchitectureDecision, DevelopmentSession } from "../models";
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
  const date = item.updatedAt || item.createdAt || item.endedAt || item.startedAt || 0;
  return new Date(typeof date === "string" ? date : 0).getTime();
}

function recent<T extends SortableRecord>(items: T[], limit = 8): T[] {
  return [...items]
    .sort((a, b) => dateOf(b) - dateOf(a))
    .slice(0, limit);
}

function bullets(values: string[]): string {
  return values.length ? values.map((item) => `- ${item}`).join("\n") : "- None";
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isMeaningfulBlocker(value: string): boolean {
  return !/^(none|no blocker)\.?$/i.test(value.trim());
}

export function generateProjectResume(data: DashboardData, projectId: string): string {
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");

  const ideas = data.ideas.filter((idea) => idea.projectId === projectId);
  const tasks = data.tasks.filter((task) => task.projectId === projectId);
  const sessions = data.developmentSessions.filter((session) => session.projectId === projectId);
  const decisions = data.architectureDecisions.filter((item) => item.projectId === projectId);
  const links = data.importantLinks.filter((item) => item.projectId === projectId);
  const activities = data.activities.filter((activity) => activity.projectId === projectId) as ActivityEvent[];

  const inProgressTask = tasks.find((task) => task.status === "in_progress");
  const unfinished = tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const completed = recent(tasks.filter((task) => task.status === "completed"));
  const blockers = tasks.filter((task) => task.status === "blocked");
  const futureIdeas = recent(ideas.filter((idea) => idea.status === "inbox" || idea.status === "reviewed"));
  const recentSessions = recent(sessions);
  const sessionCompleted = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.completedItems ?? []),
  );
  const sessionUnfinished = uniqueNonEmpty(
    recentSessions.flatMap((session) => session.unfinishedItems ?? []),
  );
  const sessionProblems = uniqueNonEmpty(
    recentSessions.flatMap((session) => [
      ...session.problemsDiscovered,
      ...(session.currentBlocker && isMeaningfulBlocker(session.currentBlocker)
        ? [session.currentBlocker]
        : []),
    ]),
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
    "# PROJECT_RESUME.md",
    `Generated: ${toDisplayDate(new Date().toISOString())}`,
    "",
    "## What this project is",
    project.purpose,
    "",
    "## Why it exists",
    "To preserve a fast project memory so work can resume without context loss across long interruptions.",
    "",
    "## Current status",
    `Status: ${project.status}`,
    `Current branch: ${project.currentBranch}`,
    `Last worked: ${formatDate(project.lastWorkedAt)}`,
    "",
    "## Current architecture",
    `Current objective: ${project.currentObjective || "Not defined"}`,
    "",
    "## What currently works",
    bullets([...completed.map((task) => task.title), ...sessionCompleted]),
    "",
    "## What remains unfinished",
    bullets([
      ...unfinished.map((task) => `${task.title} (${task.status})`),
      ...sessionUnfinished,
    ]),
    "",
    "## Current blocker",
    project.currentBlocker || "None",
    "",
    "## Current in-progress work",
    inProgressTask ? `- ${inProgressTask.title}` : "- None",
    "",
    "## Recently completed work",
    bullets([
      ...completed.map((task) => `${task.title} - ${formatDate(task.completedAt)} (${task.type})`),
      ...sessionCompleted,
    ]),
    "",
    "## Current architecture decisions",
    bullets(recent(decisions).map((decision: ArchitectureDecision) => `${decision.title}: ${decision.decision}`)),
    "",
    "## Important links",
    bullets(links.map((link) => `${link.title}: ${link.url}`)),
    "",
    "## Recent ideas",
    bullets(recent(ideas).map((idea: Idea) => `${idea.text} [${idea.status}]`)),
    "",
    "## Recent sessions",
    bullets(recentSessions.map((session: DevelopmentSession) =>
      `${session.objective} (${formatDate(session.startedAt)})${session.source === "codex" ? " [Codex]" : ""}${session.branch ? ` [branch ${session.branch}]` : ""}${session.summary ? ` — ${session.summary}` : ""}`)),
    "",
    "## Problems discovered during recent sessions",
    bullets(sessionProblems),
    "",
    "## Implementation decisions from recent sessions",
    bullets(sessionDecisions),
    "",
    "## Recently modified files",
    bullets(sessionFiles),
    "",
    "## Recent commits",
    bullets(sessionCommits),
    "",
    "## Next recommended work",
    bullets(nextSteps),
    "",
    "## Future ideas",
    bullets(futureIdeas.map((idea) => idea.text)),
    "",
    "## Recent activity",
    bullets(recent(activities).map((activity) => `${formatDate(activity.createdAt)} — ${activity.summary}`)),
    "",
    "## Outstanding bugs",
    bullets(
      blockers
        .filter((task) => task.type === "bug")
        .map((task) => `${task.title} — ${task.blockedReason || "blocked"}`),
    ),
    "",
    "## What not to touch",
    "- Avoid major refactors during active sessions without first updating architecture decisions and session notes.",
    "- Do not mark tasks complete until implementation notes and session outcome are recorded.",
    "",
    "## Lessons learned",
    "- Preserve references as soon as decisions are made.",
    "- Link ideas to tasks so resume can preserve why work started.",
    "- Keep this document regenerated when context changes.",
    "",
    `## Active tasks\n${bullets(unfinished.map((task) => task.title))}`,
  ].join("\n");
}
