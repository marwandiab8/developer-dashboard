import { detectFirebaseAssociations } from "./firebaseDetection";
import type {
  GitHubApiRepository,
  GithubVisibility,
  NormalizedGithubRepository,
  PersonalCommit,
  SafeConfigReadResult,
} from "./types";

const iso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const visibilityOf = (repository: GitHubApiRepository): GithubVisibility => {
  if (repository.visibility === "internal") return "internal";
  if (repository.visibility === "private" || repository.private) return "private";
  return "public";
};

export type NormalizeRepositoryInput = {
  repository: GitHubApiRepository;
  openPullRequestCount: number | null;
  latestPersonalCommit: PersonalCommit | null;
  configFiles: SafeConfigReadResult;
  failureCodes: string[];
  syncedAt: string;
};

export const normalizeGithubRepository = (input: NormalizeRepositoryInput): NormalizedGithubRepository => {
  const repository = input.repository;
  if (!Number.isSafeInteger(repository.id) || repository.id <= 0) throw new Error("Invalid GitHub repository identifier.");
  if (!repository.owner?.login?.trim() || !repository.name?.trim() || !repository.full_name?.trim()) {
    throw new Error("Invalid GitHub repository identity.");
  }
  try {
    const parsedUrl = new URL(repository.html_url);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") throw new Error();
  } catch {
    throw new Error("Invalid GitHub repository URL.");
  }

  const createdAt = iso(repository.created_at);
  const updatedAt = iso(repository.updated_at);
  if (!createdAt || !updatedAt) throw new Error("Invalid GitHub repository timestamps.");
  const pushedAt = iso(repository.pushed_at);
  const personalCommitAt = iso(input.latestPersonalCommit?.committedAt);
  const lastWorkedAt = personalCommitAt ?? pushedAt ?? updatedAt ?? createdAt;
  const lastWorkedAtSource = personalCommitAt
    ? "github_personal_commit"
    : pushedAt
      ? "github_repository_pushed_at"
      : updatedAt
        ? "github_repository_updated_at"
        : "github_repository_created_at";
  const pullRequests = input.openPullRequestCount;
  const trueOpenIssues = pullRequests === null ? null : Math.max(0, repository.open_issues_count - pullRequests);
  const firebaseAssociations = detectFirebaseAssociations(
    input.configFiles.files,
    input.configFiles.failedFileCount > 0 ? "partial" : "complete",
  );
  const failureCodes = [...input.failureCodes];
  if (input.configFiles.failedFileCount > 0) failureCodes.push("firebase_config_partial");

  return {
    repositoryId: repository.id,
    ownerLogin: repository.owner.login.trim(),
    name: repository.name.trim(),
    fullName: repository.full_name.trim(),
    url: repository.html_url,
    visibility: visibilityOf(repository),
    archived: repository.archived === true,
    fork: repository.fork === true,
    defaultBranch: repository.default_branch?.trim() || "main",
    description: repository.description?.trim() || null,
    language: repository.language?.trim() || null,
    topics: [...new Set((repository.topics ?? []).filter((topic) => typeof topic === "string").map((topic) => topic.trim()).filter(Boolean))].sort(),
    repositoryCreatedAt: createdAt,
    repositoryUpdatedAt: updatedAt,
    repositoryPushedAt: pushedAt,
    openIssueCount: trueOpenIssues,
    openPullRequestCount: pullRequests,
    latestPersonalCommitAt: personalCommitAt,
    latestPersonalCommitMessage: personalCommitAt ? input.latestPersonalCommit?.message ?? "" : null,
    lastWorkedAt,
    lastWorkedAtSource,
    firebaseAssociations,
    enrichmentFailureCodes: [...new Set(failureCodes)].sort(),
    syncedAt: new Date(input.syncedAt).toISOString(),
  };
};
