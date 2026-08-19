import type {
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { entityId, identityMaterial, sha256 } from "./identity";
import type { CodexIngestionPersistenceInput, CodexIngestionPersistencePort } from "./service";
import {
  CODEX_INGESTION_RATE_LIMIT_PER_MINUTE,
  CodexIngestionError,
  type CodexIngestionResult,
  type CodexProjectSelectorV1,
  type CodexProjectVerificationResult,
  type CodexSessionIngestV1,
} from "./types";

type StoredRecord = Record<string, unknown>;
type ProjectMatchKind = CodexProjectVerificationResult["matchedBy"];
type ResolvedProject = { id: string; data: StoredRecord; matchedBy: ProjectMatchKind };
type ContinuityField = "currentObjective" | "currentBlocker" | "nextRecommendedTask";
type ContinuityFieldState = {
  source?: unknown;
  valueHash?: unknown;
  externalSessionId?: unknown;
  updatedAt?: unknown;
};

const projectsPath = (uid: string) => `users/${uid}/projects`;
const sessionPath = (uid: string, id: string) => `users/${uid}/sessions/${id}`;
const promptPath = (uid: string, id: string) => `users/${uid}/codexPrompts/${id}`;
const taskPath = (uid: string, id: string) => `users/${uid}/tasks/${id}`;
const activityPath = (uid: string, id: string) => `users/${uid}/activity/${id}`;
const ideaPath = (uid: string, id: string) => `users/${uid}/ideas/${id}`;
const receiptPath = (uid: string, id: string) => `users/${uid}/codexIngestionReceipts/${id}`;
const rateStatePath = (uid: string, minuteKey: string) =>
  `users/${uid}/codexIngestion/minute-${minuteKey.replace(/:/g, "-")}`;
const continuityPath = (uid: string, projectId: string) => `users/${uid}/codexContinuity/${projectId}`;

const isRecord = (value: unknown): value is StoredRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const nonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const nestedValue = (record: StoredRecord, path: string): unknown => {
  let value: unknown = record;
  for (const segment of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
};

const githubIdentity = (project: StoredRecord): { id: string | null; fullName: string | null } => {
  const rawId = nestedValue(project, "externalSources.github.externalRepositoryId");
  const rawFullName = nestedValue(project, "externalSources.github.repositoryFullName");
  return {
    id: typeof rawId === "string" ? rawId : null,
    fullName: typeof rawFullName === "string" ? rawFullName.trim().toLowerCase() : null,
  };
};

const normalizeFullName = (value: string): string => value.trim().toLowerCase();

const toResolvedProject = (
  snapshot: DocumentSnapshot | QueryDocumentSnapshot,
  matchedBy: ProjectMatchKind,
): ResolvedProject => ({
  id: snapshot.id,
  data: (snapshot.data() ?? {}) as StoredRecord,
  matchedBy,
});

const requireSingleMatch = (
  matches: Array<DocumentSnapshot | QueryDocumentSnapshot>,
  matchedBy: ProjectMatchKind,
): ResolvedProject => {
  if (matches.length === 0) throw new CodexIngestionError("project_not_associated", 404);
  if (matches.length > 1) throw new CodexIngestionError("project_ambiguous", 409);
  return toResolvedProject(matches[0], matchedBy);
};

const resolveProject = async (
  db: Firestore,
  transaction: Transaction,
  uid: string,
  selector: CodexSessionIngestV1["project"],
): Promise<ResolvedProject> => {
  let project: ResolvedProject;
  if (selector.dashboardProjectId) {
    const snapshot = await transaction.get(db.doc(`${projectsPath(uid)}/${selector.dashboardProjectId}`));
    if (!snapshot.exists) throw new CodexIngestionError("project_not_associated", 404);
    project = toResolvedProject(snapshot, "dashboardId");
  } else if (selector.githubRepositoryId) {
    const query = db.collection(projectsPath(uid))
      .where("externalSources.github.externalRepositoryId", "==", String(selector.githubRepositoryId))
      .limit(2);
    const snapshot = await transaction.get(query);
    project = requireSingleMatch(snapshot.docs, "githubRepositoryId");
  } else if (selector.githubFullName) {
    const snapshot = await transaction.get(db.collection(projectsPath(uid)));
    const desired = normalizeFullName(selector.githubFullName);
    project = requireSingleMatch(snapshot.docs.filter((document) => {
      const data = (document.data() ?? {}) as StoredRecord;
      return githubIdentity(data).fullName === desired;
    }), "githubFullName");
  } else {
    // V1 accepts localPath as diagnostic identity, but it is never used to guess a project.
    throw new CodexIngestionError("project_not_associated", 404);
  }

  const external = githubIdentity(project.data);
  if (selector.dashboardProjectId && selector.dashboardProjectId !== project.id) {
    throw new CodexIngestionError("selector_mismatch", 409);
  }
  if (selector.githubRepositoryId && external.id !== String(selector.githubRepositoryId)) {
    throw new CodexIngestionError("selector_mismatch", 409);
  }
  if (selector.githubFullName && external.fullName !== normalizeFullName(selector.githubFullName)) {
    throw new CodexIngestionError("selector_mismatch", 409);
  }
  return project;
};

const titleFrom = (payload: CodexSessionIngestV1): string => {
  const source = payload.session.objective ?? payload.session.summary;
  return source.trim().split(/\r?\n/, 1)[0].slice(0, 160) || "Codex development session";
};

const asMilliseconds = (value: unknown): number | null => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (isRecord(value)) {
    const toDate = value.toDate;
    if (typeof toDate === "function") {
      try {
        const parsed = (toDate as () => Date)().getTime();
        return Number.isFinite(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    const seconds = typeof value.seconds === "number" ? value.seconds : value._seconds;
    if (typeof seconds === "number") return seconds * 1000;
  }
  return null;
};

const advancesTimestamp = (current: unknown, candidate: string): boolean => {
  const currentMilliseconds = asMilliseconds(current);
  return currentMilliseconds === null || Date.parse(candidate) > currentMilliseconds;
};

const existingContinuityFields = (snapshot: DocumentSnapshot): Record<string, ContinuityFieldState> => {
  const data = snapshot.data();
  if (!isRecord(data) || !isRecord(data.fields)) return {};
  return Object.fromEntries(
    Object.entries(data.fields).filter(([, value]) => isRecord(value)),
  ) as Record<string, ContinuityFieldState>;
};

const currentAuthoredValue = (project: StoredRecord, field: ContinuityField): string =>
  typeof project[field] === "string" ? project[field] as string : "";

const isCodexOwnedAndUnchanged = (
  current: string,
  metadata: ContinuityFieldState | undefined,
): boolean => metadata?.source === "codex" && metadata.valueHash === sha256(current);

const applyContinuityField = (
  field: ContinuityField,
  incoming: string,
  project: StoredRecord,
  fields: Record<string, ContinuityFieldState>,
  externalSessionId: string,
  endedAt: string,
  projectUpdates: StoredRecord,
): boolean => {
  const current = currentAuthoredValue(project, field);
  const priorCodexWrite = fields[field];
  const priorCodexWriteAt = asMilliseconds(priorCodexWrite?.updatedAt);
  const hasPriorCodexOwnership = priorCodexWrite?.source === "codex";
  if (priorCodexWrite?.source === "manual") return false;
  const priorOwnershipStillMatches = isCodexOwnedAndUnchanged(current, priorCodexWrite);
  if (hasPriorCodexOwnership && !priorOwnershipStillMatches) {
    const manualObservedAt = priorCodexWriteAt !== null && priorCodexWriteAt > Date.parse(endedAt)
      ? new Date(priorCodexWriteAt).toISOString()
      : endedAt;
    fields[field] = {
      source: "manual",
      valueHash: sha256(current),
      updatedAt: manualObservedAt,
    };
    return true;
  }
  if (
    hasPriorCodexOwnership &&
    priorCodexWriteAt !== null &&
    Date.parse(endedAt) < priorCodexWriteAt
  ) {
    return false;
  }
  if (!hasPriorCodexOwnership && current.trim().length > 0) {
    fields[field] = {
      source: "manual",
      valueHash: sha256(current),
      updatedAt: endedAt,
    };
    return true;
  }
  if (current === incoming) {
    if (
      priorOwnershipStillMatches &&
      priorCodexWriteAt !== null &&
      Date.parse(endedAt) <= priorCodexWriteAt
    ) return false;
    fields[field] = {
      source: "codex",
      valueHash: sha256(incoming),
      externalSessionId,
      updatedAt: endedAt,
    };
    return true;
  }
  projectUpdates[field] = incoming;
  fields[field] = {
    source: "codex",
    valueHash: sha256(incoming),
    externalSessionId,
    updatedAt: endedAt,
  };
  return true;
};

const buildResult = (
  projectId: string,
  externalSessionId: string,
  identity: string,
  ideaCount: number,
  idempotent: boolean,
  workflow?: CodexSessionIngestV1["workflow"],
): CodexIngestionResult => ({
  ok: true,
  idempotent,
  status: idempotent ? "duplicate" : "created",
  projectId,
  externalSessionId,
  sessionId: workflow?.workSessionId ?? entityId(identity, "session"),
  promptId: workflow?.promptRecordId ?? entityId(identity, "prompt"),
  activityId: entityId(identity, "activity"),
  ideaIds: Array.from({ length: ideaCount }, (_, index) => entityId(identity, `idea:${index}`)),
});

const assertMatchingReceipt = (
  snapshot: DocumentSnapshot,
  fingerprint: string,
  projectId: string,
  externalSessionId: string,
): void => {
  const data = snapshot.data();
  if (
    !isRecord(data) ||
    data.fingerprint !== fingerprint ||
    data.schemaVersion !== 1 ||
    data.source !== "codex" ||
    data.projectId !== projectId ||
    data.externalSessionId !== externalSessionId
  ) {
    throw new CodexIngestionError("idempotency_conflict", 409);
  }
};

const minuteKey = (iso: string): string => iso.slice(0, 16);

export class FirestoreCodexIngestionPersistence implements CodexIngestionPersistencePort {
  constructor(private readonly db: Firestore) {}

  async verifyProject(
    uid: string,
    selector: CodexProjectSelectorV1,
  ): Promise<CodexProjectVerificationResult> {
    return this.db.runTransaction(async (transaction) => {
      const project = await resolveProject(this.db, transaction, uid, selector);
      const title = typeof project.data.title === "string" ? project.data.title : "";
      return {
        ok: true,
        matched: true,
        status: "associated",
        dashboardProjectId: project.id,
        dashboardProjectTitle: title,
        matchedBy: project.matchedBy,
      };
    }, { readOnly: true });
  }

  async ingest(input: CodexIngestionPersistenceInput): Promise<CodexIngestionResult> {
    return this.db.runTransaction(async (transaction) => {
      const project = await resolveProject(this.db, transaction, input.uid, input.payload.project);
      const identity = identityMaterial(project.id, input.payload.session.externalSessionId);
      const receiptId = entityId(identity, "receipt");
      const receiptReference = this.db.doc(receiptPath(input.uid, receiptId));
      const receiptSnapshot = await transaction.get(receiptReference);
      const ideaCount = input.payload.session.ideas?.length ?? 0;
      if (receiptSnapshot.exists) {
        assertMatchingReceipt(
          receiptSnapshot,
          input.fingerprint,
          project.id,
          input.payload.session.externalSessionId,
        );
        return buildResult(
          project.id,
          input.payload.session.externalSessionId,
          identity,
          ideaCount,
          true,
          input.payload.workflow,
        );
      }

      const currentMinute = minuteKey(input.receivedAt);
      const rateReference = this.db.doc(rateStatePath(input.uid, currentMinute));
      const continuityReference = this.db.doc(continuityPath(input.uid, project.id));
      const [rateSnapshot, continuitySnapshot] = await Promise.all([
        transaction.get(rateReference),
        transaction.get(continuityReference),
      ]);
      const workflow = input.payload.workflow;
      let workflowRecords: {
        taskReference: ReturnType<Firestore["doc"]>;
        promptReference: ReturnType<Firestore["doc"]>;
        sessionReference: ReturnType<Firestore["doc"]>;
        task: StoredRecord;
        prompt: StoredRecord;
        session: StoredRecord;
      } | null = null;
      if (workflow) {
        const taskReference = this.db.doc(taskPath(input.uid, workflow.taskId));
        const promptReference = this.db.doc(promptPath(input.uid, workflow.promptRecordId));
        const sessionReference = this.db.doc(sessionPath(input.uid, workflow.workSessionId));
        const [taskSnapshot, promptSnapshot, sessionSnapshot] = await Promise.all([
          transaction.get(taskReference),
          transaction.get(promptReference),
          transaction.get(sessionReference),
        ]);
        if (!taskSnapshot.exists || !promptSnapshot.exists || !sessionSnapshot.exists) {
          throw new CodexIngestionError("workflow_not_associated", 404);
        }
        const task = (taskSnapshot.data() ?? {}) as StoredRecord;
        const prompt = (promptSnapshot.data() ?? {}) as StoredRecord;
        const workSession = (sessionSnapshot.data() ?? {}) as StoredRecord;
        const sessionTaskIds = stringArray(workSession.tasksWorkedOn);
        const sessionPromptIds = stringArray(workSession.promptsUsed);
        if (
          task.projectId !== project.id
          || prompt.projectId !== project.id
          || prompt.relatedTaskId !== workflow.taskId
          || workSession.projectId !== project.id
          || (workSession.taskId !== workflow.taskId && !sessionTaskIds.includes(workflow.taskId))
          || (
            workSession.promptRecordId !== workflow.promptRecordId
            && !sessionPromptIds.includes(workflow.promptRecordId)
          )
        ) {
          throw new CodexIngestionError("workflow_mismatch", 409);
        }
        workflowRecords = {
          taskReference,
          promptReference,
          sessionReference,
          task,
          prompt,
          session: workSession,
        };
      }
      const rateData = rateSnapshot.data();
      const previousCount = isRecord(rateData) && typeof rateData.count === "number"
        ? rateData.count
        : 0;
      if (previousCount >= CODEX_INGESTION_RATE_LIMIT_PER_MINUTE) {
        throw new CodexIngestionError("rate_limited", 429);
      }

      const result = buildResult(
        project.id,
        input.payload.session.externalSessionId,
        identity,
        ideaCount,
        false,
        input.payload.workflow,
      );
      const session = input.payload.session;
      const startedAt = session.startedAt ?? session.endedAt;
      const title = titleFrom(input.payload);
      const projectUpdates: StoredRecord = {};
      const fields = existingContinuityFields(continuitySnapshot);
      let continuityChanged = false;

      if (session.objective !== undefined) {
        continuityChanged = applyContinuityField(
          "currentObjective", session.objective, project.data, fields,
          session.externalSessionId, session.endedAt, projectUpdates,
        ) || continuityChanged;
      }
      if (session.nextRecommendedTask !== undefined) {
        continuityChanged = applyContinuityField(
          "nextRecommendedTask", session.nextRecommendedTask, project.data, fields,
          session.externalSessionId, session.endedAt, projectUpdates,
        ) || continuityChanged;
      }
      if (session.currentBlocker !== undefined) {
        const blocker = session.currentBlocker ?? "";
        const clearRequested = blocker.trim().length === 0 || blocker.trim().toLowerCase() === "none";
        const desired = clearRequested ? "" : blocker;
        continuityChanged = applyContinuityField(
          "currentBlocker", desired, project.data, fields,
          session.externalSessionId, session.endedAt, projectUpdates,
        ) || continuityChanged;
      }
      if (advancesTimestamp(project.data.lastWorkedAt, session.endedAt)) projectUpdates.lastWorkedAt = session.endedAt;
      if (advancesTimestamp(project.data.updatedAt, session.endedAt)) projectUpdates.updatedAt = session.endedAt;

      if (workflow && workflowRecords) {
        const reportedDuration = session.activeDurationMs
          ?? nonNegativeInteger(workflowRecords.session.activeDurationMs);
        const previousSessionDuration = nonNegativeInteger(workflowRecords.session.activeDurationMs);
        const previousTaskDuration = nonNegativeInteger(workflowRecords.task.totalActiveDurationMs);
        const nextTaskDuration = Math.max(
          0,
          previousTaskDuration - previousSessionDuration + reportedDuration,
        );
        const taskPromptIds = [...new Set([
          ...stringArray(workflowRecords.task.promptRecordIds),
          workflow.promptRecordId,
        ])];
        const taskSessionIds = [...new Set([
          ...stringArray(workflowRecords.task.workSessionIds),
          workflow.workSessionId,
        ])];
        const taskUpdates: StoredRecord = {
          promptRecordIds: taskPromptIds,
          workSessionIds: taskSessionIds,
          totalActiveDurationMs: nextTaskDuration,
          lastWorkedAt: session.endedAt,
          updatedAt: session.endedAt,
          ...(session.nextRecommendedTask !== undefined
            ? { recommendedNextStep: session.nextRecommendedTask }
            : {}),
          ...(session.branch ? { githubBranch: session.branch } : {}),
          ...(session.commits[0] ? { githubCommit: session.commits[0] } : {}),
        };
        if (workflow.requestedTaskStatus) {
          taskUpdates.status = workflow.requestedTaskStatus;
          taskUpdates.blockedReason = workflow.requestedTaskStatus === "blocked"
            ? session.currentBlocker ?? ""
            : "";
          if (workflow.requestedTaskStatus === "ready") {
            taskUpdates.readyAt = typeof workflowRecords.task.readyAt === "string"
              ? workflowRecords.task.readyAt
              : session.endedAt;
          }
          if (workflow.requestedTaskStatus === "in_progress") {
            taskUpdates.startedAt = typeof workflowRecords.task.startedAt === "string"
              ? workflowRecords.task.startedAt
              : startedAt;
          }
          taskUpdates.completedAt = workflow.requestedTaskStatus === "completed"
            ? session.endedAt
            : null;
        }
        transaction.update(workflowRecords.taskReference, taskUpdates);
        transaction.update(workflowRecords.sessionReference, {
          projectId: project.id,
          taskId: workflow.taskId,
          promptRecordId: workflow.promptRecordId,
          startedAt,
          endedAt: workflow.workSessionStatus === "completed" ? session.endedAt : null,
          objective: session.objective ?? session.summary,
          summary: session.summary,
          source: "codex",
          externalSessionId: session.externalSessionId,
          ...(session.branch ? { branch: session.branch } : {}),
          completedItems: session.completed,
          unfinishedItems: session.unfinished,
          currentBlocker: session.currentBlocker ?? "",
          tasksWorkedOn: [...new Set([
            ...stringArray(workflowRecords.session.tasksWorkedOn),
            workflow.taskId,
          ])],
          tasksCompleted: stringArray(workflowRecords.session.tasksCompleted),
          ideasAdded: [...new Set([
            ...stringArray(workflowRecords.session.ideasAdded),
            ...result.ideaIds,
          ])],
          problemsDiscovered: session.problemsDiscovered,
          decisionsMade: session.decisionsMade,
          promptsUsed: [...new Set([
            ...stringArray(workflowRecords.session.promptsUsed),
            workflow.promptRecordId,
          ])],
          filesModified: session.filesModified,
          commits: session.commits,
          nextStartingPoint: session.nextRecommendedTask ?? session.unfinished[0] ?? "",
          nextStep: session.nextRecommendedTask ?? session.unfinished[0] ?? "",
          blocker: session.currentBlocker ?? "",
          status: workflow.workSessionStatus,
          notes: session.summary,
          activeStartedAt: null,
          activeDurationMs: reportedDuration,
          testResults: session.testResults ?? [],
          buildResults: session.buildResults ?? [],
          deploymentStatus: session.deploymentStatus ?? "",
        });
        transaction.update(workflowRecords.promptReference, {
          resultSummary: session.summary,
          status: workflow.promptStatus,
          relatedTaskId: workflow.taskId,
          relatedSessionId: workflow.workSessionId,
          source: "codex",
          externalSessionId: session.externalSessionId,
          updatedAt: session.endedAt,
          lastUsedAt: session.endedAt,
          completedWork: session.completed,
          unfinishedWork: session.unfinished,
          problemsDiscovered: session.problemsDiscovered,
          decisionsMade: session.decisionsMade,
          filesModified: session.filesModified,
          commits: session.commits,
          branch: session.branch ?? "",
          blocker: session.currentBlocker ?? "",
          recommendedNextStep: session.nextRecommendedTask ?? session.unfinished[0] ?? "",
          activeDurationMs: reportedDuration,
          testResults: session.testResults ?? [],
          buildResults: session.buildResults ?? [],
          deploymentStatus: session.deploymentStatus ?? "",
        });
      } else {
        transaction.create(this.db.doc(sessionPath(input.uid, result.sessionId)), {
          projectId: project.id,
          taskId: null,
          promptRecordId: result.promptId,
          startedAt,
          endedAt: session.endedAt,
          objective: session.objective ?? session.summary,
          summary: session.summary,
          source: "codex",
          externalSessionId: session.externalSessionId,
          ...(session.branch ? { branch: session.branch } : {}),
          completedItems: session.completed,
          unfinishedItems: session.unfinished,
          ...(session.currentBlocker !== undefined ? { currentBlocker: session.currentBlocker ?? "" } : {}),
          tasksWorkedOn: [],
          tasksCompleted: [],
          ideasAdded: result.ideaIds,
          problemsDiscovered: session.problemsDiscovered,
          decisionsMade: session.decisionsMade,
          promptsUsed: [result.promptId],
          filesModified: session.filesModified,
          commits: session.commits,
          nextStartingPoint: session.nextRecommendedTask ?? session.unfinished[0] ?? "",
          status: "completed",
          notes: session.summary,
          activeStartedAt: null,
          activeDurationMs: session.activeDurationMs ?? 0,
          resumeFromNote: "",
          blocker: session.currentBlocker ?? "",
          nextStep: session.nextRecommendedTask ?? session.unfinished[0] ?? "",
          testResults: session.testResults ?? [],
          buildResults: session.buildResults ?? [],
          deploymentStatus: session.deploymentStatus ?? "",
        });
        transaction.create(this.db.doc(promptPath(input.uid, result.promptId)), {
          projectId: project.id,
          title,
          purpose: session.objective ?? session.summary,
          prompt: session.prompt,
          resultSummary: session.summary,
          status: "completed",
          relatedTaskId: null,
          relatedSessionId: result.sessionId,
          source: "codex",
          externalSessionId: session.externalSessionId,
          sequenceNumber: 1,
          promptSummary: session.objective ?? session.summary,
          requestedChange: session.objective ?? session.summary,
          createdBy: "codex",
          completedWork: session.completed,
          unfinishedWork: session.unfinished,
          problemsDiscovered: session.problemsDiscovered,
          decisionsMade: session.decisionsMade,
          filesModified: session.filesModified,
          commits: session.commits,
          branch: session.branch ?? "",
          blocker: session.currentBlocker ?? "",
          recommendedNextStep: session.nextRecommendedTask ?? session.unfinished[0] ?? "",
          activeDurationMs: session.activeDurationMs ?? 0,
          testResults: session.testResults ?? [],
          buildResults: session.buildResults ?? [],
          deploymentStatus: session.deploymentStatus ?? "",
          createdAt: startedAt,
          updatedAt: session.endedAt,
          lastUsedAt: session.endedAt,
        });
      }
      transaction.create(this.db.doc(activityPath(input.uid, result.activityId)), {
        projectId: project.id,
        type: workflow?.workSessionStatus === "paused" ? "session_paused" : "session_completed",
        summary: `Codex ${workflow?.workSessionStatus === "paused" ? "paused" : "completed"}: ${title}`,
        entityType: "development_session",
        entityId: result.sessionId,
        metadata: JSON.stringify({
          source: "codex",
          externalSessionId: session.externalSessionId,
          promptId: result.promptId,
          taskId: workflow?.taskId ?? null,
          branch: session.branch ?? null,
          commitCount: session.commits.length,
          ideaCount: result.ideaIds.length,
        }),
        source: "codex",
        actor: "codex",
        taskId: workflow?.taskId ?? null,
        promptRecordId: result.promptId,
        workSessionId: result.sessionId,
        externalSessionId: session.externalSessionId,
        createdAt: session.endedAt,
      });
      (session.ideas ?? []).forEach((idea, index) => {
        transaction.create(this.db.doc(ideaPath(input.uid, result.ideaIds[index])), {
          projectId: project.id,
          text: idea.text,
          description: idea.description ?? "",
          status: "inbox",
          priority: idea.priority ?? "medium",
          source: "Codex",
          externalSessionId: session.externalSessionId,
          tags: ["codex"],
          linkedTaskId: null,
          convertedAt: null,
          createdAt: session.endedAt,
          updatedAt: session.endedAt,
        });
      });
      if (Object.keys(projectUpdates).length > 0) {
        transaction.update(this.db.doc(`${projectsPath(input.uid)}/${project.id}`), projectUpdates);
      }
      if (continuityChanged) {
        transaction.set(continuityReference, {
          projectId: project.id,
          fields,
          updatedAt: session.endedAt,
        }, { merge: true });
      }
      transaction.set(rateReference, {
        minuteKey: currentMinute,
        count: previousCount + 1,
        updatedAt: input.receivedAt,
      }, { merge: true });
      transaction.create(receiptReference, {
        schemaVersion: 1,
        source: "codex",
        projectId: project.id,
        externalSessionId: session.externalSessionId,
        fingerprint: input.fingerprint,
        status: "completed",
        sessionId: result.sessionId,
        promptId: result.promptId,
        activityId: result.activityId,
        ideaIds: result.ideaIds,
        ...(input.payload.workflow ? {
          taskId: input.payload.workflow.taskId,
          promptRecordId: input.payload.workflow.promptRecordId,
          workSessionId: input.payload.workflow.workSessionId,
        } : {}),
        receivedAt: input.receivedAt,
        endedAt: session.endedAt,
      });
      return result;
    });
  }
}
