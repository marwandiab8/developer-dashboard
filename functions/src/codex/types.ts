export const CODEX_INGESTION_SCHEMA_VERSION = 1 as const;
export const CODEX_INGESTION_MAX_BYTES = 256 * 1024;
export const CODEX_INGESTION_RATE_LIMIT_PER_MINUTE = 30;

export type CodexIdeaInput = {
  text: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
};

export type CodexSessionIngestV1 = {
  schemaVersion: typeof CODEX_INGESTION_SCHEMA_VERSION;
  project: {
    dashboardProjectId?: string;
    githubRepositoryId?: number;
    githubFullName?: string;
    localPath?: string;
  };
  session: {
    externalSessionId: string;
    startedAt?: string;
    endedAt: string;
    prompt: string;
    objective?: string;
    summary: string;
    completed: string[];
    unfinished: string[];
    problemsDiscovered: string[];
    decisionsMade: string[];
    filesModified: string[];
    commits: string[];
    branch?: string;
    currentBlocker?: string | null;
    nextRecommendedTask?: string;
    ideas?: CodexIdeaInput[];
  };
  source: "codex";
};

export type CodexIngestionResult = {
  ok: true;
  idempotent: boolean;
  status: "created" | "duplicate";
  projectId: string;
  externalSessionId: string;
  sessionId: string;
  promptId: string;
  activityId: string;
  ideaIds: string[];
};

export type CodexIngestionErrorCode =
  | "invalid_request"
  | "unsupported_schema"
  | "sensitive_content"
  | "unauthenticated"
  | "method_not_allowed"
  | "project_not_associated"
  | "project_ambiguous"
  | "selector_mismatch"
  | "idempotency_conflict"
  | "rate_limited"
  | "configuration_unavailable"
  | "internal";

const SAFE_MESSAGES: Record<CodexIngestionErrorCode, string> = {
  invalid_request: "The Codex session payload is invalid.",
  unsupported_schema: "The Codex session schema version is unsupported.",
  sensitive_content: "The Codex session payload appears to contain a credential.",
  unauthenticated: "Ingestion authentication failed.",
  method_not_allowed: "Only POST is supported.",
  project_not_associated: "The Codex session is not associated with a Dashboard project.",
  project_ambiguous: "The Codex session project identity is ambiguous.",
  selector_mismatch: "The supplied project identities do not refer to the same Dashboard project.",
  idempotency_conflict: "This external session ID was already used with different content.",
  rate_limited: "Too many new Codex sessions were submitted. Retry later.",
  configuration_unavailable: "Codex ingestion is not configured.",
  internal: "Codex session ingestion failed safely.",
};

export class CodexIngestionError extends Error {
  readonly message: string;

  constructor(
    readonly code: CodexIngestionErrorCode,
    readonly httpStatus: number,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "CodexIngestionError";
    this.message = SAFE_MESSAGES[code];
  }
}
