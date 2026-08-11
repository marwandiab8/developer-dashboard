import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubProjectMetadata } from "../src/components/GitHubProjectMetadata";
import { GitHubSyncPanel } from "../src/components/GitHubSyncPanel";
import type { Project } from "../src/lib/models";
import { seedDashboardData } from "../src/lib/seed";

const githubClientFixture = vi.hoisted(() => ({
  getStatus: vi.fn(),
  sync: vi.fn(),
}));

const authFixture = vi.hoisted<{
  status: "loading" | "authenticated" | "unauthenticated";
  user: { uid: string } | null;
  lastError: string | null;
}>(() => ({
  status: "authenticated",
  user: { uid: "dashboard-owner" },
  lastError: null,
}));

vi.mock("../src/lib/github/client", () => ({
  getGitHubConnectionStatus: githubClientFixture.getStatus,
  syncGitHubRepositories: githubClientFixture.sync,
  toGitHubClientError: (error: unknown) => error instanceof Error ? error : new Error("GitHub synchronization failed."),
}));

vi.mock("../src/lib/auth/useAuth", () => ({
  useAuth: () => authFixture,
}));

const neverSyncedStatus = {
  configured: true,
  connected: true,
  ownerLogin: "dashboard-owner",
  lastSuccessfulSyncAt: null,
  lastSyncStatus: "never",
  synchronizationInProgress: false,
  rateLimit: {
    limit: 5_000,
    remaining: 4_900,
    used: 100,
    resetAt: "2026-08-06T18:00:00.000Z",
    resource: "core",
  },
  statusMessage: "GitHub connection is ready.",
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const render = (element: ReturnType<typeof createElement>) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    rerender: (nextElement: ReturnType<typeof createElement>) => {
      act(() => root.render(nextElement));
    },
    close: () => act(() => root.unmount()),
  };
};

const settle = async () => {
  await act(async () => {
    await flushMicrotasks();
  });
};

describe("GitHub synchronization UI", () => {
  beforeEach(() => {
    githubClientFixture.getStatus.mockReset();
    githubClientFixture.sync.mockReset();
    authFixture.status = "authenticated";
    authFixture.user = { uid: "dashboard-owner" };
    authFixture.lastError = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each([
    ["unauthenticated", "Sign in required"],
    ["loading", "Cloud sign-in pending"],
  ] as const)("does not call cloud synchronization while auth is %s", async (authStatus, expectedStatus) => {
    authFixture.status = authStatus;
    authFixture.user = null;
    githubClientFixture.getStatus.mockResolvedValue(neverSyncedStatus);

    const view = render(createElement(GitHubSyncPanel));
    await settle();

    expect(githubClientFixture.getStatus).not.toHaveBeenCalled();
    expect(githubClientFixture.sync).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain(expectedStatus);
    expect(view.container.textContent).toContain("local projects remain available");
    const actionButton = Array.from(view.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Sign in to sync GitHub"));
    expect(actionButton?.disabled).toBe(true);
    view.close();
  });

  it("shows not-configured state without enabling import", async () => {
    githubClientFixture.getStatus.mockResolvedValue({
      ...neverSyncedStatus,
      configured: false,
      connected: false,
      ownerLogin: null,
      statusMessage: "GitHub synchronization is not configured.",
    });

    const view = render(createElement(GitHubSyncPanel));
    await settle();

    expect(view.container.textContent).toContain("Not configured");
    expect(view.container.textContent).toContain("Import GitHub Projects");
    const importButton = Array.from(view.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Import GitHub Projects"));
    expect(importButton?.disabled).toBe(true);
    view.close();
  });

  it("offers import before the first success and sync afterward", async () => {
    githubClientFixture.getStatus.mockResolvedValue(neverSyncedStatus);
    const firstView = render(createElement(GitHubSyncPanel));
    await settle();
    expect(firstView.container.textContent).toContain("Import GitHub Projects");
    firstView.close();

    githubClientFixture.getStatus.mockResolvedValue({
      ...neverSyncedStatus,
      lastSuccessfulSyncAt: "2026-08-06T16:30:00.000Z",
      lastSyncStatus: "succeeded",
    });
    const syncedView = render(createElement(GitHubSyncPanel));
    await settle();
    expect(syncedView.container.textContent).toContain("Sync GitHub");
    expect(syncedView.container.textContent).toContain("Last successful sync");
    syncedView.close();
  });

  it("shows progress and safe synchronization counts", async () => {
    githubClientFixture.getStatus.mockResolvedValue(neverSyncedStatus);
    let finishSync: ((value: unknown) => void) | undefined;
    githubClientFixture.sync.mockReturnValue(new Promise((resolve) => {
      finishSync = resolve;
    }));

    const view = render(createElement(GitHubSyncPanel));
    await settle();
    const importButton = Array.from(view.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Import GitHub Projects"));

    act(() => importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(view.container.textContent).toContain("Synchronizing GitHub...");

    await act(async () => {
      finishSync?.({
        runId: "run-safe",
        startedAt: "2026-08-06T16:00:00.000Z",
        completedAt: "2026-08-06T16:01:00.000Z",
        created: 12,
        updated: 3,
        unchanged: 80,
        unavailable: 1,
        failed: 2,
        rateLimit: neverSyncedStatus.rateLimit,
      });
      await flushMicrotasks();
    });

    expect(view.container.textContent).toContain("Created12");
    expect(view.container.textContent).toContain("Updated3");
    expect(view.container.textContent).toContain("Unchanged80");
    expect(view.container.textContent).toContain("Failed2");
    expect(view.container.textContent).toContain("Sync GitHub");
    view.close();
  });

  it("surfaces authorization and rate-limit messages", async () => {
    githubClientFixture.getStatus.mockRejectedValue(
      new Error("This account is not authorized to use GitHub synchronization."),
    );
    const authorizationView = render(createElement(GitHubSyncPanel));
    await settle();
    expect(authorizationView.container.textContent).toContain("not authorized");
    authorizationView.close();

    githubClientFixture.getStatus.mockResolvedValue(neverSyncedStatus);
    githubClientFixture.sync.mockRejectedValue(new Error("GitHub rate limit reached. Try again later."));
    const rateLimitView = render(createElement(GitHubSyncPanel));
    await settle();
    const importButton = Array.from(rateLimitView.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Import GitHub Projects"));
    await act(async () => {
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(rateLimitView.container.textContent).toContain("rate limit reached");
    rateLimitView.close();
  });

  it("resets connection status and synchronization results when the authenticated UID changes", async () => {
    const firstUserStatus = {
      ...neverSyncedStatus,
      ownerLogin: "first-owner",
    };
    let finishSecondUserStatus: ((value: typeof neverSyncedStatus) => void) | undefined;
    githubClientFixture.getStatus
      .mockResolvedValueOnce(firstUserStatus)
      .mockReturnValueOnce(new Promise((resolve) => {
        finishSecondUserStatus = resolve;
      }));
    githubClientFixture.sync.mockResolvedValue({
      runId: "run-first-owner",
      startedAt: "2026-08-06T16:00:00.000Z",
      completedAt: "2026-08-06T16:01:00.000Z",
      created: 12,
      updated: 3,
      unchanged: 80,
      unavailable: 1,
      failed: 2,
      rateLimit: neverSyncedStatus.rateLimit,
    });

    const view = render(createElement(GitHubSyncPanel));
    await settle();
    expect(view.container.textContent).toContain("Connected as @first-owner");

    const importButton = Array.from(view.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Import GitHub Projects"));
    await act(async () => {
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });
    expect(view.container.textContent).toContain("Created12");

    authFixture.user = { uid: "second-owner" };
    view.rerender(createElement(GitHubSyncPanel));

    expect(view.container.textContent).toContain("Checking connection...");
    expect(view.container.textContent).not.toContain("Connected as @first-owner");
    expect(view.container.textContent).not.toContain("Created12");

    await act(async () => {
      finishSecondUserStatus?.({
        ...neverSyncedStatus,
        ownerLogin: "second-owner",
      });
      await flushMicrotasks();
    });
    expect(view.container.textContent).toContain("Connected as @second-owner");
    expect(githubClientFixture.getStatus).toHaveBeenCalledTimes(2);
    view.close();
  });

  it("renders source metadata only for GitHub-backed projects", () => {
    const manualProject = seedDashboardData().projects[0];
    const githubProject = {
      ...manualProject,
      externalSources: {
        github: {
          sourceType: "github",
          externalRepositoryId: "123456",
          ownerLogin: "dashboard-owner",
          repositoryName: "private-archive",
          repositoryFullName: "dashboard-owner/private-archive",
          repositoryUrl: "https://github.com/dashboard-owner/private-archive",
          visibility: "private",
          isArchived: true,
          isFork: true,
          synchronizationStatus: "success",
          synchronizationTimestamp: "2026-08-06T16:00:00.000Z",
        },
      },
    } as unknown as Project;

    const manualView = render(createElement(GitHubProjectMetadata, { project: manualProject }));
    expect(manualView.container.textContent).toBe("");
    manualView.close();

    const githubView = render(createElement(GitHubProjectMetadata, { project: githubProject }));
    expect(githubView.container.textContent).toContain("GitHub");
    expect(githubView.container.textContent).toContain("Private");
    expect(githubView.container.textContent).toContain("Archived");
    expect(githubView.container.textContent).toContain("Fork");
    expect(githubView.container.textContent).toContain("GitHub synced");
    const repositoryLink = githubView.container.querySelector("a") as HTMLAnchorElement;
    expect(repositoryLink.href).toBe("https://github.com/dashboard-owner/private-archive");
    expect(repositoryLink.target).toBe("_blank");
    githubView.close();
  });
});
