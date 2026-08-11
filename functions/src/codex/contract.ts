import { z } from "zod";
import {
  CODEX_INGESTION_MAX_BYTES,
  type CodexSessionIngestV1,
  CodexIngestionError,
} from "./types";

const KiB = 1024;
const nonBlankAuthored = (maximum: number) => z.string().max(maximum).refine(
  (value) => value.trim().length > 0,
  "Must not be blank.",
);
const authoredItem = nonBlankAuthored(4 * KiB);
const boundedAuthoredArray = (maximumItems: number) => z.array(authoredItem).max(maximumItems);
const externalSessionId = z.string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
const githubFullName = z.string()
  .trim()
  .max(256)
  .regex(/^[^/\s]+\/[^/\s]+$/)
  .transform((value) => value.toLowerCase());

export const codexSessionIngestV1Schema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    dashboardProjectId: z.string().uuid().transform((value) => value.toLowerCase()).optional(),
    githubRepositoryId: z.number().int().positive().safe().optional(),
    githubFullName: githubFullName.optional(),
    localPath: z.string().trim().min(1).max(2048).optional(),
  }).strict().refine(
    (project) => Boolean(
      project.dashboardProjectId ||
      project.githubRepositoryId ||
      project.githubFullName ||
      project.localPath,
    ),
    "At least one project identity is required.",
  ),
  session: z.object({
    externalSessionId,
    startedAt: z.string().datetime({ offset: true }).optional(),
    endedAt: z.string().datetime({ offset: true }),
    prompt: nonBlankAuthored(128 * KiB),
    objective: nonBlankAuthored(16 * KiB).optional(),
    summary: nonBlankAuthored(32 * KiB),
    completed: boundedAuthoredArray(100),
    unfinished: boundedAuthoredArray(100),
    problemsDiscovered: boundedAuthoredArray(100),
    decisionsMade: boundedAuthoredArray(100),
    filesModified: boundedAuthoredArray(250),
    commits: boundedAuthoredArray(100),
    branch: z.string().trim().min(1).max(512).optional(),
    currentBlocker: z.string().max(16 * KiB).nullable().optional(),
    nextRecommendedTask: nonBlankAuthored(16 * KiB).optional(),
    ideas: z.array(z.object({
      text: nonBlankAuthored(4 * KiB),
      description: z.string().max(16 * KiB).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    }).strict()).max(25).optional(),
  }).strict().superRefine((session, context) => {
    if (session.startedAt && Date.parse(session.startedAt) > Date.parse(session.endedAt)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["startedAt"], message: "startedAt must not be after endedAt." });
    }
  }),
  source: z.literal("codex"),
}).strict();

const hasUnsupportedSchema = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  return "schemaVersion" in value && (value as { schemaVersion?: unknown }).schemaVersion !== 1;
};

const serializedByteLength = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const CREDENTIAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /["']?(?:private_key|client_secret|access_token|password)["']?\s*[:=]\s*(?:["'][^"'\s]{16,}["']|[A-Za-z0-9._~+/-]{20,})/i,
] as const;

const containsCredential = (value: unknown): boolean => {
  if (typeof value === "string") return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsCredential);
  if (value && typeof value === "object") return Object.values(value).some(containsCredential);
  return false;
};

const containsConfiguredValue = (
  value: unknown,
  forbidden: string,
  visited: WeakSet<object>,
): boolean => {
  if (typeof value === "string") return value.includes(forbidden);
  if (!value || typeof value !== "object") return false;
  if (visited.has(value)) return false;
  visited.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsConfiguredValue(item, forbidden, visited));
  }
  return Object.values(value).some((item) => containsConfiguredValue(item, forbidden, visited));
};

export const assertPayloadExcludesConfiguredValues = (
  raw: unknown,
  configuredValues: string[],
): void => {
  const containsForbiddenValue = configuredValues
    .filter((value) => value.length > 0)
    .some((value) => containsConfiguredValue(raw, value, new WeakSet<object>()));
  if (containsForbiddenValue) {
    throw new CodexIngestionError("sensitive_content", 400);
  }
};

export const parseCodexSessionIngestV1 = (raw: unknown): CodexSessionIngestV1 => {
  if (serializedByteLength(raw) > CODEX_INGESTION_MAX_BYTES) {
    throw new CodexIngestionError("invalid_request", 400);
  }
  if (hasUnsupportedSchema(raw)) {
    throw new CodexIngestionError("unsupported_schema", 400);
  }
  const parsed = codexSessionIngestV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new CodexIngestionError("invalid_request", 400);
  }
  if (containsCredential(parsed.data)) {
    throw new CodexIngestionError("sensitive_content", 400);
  }
  return parsed.data;
};
