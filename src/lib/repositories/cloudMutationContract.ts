import type { DashboardData } from "../models";
import type {
  CloudMutationCollection,
  CloudMutationContract,
  CloudMutationDocumentExpectation,
  CloudMutationFieldExpectation,
  CloudMutationFieldState,
} from "./types";

type DashboardEntity = Record<string, unknown>;

type CollectionDescriptor = {
  dataKey: keyof DashboardData;
  collection: CloudMutationCollection;
  id: (entity: DashboardEntity) => string;
};

const descriptors: CollectionDescriptor[] = [
  { dataKey: "projects", collection: "projects", id: (entity) => String(entity.id ?? "") },
  { dataKey: "ideas", collection: "ideas", id: (entity) => String(entity.id ?? "") },
  { dataKey: "tasks", collection: "tasks", id: (entity) => String(entity.id ?? "") },
  { dataKey: "brainDumps", collection: "brainDumps", id: (entity) => String(entity.id ?? "") },
  { dataKey: "scratchpads", collection: "scratchpads", id: (entity) => String(entity.projectId ?? "") },
  {
    dataKey: "architectureDecisions",
    collection: "architectureDecisions",
    id: (entity) => String(entity.id ?? ""),
  },
  { dataKey: "codexPrompts", collection: "codexPrompts", id: (entity) => String(entity.id ?? "") },
  { dataKey: "notes", collection: "notes", id: (entity) => String(entity.id ?? "") },
  { dataKey: "importantLinks", collection: "links", id: (entity) => String(entity.id ?? "") },
  {
    dataKey: "developmentSessions",
    collection: "sessions",
    id: (entity) => String(entity.id ?? ""),
  },
  { dataKey: "activities", collection: "activity", id: (entity) => String(entity.id ?? "") },
];

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, candidate]) => candidate !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, candidate]) => [key, canonicalize(candidate)]),
    );
  }
  return value;
};

const serialize = (value: unknown) => JSON.stringify(canonicalize(value));

const stateFor = (entity: DashboardEntity | undefined, field: string): CloudMutationFieldState => {
  if (!entity || !Object.prototype.hasOwnProperty.call(entity, field) || entity[field] === undefined) {
    return { present: false };
  }
  return { present: true, value: canonicalize(entity[field]) };
};

const fieldsForChange = (
  before: DashboardEntity | undefined,
  after: DashboardEntity | undefined,
): CloudMutationFieldExpectation[] => {
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  keys.delete("id");

  return Array.from(keys)
    .sort()
    .flatMap((field) => {
      const previous = stateFor(before, field);
      const desired = stateFor(after, field);

      // Dashboard upserts use merge semantics. A missing optional field in the
      // projected model therefore does not authorize deleting a remote field.
      if (before && after && !desired.present) {
        return [];
      }
      if (serialize(previous) === serialize(desired)) {
        return [];
      }
      return [{ field, before: previous, after: desired }];
    });
};

export const fingerprintCloudMutationDocuments = (
  documents: CloudMutationDocumentExpectation[],
) => {
  const source = serialize({ version: 1, documents });
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
};

export const createCloudMutationContract = (
  beforeData: DashboardData,
  afterData: DashboardData,
): CloudMutationContract => {
  const documents: CloudMutationDocumentExpectation[] = [];

  descriptors.forEach((descriptor) => {
    const beforeRows = beforeData[descriptor.dataKey] as unknown as DashboardEntity[];
    const afterRows = afterData[descriptor.dataKey] as unknown as DashboardEntity[];
    const beforeById = new Map(beforeRows.map((entity) => [descriptor.id(entity), entity]));
    const afterById = new Map(afterRows.map((entity) => [descriptor.id(entity), entity]));
    const ids = new Set([...beforeById.keys(), ...afterById.keys()]);

    Array.from(ids).sort().forEach((documentId) => {
      if (!documentId) return;
      const before = beforeById.get(documentId);
      const after = afterById.get(documentId);
      const fields = fieldsForChange(before, after);
      if (before && after && fields.length === 0) return;

      documents.push({
        collection: descriptor.collection,
        documentId,
        beforeExists: before !== undefined,
        afterExists: after !== undefined,
        fields,
      });
    });
  });

  return {
    version: 1,
    fingerprint: fingerprintCloudMutationDocuments(documents),
    documents,
  };
};

export const canonicalCloudMutationValue = canonicalize;

const collections = new Set<CloudMutationCollection>(
  descriptors.map((descriptor) => descriptor.collection),
);

const isFieldState = (value: unknown): value is CloudMutationFieldState => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.present === "boolean"
    && (candidate.present || candidate.value === undefined);
};

export const isCloudMutationContract = (value: unknown): value is CloudMutationContract => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.fingerprint !== "string") return false;
  if (!Array.isArray(candidate.documents)) return false;

  const documentsAreValid = candidate.documents.every((document) => {
    if (!document || typeof document !== "object") return false;
    const row = document as Record<string, unknown>;
    return typeof row.collection === "string"
      && collections.has(row.collection as CloudMutationCollection)
      && typeof row.documentId === "string"
      && row.documentId.length > 0
      && typeof row.beforeExists === "boolean"
      && typeof row.afterExists === "boolean"
      && Array.isArray(row.fields)
      && row.fields.every((field) => {
        if (!field || typeof field !== "object") return false;
        const expectation = field as Record<string, unknown>;
        return typeof expectation.field === "string"
          && expectation.field.length > 0
          && isFieldState(expectation.before)
          && isFieldState(expectation.after);
      });
  });
  if (!documentsAreValid) return false;

  return candidate.fingerprint
    === fingerprintCloudMutationDocuments(
      candidate.documents as CloudMutationDocumentExpectation[],
    );
};
