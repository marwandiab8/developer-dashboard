import { Buffer } from "node:buffer";
import { SAFE_FIREBASE_CONFIG_PATHS } from "./firebaseDetection";
import { mergeRateLimitState } from "./rateLimit";
import {
  GITHUB_CONCURRENCY,
  GITHUB_PAGE_SIZE,
  GithubApiError,
  type GitHubApiRepository,
  type GitHubApiUser,
  type PersonalCommit,
  type RateLimitState,
  type SafeConfigFile,
  type SafeConfigReadResult,
} from "./types";

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const headerNumber = (headers: Headers, name: string): number | null => {
  const raw = headers.get(name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export const rateLimitFromHeaders = (headers: Headers): RateLimitState => {
  const resetEpoch = headerNumber(headers, "x-ratelimit-reset");
  return {
    limit: headerNumber(headers, "x-ratelimit-limit"),
    remaining: headerNumber(headers, "x-ratelimit-remaining"),
    used: headerNumber(headers, "x-ratelimit-used"),
    resetAt: resetEpoch === null ? null : new Date(resetEpoch * 1000).toISOString(),
    resource: headers.get("x-ratelimit-resource"),
  };
};

export const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
  getStopError?: () => Error | null,
): Promise<R[]> => {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Concurrency limit must be positive.");
  const output = new Array<R>(values.length);
  let cursor = 0;
  let firstError: unknown = null;
  const worker = async (): Promise<void> => {
    while (firstError === null && cursor < values.length) {
      const stopError = getStopError?.() ?? null;
      if (stopError) {
        firstError = stopError;
        return;
      }
      const index = cursor++;
      try {
        output[index] = await mapper(values[index], index);
      } catch (error) {
        if (firstError === null) firstError = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  const stopError = getStopError?.() ?? null;
  if (stopError) throw stopError;
  if (firstError !== null) throw firstError;
  return output;
};

type JsonResult<T> = { data: T; headers: Headers };
type ContentResponse = { type?: string; size?: number; encoding?: string; content?: string };

const encodeRepositoryPath = (owner: string, name: string): string =>
  `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
const encodeContentPath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");
type GithubRequestMode = "authenticated" | "anonymous";

export class GithubClient {
  private latestRateLimit: RateLimitState | null = null;
  private rateLimitExhaustion: GithubApiError | null = null;
  private readonly publicInventoryOnlyRepositoryIds = new Set<number>();
  private readonly anonymousFallbackRepositoryIds = new Set<number>();

  constructor(
    private readonly credential: string,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch,
    private readonly apiBase = "https://api.github.com",
  ) {}

  get rateLimit(): RateLimitState | null {
    return this.latestRateLimit;
  }

  get rateLimitError(): GithubApiError | null {
    if (!this.rateLimitExhaustion) return null;
    return new GithubApiError(
      "rate_limited",
      "GitHub rate limit reached.",
      this.rateLimitExhaustion.status,
      mergeRateLimitState(this.rateLimitExhaustion.rateLimit, this.latestRateLimit),
    );
  }

  private async requestJson<T>(path: string, mode: GithubRequestMode = "authenticated"): Promise<JsonResult<T>> {
    const existingRateLimitError = this.rateLimitError;
    if (existingRateLimitError) throw existingRateLimitError;
    let response: Response;
    try {
      response = await this.fetchImplementation(new URL(path, this.apiBase), {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          ...(mode === "authenticated" ? { Authorization: `Bearer ${this.credential}` } : {}),
          "User-Agent": "developer-dashboard-github-sync/2.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch {
      throw new GithubApiError("unavailable", "GitHub request was unavailable.");
    }

    const requestRateLimit = rateLimitFromHeaders(response.headers);
    if (mode === "authenticated") {
      this.latestRateLimit = mergeRateLimitState(this.latestRateLimit, requestRateLimit);
    }
    if (!response.ok) {
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 && requestRateLimit.remaining !== null && requestRateLimit.remaining <= 0);
      if (rateLimited) {
        this.rateLimitExhaustion = new GithubApiError(
          "rate_limited",
          "GitHub rate limit reached.",
          response.status,
          mergeRateLimitState(this.rateLimitExhaustion?.rateLimit, requestRateLimit),
        );
        throw this.rateLimitError ?? this.rateLimitExhaustion;
      }
      if (response.status === 401 || response.status === 403) {
        throw new GithubApiError("authorization", "GitHub authorization failed.", response.status, requestRateLimit);
      }
      if (response.status === 404 || response.status === 409 || response.status >= 500) {
        throw new GithubApiError("unavailable", "GitHub resource was unavailable.", response.status, requestRateLimit);
      }
      throw new GithubApiError("invalid_response", "GitHub returned an invalid response.", response.status, requestRateLimit);
    }

    try {
      return { data: (await response.json()) as T, headers: response.headers };
    } catch {
      throw new GithubApiError("invalid_response", "GitHub returned an invalid response.", response.status, requestRateLimit);
    }
  }

  async getAuthenticatedUser(): Promise<GitHubApiUser> {
    const { data } = await this.requestJson<GitHubApiUser>("/user");
    if (!data || typeof data.login !== "string" || !data.login.trim()) {
      throw new GithubApiError("invalid_response", "GitHub returned an invalid user response.");
    }
    return { login: data.login.trim() };
  }

  private async listRepositoryPages(
    endpoint: string,
    parameters: Record<string, string>,
    mode: GithubRequestMode,
  ): Promise<GitHubApiRepository[]> {
    const repositories: GitHubApiRepository[] = [];
    for (let page = 1; page <= 1000; page += 1) {
      const query = new URLSearchParams({
        ...parameters,
        per_page: String(GITHUB_PAGE_SIZE),
        page: String(page),
      });
      const { data } = await this.requestJson<GitHubApiRepository[]>(`${endpoint}?${query.toString()}`, mode);
      if (!Array.isArray(data)) throw new GithubApiError("invalid_response", "GitHub returned invalid repositories.");
      repositories.push(...data);
      if (data.length < GITHUB_PAGE_SIZE) return repositories;
    }
    throw new GithubApiError("invalid_response", "GitHub repository pagination exceeded the safety bound.");
  }

  async listAllRepositories(login: string): Promise<GitHubApiRepository[]> {
    this.publicInventoryOnlyRepositoryIds.clear();
    this.anonymousFallbackRepositoryIds.clear();
    const authenticated = await this.listRepositoryPages("/user/repos", {
      visibility: "all",
      affiliation: "owner,collaborator,organization_member",
      sort: "full_name",
      direction: "asc",
    }, "authenticated");
    const publicOwner = await this.listRepositoryPages(`/users/${encodeURIComponent(login)}/repos`, {
      type: "owner",
      sort: "full_name",
      direction: "asc",
    }, "anonymous");
    const repositoriesById = new Map(authenticated.map((repository) => [repository.id, repository]));
    for (const repository of publicOwner) {
      const isPublic = !repository.private && repository.visibility !== "private" && repository.visibility !== "internal";
      if (!isPublic || repositoriesById.has(repository.id)) continue;
      repositoriesById.set(repository.id, repository);
      this.publicInventoryOnlyRepositoryIds.add(repository.id);
    }
    return [...repositoriesById.values()].sort((left, right) => left.full_name.localeCompare(right.full_name));
  }

  private isPublicRepository(repository: GitHubApiRepository): boolean {
    const isPublic = !repository.private && repository.visibility !== "private" && repository.visibility !== "internal";
    return isPublic;
  }

  private async requestRepositoryJson<T>(repository: GitHubApiRepository, path: string): Promise<JsonResult<T>> {
    const isPublic = this.isPublicRepository(repository);
    if (isPublic && (
      this.publicInventoryOnlyRepositoryIds.has(repository.id) ||
      this.anonymousFallbackRepositoryIds.has(repository.id)
    )) {
      return this.requestJson<T>(path, "anonymous");
    }
    try {
      return await this.requestJson<T>(path, "authenticated");
    } catch (error) {
      const canRetryAnonymously = isPublic &&
        error instanceof GithubApiError &&
        error.safeCode !== "rate_limited" &&
        (error.status === 403 || error.status === 404);
      if (!canRetryAnonymously) throw error;
      this.anonymousFallbackRepositoryIds.add(repository.id);
      return this.requestJson<T>(path, "anonymous");
    }
  }

  async getOpenPullRequestCount(repository: GitHubApiRepository): Promise<number> {
    const repositoryPath = encodeRepositoryPath(repository.owner.login, repository.name);
    const { data, headers } = await this.requestRepositoryJson<unknown[]>(
      repository,
      `/repos/${repositoryPath}/pulls?state=open&per_page=1&page=1`,
    );
    if (!Array.isArray(data)) throw new GithubApiError("invalid_response", "GitHub returned invalid pull requests.");
    const link = headers.get("link") ?? "";
    const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (last) return Number(last[1]);
    return data.length;
  }

  async getLatestPersonalCommit(repository: GitHubApiRepository, login: string): Promise<PersonalCommit | null> {
    const repositoryPath = encodeRepositoryPath(repository.owner.login, repository.name);
    const query = new URLSearchParams({ author: login, per_page: "1", page: "1" });
    const { data } = await this.requestRepositoryJson<
      Array<{ commit?: { author?: { date?: string | null }; committer?: { date?: string | null }; message?: string } }>
    >(repository, `/repos/${repositoryPath}/commits?${query.toString()}`);
    if (!Array.isArray(data) || data.length === 0) return null;
    const commit = data[0]?.commit;
    const committedAt = commit?.author?.date ?? commit?.committer?.date ?? null;
    if (!committedAt || Number.isNaN(new Date(committedAt).getTime())) return null;
    const message = typeof commit?.message === "string" ? commit.message.trim().slice(0, 1000) : "";
    return { committedAt: new Date(committedAt).toISOString(), message };
  }

  private async getSafeConfigFile(
    repository: GitHubApiRepository,
    repositoryPath: string,
    branch: string,
    path: string,
  ): Promise<SafeConfigFile> {
    const query = new URLSearchParams({ ref: branch });
    const { data } = await this.requestRepositoryJson<ContentResponse>(
      repository,
      `/repos/${repositoryPath}/contents/${encodeContentPath(path)}?${query.toString()}`,
    );
    if (data.type !== "file" || data.encoding !== "base64" || typeof data.content !== "string") {
      throw new GithubApiError("invalid_response", "GitHub returned an invalid safe configuration file.");
    }
    if (typeof data.size === "number" && data.size > 128 * 1024) {
      throw new GithubApiError("invalid_response", "Safe configuration file exceeded the size limit.");
    }
    const decoded = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
    if (Buffer.byteLength(decoded, "utf8") > 128 * 1024) {
      throw new GithubApiError("invalid_response", "Safe configuration file exceeded the size limit.");
    }
    return { path, content: decoded };
  }

  async getSafeFirebaseConfigFiles(repository: GitHubApiRepository): Promise<SafeConfigReadResult> {
    if (!repository.default_branch) return { files: [], failedFileCount: 0 };
    const repositoryPath = encodeRepositoryPath(repository.owner.login, repository.name);
    const results = await mapWithConcurrency(SAFE_FIREBASE_CONFIG_PATHS, 2, async (path) => {
      try {
        return {
          file: await this.getSafeConfigFile(repository, repositoryPath, repository.default_branch, path),
          failed: false,
        };
      } catch (error) {
        if (error instanceof GithubApiError && error.safeCode === "rate_limited") throw error;
        const expectedAbsence = error instanceof GithubApiError &&
          (error.status === 404 || error.status === 409);
        return { file: null, failed: !expectedAbsence };
      }
    });
    return {
      files: results.map((result) => result.file).filter((file): file is SafeConfigFile => file !== null),
      failedFileCount: results.filter((result) => result.failed).length,
    };
  }
}

export const enrichWithBoundedConcurrency = async <T>(
  repositories: readonly GitHubApiRepository[],
  mapper: (repository: GitHubApiRepository) => Promise<T>,
  getStopError?: () => Error | null,
): Promise<T[]> => mapWithConcurrency(repositories, GITHUB_CONCURRENCY, mapper, getStopError);
