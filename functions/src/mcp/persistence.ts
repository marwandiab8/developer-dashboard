import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { entityId, payloadFingerprint } from "../codex/identity";
import type { McpToolInput, McpToolName } from "./contract";

type RecordValue = Record<string, unknown>;

export class McpToolError extends Error {
  constructor(readonly code: "not_found" | "relationship_mismatch" | "conflict" | "invalid_state") {
    super(code === "not_found" ? "The requested dashboard record was not found." : code === "relationship_mismatch" ? "The requested records do not belong to the same project workflow." : code === "conflict" ? "The idempotency key was already used with different input." : "The requested workflow transition is not valid.");
    this.name = "McpToolError";
  }
}

export interface DashboardMcpPersistencePort {
  call<Name extends McpToolName>(uid: string, name: Name, input: McpToolInput[Name]): Promise<RecordValue>;
}

const userPath = (uid: string, collection: string, id?: string) =>
  `users/${uid}/${collection}${id ? `/${id}` : ""}`;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const nonNegative = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const iso = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  if (isRecord(value) && typeof value.toDate === "function") {
    try { return (value.toDate as () => Date)().toISOString(); } catch { return null; }
  }
  return null;
};

const asRecord = (snapshot: DocumentSnapshot): RecordValue =>
  (snapshot.data() ?? {}) as RecordValue;

const requireDocument = (snapshot: DocumentSnapshot): RecordValue => {
  if (!snapshot.exists) throw new McpToolError("not_found");
  return asRecord(snapshot);
};

const requireProjectRelationship = (record: RecordValue, projectId: string) => {
  if (record.projectId !== projectId) throw new McpToolError("relationship_mismatch");
};

const projectView = (id: string, data: RecordValue) => ({
  id,
  name: typeof data.title === "string" ? data.title : "Untitled project",
  purpose: typeof data.purpose === "string" ? data.purpose : "",
  status: typeof data.manualStatus === "string" ? data.manualStatus : data.status,
  currentObjective: typeof data.currentObjective === "string" ? data.currentObjective : "",
  currentBlocker: typeof data.currentBlocker === "string" ? data.currentBlocker : "",
  recommendedNextStep: typeof data.nextRecommendedTask === "string" ? data.nextRecommendedTask : "",
  currentBranch: typeof data.currentBranch === "string" ? data.currentBranch : "",
  lastWorkedAt: iso(data.lastWorkedAt) ?? iso(data.updatedAt),
  repository: isRecord(data.externalSources) && isRecord(data.externalSources.github)
    ? {
        githubRepositoryId: data.externalSources.github.externalRepositoryId ?? null,
        githubFullName: data.externalSources.github.repositoryFullName ?? null,
        repositoryUrl: data.externalSources.github.repositoryUrl ?? null,
        defaultBranch: data.externalSources.github.defaultBranch ?? null,
      }
    : null,
});

const ideaView = (id: string, data: RecordValue) => ({
  id,
  projectId: data.projectId,
  title: data.text,
  description: data.description,
  priority: data.priority,
  tags: strings(data.tags),
  source: data.source,
  status: data.status,
  convertedTaskId: data.linkedTaskId ?? null,
  convertedAt: iso(data.convertedAt),
  createdAt: iso(data.createdAt),
  updatedAt: iso(data.updatedAt),
});

const taskView = (id: string, data: RecordValue) => ({
  id,
  projectId: data.projectId,
  sourceIdeaId: data.sourceIdeaId ?? null,
  title: data.title,
  requestedChange: data.details,
  acceptanceCriteria: data.acceptanceCriteria,
  priority: data.priority,
  status: data.status === "backlog" ? "open" : data.status === "testing" ? "in_progress" : data.status,
  currentBlocker: data.blockedReason ?? "",
  createdAt: iso(data.createdAt),
  readyAt: iso(data.readyAt),
  startedAt: iso(data.startedAt),
  completedAt: iso(data.completedAt),
  lastWorkedAt: iso(data.lastWorkedAt) ?? iso(data.updatedAt),
  totalActiveDurationMs: nonNegative(data.totalActiveDurationMs),
  promptRecordIds: strings(data.promptRecordIds),
  workSessionIds: strings(data.workSessionIds),
  recommendedNextStep: data.recommendedNextStep ?? "",
  github: {
    branch: data.githubBranch ?? "",
    commit: data.githubCommit ?? "",
    pullRequest: data.githubPullRequest ?? "",
  },
});

const promptView = (id: string, data: RecordValue) => ({
  id,
  projectId: data.projectId,
  taskId: data.relatedTaskId ?? null,
  workSessionId: data.relatedSessionId ?? null,
  sequenceNumber: data.sequenceNumber ?? 1,
  source: data.source ?? "manual",
  summary: data.promptSummary ?? data.purpose ?? data.title,
  requestedChange: data.requestedChange ?? data.purpose ?? "",
  status: data.status,
  resultSummary: data.resultSummary ?? "",
  completedWork: strings(data.completedWork),
  unfinishedWork: strings(data.unfinishedWork),
  problemsDiscovered: strings(data.problemsDiscovered),
  decisionsMade: strings(data.decisionsMade),
  blocker: data.blocker ?? "",
  recommendedNextStep: data.recommendedNextStep ?? "",
  activeDurationMs: nonNegative(data.activeDurationMs),
  createdAt: iso(data.createdAt),
  updatedAt: iso(data.updatedAt),
});

const sessionView = (id: string, data: RecordValue) => ({
  id,
  projectId: data.projectId,
  taskId: data.taskId ?? null,
  promptRecordId: data.promptRecordId ?? null,
  source: data.source ?? "manual",
  status: data.status,
  startedAt: iso(data.startedAt),
  finishedAt: iso(data.endedAt),
  activeStartedAt: iso(data.activeStartedAt),
  activeDurationMs: nonNegative(data.activeDurationMs),
  summary: data.summary ?? "",
  completedWork: strings(data.completedItems),
  unfinishedWork: strings(data.unfinishedItems),
  problemsDiscovered: strings(data.problemsDiscovered),
  decisionsMade: strings(data.decisionsMade),
  blocker: data.blocker ?? data.currentBlocker ?? "",
  nextStep: data.nextStep ?? data.nextStartingPoint ?? "",
  filesModified: strings(data.filesModified),
  commits: strings(data.commits),
});

const dateValue = (value: unknown) => {
  const normalized = iso(value);
  return normalized ? Date.parse(normalized) : 0;
};

const sessionActiveDuration = (
  session: ReturnType<typeof sessionView>,
  now: Date,
) => {
  if (session.status !== "active" || !session.activeStartedAt) return session.activeDurationMs;
  const running = Math.max(
    0,
    Math.min(now.getTime() - Date.parse(session.activeStartedAt), 4 * 60 * 60 * 1000),
  );
  return session.activeDurationMs + running;
};

const statusRank: Record<string, number> = {
  in_progress: 0, testing: 0, blocked: 1, ready: 2, open: 3, backlog: 3, completed: 4, cancelled: 5,
};
const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type WriteContext = {
  transaction: Transaction;
  stableId: (kind: string) => string;
};

export class FirestoreDashboardMcpPersistence implements DashboardMcpPersistencePort {
  constructor(private readonly db: Firestore, private readonly now: () => Date = () => new Date()) {}

  private async project(uid: string, projectId: string) {
    const snapshot = await this.db.doc(userPath(uid, "projects", projectId)).get();
    return { snapshot, data: requireDocument(snapshot) };
  }

  private async task(uid: string, projectId: string, taskId: string) {
    await this.project(uid, projectId);
    const snapshot = await this.db.doc(userPath(uid, "tasks", taskId)).get();
    const data = requireDocument(snapshot);
    requireProjectRelationship(data, projectId);
    return { snapshot, data };
  }

  private async idempotentWrite(
    uid: string,
    name: McpToolName,
    input: RecordValue,
    mutate: (context: WriteContext) => Promise<RecordValue>,
  ): Promise<RecordValue> {
    const key = String(input.idempotencyKey);
    const identity = `mcp:v1:${uid}:${name}:${key}`;
    const receiptId = entityId(identity, "receipt");
    const auditId = entityId(identity, "audit");
    const fingerprint = payloadFingerprint(input);
    const receiptReference = this.db.doc(userPath(uid, "mcpIdempotencyReceipts", receiptId));
    return this.db.runTransaction(async (transaction) => {
      const receipt = await transaction.get(receiptReference);
      if (receipt.exists) {
        const stored = asRecord(receipt);
        if (stored.tool !== name || stored.fingerprint !== fingerprint || !isRecord(stored.result)) {
          throw new McpToolError("conflict");
        }
        return { ...stored.result, idempotent: true };
      }
      const result = await mutate({
        transaction,
        stableId: (kind) => entityId(identity, kind),
      });
      const createdAt = this.now().toISOString();
      transaction.create(this.db.doc(userPath(uid, "mcpAuditEvents", auditId)), {
        tool: name,
        actor: "chatgpt",
        projectId: typeof input.projectId === "string" ? input.projectId : null,
        taskId: typeof input.taskId === "string" ? input.taskId : null,
        resultIds: Object.fromEntries(Object.entries(result).filter(([keyName]) => keyName.endsWith("Id"))),
        createdAt,
      });
      transaction.create(receiptReference, {
        tool: name,
        fingerprint,
        result,
        createdAt,
      });
      return { ...result, idempotent: false };
    });
  }

  async call<Name extends McpToolName>(uid: string, name: Name, input: McpToolInput[Name]): Promise<RecordValue> {
    switch (name) {
      case "list_projects": {
        const value = input as McpToolInput["list_projects"];
        const snapshot = await this.db.collection(userPath(uid, "projects")).limit(value.limit).get();
        return { projects: snapshot.docs.map((document) => projectView(document.id, document.data())) };
      }
      case "get_project": {
        const value = input as McpToolInput["get_project"];
        const project = await this.project(uid, value.projectId);
        return { project: projectView(project.snapshot.id, project.data) };
      }
      case "list_project_ideas": {
        const value = input as McpToolInput["list_project_ideas"];
        await this.project(uid, value.projectId);
        const snapshot = await this.db.collection(userPath(uid, "ideas"))
          .where("projectId", "==", value.projectId).limit(value.limit).get();
        const ideas = snapshot.docs
          .map((document) => ideaView(document.id, document.data()))
          .filter((idea) => !value.status || idea.status === value.status);
        return { ideas };
      }
      case "list_task_queue": {
        const value = input as McpToolInput["list_task_queue"];
        if (value.projectId) await this.project(uid, value.projectId);
        const snapshot = await this.db.collection(userPath(uid, "tasks")).limit(500).get();
        const since = value.workedSince ? Date.parse(value.workedSince) : 0;
        const tasks = snapshot.docs
          .map((document) => taskView(document.id, document.data()))
          .filter((task) => (!value.projectId || task.projectId === value.projectId)
            && (!value.priority || task.priority === value.priority)
            && (!value.status || task.status === value.status)
            && (!since || dateValue(task.lastWorkedAt) >= since))
          .sort((left, right) => (statusRank[String(left.status)] ?? 99) - (statusRank[String(right.status)] ?? 99)
            || (priorityRank[String(left.priority)] ?? 99) - (priorityRank[String(right.priority)] ?? 99)
            || dateValue(right.lastWorkedAt) - dateValue(left.lastWorkedAt))
          .slice(0, value.limit);
        return { tasks };
      }
      case "get_task": {
        const value = input as McpToolInput["get_task"];
        const task = await this.task(uid, value.projectId, value.taskId);
        return { task: taskView(task.snapshot.id, task.data) };
      }
      case "get_task_context": {
        const value = input as McpToolInput["get_task_context"];
        const [{ snapshot: taskSnapshot, data: task }, { snapshot: projectSnapshot, data: project }] = await Promise.all([
          this.task(uid, value.projectId, value.taskId),
          this.project(uid, value.projectId),
        ]);
        const [ideas, prompts, sessions, decisions] = await Promise.all([
          task.sourceIdeaId ? this.db.doc(userPath(uid, "ideas", String(task.sourceIdeaId))).get() : null,
          this.db.collection(userPath(uid, "codexPrompts")).where("relatedTaskId", "==", value.taskId).limit(100).get(),
          this.db.collection(userPath(uid, "sessions")).where("taskId", "==", value.taskId).limit(100).get(),
          this.db.collection(userPath(uid, "architectureDecisions")).where("projectId", "==", value.projectId).limit(100).get(),
        ]);
        const projectResult = projectView(projectSnapshot.id, project);
        const taskResult = taskView(taskSnapshot.id, task);
        const promptResults = prompts.docs.map((document) => promptView(document.id, document.data()));
        const sessionResults = sessions.docs.map((document) => sessionView(document.id, document.data()));
        const decisionResults = decisions.docs.map((document) => ({ id: document.id, title: document.data().title, decision: document.data().decision, status: document.data().status }));
        const unfinishedWork = [...new Set([
          ...promptResults.flatMap((prompt) => prompt.unfinishedWork),
          ...sessionResults.flatMap((session) => session.unfinishedWork),
        ])].slice(0, 100);
        return {
          project: projectResult,
          task: taskResult,
          originalIdea: ideas?.exists ? ideaView(ideas.id, asRecord(ideas)) : null,
          previousPrompts: promptResults,
          workSessions: sessionResults,
          decisions: decisionResults,
          unfinishedWork,
          projectResume: {
            project: projectResult,
            task: taskResult,
            recentWork: sessionResults.slice(0, 20),
            unfinishedWork,
          },
          aiContext: {
            repository: projectResult.repository,
            currentBranch: projectResult.currentBranch,
            currentObjective: projectResult.currentObjective,
            currentBlocker: taskResult.currentBlocker || projectResult.currentBlocker,
            recommendedNextStep: taskResult.recommendedNextStep || projectResult.recommendedNextStep,
            acceptedDecisions: decisionResults.filter((decision) => decision.status === "accepted"),
          },
        };
      }
      case "get_project_timeline":
      case "get_task_timeline": {
        const value = input as McpToolInput["get_project_timeline"] & { taskId?: string };
        await this.project(uid, value.projectId);
        if (value.taskId) await this.task(uid, value.projectId, value.taskId);
        const [activities, prompts, sessions] = await Promise.all([
          this.db.collection(userPath(uid, "activity")).where("projectId", "==", value.projectId).limit(300).get(),
          this.db.collection(userPath(uid, "codexPrompts")).where("projectId", "==", value.projectId).limit(200).get(),
          this.db.collection(userPath(uid, "sessions")).where("projectId", "==", value.projectId).limit(200).get(),
        ]);
        const hidden = new Set(["github_repository_imported", "github_repository_updated", "github_repository_unavailable"]);
        const events = [
          ...activities.docs.filter((document) => !hidden.has(String(document.data().type))).map((document) => ({ id: document.id, kind: "activity", taskId: document.data().taskId ?? (document.data().entityType === "task" ? document.data().entityId : null), actor: document.data().actor ?? (document.data().source === "codex" ? "codex" : "marwan"), summary: document.data().summary, detail: document.data().metadata, occurredAt: iso(document.data().createdAt), activeDurationMs: 0 })),
          ...prompts.docs.map((document) => ({ id: document.id, kind: "prompt", taskId: document.data().relatedTaskId ?? null, actor: document.data().createdBy ?? "marwan", summary: document.data().promptSummary ?? document.data().title, detail: document.data().resultSummary ?? "", occurredAt: iso(document.data().createdAt), activeDurationMs: 0 })),
          ...sessions.docs.map((document) => ({ id: document.id, kind: "session", taskId: document.data().taskId ?? null, actor: document.data().source === "manual" ? "marwan" : document.data().source ?? "marwan", summary: document.data().summary ?? document.data().objective, detail: document.data().nextStep ?? document.data().blocker ?? "", occurredAt: iso(document.data().endedAt) ?? iso(document.data().startedAt), activeDurationMs: nonNegative(document.data().activeDurationMs) })),
        ].filter((event) => !value.taskId || event.taskId === value.taskId)
          .sort((left, right) => value.taskId
            ? dateValue(left.occurredAt) - dateValue(right.occurredAt)
            : dateValue(right.occurredAt) - dateValue(left.occurredAt))
          .slice(0, value.limit);
        return { events, totalActiveDurationMs: events.reduce((total, event) => total + event.activeDurationMs, 0) };
      }
      case "get_project_resume":
      case "get_ai_context": {
        const value = input as McpToolInput["get_project_resume"];
        const project = await this.project(uid, value.projectId);
        const [tasks, sessions] = await Promise.all([
          this.db.collection(userPath(uid, "tasks")).where("projectId", "==", value.projectId).limit(200).get(),
          this.db.collection(userPath(uid, "sessions")).where("projectId", "==", value.projectId).limit(200).get(),
        ]);
        const projectData = projectView(project.snapshot.id, project.data);
        const taskData = tasks.docs.map((document) => taskView(document.id, document.data()));
        const sessionData = sessions.docs.map((document) => sessionView(document.id, document.data()));
        return {
          kind: name === "get_project_resume" ? "project_resume" : "ai_context",
          project: projectData,
          activeTasks: taskData.filter((task) => !["completed", "cancelled"].includes(String(task.status))),
          recentWork: sessionData.sort((left, right) => dateValue(right.finishedAt ?? right.startedAt) - dateValue(left.finishedAt ?? left.startedAt)).slice(0, 20),
          totalActiveDurationMs: sessionData.reduce((total, session) => total + session.activeDurationMs, 0),
        };
      }
      case "get_task_time_summary": {
        const value = input as McpToolInput["get_task_time_summary"];
        await this.task(uid, value.projectId, value.taskId);
        const snapshot = await this.db.collection(userPath(uid, "sessions")).where("taskId", "==", value.taskId).limit(500).get();
        const sessions = snapshot.docs.map((document) => sessionView(document.id, document.data()));
        const now = this.now();
        return {
          taskId: value.taskId,
          totalActiveDurationMs: sessions
            .filter((session) => session.status !== "abandoned")
            .reduce((total, session) => total + sessionActiveDuration(session, now), 0),
          sessions: sessions.map((session) => ({
            ...session,
            activeDurationMs: sessionActiveDuration(session, now),
          })),
        };
      }
      case "create_idea": {
        const value = input as McpToolInput["create_idea"];
        return this.idempotentWrite(uid, name, value, async ({ transaction, stableId }) => {
          const project = await transaction.get(this.db.doc(userPath(uid, "projects", value.projectId)));
          requireDocument(project);
          const ideaId = stableId("idea");
          const now = this.now().toISOString();
          transaction.create(this.db.doc(userPath(uid, "ideas", ideaId)), { projectId: value.projectId, text: value.title, description: value.description, priority: value.priority, tags: value.tags, source: value.source, status: "inbox", linkedTaskId: null, convertedAt: null, createdAt: now, updatedAt: now });
          return { ideaId, projectId: value.projectId, status: "inbox" };
        });
      }
      case "update_idea": {
        const value = input as McpToolInput["update_idea"];
        return this.idempotentWrite(uid, name, value, async ({ transaction }) => {
          const [project, idea] = await Promise.all([transaction.get(this.db.doc(userPath(uid, "projects", value.projectId))), transaction.get(this.db.doc(userPath(uid, "ideas", value.ideaId)))]);
          requireDocument(project);
          const ideaData = requireDocument(idea);
          requireProjectRelationship(ideaData, value.projectId);
          if (ideaData.status === "converted") throw new McpToolError("invalid_state");
          const updates: RecordValue = { updatedAt: this.now().toISOString() };
          if (value.title !== undefined) updates.text = value.title;
          if (value.description !== undefined) updates.description = value.description;
          if (value.priority !== undefined) updates.priority = value.priority;
          if (value.tags !== undefined) updates.tags = value.tags;
          if (value.status !== undefined) updates.status = value.status;
          transaction.update(idea.ref, updates);
          return { ideaId: value.ideaId, projectId: value.projectId, status: updates.status ?? ideaData.status };
        });
      }
      case "convert_idea_to_task": {
        const value = input as McpToolInput["convert_idea_to_task"];
        return this.idempotentWrite(uid, name, value, async ({ transaction, stableId }) => {
          const [project, idea] = await Promise.all([transaction.get(this.db.doc(userPath(uid, "projects", value.projectId))), transaction.get(this.db.doc(userPath(uid, "ideas", value.ideaId)))]);
          requireDocument(project);
          const ideaData = requireDocument(idea);
          requireProjectRelationship(ideaData, value.projectId);
          if (typeof ideaData.linkedTaskId === "string") return { ideaId: value.ideaId, taskId: ideaData.linkedTaskId, projectId: value.projectId, duplicatePrevented: true };
          const taskId = stableId("task");
          const activityId = stableId("activity");
          const now = this.now().toISOString();
          transaction.create(this.db.doc(userPath(uid, "tasks", taskId)), { projectId: value.projectId, sourceIdeaId: value.ideaId, title: ideaData.text, details: ideaData.description ?? "", acceptanceCriteria: value.acceptanceCriteria, type: "feature", priority: value.priority ?? ideaData.priority ?? "medium", status: "ready", blockedReason: "", implementationNotes: "", readyAt: now, startedAt: null, completedAt: null, lastWorkedAt: null, totalActiveDurationMs: 0, promptRecordIds: [], workSessionIds: [], recommendedNextStep: "Prepare a complete Codex prompt.", githubBranch: "", githubCommit: "", githubPullRequest: "", createdAt: now, updatedAt: now });
          transaction.update(idea.ref, { status: "converted", linkedTaskId: taskId, convertedAt: now, updatedAt: now });
          transaction.create(this.db.doc(userPath(uid, "activity", activityId)), { projectId: value.projectId, taskId, type: "idea_converted", actor: "chatgpt", summary: `Converted idea to task: ${String(ideaData.text)}`, entityType: "task", entityId: taskId, metadata: value.ideaId, createdAt: now });
          return { ideaId: value.ideaId, taskId, projectId: value.projectId, duplicatePrevented: false };
        });
      }
      case "update_task_status":
      case "mark_task_completed": {
        const raw = input as McpToolInput["update_task_status"] | McpToolInput["mark_task_completed"];
        const value = name === "mark_task_completed" ? { ...raw, status: "completed" as const, blocker: undefined } : raw as McpToolInput["update_task_status"];
        return this.idempotentWrite(uid, name, value, async ({ transaction, stableId }) => {
          const [project, task] = await Promise.all([transaction.get(this.db.doc(userPath(uid, "projects", value.projectId))), transaction.get(this.db.doc(userPath(uid, "tasks", value.taskId)))]);
          requireDocument(project);
          const taskData = requireDocument(task);
          requireProjectRelationship(taskData, value.projectId);
          const now = this.now().toISOString();
          transaction.update(task.ref, { status: value.status, blockedReason: value.status === "blocked" ? value.blocker ?? "" : "", ...(value.status === "ready" ? { readyAt: taskData.readyAt ?? now } : {}), ...(value.status === "in_progress" ? { startedAt: taskData.startedAt ?? now } : {}), completedAt: value.status === "completed" ? now : null, lastWorkedAt: ["in_progress", "blocked", "completed"].includes(value.status) ? now : taskData.lastWorkedAt ?? null, updatedAt: now });
          const activityId = stableId("activity");
          transaction.create(this.db.doc(userPath(uid, "activity", activityId)), { projectId: value.projectId, taskId: value.taskId, type: value.status === "completed" ? "task_completed" : value.status === "blocked" ? "task_blocked" : "task_status_changed", actor: "chatgpt", summary: `${value.status === "completed" ? "Completed" : "Updated"} task: ${String(taskData.title)}`, entityType: "task", entityId: value.taskId, metadata: value.status, createdAt: now });
          return { projectId: value.projectId, taskId: value.taskId, status: value.status };
        });
      }
      case "create_task_prompt_record": {
        const value = input as McpToolInput["create_task_prompt_record"];
        return this.idempotentWrite(uid, name, value, async ({ transaction, stableId }) => {
          const [project, task] = await Promise.all([transaction.get(this.db.doc(userPath(uid, "projects", value.projectId))), transaction.get(this.db.doc(userPath(uid, "tasks", value.taskId)))]);
          requireDocument(project);
          const taskData = requireDocument(task);
          requireProjectRelationship(taskData, value.projectId);
          if (value.workSessionId) {
            const session = requireDocument(await transaction.get(this.db.doc(userPath(uid, "sessions", value.workSessionId))));
            requireProjectRelationship(session, value.projectId);
            if (session.taskId !== value.taskId) throw new McpToolError("relationship_mismatch");
          }
          const promptRecordId = stableId("prompt");
          const now = this.now().toISOString();
          const priorIds = strings(taskData.promptRecordIds);
          transaction.create(this.db.doc(userPath(uid, "codexPrompts", promptRecordId)), { projectId: value.projectId, relatedTaskId: value.taskId, relatedSessionId: value.workSessionId ?? null, title: value.promptSummary.slice(0, 160), purpose: value.promptSummary, prompt: value.fullPrompt ?? value.requestedChange, promptSummary: value.promptSummary, requestedChange: value.requestedChange, resultSummary: "", source: "chatgpt", createdBy: "chatgpt", sequenceNumber: priorIds.length + 1, status: "prepared", completedWork: [], unfinishedWork: [], problemsDiscovered: [], decisionsMade: [], filesModified: [], commits: [], branch: "", blocker: "", recommendedNextStep: "Give this prompt to Codex.", activeDurationMs: 0, testResults: [], buildResults: [], deploymentStatus: "Not deployed", createdAt: now, updatedAt: now, lastUsedAt: null });
          transaction.update(task.ref, { promptRecordIds: [...new Set([...priorIds, promptRecordId])], updatedAt: now });
          return { projectId: value.projectId, taskId: value.taskId, promptRecordId, sequenceNumber: priorIds.length + 1, status: "prepared" };
        });
      }
      case "start_task_work_session": {
        const value = input as McpToolInput["start_task_work_session"];
        return this.idempotentWrite(uid, name, value, async ({ transaction, stableId }) => {
          const [project, task] = await Promise.all([transaction.get(this.db.doc(userPath(uid, "projects", value.projectId))), transaction.get(this.db.doc(userPath(uid, "tasks", value.taskId)))]);
          requireDocument(project);
          const taskData = requireDocument(task);
          requireProjectRelationship(taskData, value.projectId);
          if (value.promptRecordId) {
            const prompt = requireDocument(await transaction.get(this.db.doc(userPath(uid, "codexPrompts", value.promptRecordId))));
            if (prompt.projectId !== value.projectId || prompt.relatedTaskId !== value.taskId) throw new McpToolError("relationship_mismatch");
          }
          const now = this.now().toISOString();
          if (value.resumeSessionId) {
            const sessionRef = this.db.doc(userPath(uid, "sessions", value.resumeSessionId));
            const session = requireDocument(await transaction.get(sessionRef));
            if (session.projectId !== value.projectId || session.taskId !== value.taskId || session.status !== "paused") throw new McpToolError("invalid_state");
            transaction.update(sessionRef, { status: "active", activeStartedAt: now, resumeFromNote: value.resumeFromNote, source: "chatgpt" });
            transaction.update(task.ref, { status: "in_progress", startedAt: taskData.startedAt ?? now, lastWorkedAt: now, updatedAt: now });
            return { projectId: value.projectId, taskId: value.taskId, workSessionId: value.resumeSessionId, status: "active", resumed: true };
          }
          const workSessionId = stableId("session");
          transaction.create(this.db.doc(userPath(uid, "sessions", workSessionId)), { projectId: value.projectId, taskId: value.taskId, promptRecordId: value.promptRecordId ?? null, source: "chatgpt", startedAt: now, endedAt: null, activeStartedAt: now, activeDurationMs: 0, status: "active", objective: taskData.title ?? "Task work", summary: "", resumeFromNote: value.resumeFromNote, blocker: taskData.blockedReason ?? "", nextStep: taskData.recommendedNextStep ?? "", tasksWorkedOn: [value.taskId], tasksCompleted: [], ideasAdded: [], problemsDiscovered: [], decisionsMade: [], promptsUsed: value.promptRecordId ? [value.promptRecordId] : [], filesModified: [], commits: [], nextStartingPoint: taskData.recommendedNextStep ?? "", notes: "", testResults: [], buildResults: [], deploymentStatus: "Not deployed" });
          transaction.update(task.ref, { status: "in_progress", startedAt: taskData.startedAt ?? now, lastWorkedAt: now, workSessionIds: [...new Set([...strings(taskData.workSessionIds), workSessionId])], updatedAt: now });
          return { projectId: value.projectId, taskId: value.taskId, workSessionId, status: "active", resumed: false };
        });
      }
      case "finish_task_work_session": {
        const value = input as McpToolInput["finish_task_work_session"];
        return this.idempotentWrite(uid, name, value, async ({ transaction }) => {
          const [project, task, session] = await Promise.all([transaction.get(this.db.doc(userPath(uid, "projects", value.projectId))), transaction.get(this.db.doc(userPath(uid, "tasks", value.taskId))), transaction.get(this.db.doc(userPath(uid, "sessions", value.workSessionId)))]);
          requireDocument(project);
          const taskData = requireDocument(task);
          const sessionData = requireDocument(session);
          requireProjectRelationship(taskData, value.projectId);
          if (sessionData.projectId !== value.projectId || sessionData.taskId !== value.taskId || ["completed", "abandoned"].includes(String(sessionData.status))) throw new McpToolError("invalid_state");
          if (value.promptRecordId && sessionData.promptRecordId !== value.promptRecordId) throw new McpToolError("relationship_mismatch");
          if (value.promptRecordId) {
            const prompt = requireDocument(await transaction.get(this.db.doc(userPath(uid, "codexPrompts", value.promptRecordId))));
            if (prompt.projectId !== value.projectId || prompt.relatedTaskId !== value.taskId) throw new McpToolError("relationship_mismatch");
          }
          const now = this.now().toISOString();
          const running = sessionData.status === "active" && iso(sessionData.activeStartedAt) ? Math.max(0, Math.min(Date.parse(now) - Date.parse(iso(sessionData.activeStartedAt)!), 4 * 60 * 60 * 1000)) : 0;
          const previousDuration = nonNegative(sessionData.activeDurationMs);
          const duration = value.activeDurationMs ?? previousDuration + running;
          const taskDuration = Math.max(0, nonNegative(taskData.totalActiveDurationMs) - previousDuration + duration);
          const status = value.outcome === "paused" ? "paused" : value.outcome;
          transaction.update(session.ref, { status, endedAt: value.outcome === "paused" ? null : now, activeStartedAt: null, activeDurationMs: duration, summary: value.summary, completedItems: value.completedWork, unfinishedItems: value.unfinishedWork, problemsDiscovered: value.problemsDiscovered, decisionsMade: value.decisionsMade, blocker: value.blocker, currentBlocker: value.blocker, nextStep: value.nextStep, nextStartingPoint: value.nextStep, notes: value.summary });
          transaction.update(task.ref, { totalActiveDurationMs: taskDuration, lastWorkedAt: now, blockedReason: value.blocker, ...(value.blocker ? { status: "blocked" } : {}), recommendedNextStep: value.nextStep, updatedAt: now });
          if (value.promptRecordId) transaction.update(this.db.doc(userPath(uid, "codexPrompts", value.promptRecordId)), { relatedSessionId: value.workSessionId, resultSummary: value.summary, completedWork: value.completedWork, unfinishedWork: value.unfinishedWork, problemsDiscovered: value.problemsDiscovered, decisionsMade: value.decisionsMade, blocker: value.blocker, recommendedNextStep: value.nextStep, activeDurationMs: duration, status: value.outcome === "abandoned" ? "failed" : "completed", updatedAt: now, lastUsedAt: now });
          return { projectId: value.projectId, taskId: value.taskId, workSessionId: value.workSessionId, status, activeDurationMs: duration, totalTaskActiveDurationMs: taskDuration };
        });
      }
      case "append_task_work_summary": {
        const value = input as McpToolInput["append_task_work_summary"];
        return this.idempotentWrite(uid, name, value, async ({ transaction }) => {
          const [task, session] = await Promise.all([transaction.get(this.db.doc(userPath(uid, "tasks", value.taskId))), transaction.get(this.db.doc(userPath(uid, "sessions", value.workSessionId)))]);
          const taskData = requireDocument(task);
          const sessionData = requireDocument(session);
          if (taskData.projectId !== value.projectId || sessionData.projectId !== value.projectId || sessionData.taskId !== value.taskId) throw new McpToolError("relationship_mismatch");
          if (value.promptRecordId) {
            const prompt = requireDocument(await transaction.get(this.db.doc(userPath(uid, "codexPrompts", value.promptRecordId))));
            if (prompt.projectId !== value.projectId || prompt.relatedTaskId !== value.taskId) throw new McpToolError("relationship_mismatch");
          }
          const summary = typeof sessionData.summary === "string" && sessionData.summary ? `${sessionData.summary}\n\n${value.summary}` : value.summary;
          transaction.update(session.ref, { summary, notes: summary });
          if (value.promptRecordId) transaction.update(this.db.doc(userPath(uid, "codexPrompts", value.promptRecordId)), { resultSummary: summary });
          return { projectId: value.projectId, taskId: value.taskId, workSessionId: value.workSessionId, summaryAppended: true };
        });
      }
      case "record_task_blocker": {
        const value = input as McpToolInput["record_task_blocker"];
        return this.idempotentWrite(uid, name, value, async ({ transaction, stableId }) => {
          const task = await transaction.get(this.db.doc(userPath(uid, "tasks", value.taskId)));
          const taskData = requireDocument(task);
          requireProjectRelationship(taskData, value.projectId);
          if (value.workSessionId) {
            const sessionRef = this.db.doc(userPath(uid, "sessions", value.workSessionId));
            const session = requireDocument(await transaction.get(sessionRef));
            if (session.projectId !== value.projectId || session.taskId !== value.taskId) throw new McpToolError("relationship_mismatch");
            transaction.update(sessionRef, { blocker: value.blocker, currentBlocker: value.blocker });
          }
          const now = this.now().toISOString();
          transaction.update(task.ref, { status: "blocked", blockedReason: value.blocker, lastWorkedAt: now, updatedAt: now });
          transaction.create(this.db.doc(userPath(uid, "activity", stableId("activity"))), { projectId: value.projectId, taskId: value.taskId, workSessionId: value.workSessionId ?? null, type: "blocker_recorded", actor: "chatgpt", summary: `Blocked task: ${String(taskData.title)}`, entityType: "task", entityId: value.taskId, metadata: value.blocker, createdAt: now });
          return { projectId: value.projectId, taskId: value.taskId, status: "blocked", blocker: value.blocker };
        });
      }
      default:
        throw new Error("unsupported_tool");
    }
  }
}
