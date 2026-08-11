import assert from "node:assert/strict";
import test from "node:test";
import { GithubClient, mapWithConcurrency } from "../src/github/client";
import { SAFE_FIREBASE_CONFIG_PATHS } from "../src/github/firebaseDetection";
import { GithubApiError, type GitHubApiRepository } from "../src/github/types";

const repo = (id: number, overrides: Partial<GitHubApiRepository> = {}): GitHubApiRepository => ({
  id, name: `repo-${id}`, full_name: `owner/repo-${id}`, owner: { login: "owner" },
  html_url: `https://github.com/owner/repo-${id}`, private: false, visibility: "public",
  archived: false, fork: false, default_branch: "main", description: null, language: null,
  topics: [], created_at: "2025-01-01T00:00:00.000Z", updated_at: "2025-01-02T00:00:00.000Z",
  pushed_at: "2025-01-02T00:00:00.000Z", open_issues_count: 0, ...overrides,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const encodedFile = (content: string) => ({
  type: "file",
  encoding: "base64",
  size: Buffer.byteLength(content, "utf8"),
  content: Buffer.from(content, "utf8").toString("base64"),
});

test("reads only exact allowlisted metadata paths without enumerating private repository source", async () => {
  const repository = repo(41, { private: true, visibility: "private" });
  const requestedPaths: string[] = [];
  const client = new GithubClient("credential", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname.includes("/git/trees/"), false);
    assert.equal(url.pathname.includes("/contents/src/"), false);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer credential");
    const marker = "/contents/";
    const offset = url.pathname.indexOf(marker);
    assert.notEqual(offset, -1);
    const path = url.pathname.slice(offset + marker.length).split("/").map(decodeURIComponent).join("/");
    requestedPaths.push(path);
    if (path === ".firebaserc") {
      return json(encodedFile(JSON.stringify({ projects: { default: "allowlisted-project" } })));
    }
    if (path === "apphosting.yaml") {
      return json(encodedFile("env:\n  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID\n    value: allowlisted-project"));
    }
    return json({}, 404);
  });

  const result = await client.getSafeFirebaseConfigFiles(repository);

  assert.deepEqual([...requestedPaths].sort(), [...SAFE_FIREBASE_CONFIG_PATHS].sort());
  assert.deepEqual(result.files.map((file) => file.path), [".firebaserc", "apphosting.yaml"]);
  assert.equal(result.failedFileCount, 0);
});

test("treats missing optional metadata files as a complete no-evidence result", async () => {
  const repository = repo(42, { private: true, visibility: "private" });
  const authorizations: Array<string | null> = [];
  let calls = 0;
  const client = new GithubClient("credential", async (_input, init) => {
    calls += 1;
    authorizations.push(new Headers(init?.headers).get("authorization"));
    return json({}, calls % 2 === 0 ? 409 : 404);
  });

  const result = await client.getSafeFirebaseConfigFiles(repository);

  assert.deepEqual(result, { files: [], failedFileCount: 0 });
  assert.equal(calls, SAFE_FIREBASE_CONFIG_PATHS.length);
  assert.deepEqual(authorizations, SAFE_FIREBASE_CONFIG_PATHS.map(() => "Bearer credential"));
});

test("keeps inaccessible private metadata nonfatal but marks Firebase evidence as partial", async () => {
  const repository = repo(44, { private: true, visibility: "private" });
  const authorizations: Array<string | null> = [];
  const client = new GithubClient("credential", async (_input, init) => {
    authorizations.push(new Headers(init?.headers).get("authorization"));
    return json({}, 403);
  });

  const result = await client.getSafeFirebaseConfigFiles(repository);

  assert.deepEqual(result.files, []);
  assert.equal(result.failedFileCount, SAFE_FIREBASE_CONFIG_PATHS.length);
  assert.deepEqual(authorizations, SAFE_FIREBASE_CONFIG_PATHS.map(() => "Bearer credential"));
});

test("propagates safe-config rate exhaustion and stops launching allowlisted reads", async () => {
  const repository = repo(45, { private: true, visibility: "private" });
  const requestedPaths: string[] = [];
  const reset = "1735866000";
  const client = new GithubClient("credential", async (input) => {
    const url = new URL(String(input));
    const path = url.pathname.split("/contents/")[1]?.split("/").map(decodeURIComponent).join("/") ?? "";
    requestedPaths.push(path);
    if (path === ".firebaserc") {
      return json({}, 403, {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-used": "5000",
        "x-ratelimit-reset": reset,
        "x-ratelimit-resource": "core",
      });
    }
    return json({}, 404);
  });

  await assert.rejects(() => client.getSafeFirebaseConfigFiles(repository), (error) => {
    assert.ok(error instanceof GithubApiError);
    assert.equal(error.safeCode, "rate_limited");
    assert.equal(error.rateLimit?.remaining, 0);
    assert.equal(error.rateLimit?.resetAt, new Date(Number(reset) * 1000).toISOString());
    return true;
  });
  assert.deepEqual(requestedPaths.sort(), [".firebaserc", "firebase.json"]);
});

test("models genuine allowlisted metadata retrieval failures as partial without enumerating a tree", async () => {
  const repository = repo(43, { private: true, visibility: "private" });
  const requestedUrls: string[] = [];
  const client = new GithubClient("credential", async (input) => {
    requestedUrls.push(String(input));
    return json({}, 500);
  });

  const result = await client.getSafeFirebaseConfigFiles(repository);

  assert.deepEqual(result.files, []);
  assert.equal(result.failedFileCount, SAFE_FIREBASE_CONFIG_PATHS.length);
  assert.equal(requestedUrls.some((url) => url.includes("/git/trees/")), false);
});

test("paginates both inventories beyond 100 and retains public private internal archived and forked repositories", async () => {
  const authenticatedFirst = Array.from({ length: 100 }, (_, index) => repo(index + 1));
  const authenticatedLast = repo(101, { private: true, visibility: "private", archived: true, fork: true });
  const publicFirst = Array.from({ length: 100 }, (_, index) => repo(index + 1001));
  const publicLast = repo(1101, { archived: true, fork: true });
  const authenticatedPages: string[] = [];
  const publicPages: string[] = [];
  const client = new GithubClient("credential", async (input, init) => {
    const url = new URL(String(input));
    const page = url.searchParams.get("page") ?? "";
    const authorization = new Headers(init?.headers).get("authorization");
    if (url.pathname === "/user/repos") {
      authenticatedPages.push(page);
      assert.equal(authorization, "Bearer credential");
      return json(page === "1" ? authenticatedFirst : [authenticatedLast], 200, { "x-ratelimit-limit": "5000" });
    }
    if (url.pathname === "/users/owner/repos") {
      publicPages.push(page);
      assert.equal(authorization, null);
      return json(page === "1" ? publicFirst : [publicLast], 200, { "x-ratelimit-limit": "60" });
    }
    return json({}, 404);
  });
  const repositories = await client.listAllRepositories("owner");
  assert.equal(repositories.length, 202);
  assert.deepEqual(authenticatedPages, ["1", "2"]);
  assert.deepEqual(publicPages, ["1", "2"]);
  assert.equal(repositories.find((item) => item.id === 101)?.private, true);
  assert.equal(repositories.find((item) => item.id === 101)?.archived, true);
  assert.equal(repositories.find((item) => item.id === 101)?.fork, true);
  assert.equal(repositories.find((item) => item.id === 1101)?.archived, true);
  assert.equal(repositories.find((item) => item.id === 1101)?.fork, true);
  assert.equal(client.rateLimit?.limit, 5000);
});

test("deduplicates by immutable id and keeps authenticated inventory authoritative", async () => {
  const authenticated = repo(7, { private: true, visibility: "private", description: "authenticated" });
  const publicDuplicate = repo(7, { description: "public duplicate" });
  const client = new GithubClient("credential", async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/user/repos") return json([authenticated]);
    if (path === "/users/owner/repos") return json([publicDuplicate]);
    return json({}, 404);
  });
  const repositories = await client.listAllRepositories("owner");
  assert.equal(repositories.length, 1);
  assert.equal(repositories[0].private, true);
  assert.equal(repositories[0].description, "authenticated");
});

test("falls back once for authenticated-listed public repositories but never for private or internal repositories", async () => {
  const privateRepository = repo(1, { name: "private", full_name: "owner/private", private: true, visibility: "private" });
  const publicOnlyRepository = repo(2, { name: "public-only", full_name: "owner/public-only" });
  const authenticatedPublic = repo(3, { name: "authenticated-public", full_name: "owner/authenticated-public" });
  const internalRepository = repo(4, { name: "internal", full_name: "owner/internal", visibility: "internal" });
  const authorizations: Record<string, Array<string | null>> = {};
  const client = new GithubClient("credential", async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/user/repos") return json([privateRepository, authenticatedPublic, internalRepository]);
    if (url.pathname === "/users/owner/repos") return json([authenticatedPublic, publicOnlyRepository]);
    if (url.pathname.endsWith("/pulls") || url.pathname.endsWith("/commits")) {
      const authorization = new Headers(init?.headers).get("authorization");
      authorizations[url.pathname] = [...(authorizations[url.pathname] ?? []), authorization];
      if ((url.pathname.includes("/private/") || url.pathname.includes("/internal/")) ||
          (url.pathname.includes("/authenticated-public/") && authorization !== null)) {
        return json({}, 404);
      }
      return json([]);
    }
    return json({}, 404);
  });
  const repositories = await client.listAllRepositories("owner");
  const privateResult = repositories.find((item) => item.id === 1);
  const publicResult = repositories.find((item) => item.id === 2);
  const authenticatedPublicResult = repositories.find((item) => item.id === 3);
  const internalResult = repositories.find((item) => item.id === 4);
  assert.ok(privateResult);
  assert.ok(publicResult);
  assert.ok(authenticatedPublicResult);
  assert.ok(internalResult);
  assert.equal(repositories.filter((item) => item.id === 3).length, 1);
  await assert.rejects(() => client.getOpenPullRequestCount(privateResult));
  await assert.rejects(() => client.getOpenPullRequestCount(internalResult));
  assert.equal(await client.getOpenPullRequestCount(publicResult), 0);
  assert.equal(await client.getOpenPullRequestCount(authenticatedPublicResult), 0);
  assert.equal(await client.getLatestPersonalCommit(authenticatedPublicResult, "owner"), null);
  assert.deepEqual(authorizations["/repos/owner/private/pulls"], ["Bearer credential"]);
  assert.deepEqual(authorizations["/repos/owner/internal/pulls"], ["Bearer credential"]);
  assert.deepEqual(authorizations["/repos/owner/public-only/pulls"], [null]);
  assert.deepEqual(authorizations["/repos/owner/authenticated-public/pulls"], ["Bearer credential", null]);
  assert.deepEqual(authorizations["/repos/owner/authenticated-public/commits"], [null]);
});

test("latches rate exhaustion and does not anonymously retry public server failures", async () => {
  const authenticatedPublic = repo(8, { name: "public", full_name: "owner/public" });
  const optionalAuthorizations: Array<string | null> = [];
  const client = new GithubClient("credential", async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/user/repos") return json([authenticatedPublic]);
    if (url.pathname === "/users/owner/repos") return json([authenticatedPublic]);
    optionalAuthorizations.push(new Headers(init?.headers).get("authorization"));
    if (url.pathname.endsWith("/pulls")) {
      return json({}, 429, { "x-ratelimit-remaining": "0" });
    }
    if (url.pathname.endsWith("/commits")) return json({}, 500);
    return json({}, 404);
  });
  const repositories = await client.listAllRepositories("owner");
  const publicResult = repositories[0];
  await assert.rejects(() => client.getOpenPullRequestCount(publicResult), (error) => {
    assert.ok(error instanceof GithubApiError);
    assert.equal(error.safeCode, "rate_limited");
    return true;
  });
  await assert.rejects(() => client.getLatestPersonalCommit(publicResult, "owner"), (error) => {
    assert.ok(error instanceof GithubApiError);
    assert.equal(error.safeCode, "rate_limited");
    return true;
  });
  assert.deepEqual(optionalAuthorizations, ["Bearer credential"]);

  const serverFailureAuthorizations: Array<string | null> = [];
  const serverFailureClient = new GithubClient("credential", async (_input, init) => {
    serverFailureAuthorizations.push(new Headers(init?.headers).get("authorization"));
    return json({}, 500);
  });
  await assert.rejects(
    () => serverFailureClient.getLatestPersonalCommit(authenticatedPublic, "owner"),
    (error) => error instanceof GithubApiError && error.safeCode === "unavailable",
  );
  assert.deepEqual(serverFailureAuthorizations, ["Bearer credential"]);
});

test("maps rate limits without returning response content", async () => {
  const reset = String(Math.floor(Date.now() / 1000) + 60);
  const client = new GithubClient("not-logged", async () => json({ secret: "must-not-surface" }, 403, {
    "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset, "x-ratelimit-resource": "core",
  }));
  await assert.rejects(() => client.getAuthenticatedUser(), (error) => {
    assert.ok(error instanceof GithubApiError);
    assert.equal(error.safeCode, "rate_limited");
    assert.equal(error.message.includes("must-not-surface"), false);
    assert.ok(error.rateLimit?.resetAt);
    return true;
  });
});

test("an authenticated response with no rate-limit headers preserves prior metadata", async () => {
  let calls = 0;
  const client = new GithubClient("credential", async () => {
    calls += 1;
    return calls === 1
      ? json({ login: "owner" }, 200, {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4980",
          "x-ratelimit-used": "20",
          "x-ratelimit-reset": "1735866000",
          "x-ratelimit-resource": "core",
        })
      : json({ login: "owner" });
  });
  await client.getAuthenticatedUser();
  const previous = client.rateLimit;
  await client.getAuthenticatedUser();
  assert.deepEqual(client.rateLimit, previous);
});

test("a later-finishing concurrent response cannot degrade stronger rate-limit metadata", async () => {
  let resolveStronger: ((value: Response) => void) | undefined;
  let resolveWeaker: ((value: Response) => void) | undefined;
  const client = new GithubClient("credential", async (input) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.includes("repo-1")) {
      return new Promise<Response>((resolve) => { resolveStronger = resolve; });
    }
    return new Promise<Response>((resolve) => { resolveWeaker = resolve; });
  });

  const strongerRequest = client.getOpenPullRequestCount(repo(1));
  const weakerRequest = client.getOpenPullRequestCount(repo(2));
  await Promise.resolve();
  assert.ok(resolveStronger);
  assert.ok(resolveWeaker);
  resolveStronger(json([], 200, {
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4975",
    "x-ratelimit-used": "25",
    "x-ratelimit-reset": "1735866000",
    "x-ratelimit-resource": "core",
  }));
  await strongerRequest;
  resolveWeaker(json([], 200, {
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4990",
    "x-ratelimit-used": "10",
    "x-ratelimit-reset": "1735866000",
    "x-ratelimit-resource": "core",
  }));
  await weakerRequest;

  assert.equal(client.rateLimit?.remaining, 4975);
  assert.equal(client.rateLimit?.used, 25);
  assert.equal(client.rateLimit?.limit, 5000);
  assert.equal(client.rateLimit?.resource, "core");
});

test("bounds concurrency", async () => {
  let active = 0;
  let maximum = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
  });
  assert.equal(maximum, 2);
});
