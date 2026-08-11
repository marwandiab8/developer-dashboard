export const FUNCTIONS_REGION = "us-east4";
export const GITHUB_PAGE_SIZE = 100;
export const GITHUB_CONCURRENCY = 4;
export const FIRESTORE_BATCH_SIZE = 400;
export const SYNC_LEASE_TTL_MS = 12 * 60 * 1000;

export type GithubSyncMode = "manual" | "scheduled";
export type GithubVisibility = "public" | "private" | "internal";
export const SYNC_FAILURE_STAGES = [
  "github_authentication",
  "repository_list_and_enrichment",
  "contract_normalization",
  "project_persistence",
  "run_completion",
] as const;
export type SyncFailureStage = (typeof SYNC_FAILURE_STAGES)[number];

export type RateLimitState = {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: string | null;
  resource: string | null;
};

export type GitHubApiUser = {
  login: string;
};

export type GitHubApiRepository = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  private: boolean;
  visibility?: GithubVisibility;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  open_issues_count: number;
};

export type PersonalCommit = {
  committedAt: string;
  message: string;
};

export type SafeConfigFile = {
  path: string;
  content: string;
};

export type SafeConfigReadResult = {
  files: SafeConfigFile[];
  failedFileCount: number;
};

export type FirebaseAssociationEvidence = {
  projectId: string;
  filePath: string;
  configKey: string;
  status: "detected";
};

export type FirebaseAssociationDetection = {
  projectIds: string[];
  evidence: FirebaseAssociationEvidence[];
  discoveryStatus: "complete" | "partial";
};

export type RepositoryEnrichment = {
  openPullRequestCount: number | null;
  openIssueCount: number | null;
  latestPersonalCommit: PersonalCommit | null;
  firebaseAssociations: FirebaseAssociationDetection;
  failureCodes: string[];
};

export type LastWorkedAtSource =
  | "github_personal_commit"
  | "github_repository_pushed_at"
  | "github_repository_updated_at"
  | "github_repository_created_at";

export type NormalizedGithubRepository = {
  repositoryId: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  url: string;
  visibility: GithubVisibility;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  topics: string[];
  repositoryCreatedAt: string;
  repositoryUpdatedAt: string;
  repositoryPushedAt: string | null;
  openIssueCount: number | null;
  openPullRequestCount: number | null;
  latestPersonalCommitAt: string | null;
  latestPersonalCommitMessage: string | null;
  lastWorkedAt: string;
  lastWorkedAtSource: LastWorkedAtSource;
  firebaseAssociations: FirebaseAssociationDetection;
  enrichmentFailureCodes: string[];
  syncedAt: string;
};

export type GithubSyncCounts = {
  created: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  failed: number;
};

export type GithubSyncResponse = GithubSyncCounts & {
  runId: string;
  startedAt: string;
  completedAt: string;
  rateLimit: RateLimitState | null;
};

export type GithubConnectionResponse = {
  configured: boolean;
  connected: boolean;
  ownerLogin: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncStatus: "never" | "running" | "succeeded" | "failed";
  synchronizationInProgress: boolean;
  rateLimit: RateLimitState | null;
  statusMessage: string;
};

export type SyncStateRecord = {
  status: "running" | "succeeded" | "failed";
  syncEnabled: boolean;
  firstSuccessfulManualImportAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastRunId: string | null;
  lastSuccessfulScheduledDayKey: string | null;
  /** Legacy completion marker retained for deployed-state compatibility. */
  lastScheduledKey: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  connectedOwnerLogin: string | null;
  lastRateLimit: RateLimitState | null;
  lastCounts: GithubSyncCounts | null;
  lastErrorCode: string | null;
  lastFailureStage: SyncFailureStage | null;
};

export type LeaseResult = {
  acquired: boolean;
  duplicateScheduledRun: boolean;
  scheduledDisabled?: boolean;
};

export type GithubApiErrorCode = "authorization" | "rate_limited" | "unavailable" | "invalid_response";

export class GithubApiError extends Error {
  constructor(
    readonly safeCode: GithubApiErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly rateLimit: RateLimitState | null = null,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}
