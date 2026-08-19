import type {
  ActivityEvent,
  CodexPrompt,
  DashboardData,
  DevelopmentSession,
  IdeaStatus,
  Task,
  TaskStatus,
  WorkflowActor,
} from "./models";

export const MAX_UNCLOSED_SESSION_MS = 4 * 60 * 60 * 1000;

export type CanonicalIdeaStatus = "inbox" | "ready_for_review" | "converted" | "archived";
export type CanonicalTaskStatus = "open" | "ready" | "in_progress" | "blocked" | "completed" | "cancelled";

export const normalizeIdeaStatus = (status: IdeaStatus): CanonicalIdeaStatus => {
  if (status === "reviewed" || status === "accepted") return "ready_for_review";
  if (status === "rejected") return "archived";
  return status;
};

export const normalizeTaskStatus = (status: TaskStatus): CanonicalTaskStatus => {
  if (status === "backlog") return "open";
  if (status === "testing") return "in_progress";
  return status;
};

export const normalizePromptStatus = (status: CodexPrompt["status"]): CodexPrompt["status"] => {
  if (status === "draft" || status === "ready") return "prepared";
  if (status === "used") return "completed";
  if (status === "archived") return "superseded";
  return status;
};

const millisecondsBetween = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start || !end) return 0;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return endMs - startMs;
};

export const calculateSessionActiveDuration = (
  session: DevelopmentSession,
  now = new Date(),
): number => {
  const accumulated = Number.isSafeInteger(session.activeDurationMs) && session.activeDurationMs >= 0
    ? session.activeDurationMs
    : 0;
  if (session.status !== "active" || !session.activeStartedAt) return accumulated;
  const running = millisecondsBetween(session.activeStartedAt, now.toISOString());
  return accumulated + Math.min(running, MAX_UNCLOSED_SESSION_MS);
};

export const calculateTaskActiveDuration = (
  sessions: DevelopmentSession[],
  taskId: string,
  now = new Date(),
) => sessions
  .filter((session) => session.taskId === taskId && session.status !== "abandoned")
  .reduce((total, session) => total + calculateSessionActiveDuration(session, now), 0);

export const calculateProjectActiveDuration = (
  sessions: DevelopmentSession[],
  projectId: string,
  now = new Date(),
) => sessions
  .filter((session) => session.projectId === projectId && session.status !== "abandoned")
  .reduce((total, session) => total + calculateSessionActiveDuration(session, now), 0);

export const formatActiveDuration = (durationMs: number): string => {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

const taskStatusRank: Record<CanonicalTaskStatus, number> = {
  in_progress: 0,
  blocked: 1,
  ready: 2,
  open: 3,
  completed: 4,
  cancelled: 5,
};

const priorityRank: Record<Task["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const timestamp = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

export type TaskQueueFilters = {
  projectId?: string;
  priority?: Task["priority"];
  status?: CanonicalTaskStatus;
  workedSince?: string;
};

export const buildTaskQueue = (tasks: Task[], filters: TaskQueueFilters = {}): Task[] => {
  const since = filters.workedSince ? timestamp(filters.workedSince) : 0;
  return tasks
    .filter((task) => {
      const status = normalizeTaskStatus(task.status);
      return (!filters.projectId || task.projectId === filters.projectId)
        && (!filters.priority || task.priority === filters.priority)
        && (!filters.status || status === filters.status)
        && (!since || timestamp(task.lastWorkedAt ?? task.updatedAt) >= since);
    })
    .sort((left, right) => {
      const statusDifference = taskStatusRank[normalizeTaskStatus(left.status)]
        - taskStatusRank[normalizeTaskStatus(right.status)];
      if (statusDifference !== 0) return statusDifference;
      const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityDifference !== 0) return priorityDifference;
      return timestamp(right.lastWorkedAt ?? right.updatedAt)
        - timestamp(left.lastWorkedAt ?? left.updatedAt);
    });
};

export type TimelineEntry = {
  id: string;
  projectId: string;
  taskId: string | null;
  occurredAt: string;
  actor: WorkflowActor;
  kind: "idea" | "task" | "prompt" | "session" | "decision" | "progress" | "blocker";
  summary: string;
  detail: string;
  activeDurationMs: number;
};

const actorForActivity = (activity: ActivityEvent): WorkflowActor =>
  activity.actor ?? (activity.source === "codex" ? "codex" : "marwan");

const meaningfulActivityTypes = new Set<ActivityEvent["type"]>([
  "idea_captured",
  "idea_converted",
  "idea_updated",
  "task_created",
  "task_started",
  "task_status_changed",
  "task_blocked",
  "task_reopened",
  "task_completed",
  "work_summary_added",
  "blocker_recorded",
  "decision_accepted",
]);

const activityKind = (activity: ActivityEvent): TimelineEntry["kind"] => {
  if (activity.type.startsWith("idea_")) return "idea";
  if (activity.type.includes("block")) return "blocker";
  if (activity.type.startsWith("task_")) return "task";
  if (activity.type === "decision_accepted") return "decision";
  return "progress";
};

export const buildProjectTimeline = (data: DashboardData, projectId: string): TimelineEntry[] => {
  const entries: TimelineEntry[] = [];

  data.activities
    .filter((activity) => activity.projectId === projectId && meaningfulActivityTypes.has(activity.type))
    .forEach((activity) => entries.push({
      id: `activity:${activity.id}`,
      projectId,
      taskId: activity.taskId ?? (activity.entityType === "task" ? activity.entityId : null),
      occurredAt: activity.createdAt,
      actor: actorForActivity(activity),
      kind: activityKind(activity),
      summary: activity.summary,
      detail: activity.metadata,
      activeDurationMs: 0,
    }));

  data.codexPrompts
    .filter((prompt) => prompt.projectId === projectId)
    .forEach((prompt) => entries.push({
      id: `prompt:${prompt.id}`,
      projectId,
      taskId: prompt.relatedTaskId,
      occurredAt: prompt.createdAt,
      actor: prompt.createdBy,
      kind: "prompt",
      summary: prompt.promptSummary || prompt.title,
      detail: prompt.requestedChange || prompt.purpose,
      // Prompt duration is attributable through its work session. Counting it
      // here would duplicate the same active interval in daily totals.
      activeDurationMs: 0,
    }));

  data.developmentSessions
    .filter((session) => session.projectId === projectId)
    .forEach((session) => entries.push({
      id: `session:${session.id}`,
      projectId,
      taskId: session.taskId,
      occurredAt: session.endedAt ?? session.startedAt,
      actor: session.source === "manual" ? "marwan" : session.source,
      kind: session.blocker ? "blocker" : "session",
      summary: session.summary || session.objective,
      detail: session.blocker || session.nextStep || session.nextStartingPoint,
      activeDurationMs: calculateSessionActiveDuration(session),
    }));

  return entries.sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt));
};

export const buildTaskTimeline = (data: DashboardData, taskId: string): TimelineEntry[] => {
  const task = data.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return [];
  const sourceIdea = task.sourceIdeaId
    ? data.ideas.find((idea) => idea.id === task.sourceIdeaId && idea.projectId === task.projectId)
    : undefined;
  const entries = buildProjectTimeline(data, task.projectId)
    .filter((entry) => entry.taskId === taskId);
  if (sourceIdea) {
    entries.push({
      id: `source-idea:${sourceIdea.id}`,
      projectId: task.projectId,
      taskId,
      occurredAt: sourceIdea.createdAt,
      actor: sourceIdea.source === "ChatGPT"
        ? "chatgpt"
        : sourceIdea.source === "Codex"
          ? "codex"
          : "marwan",
      kind: "idea",
      summary: `Original idea: ${sourceIdea.text}`,
      detail: sourceIdea.description,
      activeDurationMs: 0,
    });
  }
  return entries.sort((left, right) => timestamp(left.occurredAt) - timestamp(right.occurredAt));
};

export type TimelineDay = {
  dateKey: string;
  label: string;
  activeDurationMs: number;
  entries: TimelineEntry[];
};

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const groupTimelineByDate = (entries: TimelineEntry[]): TimelineDay[] => {
  const groups = new Map<string, TimelineEntry[]>();
  entries.forEach((entry) => {
    const parsed = new Date(entry.occurredAt);
    if (Number.isNaN(parsed.getTime())) return;
    const key = dayKeyFormatter.format(parsed);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([dateKey, dayEntries]) => ({
      dateKey,
      label: dayLabelFormatter.format(new Date(dayEntries[0].occurredAt)),
      activeDurationMs: dayEntries.reduce((total, entry) => total + entry.activeDurationMs, 0),
      entries: dayEntries,
    }));
};
