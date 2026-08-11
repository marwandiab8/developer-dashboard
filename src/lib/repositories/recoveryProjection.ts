import type { DashboardData } from "../models";
import { isCloudMutationContract } from "./cloudMutationContract";
import { dashboardReducer } from "./reducer";
import type {
  CloudMutationCollection,
  CloudMutationContract,
  PendingCloudReconciliationAction,
} from "./types";

type DashboardEntity = Record<string, unknown>;

const collectionDescriptors: Record<
  CloudMutationCollection,
  { dataKey: keyof DashboardData; idField: "id" | "projectId" }
> = {
  projects: { dataKey: "projects", idField: "id" },
  ideas: { dataKey: "ideas", idField: "id" },
  tasks: { dataKey: "tasks", idField: "id" },
  brainDumps: { dataKey: "brainDumps", idField: "id" },
  scratchpads: { dataKey: "scratchpads", idField: "projectId" },
  architectureDecisions: { dataKey: "architectureDecisions", idField: "id" },
  codexPrompts: { dataKey: "codexPrompts", idField: "id" },
  notes: { dataKey: "notes", idField: "id" },
  links: { dataKey: "importantLinks", idField: "id" },
  sessions: { dataKey: "developmentSessions", idField: "id" },
  activity: { dataKey: "activities", idField: "id" },
};

const entityId = (entity: DashboardEntity, idField: "id" | "projectId") =>
  String(entity[idField] ?? "");

const applyMutationContract = (
  base: DashboardData,
  mutation: CloudMutationContract,
): DashboardData => mutation.documents.reduce((current, expectation) => {
  const descriptor = collectionDescriptors[expectation.collection];
  const rows = current[descriptor.dataKey] as unknown as DashboardEntity[];
  const existingIndex = rows.findIndex(
    (entity) => entityId(entity, descriptor.idField) === expectation.documentId,
  );

  if (!expectation.afterExists) {
    if (existingIndex < 0) return current;
    return {
      ...current,
      [descriptor.dataKey]: rows.filter((_, index) => index !== existingIndex),
    } as DashboardData;
  }

  const nextEntity: DashboardEntity = existingIndex >= 0
    ? { ...rows[existingIndex] }
    : { [descriptor.idField]: expectation.documentId };
  expectation.fields.forEach((field) => {
    if (field.after.present) {
      nextEntity[field.field] = field.after.value;
    } else {
      delete nextEntity[field.field];
    }
  });

  const nextRows = existingIndex >= 0
    ? rows.map((entity, index) => index === existingIndex ? nextEntity : entity)
    : [nextEntity, ...rows];
  return {
    ...current,
    [descriptor.dataKey]: nextRows,
  } as DashboardData;
}, base);

const applyLegacyJournalEntry = (
  base: DashboardData,
  pending: PendingCloudReconciliationAction,
) => {
  let projected = dashboardReducer(base, pending.action);
  if (
    pending.activity
    && (pending.action.type !== "activity_add" || pending.action.payload.id !== pending.activity.id)
  ) {
    projected = dashboardReducer(projected, {
      type: "activity_add",
      payload: pending.activity,
    });
  }
  if (pending.projectRecency) {
    const recency = pending.projectRecency;
    projected = {
      ...projected,
      projects: projected.projects.map((project) => project.id === recency.projectId
        ? {
            ...project,
            updatedAt: recency.updatedAt,
            lastWorkedAt: recency.lastWorkedAt,
          }
        : project),
    };
  }
  return projected;
};

/**
 * The single recovery projection rule: every repository snapshot is an
 * immutable remote base, then every still-visible journal mutation overlays it
 * in original invocation order. Mutation contracts apply only their authored
 * fields, so unrelated remote changes remain authoritative.
 */
export const buildRecoveryProjection = (
  remoteBase: DashboardData,
  pendingMutations: PendingCloudReconciliationAction[],
): DashboardData => pendingMutations.reduce((projection, pending) => {
  if (isCloudMutationContract(pending.mutation)) {
    return applyMutationContract(projection, pending.mutation);
  }
  return applyLegacyJournalEntry(projection, pending);
}, remoteBase);
