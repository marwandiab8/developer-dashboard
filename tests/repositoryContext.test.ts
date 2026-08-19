import { renderToString } from "react-dom/server";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardProvider,
  useDashboard,
  type DashboardContextValue,
} from "../src/lib/repositories/repositoryContext";
import { STORAGE_KEY } from "../src/lib/constants";
import { seedDashboardData } from "../src/lib/seed";
import {
  appendPendingCloudReconciliationAction,
  cloudRecoveryScopeForUid,
  createLocalDashboardBackup,
  ensurePreCloudFallbackBackup,
  getLocalDataReconciliationState,
  getLocalDashboardBackupInfo,
  getPendingCloudReconciliationActions,
  getPreCloudFallbackBackupInfo,
  loadCloudRecoveryDashboardData,
  markLocalDataCloudAcknowledged,
  saveCloudFallbackDashboardData,
  saveCloudRecoveryDashboardData,
} from "../src/lib/repositories/localAdapter";
import type { BrainDump, DashboardData, Project, Task } from "../src/lib/models";
import type {
  DashboardRepository,
  MigrationState,
  MutationResult,
} from "../src/lib/repositories/types";
import { dashboardReducer } from "../src/lib/repositories/reducer";
import { buildRecoveryProjection } from "../src/lib/repositories/recoveryProjection";

const fixtures = vi.hoisted(() => ({
  auth: {
    status: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
    user: null as { uid: string } | null,
  },
  createFirestoreRepository: vi.fn(),
}));

vi.mock("../src/lib/auth/useAuth", () => ({
  useAuth: () => fixtures.auth,
}));

vi.mock("../src/lib/repositories/firestoreAdapter", () => ({
  createFirestoreRepository: fixtures.createFirestoreRepository,
}));

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const flushAsyncWork = async (rounds = 16) => {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
};

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const mountProvider = async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const contextRef: { current: DashboardContextValue | null } = { current: null };

  function Probe() {
    const dashboard = useDashboard();
    contextRef.current = dashboard;
    return React.createElement(
      "div",
      null,
      `${dashboard.data.projects[0]?.title ?? "no-project"}:${dashboard.migrationState.phase}`,
    );
  }

  const renderProvider = () => {
    root.render(React.createElement(DashboardProvider, null, React.createElement(Probe)));
  };

  act(renderProvider);
  await flushAsyncWork();

  return {
    container,
    contextRef,
    rerender: () => act(renderProvider),
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const migrationState = (overrides: Partial<MigrationState> = {}): MigrationState => ({
  phase: "idle",
  hasLocalData: false,
  hasCloudData: false,
  localRecordCounts: {},
  cloudRecordCounts: {},
  markerStatus: "not_started",
  error: null,
  startedAt: null,
  completedAt: null,
  version: 1,
  ...overrides,
});

const createCloudRepository = (
  cloudData: DashboardData,
  marker: MigrationState,
): DashboardRepository => ({
  load: vi.fn(async () => cloudData),
  save: vi.fn(async () => {
    return;
  }),
  applyAction: vi.fn(async () => {
    return;
  }),
  subscribe: vi.fn(() => () => {
    return;
  }),
  hasData: vi.fn(async () => cloudData.projects.length > 0),
  getCounts: vi.fn(async () => ({
    projects: cloudData.projects.length,
    ideas: cloudData.ideas.length,
    tasks: cloudData.tasks.length,
  })),
  getMigrationState: vi.fn(async () => marker),
  setMigrationState: vi.fn(async () => {
    return;
  }),
  importData: vi.fn(async () => marker),
  exportData: vi.fn(async () => cloudData),
});

const readPersistedDashboard = () =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as DashboardData;

describe("repository provider loading state", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    fixtures.createFirestoreRepository.mockReset();
  });

  it("renders a deterministic loading state before client hydration", () => {
    const markup = renderToString(
      React.createElement(DashboardProvider, null, React.createElement("div", null, "DASHBOARD_MARKER")),
    );

    expect(markup).toContain("Loading dashboard data...");
    expect(markup).not.toContain("DASHBOARD_MARKER");
  });

  it("hydrates from persisted localStorage after mount and replaces loading state", async () => {
    const seeded = seedDashboardData();
    const hydratedData = {
      ...seeded,
      projects: seeded.projects.map((project, index) =>
        index === 0 ? { ...project, title: "Hydrated project title" } : project,
      ),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(hydratedData));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe() {
      const { data } = useDashboard();
      return React.createElement("div", null, data.projects[0]?.title);
    }

    act(() => {
      root.render(React.createElement(DashboardProvider, null, React.createElement(Probe)));
    });

    try {
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(container.textContent).toContain("Hydrated project title");
    } finally {
      act(() => {
        root.unmount();
      });
    }
  });

  it("hydrates local data while authentication is still resolving", async () => {
    fixtures.auth.status = "loading";
    const seeded = seedDashboardData();
    const localData = {
      ...seeded,
      projects: seeded.projects.map((project, index) =>
        index === 0 ? { ...project, title: "Local while auth loads" } : project,
      ),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));

    const mounted = await mountProvider();
    try {
      expect(mounted.container.textContent).toContain("Local while auth loads");
      expect(mounted.contextRef.current?.syncStatus).toBe("synced");
      expect(fixtures.createFirestoreRepository).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it("creates and persists exactly one shared activity record for one action", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let currentData: DashboardData | null = null;
    let createProject: ((title: string, purpose: string) => Promise<Project>) | null = null;

    function Probe() {
      const dashboard = useDashboard();
      currentData = dashboard.data;
      createProject = dashboard.createProject;
      return React.createElement("div", null, dashboard.data.activities.length);
    }

    act(() => {
      root.render(React.createElement(DashboardProvider, null, React.createElement(Probe)));
    });

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(createProject).not.toBeNull();
      await act(async () => {
        await createProject!("Activity persistence", "Prove one action has one activity");
      });

      const visibleActivities = currentData!.activities;
      expect(visibleActivities).toHaveLength(seeded.activities.length + 1);
      const createdActivity = visibleActivities.find((entry) => entry.summary.includes("Activity persistence"));
      expect(createdActivity).toBeDefined();

      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as DashboardData;
      expect(persisted.activities).toHaveLength(seeded.activities.length + 1);
      expect(persisted.activities.find((entry) => entry.id === createdActivity!.id)).toEqual(createdActivity);
    } finally {
      act(() => {
        root.unmount();
      });
    }
  });
});

describe("ordered local action persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    fixtures.createFirestoreRepository.mockReset();
  });

  it("preserves two quick captures invoked before React renders and reloads both", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const projectId = seeded.projects[0].id;
    const mounted = await mountProvider();

    act(() => {
      mounted.contextRef.current!.runQuickCapture({
        projectId,
        text: "First immediate capture",
        classification: "idea",
      });
      mounted.contextRef.current!.runQuickCapture({
        projectId,
        text: "Second immediate capture",
        classification: "idea",
      });
    });
    await flushAsyncWork(24);

    const persisted = readPersistedDashboard();
    expect(persisted.ideas.map((idea) => idea.text)).toEqual(
      expect.arrayContaining(["First immediate capture", "Second immediate capture"]),
    );
    expect(mounted.contextRef.current!.data).toEqual(persisted);
    mounted.unmount();

    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.data.ideas.map((idea) => idea.text)).toEqual(
        expect.arrayContaining(["First immediate capture", "Second immediate capture"]),
      );
    } finally {
      reloaded.unmount();
    }
  });

  it("preserves Quick Capture prose and existing scratchpad whitespace exactly", async () => {
    const seeded = seedDashboardData();
    const projectId = seeded.projects[0].id;
    const existingMarkdown = "\n  existing scratchpad  \n\n";
    const exactCapture = "  indented\n    child\n\n";
    const withScratchpad: DashboardData = {
      ...seeded,
      scratchpads: [{
        projectId,
        markdown: existingMarkdown,
        updatedAt: "2026-08-10T18:00:00.000Z",
      }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withScratchpad));
    const mounted = await mountProvider();

    act(() => {
      mounted.contextRef.current!.runQuickCapture({
        projectId,
        text: exactCapture,
        classification: "idea",
      });
      mounted.contextRef.current!.runQuickCapture({
        projectId,
        text: exactCapture,
        classification: "scratchpad",
      });
    });
    await flushAsyncWork(24);

    const expectedScratchpad = `${existingMarkdown}\n\n${exactCapture}`;
    const persisted = readPersistedDashboard();
    expect(persisted.ideas.some((idea) => idea.text === exactCapture)).toBe(true);
    expect(persisted.scratchpads.find((entry) => entry.projectId === projectId)?.markdown)
      .toBe(expectedScratchpad);
    expect(mounted.contextRef.current!.data.scratchpads.find(
      (entry) => entry.projectId === projectId,
    )?.markdown).toBe(expectedScratchpad);

    mounted.unmount();
    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.data.ideas.some((idea) => idea.text === exactCapture))
        .toBe(true);
      expect(reloaded.contextRef.current!.data.scratchpads.find(
        (entry) => entry.projectId === projectId,
      )?.markdown).toBe(expectedScratchpad);
    } finally {
      reloaded.unmount();
    }
  });

  it("preserves immediate brain-dump conversions and their created entities", async () => {
    const seeded = seedDashboardData();
    const firstBrainDump = seeded.brainDumps[0];
    const secondBrainDump: BrainDump = {
      ...firstBrainDump,
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddde",
      text: "Convert this second brain dump to a task",
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...seeded, brainDumps: [firstBrainDump, secondBrainDump] }),
    );
    const mounted = await mountProvider();

    act(() => {
      mounted.contextRef.current!.convertBrainDumpToIdea(firstBrainDump.id);
      mounted.contextRef.current!.convertBrainDumpToTask(secondBrainDump.id);
    });
    await flushAsyncWork(32);

    const persisted = readPersistedDashboard();
    const convertedIdea = persisted.ideas.find((idea) => idea.text === firstBrainDump.text);
    const convertedTask = persisted.tasks.find((task) => task.details === secondBrainDump.text);
    expect(convertedIdea).toBeDefined();
    expect(convertedTask).toBeDefined();
    expect(persisted.brainDumps.find((entry) => entry.id === firstBrainDump.id)).toMatchObject({
      status: "converted",
      convertedEntityType: "idea",
      convertedEntityId: convertedIdea!.id,
    });
    expect(persisted.brainDumps.find((entry) => entry.id === secondBrainDump.id)).toMatchObject({
      status: "converted",
      convertedEntityType: "task",
      convertedEntityId: convertedTask!.id,
    });
    expect(mounted.contextRef.current!.data).toEqual(persisted);
    mounted.unmount();

    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.data.ideas.some((idea) => idea.id === convertedIdea!.id)).toBe(true);
      expect(reloaded.contextRef.current!.data.tasks.some((task) => task.id === convertedTask!.id)).toBe(true);
    } finally {
      reloaded.unmount();
    }
  });

  it("applies an immediate task update to the task created just before it", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const mounted = await mountProvider();
    let createdTask: Task | null = null;

    act(() => {
      createdTask = mounted.contextRef.current!.addTask({
        projectId: seeded.projects[0].id,
        title: "Create then update without a render",
        details: "Original details",
        type: "feature",
        status: "backlog",
        priority: "high",
        blockedReason: "",
        sourceIdeaId: null,
        acceptanceCriteria: "The update survives",
        implementationNotes: "",
        startedAt: null,
        completedAt: null,
      });
      mounted.contextRef.current!.updateTask(createdTask.id, {
        status: "in_progress",
        details: "Updated before React committed",
      });
    });
    await flushAsyncWork(24);

    const persisted = readPersistedDashboard();
    expect(persisted.tasks.find((task) => task.id === createdTask!.id)).toMatchObject({
      status: "in_progress",
      details: "Updated before React committed",
    });
    expect(mounted.contextRef.current!.data).toEqual(persisted);
    mounted.unmount();

    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.data.tasks.find((task) => task.id === createdTask!.id)).toMatchObject({
        status: "in_progress",
        details: "Updated before React committed",
      });
    } finally {
      reloaded.unmount();
    }
  });

  it("does not journal ordinary local-first actions for cloud replay", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const mounted = await mountProvider();

    try {
      act(() => {
        mounted.contextRef.current!.updateProject(seeded.projects[0].id, {
          currentObjective: "Local-first objective awaiting an explicit migration choice",
        });
      });
      await flushAsyncWork(24);

      expect(readPersistedDashboard().projects[0].currentObjective)
        .toBe("Local-first objective awaiting an explicit migration choice");
      expect(getPendingCloudReconciliationActions()).toEqual([]);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps Quick Capture visible and exposes degraded persistence when localStorage rejects the save", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const mounted = await mountProvider();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEY) {
        throw new DOMException("Local storage quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      act(() => {
        mounted.contextRef.current!.runQuickCapture({
          projectId: seeded.projects[0].id,
          text: "Visible in memory after rejected local save",
          classification: "idea",
        });
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.data.ideas.some(
        (idea) => idea.text === "Visible in memory after rejected local save",
      )).toBe(true);
      expect(readPersistedDashboard().ideas.some(
        (idea) => idea.text === "Visible in memory after rejected local save",
      )).toBe(false);
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");
      expect(mounted.contextRef.current!.localPersistenceError).toContain(
        "visible only in this tab and is not durably stored",
      );
      expect(mounted.contextRef.current!.syncStatus).toBe("error");

      setItemSpy.mockRestore();
      act(() => {
        mounted.contextRef.current!.runQuickCapture({
          projectId: seeded.projects[0].id,
          text: "Successful save recovers local durability",
          classification: "idea",
        });
      });
      await flushAsyncWork(24);

      const recoveredPersistence = readPersistedDashboard();
      expect(recoveredPersistence.ideas.map((idea) => idea.text)).toEqual(
        expect.arrayContaining([
          "Visible in memory after rejected local save",
          "Successful save recovers local durability",
        ]),
      );
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("durable");
      expect(mounted.contextRef.current!.localPersistenceError).toBeNull();
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
      expect(mounted.contextRef.current!.syncStatus).toBe("synced");
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("keeps degraded local work through loading-to-signed-out auth resolution and later recovers it", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    fixtures.auth.status = "loading";
    fixtures.auth.user = null;
    const mounted = await mountProvider();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEY) {
        throw new DOMException("Local storage quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      act(() => {
        mounted.contextRef.current!.runQuickCapture({
          projectId: seeded.projects[0].id,
          text: "Degraded capture survives auth resolution",
          classification: "idea",
        });
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.data.ideas.some(
        (idea) => idea.text === "Degraded capture survives auth resolution",
      )).toBe(true);
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");

      fixtures.auth.status = "unauthenticated";
      mounted.rerender();
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.data.ideas.some(
        (idea) => idea.text === "Degraded capture survives auth resolution",
      )).toBe(true);
      expect(readPersistedDashboard().ideas.some(
        (idea) => idea.text === "Degraded capture survives auth resolution",
      )).toBe(false);
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");
      expect(mounted.contextRef.current!.localPersistenceError).toContain(
        "visible only in this tab and is not durably stored",
      );
      expect(mounted.contextRef.current!.syncStatus).toBe("error");

      setItemSpy.mockRestore();
      act(() => {
        mounted.contextRef.current!.runQuickCapture({
          projectId: seeded.projects[0].id,
          text: "Later save durably recovers the degraded projection",
          classification: "idea",
        });
      });
      await flushAsyncWork(32);

      expect(readPersistedDashboard().ideas.map((idea) => idea.text)).toEqual(
        expect.arrayContaining([
          "Degraded capture survives auth resolution",
          "Later save durably recovers the degraded projection",
        ]),
      );
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("durable");
      expect(mounted.contextRef.current!.localPersistenceError).toBeNull();
      expect(mounted.contextRef.current!.syncStatus).toBe("synced");
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("keeps a task edit visible when its local save fails", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const mounted = await mountProvider();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEY) {
        throw new DOMException("Local storage is unavailable", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      const taskId = seeded.tasks[0].id;
      act(() => {
        mounted.contextRef.current!.updateTask(taskId, {
          details: "Current-tab task edit survives the failed save",
        });
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === taskId)?.details)
        .toBe("Current-tab task edit survives the failed save");
      expect(readPersistedDashboard().tasks.find((task) => task.id === taskId)?.details)
        .not.toBe("Current-tab task edit survives the failed save");
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("keeps a project edit visible when its local save fails", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const mounted = await mountProvider();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEY) {
        throw new DOMException("Local storage is unavailable", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      const projectId = seeded.projects[0].id;
      act(() => {
        mounted.contextRef.current!.updateProject(projectId, {
          currentObjective: "Current-tab project edit survives the failed save",
        });
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.data.projects.find((project) => project.id === projectId)?.currentObjective)
        .toBe("Current-tab project edit survives the failed save");
      expect(readPersistedDashboard().projects.find((project) => project.id === projectId)?.currentObjective)
        .not.toBe("Current-tab project edit survives the failed save");
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("finishes local hydration in memory when initial seed persistence fails", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEY) {
        throw new DOMException("Browser storage is disabled", "SecurityError");
      }
      return originalSetItem.call(this, key, value);
    });

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current).not.toBeNull();
      expect(mounted.container.textContent).not.toContain("Loading dashboard data...");
      expect(mounted.contextRef.current!.data.projects).toHaveLength(
        seedDashboardData().projects.length,
      );
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");
      expect(mounted.contextRef.current!.localPersistenceError).toContain(
        "visible only in this tab and is not durably stored",
      );
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });
});

describe("cloud action ordering and local fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "owner-user" };
    fixtures.createFirestoreRepository.mockReset();
  });

  const completedMarker = () => migrationState({
    phase: "complete",
    markerStatus: "import_complete",
    completedAt: "2026-08-07T12:00:00.000Z",
    hasCloudData: true,
  });

  const taskInput = (projectId: string, title: string) => ({
    projectId,
    title,
    details: "",
    type: "feature" as const,
    status: "backlog" as const,
    priority: "medium" as const,
    blockedReason: "",
    sourceIdeaId: null,
    acceptanceCriteria: "",
    implementationNotes: "",
    startedAt: null,
    completedAt: null,
  });

  it("uses the projected manual recency for a direct project update", async () => {
    const cloudData = seedDashboardData();
    cloudData.projects[0] = {
      ...cloudData.projects[0],
      updatedAt: "2025-01-01T00:00:00.000Z",
      lastWorkedAt: "2025-01-01T00:00:00.000Z",
    };
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.applyAction = vi.fn(async (action, _activity, projectRecency) => {
      const projected = dashboardReducer(cloudData, action);
      cloudData.projects = projected.projects.map((project) =>
        projectRecency && project.id === projectRecency.projectId
          ? {
              ...project,
              updatedAt: projectRecency.updatedAt,
              lastWorkedAt: projectRecency.lastWorkedAt,
            }
          : project,
      );
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    try {
      const projectId = cloudData.projects[0].id;
      const updateProjectWithUntrustedFields = mounted.contextRef.current!.updateProject as (
        id: string,
        updates: Record<string, unknown>,
      ) => void;

      act(() => {
        updateProjectWithUntrustedFields(projectId, {
          currentObjective: "Persist reducer-owned project recency",
          id: "untrusted-project-id",
          createdAt: "2000-01-01T00:00:00.000Z",
          updatedAt: "2000-01-01T00:00:00.000Z",
          lastWorkedAt: "2000-01-01T00:00:00.000Z",
        });
      });
      await flushAsyncWork(24);

      const visibleProject = mounted.contextRef.current!.data.projects.find(
        (project) => project.id === projectId,
      );
      expect(visibleProject).toMatchObject({
        id: projectId,
        currentObjective: "Persist reducer-owned project recency",
      });
      expect(visibleProject!.updatedAt).toBe(visibleProject!.lastWorkedAt);
      expect(visibleProject!.lastWorkedAt).not.toBe("2000-01-01T00:00:00.000Z");

      expect(repository.applyAction).toHaveBeenCalledWith(
        {
          type: "project_update",
          payload: {
            id: projectId,
            updates: { currentObjective: "Persist reducer-owned project recency" },
          },
        },
        undefined,
        {
          projectId,
          updatedAt: visibleProject!.updatedAt,
          lastWorkedAt: visibleProject!.lastWorkedAt,
        },
        expect.any(String),
        expect.objectContaining({
          version: 1,
          fingerprint: expect.any(String),
          documents: expect.arrayContaining([
            expect.objectContaining({ collection: "projects", documentId: projectId }),
          ]),
        }),
      );
    } finally {
      mounted.unmount();
    }
  });

  const cloudFailureCases: Array<{
    label: string;
    mutate: (dashboard: DashboardContextValue, projectId: string) => void;
    persisted: (data: DashboardData, projectId: string) => boolean;
  }> = [
    {
      label: "Quick Capture",
      mutate: (dashboard, projectId) => dashboard.runQuickCapture({
        projectId,
        text: "Quick Capture preserved after cloud failure",
        classification: "idea",
      }),
      persisted: (data) => data.ideas.some(
        (idea) => idea.text === "Quick Capture preserved after cloud failure",
      ),
    },
    {
      label: "task creation",
      mutate: (dashboard, projectId) => {
        dashboard.addTask(taskInput(projectId, "Task preserved after cloud failure"));
      },
      persisted: (data) => data.tasks.some(
        (task) => task.title === "Task preserved after cloud failure",
      ),
    },
    {
      label: "project edit",
      mutate: (dashboard, projectId) => dashboard.updateProject(projectId, {
        currentBlocker: "Project edit preserved after cloud failure",
      }),
      persisted: (data, projectId) => data.projects.some(
        (project) => project.id === projectId
          && project.currentBlocker === "Project edit preserved after cloud failure",
      ),
    },
  ];

  it.each(cloudFailureCases)(
    "durably falls back to local mode when a $label cloud write fails",
    async ({ mutate, persisted }) => {
      const cloudData = seedDashboardData();
      const repository = createCloudRepository(cloudData, completedMarker());
      repository.applyAction = vi.fn(async () => {
        throw Object.assign(new Error("Firestore action rejected"), { code: "unavailable" });
      });
      fixtures.createFirestoreRepository.mockResolvedValue(repository);

      const mounted = await mountProvider();
      const projectId = cloudData.projects[0].id;
      const ownerScope = cloudRecoveryScopeForUid("owner-user");
      try {
        expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");

        act(() => {
          mutate(mounted.contextRef.current!, projectId);
        });
        await flushAsyncWork(32);

        const persistedFallback = loadCloudRecoveryDashboardData(ownerScope);
        expect(repository.applyAction).toHaveBeenCalledOnce();
        expect(persisted(mounted.contextRef.current!.data, projectId)).toBe(true);
        expect(persistedFallback).not.toBeNull();
        expect(persisted(persistedFallback!, projectId)).toBe(true);
        expect(persisted(readPersistedDashboard(), projectId)).toBe(false);
        expect(mounted.contextRef.current!.repositoryMode).toBe("local");
        expect(mounted.contextRef.current!.migrationState).toMatchObject({
          phase: "required",
          markerStatus: "local_reconciliation_required",
          reconciliationRequired: true,
        });
        expect(mounted.contextRef.current!.lastActionError).toContain(
          "saved locally; cloud reconciliation is required",
        );
        expect(getLocalDataReconciliationState()).toMatchObject({ required: false });
      } finally {
        mounted.unmount();
      }

      const reloaded = await mountProvider();
      try {
        expect(reloaded.contextRef.current!.repositoryMode).toBe("local");
        expect(reloaded.contextRef.current!.migrationState).toMatchObject({
          phase: "required",
          markerStatus: "local_reconciliation_required",
          reconciliationRequired: true,
        });
        expect(persisted(reloaded.contextRef.current!.data, projectId)).toBe(true);
      } finally {
        reloaded.unmount();
      }
    },
  );

  it("recovers a scoped snapshot after journal persistence is interrupted", async () => {
    const cloudData = seedDashboardData();
    const repository = createCloudRepository(cloudData, completedMarker());
    fixtures.createFirestoreRepository.mockResolvedValue(repository);
    const ownerScope = cloudRecoveryScopeForUid("owner-user");
    const reconciliationJournalKey = `${STORAGE_KEY}:reconciliation-actions`;

    const mounted = await mountProvider();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === reconciliationJournalKey) {
        throw new DOMException("Journal quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });
    try {
      act(() => {
        mounted.contextRef.current!.addTask(taskInput(
          cloudData.projects[0].id,
          "Snapshot survives missing journal",
        ));
      });
      await flushAsyncWork(32);

      expect(repository.applyAction).not.toHaveBeenCalled();
      expect(getPendingCloudReconciliationActions(ownerScope)).toEqual([]);
      expect(loadCloudRecoveryDashboardData(ownerScope)?.tasks.some(
        (task) => task.title === "Snapshot survives missing journal",
      )).toBe(true);
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }

    const cloudLoadsBeforeRecoveryReload = vi.mocked(repository.load).mock.calls.length;
    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.repositoryMode).toBe("local");
      expect(reloaded.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "local_reconciliation_required",
      });
      expect(reloaded.contextRef.current!.data.tasks.some(
        (task) => task.title === "Snapshot survives missing journal",
      )).toBe(true);
      expect(repository.load).toHaveBeenCalledTimes(cloudLoadsBeforeRecoveryReload);

      await act(async () => {
        await reloaded.contextRef.current!.beginMigrationKeepCloud();
      });
      await flushAsyncWork(32);
      const keepCloudBackup = JSON.parse(getLocalDashboardBackupInfo() ?? "null") as {
        dashboardData: DashboardData;
      };
      expect(keepCloudBackup.dashboardData.tasks.some(
        (task) => task.title === "Snapshot survives missing journal",
      )).toBe(true);
    } finally {
      reloaded.unmount();
    }
  });

  it("stays in isolated local mode when both cloud and recovery storage fail", async () => {
    const cloudData = seedDashboardData();
    const staleCloudData = structuredClone(cloudData);
    staleCloudData.projects[0] = {
      ...staleCloudData.projects[0],
      currentBlocker: "Stale cloud snapshot must not replace the projected action",
    };
    const repository = createCloudRepository(cloudData, completedMarker());
    let cloudListener: ((data: DashboardData) => void) | null = null;
    repository.subscribe = vi.fn((onChange) => {
      cloudListener = onChange;
      return () => {
        return;
      };
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const ownerScope = cloudRecoveryScopeForUid("owner-user");
    const scopedRecoveryKey = `${STORAGE_KEY}:cloud-recovery:${ownerScope}`;
    const mounted = await mountProvider();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === scopedRecoveryKey) {
        throw new DOMException("Recovery storage quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      act(() => {
        mounted.contextRef.current!.addTask(taskInput(
          cloudData.projects[0].id,
          "Visible even when recovery storage fails",
        ));
      });
      await flushAsyncWork(32);

      expect(repository.applyAction).not.toHaveBeenCalled();
      expect(loadCloudRecoveryDashboardData(ownerScope)).toBeNull();
      expect(getPendingCloudReconciliationActions(ownerScope)).toEqual([]);
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.tasks.some(
        (task) => task.title === "Visible even when recovery storage fails",
      )).toBe(true);
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "local_reconciliation_required",
        reconciliationRequired: true,
      });
      expect(mounted.contextRef.current!.lastActionError).toContain("export it before closing");

      act(() => {
        cloudListener?.(staleCloudData);
      });
      expect(mounted.contextRef.current!.data.tasks.some(
        (task) => task.title === "Visible even when recovery storage fails",
      )).toBe(true);
      expect(mounted.contextRef.current!.data.projects[0].currentBlocker)
        .not.toBe("Stale cloud snapshot must not replace the projected action");

      const exported = await mounted.contextRef.current!.exportLocalData();
      expect(exported.tasks.some(
        (task) => task.title === "Visible even when recovery storage fails",
      )).toBe(true);
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("keeps the exact shared local dataset untouched during an account-scoped fallback", async () => {
    const oldBackupData = seedDashboardData();
    oldBackupData.projects[0] = {
      ...oldBackupData.projects[0],
      currentObjective: "Older migration backup",
    };
    expect(createLocalDashboardBackup({ data: oldBackupData, sourceDevice: "older-test" })).not.toBeNull();

    const retainedLocalData = seedDashboardData();
    retainedLocalData.projects[0] = {
      ...retainedLocalData.projects[0],
      currentObjective: "Newest retained local-only objective",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(retainedLocalData));
    markLocalDataCloudAcknowledged();

    const cloudData = seedDashboardData();
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.applyAction = vi.fn(async () => {
      throw Object.assign(new Error("Cloud write failed"), { code: "unavailable" });
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    try {
      act(() => {
        mounted.contextRef.current!.addTask(taskInput(cloudData.projects[0].id, "Trigger safe fallback"));
      });
      await flushAsyncWork(32);

      const oldBackup = JSON.parse(getLocalDashboardBackupInfo() ?? "null") as {
        dashboardData: DashboardData;
      };
      expect(oldBackup.dashboardData.projects[0].currentObjective).toBe("Older migration backup");
      expect(getPreCloudFallbackBackupInfo()).toBeNull();
      expect(readPersistedDashboard().projects[0].currentObjective)
        .toBe("Newest retained local-only objective");
      expect(loadCloudRecoveryDashboardData(cloudRecoveryScopeForUid("owner-user"))?.tasks.some(
        (task) => task.title === "Trigger safe fallback",
      )).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  it("reconciles a durable local fallback before safely reactivating cloud", async () => {
    let cloudData = seedDashboardData();
    let persistedMarker = completedMarker();
    let cloudWritesAvailable = false;
    const repository = createCloudRepository(cloudData, persistedMarker);
    repository.load = vi.fn(async () => cloudData);
    repository.getMigrationState = vi.fn(async () => persistedMarker);
    repository.applyAction = vi.fn(async () => {
      if (!cloudWritesAvailable) {
        throw Object.assign(new Error("Cloud temporarily unavailable"), { code: "unavailable" });
      }
    });
    repository.importData = vi.fn(async (localData) => {
      cloudData = structuredClone(localData);
      persistedMarker = migrationState({
        phase: "complete",
        markerStatus: "import_complete",
        completedAt: "2026-08-10T16:00:00.000Z",
        hasLocalData: true,
        hasCloudData: true,
      });
      return persistedMarker;
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const projectId = cloudData.projects[0].id;
    const ownerScope = cloudRecoveryScopeForUid("owner-user");
    let pendingActivityId = "";
    try {
      act(() => {
        mounted.contextRef.current!.runQuickCapture({
          projectId,
          text: "Fallback capture later reconciled to cloud",
          classification: "idea",
        });
      });
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(getLocalDataReconciliationState().required).toBe(false);
      expect(loadCloudRecoveryDashboardData(ownerScope)?.ideas.some(
        (idea) => idea.text === "Fallback capture later reconciled to cloud",
      )).toBe(true);
      const pendingReplay = getPendingCloudReconciliationActions(ownerScope);
      expect(pendingReplay).toHaveLength(1);
      expect(pendingReplay[0]).toMatchObject({
        action: { type: "idea_add" },
        activity: { type: "idea_captured" },
        projectRecency: { projectId },
      });
      pendingActivityId = pendingReplay[0].activity!.id;

      cloudWritesAvailable = true;
      let recovery: MigrationState | null = null;
      await act(async () => {
        recovery = await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(32);

      expect(recovery).toMatchObject({ phase: "complete", markerStatus: "import_complete" });
      expect(repository.importData).toHaveBeenCalledWith(
        expect.objectContaining({
          ideas: expect.arrayContaining([
            expect.objectContaining({ text: "Fallback capture later reconciled to cloud" }),
          ]),
        }),
      );
      expect(repository.applyAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "idea_add" }),
        expect.objectContaining({ id: pendingActivityId, type: "idea_captured" }),
        expect.objectContaining({ projectId }),
        pendingReplay[0].id,
        pendingReplay[0].mutation,
      );
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.migrationState.phase).toBe("complete");
      expect(getLocalDataReconciliationState()).toEqual({ required: false, reason: null });
      expect(mounted.contextRef.current!.data.ideas.some(
        (idea) => idea.text === "Fallback capture later reconciled to cloud",
      )).toBe(true);
      expect(mounted.contextRef.current!.data.activities.some(
        (activity) => activity.id === pendingActivityId,
      )).toBe(true);
    } finally {
      mounted.unmount();
    }

    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.repositoryMode).toBe("cloud");
      expect(reloaded.contextRef.current!.migrationState.phase).toBe("complete");
      expect(reloaded.contextRef.current!.data.ideas.some(
        (idea) => idea.text === "Fallback capture later reconciled to cloud",
      )).toBe(true);
      expect(reloaded.contextRef.current!.data.activities.some(
        (activity) => activity.id === pendingActivityId,
      )).toBe(true);
    } finally {
      reloaded.unmount();
    }
  });

  it("replays a failed existing-project edit before acknowledging skipped import records", async () => {
    let cloudData = seedDashboardData();
    let persistedMarker = completedMarker();
    let cloudWritesAvailable = false;
    const repository = createCloudRepository(cloudData, persistedMarker);
    repository.load = vi.fn(async () => cloudData);
    repository.getMigrationState = vi.fn(async () => persistedMarker);
    repository.applyAction = vi.fn(async (action) => {
      if (!cloudWritesAvailable) {
        throw Object.assign(new Error("Project update could not reach Firestore"), { code: "unavailable" });
      }
      cloudData = dashboardReducer(cloudData, action);
    });
    repository.importData = vi.fn(async () => {
      persistedMarker = migrationState({
        phase: "complete",
        markerStatus: "import_complete",
        completedAt: "2026-08-10T17:00:00.000Z",
        hasLocalData: true,
        hasCloudData: true,
        importedCounts: { projects: 0 },
        skippedCounts: { projects: cloudData.projects.length },
      });
      return persistedMarker;
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const projectId = cloudData.projects[0].id;
    try {
      act(() => {
        mounted.contextRef.current!.updateProject(projectId, {
          currentObjective: "Existing project edit replayed during reconciliation",
        });
      });
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      const pendingActions = getPendingCloudReconciliationActions();
      expect(pendingActions).toEqual([
        expect.objectContaining({
          action: expect.objectContaining({
            type: "project_update",
            payload: expect.objectContaining({ id: projectId }),
          }),
          projectRecency: expect.objectContaining({
            projectId,
          }),
        }),
      ]);
      const pendingRecency = pendingActions[0].projectRecency;
      expect(pendingRecency?.updatedAt).toBe(pendingRecency?.lastWorkedAt);

      cloudWritesAvailable = true;
      let recovery: MigrationState | null = null;
      await act(async () => {
        recovery = await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(32);

      expect(recovery).toMatchObject({
        phase: "complete",
        skippedCounts: { projects: cloudData.projects.length },
      });
      expect(repository.applyAction).toHaveBeenCalledTimes(2);
      expect(repository.applyAction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: "project_update",
          payload: expect.objectContaining({ id: projectId }),
        }),
        undefined,
        pendingRecency,
        pendingActions[0].id,
        pendingActions[0].mutation,
      );
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects.find((project) => project.id === projectId)?.currentObjective)
        .toBe("Existing project edit replayed during reconciliation");
      expect(getPendingCloudReconciliationActions()).toEqual([]);
      expect(getLocalDataReconciliationState().required).toBe(false);
    } finally {
      mounted.unmount();
    }

    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.repositoryMode).toBe("cloud");
      expect(reloaded.contextRef.current!.data.projects.find((project) => project.id === projectId)?.currentObjective)
        .toBe("Existing project edit replayed during reconciliation");
    } finally {
      reloaded.unmount();
    }
  });

  it("pauses later queued cloud writes and replays overlapping updates in invocation order", async () => {
    let cloudData = seedDashboardData();
    let cloudWritesAvailable = false;
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.load = vi.fn(async () => cloudData);
    repository.applyAction = vi.fn(async (action) => {
      if (!cloudWritesAvailable) {
        throw Object.assign(new Error("First queued update failed"), { code: "unavailable" });
      }
      cloudData = dashboardReducer(cloudData, action);
    });
    repository.importData = vi.fn(async () => migrationState({
      phase: "running",
      markerStatus: "reconciliation_pending",
      completedAt: null,
      hasLocalData: true,
      hasCloudData: true,
      importedCounts: { tasks: 0 },
      skippedCounts: { tasks: cloudData.tasks.length },
      reconciliationRequired: true,
    }));
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const taskId = cloudData.tasks[0].id;
    try {
      act(() => {
        mounted.contextRef.current!.updateTask(taskId, { details: "Older failed value" });
        mounted.contextRef.current!.updateTask(taskId, { details: "Newest queued value" });
      });
      await flushAsyncWork(32);

      // The second operation never reaches Firestore after the first queued
      // failure, so recovery can deterministically replay both in order.
      expect(repository.applyAction).toHaveBeenCalledTimes(1);
      expect(loadCloudRecoveryDashboardData(cloudRecoveryScopeForUid("owner-user"))
        ?.tasks.find((task) => task.id === taskId)?.details)
        .toBe("Newest queued value");
      expect(getPendingCloudReconciliationActions().map((entry) =>
        entry.action.type === "task_update" ? entry.action.payload.updates.details : null,
      )).toEqual(["Older failed value", "Newest queued value"]);

      cloudWritesAvailable = true;
      await act(async () => {
        await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(32);

      expect(cloudData.tasks.find((task) => task.id === taskId)?.details).toBe("Newest queued value");
      expect(repository.applyAction).toHaveBeenCalledTimes(3);
      expect(getPendingCloudReconciliationActions()).toEqual([]);
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "complete",
        markerStatus: "import_complete",
      });
    } finally {
      mounted.unmount();
    }
  });

  it("keeps a conflicting journal item visible and never replays later items past it", async () => {
    const cloudData = seedDashboardData();
    let recoveryMode = false;
    const replayedTitles: string[] = [];
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.applyAction = vi.fn(async (action) => {
      if (!recoveryMode) {
        throw Object.assign(new Error("Initial cloud write unavailable"), { code: "unavailable" });
      }
      if (action.type === "task_update") {
        throw Object.assign(
          new Error("Recovery conflict: newer cloud task details were preserved."),
          { code: "reconciliation-conflict" },
        );
      }
      if (action.type === "task_add") {
        replayedTitles.push(action.payload.title);
      }
    });
    repository.importData = vi.fn(async () => migrationState({
      phase: "running",
      markerStatus: "reconciliation_pending",
      completedAt: null,
      hasLocalData: true,
      hasCloudData: true,
      skippedCounts: { tasks: cloudData.tasks.length },
      reconciliationRequired: true,
    }));
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const projectId = cloudData.projects[0].id;
    const taskId = cloudData.tasks[0].id;
    try {
      act(() => {
        mounted.contextRef.current!.updateTask(taskId, { details: "Stale local edit" });
      });
      await flushAsyncWork(24);
      act(() => {
        mounted.contextRef.current!.addTask(taskInput(projectId, "Later safe journal item"));
      });
      await flushAsyncWork(24);

      const beforeReplay = getPendingCloudReconciliationActions();
      expect(beforeReplay.map((entry) => entry.action.type)).toEqual(["task_update", "task_add"]);
      expect(beforeReplay.every((entry) => entry.mutation?.version === 1)).toBe(true);

      recoveryMode = true;
      let result: MigrationState | null = migrationState();
      await act(async () => {
        result = await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(24);

      expect(result).toBeNull();
      expect(replayedTitles).toEqual([]);
      expect(getPendingCloudReconciliationActions().map((entry) => entry.id))
        .toEqual(beforeReplay.map((entry) => entry.id));
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "reconciliation_required",
        reconciliationRequired: true,
      });
      expect(mounted.contextRef.current!.lastActionError).toContain(
        "newer cloud task details were preserved",
      );
      expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === taskId)?.details)
        .toBe("Stale local edit");
      expect(mounted.contextRef.current!.data.tasks.some(
        (task) => task.title === "Later safe journal item",
      )).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  it("reuses the session-note operation ID after an ambiguous commit and keeps the note exactly once", async () => {
    let cloudData = seedDashboardData();
    let recoveryMode = false;
    let failTaskReplay = true;
    const committedOperationIds = new Set<string>();
    const sessionOperationIds: string[] = [];
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.load = vi.fn(async () => cloudData);
    repository.applyAction = vi.fn(async (action, _activity, _projectRecency, operationId) => {
      if (action.type === "session_note_append") {
        expect(operationId).toEqual(expect.any(String));
        sessionOperationIds.push(operationId!);
        if (committedOperationIds.has(operationId!)) {
          return;
        }

        cloudData = dashboardReducer(cloudData, action);
        committedOperationIds.add(operationId!);
        if (!recoveryMode) {
          throw Object.assign(
            new Error("Session-note commit acknowledgement was unavailable"),
            { code: "unavailable" },
          );
        }
        return;
      }

      if (action.type === "task_add" && failTaskReplay) {
        throw new Error("Later replay entry failed");
      }
      cloudData = dashboardReducer(cloudData, action);
    });
    repository.importData = vi.fn(async () => migrationState({
      phase: "running",
      markerStatus: "reconciliation_pending",
      completedAt: null,
      hasLocalData: true,
      hasCloudData: true,
      importedCounts: {},
      skippedCounts: { developmentSessions: cloudData.developmentSessions.length },
      reconciliationRequired: true,
    }));
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const sessionId = cloudData.developmentSessions[0].id;
    const projectId = cloudData.projects[0].id;
    try {
      act(() => {
        mounted.contextRef.current!.appendSessionNote(sessionId, "Append this exactly once");
      });
      await flushAsyncWork(32);
      act(() => {
        mounted.contextRef.current!.addTask(taskInput(projectId, "Replay after the session note"));
      });
      await flushAsyncWork(24);

      recoveryMode = true;
      let firstRecovery: MigrationState | null = migrationState();
      await act(async () => {
        firstRecovery = await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(24);
      expect(firstRecovery).toBeNull();
      expect(sessionOperationIds).toHaveLength(2);
      expect(sessionOperationIds[1]).toBe(sessionOperationIds[0]);
      expect(getPendingCloudReconciliationActions().map((entry) => entry.action.type)).toEqual(["task_add"]);

      failTaskReplay = false;
      await act(async () => {
        await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(32);

      expect(sessionOperationIds).toHaveLength(2);
      const sessionNotes = cloudData.developmentSessions.find((session) => session.id === sessionId)?.notes ?? "";
      expect(sessionNotes.match(/Append this exactly once/g)).toHaveLength(1);
      expect(getPendingCloudReconciliationActions()).toEqual([]);
    } finally {
      mounted.unmount();
    }
  });

  it("rebuilds failed recovery from a stale listener base plus the ordered journal", async () => {
    const cloudData = seedDashboardData();
    const writeGate = createDeferred<void>();
    let subscriber: ((data: DashboardData) => void) | null = null;
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.subscribe = vi.fn((onChange) => {
      subscriber = onChange;
      return () => {
        subscriber = null;
      };
    });
    repository.applyAction = vi.fn(() => writeGate.promise);
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const taskId = cloudData.tasks[0].id;
    const ownerScope = cloudRecoveryScopeForUid("owner-user");
    const journalKey = `${STORAGE_KEY}:reconciliation-actions`;
    const originalGetItem = Storage.prototype.getItem;
    try {
      act(() => {
        mounted.contextRef.current!.updateTask(taskId, {
          details: "Optimistic edit must survive stale listener failure",
        });
      });
      await flushAsyncWork(12);
      const journalBeforeFailure = getPendingCloudReconciliationActions(ownerScope);
      expect(journalBeforeFailure).toHaveLength(1);

      const listenerReadSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
        this: Storage,
        key: string,
      ) {
        if (key === journalKey) {
          throw new DOMException("Journal read temporarily unavailable", "SecurityError");
        }
        return originalGetItem.call(this, key);
      });

      const staleListenerBase: DashboardData = {
        ...cloudData,
        tasks: cloudData.tasks.map((task) => task.id === taskId
          ? {
              ...task,
              acceptanceCriteria: "Unrelated remote edit from stale listener base",
            }
          : task),
      };
      try {
        act(() => {
          subscriber?.(staleListenerBase);
        });
      } finally {
        listenerReadSpy.mockRestore();
      }
      expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === taskId)?.details)
        .toBe("Optimistic edit must survive stale listener failure");

      await act(async () => {
        writeGate.reject(Object.assign(new Error("Cloud write rejected"), { code: "unavailable" }));
        await writeGate.promise.catch(() => undefined);
      });
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === taskId)).toMatchObject({
        details: "Optimistic edit must survive stale listener failure",
        acceptanceCriteria: "Unrelated remote edit from stale listener base",
      });
      expect(loadCloudRecoveryDashboardData(ownerScope)?.tasks.find(
        (task) => task.id === taskId,
      )).toMatchObject({
        details: "Optimistic edit must survive stale listener failure",
        acceptanceCriteria: "Unrelated remote edit from stale listener base",
      });
      expect(getPendingCloudReconciliationActions(ownerScope).map((entry) => entry.id))
        .toEqual(journalBeforeFailure.map((entry) => entry.id));
    } finally {
      mounted.unmount();
    }
  });

  it("rebuilds a deferred raw snapshot with mutations invoked after that snapshot", async () => {
    const cloudData = seedDashboardData();
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    const writeGates = [firstWrite, secondWrite];
    let writeIndex = 0;
    let subscriber: ((data: DashboardData) => void) | null = null;
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.subscribe = vi.fn((onChange) => {
      subscriber = onChange;
      return () => {
        subscriber = null;
      };
    });
    repository.applyAction = vi.fn(async () => {
      const gate = writeGates[writeIndex];
      writeIndex += 1;
      expect(gate).toBeDefined();
      await gate.promise;
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const taskId = cloudData.tasks[0].id;
    try {
      act(() => {
        mounted.contextRef.current!.updateTask(taskId, {
          details: "Mutation A before the deferred snapshot",
        });
      });
      await flushAsyncWork(12);
      expect(repository.applyAction).toHaveBeenCalledOnce();

      const staleRawBase: DashboardData = {
        ...cloudData,
        tasks: cloudData.tasks.map((task) => task.id === taskId
          ? { ...task, acceptanceCriteria: "Unrelated remote field from snapshot S" }
          : task),
      };
      act(() => {
        subscriber?.(staleRawBase);
      });
      expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === taskId)?.details)
        .toBe("Mutation A before the deferred snapshot");

      act(() => {
        mounted.contextRef.current!.updateTask(taskId, {
          details: "Mutation B after the deferred snapshot",
        });
      });
      expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === taskId)?.details)
        .toBe("Mutation B after the deferred snapshot");

      await act(async () => {
        firstWrite.resolve();
        await firstWrite.promise;
      });
      await flushAsyncWork(12);
      expect(repository.applyAction).toHaveBeenCalledTimes(2);

      await act(async () => {
        secondWrite.resolve();
        await secondWrite.promise;
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === taskId)).toMatchObject({
        details: "Mutation B after the deferred snapshot",
        acceptanceCriteria: "Unrelated remote field from snapshot S",
      });
    } finally {
      mounted.unmount();
    }
  });

  it("defers intermediate Firestore snapshots until queued dependent actions finish", async () => {
    let cloudData = seedDashboardData();
    let subscriber: ((data: DashboardData) => void) | null = null;
    const releases: Array<() => void> = [];
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.load = vi.fn(async () => cloudData);
    repository.subscribe = vi.fn((onChange) => {
      subscriber = onChange;
      return () => {
        subscriber = null;
      };
    });
    repository.applyAction = vi.fn(async (
      action,
      activity,
      projectRecency,
      operationId,
      mutation,
    ) => {
      cloudData = buildRecoveryProjection(cloudData, [{
        id: operationId ?? `direct-${releases.length}`,
        action,
        activity,
        projectRecency,
        mutation,
        recordedAt: "2026-08-11T12:00:00.000Z",
      }]);
      subscriber?.(cloudData);
      await new Promise<void>((resolve) => releases.push(resolve));
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const projectId = cloudData.projects[0].id;
    let firstTask: Task | null = null;
    let secondTask: Task | null = null;

    act(() => {
      firstTask = mounted.contextRef.current!.addTask(taskInput(projectId, "First queued cloud task"));
      secondTask = mounted.contextRef.current!.addTask(taskInput(projectId, "Second queued cloud task"));
    });
    await flushAsyncWork();

    expect(releases).toHaveLength(1);
    expect(mounted.contextRef.current!.data.tasks.some((task) => task.id === secondTask!.id)).toBe(true);

    act(() => {
      mounted.contextRef.current!.updateTask(secondTask!.id, {
        details: "Dependent update after the intermediate snapshot",
      });
    });
    expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === secondTask!.id)?.details)
      .toBe("Dependent update after the intermediate snapshot");

    for (let index = 0; index < 3; index += 1) {
      await flushAsyncWork();
      const release = releases.shift();
      expect(release).toBeDefined();
      await act(async () => {
        release?.();
        await Promise.resolve();
      });
    }
    await flushAsyncWork(24);

    expect(repository.applyAction).toHaveBeenCalledTimes(3);
    expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === firstTask!.id)).toBeDefined();
    expect(mounted.contextRef.current!.data.tasks.find((task) => task.id === secondTask!.id)).toMatchObject({
      details: "Dependent update after the intermediate snapshot",
    });
    expect(mounted.contextRef.current!.data).toEqual(cloudData);
    mounted.unmount();
  });

  it("returns an observable failure and performs no capture while auth data is not ready", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const mounted = await mountProvider();
    const beforeIdeaIds = mounted.contextRef.current!.data.ideas.map((idea) => idea.id);

    try {
      fixtures.auth.status = "loading";
      fixtures.auth.user = null;
      mounted.rerender();
      expect(mounted.contextRef.current!.isMutationReady).toBe(false);

      let result: MutationResult | null = null;
      await act(async () => {
        result = await mounted.contextRef.current!.runQuickCapture({
          projectId: seeded.projects[0].id,
          text: "Must not be projected while auth is changing",
          classification: "idea",
        });
      });

      expect(result).toEqual({
        ok: false,
        error: "Dashboard data is still loading for the current account. Try again when loading finishes.",
      });
      expect(mounted.contextRef.current!.data.ideas.map((idea) => idea.id)).toEqual(beforeIdeaIds);
      expect(readPersistedDashboard().ideas.map((idea) => idea.id)).toEqual(beforeIdeaIds);
    } finally {
      mounted.unmount();
    }
  });

  it("returns validation failures without throwing or changing dashboard data", async () => {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const mounted = await mountProvider();
    const before = structuredClone(mounted.contextRef.current!.data);

    try {
      let result: MutationResult | null = null;
      await act(async () => {
        result = await mounted.contextRef.current!.runQuickCapture({
          projectId: seeded.projects[0].id,
          text: "   ",
          classification: "idea",
        });
      });
      expect(result).toEqual({ ok: false, error: "Quick capture requires text." });
      expect(mounted.contextRef.current!.data).toEqual(before);
      expect(readPersistedDashboard()).toEqual(before);
    } finally {
      mounted.unmount();
    }
  });

  it("preserves an unresolved cloud action and later local work across sign-out and rejection", async () => {
    const cloudData = seedDashboardData();
    const repository = createCloudRepository(cloudData, completedMarker());
    let rejectCloudWrite: ((reason: Error) => void) | undefined;
    repository.applyAction = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectCloudWrite = reject;
    }));
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const projectId = cloudData.projects[0].id;
    act(() => {
      mounted.contextRef.current!.addTask(taskInput(projectId, "Cloud write that remains pending"));
    });
    await flushAsyncWork();
    expect(repository.applyAction).toHaveBeenCalledTimes(1);

    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    mounted.rerender();
    await flushAsyncWork(24);

    const ownerScope = cloudRecoveryScopeForUid("owner-user");
    expect(loadCloudRecoveryDashboardData(ownerScope)?.tasks.some(
      (task) => task.title === "Cloud write that remains pending",
    )).toBe(true);

    act(() => {
      mounted.contextRef.current!.addTask(taskInput(projectId, "Local task after sign-out"));
    });
    await flushAsyncWork(24);

    await act(async () => {
      rejectCloudWrite?.(Object.assign(new Error("Pending cloud write rejected"), { code: "unavailable" }));
      await Promise.resolve();
    });
    await flushAsyncWork(24);

    expect(loadCloudRecoveryDashboardData(ownerScope)?.tasks.some(
      (task) => task.title === "Local task after sign-out",
    )).toBe(true);
    expect(loadCloudRecoveryDashboardData(ownerScope)?.tasks.some(
      (task) => task.title === "Cloud write that remains pending",
    )).toBe(true);
    expect(getPendingCloudReconciliationActions(ownerScope).map((entry) => entry.action.type)).toEqual([
      "task_add",
      "task_add",
    ]);
    expect(mounted.contextRef.current!.repositoryMode).toBe("local");
    mounted.unmount();
  });

  it("keeps scoped recovered work visible without depending on a shared fallback backup", async () => {
    const cloudData = seedDashboardData();
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.applyAction = vi.fn(() => new Promise<void>(() => {
      return;
    }));
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const projectId = cloudData.projects[0].id;
    act(() => {
      mounted.contextRef.current!.addTask(taskInput(projectId, "Visible despite backup quota failure"));
    });
    await flushAsyncWork();
    expect(repository.applyAction).toHaveBeenCalledOnce();

    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === `${STORAGE_KEY}:pre-cloud-fallback-backup`) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      fixtures.auth.status = "unauthenticated";
      fixtures.auth.user = null;
      mounted.rerender();
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.tasks.some(
        (task) => task.title === "Visible despite backup quota failure",
      )).toBe(true);
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "local_reconciliation_required",
        reconciliationRequired: true,
      });
      expect(mounted.contextRef.current!.migrationState.reconciliationReason).toContain(
        "reconciled before cloud data becomes active",
      );
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
      expect(mounted.contextRef.current!.syncStatus).toBe("synced");
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("falls back to writable local data when a completed-migration cloud load fails", async () => {
    const localData = seedDashboardData();
    localData.projects[0] = {
      ...localData.projects[0],
      title: "Local project retained during cloud outage",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));
    markLocalDataCloudAcknowledged();

    const repository = createCloudRepository(seedDashboardData(), completedMarker());
    repository.load = vi.fn(async () => {
      throw Object.assign(new Error("Firestore is unavailable"), { code: "unavailable" });
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("Local project retained during cloud outage");
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.syncStatus).toBe("offline");

      act(() => {
        mounted.contextRef.current!.addNote({
          projectId: localData.projects[0].id,
          title: "Captured during cloud outage",
          section: "test",
          tags: [],
          markdown: "This must persist locally.",
        });
      });
      await flushAsyncWork(24);

      expect(readPersistedDashboard().notes.some((note) => note.title === "Captured during cloud outage")).toBe(true);
      expect(repository.applyAction).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it("rechecks local data after sign-in metadata waits before activating cloud", async () => {
    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    const cloudData = seedDashboardData();
    let resolveCounts: ((counts: Record<string, number>) => void) | null = null;
    const repository = createCloudRepository(
      cloudData,
      migrationState({ markerStatus: "initialized" }),
    );
    repository.getCounts = vi.fn(() => new Promise<Record<string, number>>((resolve) => {
      resolveCounts = resolve;
    }));
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "owner-user" };
    mounted.rerender();
    await flushAsyncWork();
    expect(repository.getCounts).toHaveBeenCalledTimes(1);

    act(() => {
      mounted.contextRef.current!.runQuickCapture({
        projectId: mounted.contextRef.current!.data.projects[0].id,
        text: "Captured while cloud metadata was loading",
        classification: "note",
      });
    });
    await flushAsyncWork();

    await act(async () => {
      resolveCounts?.({ projects: cloudData.projects.length });
      await Promise.resolve();
    });
    await flushAsyncWork(24);

    expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
    expect(mounted.contextRef.current!.repositoryMode).toBe("local");
    expect(mounted.contextRef.current!.data.notes.some(
      (note) => note.markdown === "Captured while cloud metadata was loading",
    )).toBe(true);
    expect(repository.load).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("aborts cloud activation when local data changes during the cloud load", async () => {
    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    const cloudData = seedDashboardData();
    let resolveLoad: ((data: DashboardData) => void) | null = null;
    const repository = createCloudRepository(
      cloudData,
      migrationState({ markerStatus: "initialized" }),
    );
    repository.load = vi.fn(() => new Promise<DashboardData>((resolve) => {
      resolveLoad = resolve;
    }));
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "owner-user" };
    mounted.rerender();
    await flushAsyncWork();
    expect(repository.load).toHaveBeenCalledTimes(1);

    act(() => {
      mounted.contextRef.current!.runQuickCapture({
        projectId: mounted.contextRef.current!.data.projects[0].id,
        text: "Captured while the cloud repository was loading",
        classification: "idea",
      });
    });
    await flushAsyncWork();

    await act(async () => {
      resolveLoad?.(cloudData);
      await Promise.resolve();
    });
    await flushAsyncWork(24);

    expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
    expect(mounted.contextRef.current!.repositoryMode).toBe("local");
    expect(mounted.contextRef.current!.data.ideas.some(
      (idea) => idea.text === "Captured while the cloud repository was loading",
    )).toBe(true);
    mounted.unmount();
  });

  it("keeps a newer realtime bootstrap snapshot when the older load resolves later", async () => {
    const olderBootstrap = seedDashboardData();
    olderBootstrap.projects[0] = {
      ...olderBootstrap.projects[0],
      title: "Older bootstrap load",
    };
    const newerRealtime = structuredClone(olderBootstrap);
    newerRealtime.projects[0] = {
      ...newerRealtime.projects[0],
      title: "Newer realtime bootstrap",
    };
    const delayedLoad = createDeferred<DashboardData>();
    let subscriber: ((data: DashboardData) => void) | null = null;
    const repository = createCloudRepository(olderBootstrap, completedMarker());
    repository.load = vi.fn(() => delayedLoad.promise);
    repository.subscribe = vi.fn((onChange) => {
      subscriber = onChange;
      return () => {
        subscriber = null;
      };
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    try {
      expect(repository.load).toHaveBeenCalledOnce();
      expect(subscriber).not.toBeNull();

      act(() => {
        subscriber?.(newerRealtime);
      });
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("Newer realtime bootstrap");

      await act(async () => {
        delayedLoad.resolve(olderBootstrap);
        await delayedLoad.promise;
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("Newer realtime bootstrap");
    } finally {
      mounted.unmount();
    }
  });

  it("keeps a deferred realtime snapshot authoritative without a post-write reload", async () => {
    const cloudData = seedDashboardData();
    const stalePostWriteLoad = createDeferred<DashboardData>();
    const writeGate = createDeferred<void>();
    let subscriber: ((data: DashboardData) => void) | null = null;
    let appliedAction: Parameters<DashboardRepository["applyAction"]>[0] | null = null;
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.load = vi.fn()
      .mockResolvedValueOnce(cloudData)
      .mockImplementation(() => stalePostWriteLoad.promise);
    repository.subscribe = vi.fn((onChange) => {
      subscriber = onChange;
      return () => {
        subscriber = null;
      };
    });
    repository.applyAction = vi.fn(async (action) => {
      appliedAction = action;
      await writeGate.promise;
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    try {
      const projectId = cloudData.projects[0].id;
      act(() => {
        mounted.contextRef.current!.updateProject(projectId, {
          currentObjective: "Projected action reflected by realtime",
        });
      });
      await flushAsyncWork(12);
      expect(appliedAction).not.toBeNull();

      const newerRealtime = dashboardReducer(cloudData, appliedAction!);
      newerRealtime.projects = newerRealtime.projects.map((project) =>
        project.id === projectId
          ? { ...project, title: "Newer server-side project title" }
          : project,
      );
      act(() => {
        subscriber?.(newerRealtime);
      });

      await act(async () => {
        writeGate.resolve();
        await writeGate.promise;
      });
      stalePostWriteLoad.resolve(cloudData);
      await flushAsyncWork(24);

      expect(repository.load).toHaveBeenCalledOnce();
      expect(mounted.contextRef.current!.data.projects[0]).toMatchObject({
        title: "Newer server-side project title",
        currentObjective: "Projected action reflected by realtime",
      });
      expect(mounted.contextRef.current!.syncStatus).toBe("synced");
    } finally {
      mounted.unmount();
    }
  });

  it("does not let an already-arrived stale snapshot roll back an acknowledged write", async () => {
    const cloudData = seedDashboardData();
    const writeGate = createDeferred<void>();
    let subscriber: ((data: DashboardData) => void) | null = null;
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.subscribe = vi.fn((onChange) => {
      subscriber = onChange;
      return () => {
        subscriber = null;
      };
    });
    repository.applyAction = vi.fn(() => writeGate.promise);
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    const projectId = cloudData.projects[0].id;
    try {
      act(() => {
        mounted.contextRef.current!.updateProject(projectId, {
          currentObjective: "Durably acknowledged local objective",
        });
      });
      await flushAsyncWork(12);

      act(() => {
        subscriber?.(cloudData);
      });
      await act(async () => {
        writeGate.resolve();
        await writeGate.promise;
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.data.projects[0].currentObjective)
        .toBe("Durably acknowledged local objective");

      const laterRemoteEdit: DashboardData = {
        ...cloudData,
        projects: cloudData.projects.map((project) => project.id === projectId
          ? { ...project, currentObjective: "Later remote objective" }
          : project),
      };
      act(() => {
        subscriber?.(laterRemoteEdit);
      });
      expect(mounted.contextRef.current!.data.projects[0].currentObjective)
        .toBe("Later remote objective");
    } finally {
      mounted.unmount();
    }
  });

  it("accepts multiple successive realtime snapshots in arrival order", async () => {
    const cloudData = seedDashboardData();
    let subscriber: ((data: DashboardData) => void) | null = null;
    const repository = createCloudRepository(cloudData, completedMarker());
    repository.subscribe = vi.fn((onChange) => {
      subscriber = onChange;
      return () => {
        subscriber = null;
      };
    });
    fixtures.createFirestoreRepository.mockResolvedValue(repository);

    const mounted = await mountProvider();
    try {
      const withTitle = (title: string) => ({
        ...cloudData,
        projects: cloudData.projects.map((project, index) =>
          index === 0 ? { ...project, title } : project,
        ),
      });

      act(() => {
        subscriber?.(withTitle("Realtime snapshot one"));
        subscriber?.(withTitle("Realtime snapshot two"));
        subscriber?.(withTitle("Realtime snapshot three"));
      });

      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("Realtime snapshot three");
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
    } finally {
      mounted.unmount();
    }
  });
});

describe("authentication generation isolation", () => {
  const completedMarker = () => migrationState({
    phase: "complete",
    markerStatus: "import_complete",
    completedAt: "2026-08-07T12:00:00.000Z",
    hasCloudData: true,
  });

  const dataWithProjectTitle = (title: string) => {
    const data = seedDashboardData();
    data.projects = data.projects.map((project, index) =>
      index === 0 ? { ...project, title } : project,
    );
    return data;
  };

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "user-a" };
    fixtures.createFirestoreRepository.mockReset();
  });

  it("ignores a stale user A repository creation success after user B becomes active", async () => {
    const delayedUserA = createDeferred<DashboardRepository>();
    const userARepository = createCloudRepository(
      dataWithProjectTitle("User A cloud project"),
      completedMarker(),
    );
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B cloud project"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      uid === "user-a" ? delayedUserA.promise : Promise.resolve(userBRepository),
    );

    const mounted = await mountProvider();
    try {
      expect(fixtures.createFirestoreRepository).toHaveBeenCalledWith("user-a");

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("User B cloud project");

      await act(async () => {
        delayedUserA.resolve(userARepository);
        await delayedUserA.promise;
      });
      await flushAsyncWork(24);

      expect(userARepository.getCounts).not.toHaveBeenCalled();
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("User B cloud project");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  it("ignores a stale user A repository creation failure after user B becomes active", async () => {
    const delayedUserA = createDeferred<DashboardRepository>();
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B survives stale failure"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      uid === "user-a" ? delayedUserA.promise : Promise.resolve(userBRepository),
    );

    const mounted = await mountProvider();
    try {
      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B survives stale failure");

      await act(async () => {
        delayedUserA.reject(new Error("Obsolete user A initialization failed"));
        await delayedUserA.promise.catch(() => undefined);
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B survives stale failure");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  it("ignores stale user A cloud load completion after sign-out", async () => {
    const localData = dataWithProjectTitle("Signed-out local project");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));
    markLocalDataCloudAcknowledged();

    const delayedLoad = createDeferred<DashboardData>();
    const userAData = dataWithProjectTitle("User A delayed cloud project");
    const userARepository = createCloudRepository(userAData, completedMarker());
    userARepository.load = vi.fn(() => delayedLoad.promise);
    fixtures.createFirestoreRepository.mockResolvedValue(userARepository);

    const mounted = await mountProvider();
    try {
      await flushAsyncWork(24);
      expect(userARepository.load).toHaveBeenCalledOnce();

      fixtures.auth.status = "unauthenticated";
      fixtures.auth.user = null;
      mounted.rerender();
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Signed-out local project");

      await act(async () => {
        delayedLoad.resolve(userAData);
        await delayedLoad.promise;
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Signed-out local project");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  it("ignores a stale user A cloud load failure after user B becomes active", async () => {
    const delayedUserALoad = createDeferred<DashboardData>();
    const userARepository = createCloudRepository(
      dataWithProjectTitle("User A load-failure project"),
      completedMarker(),
    );
    userARepository.load = vi.fn(() => delayedUserALoad.promise);
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B survives stale load failure"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    try {
      await flushAsyncWork(24);
      expect(userARepository.load).toHaveBeenCalledOnce();

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B survives stale load failure");

      await act(async () => {
        delayedUserALoad.reject(Object.assign(new Error("Obsolete cloud load failed"), {
          code: "unavailable",
        }));
        await delayedUserALoad.promise.catch(() => undefined);
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B survives stale load failure");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  it("keeps signed-out local state active until the current user B repository is ready", async () => {
    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    const localData = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));

    const delayedUserB = createDeferred<DashboardRepository>();
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B after signed-out mode"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation(() => delayedUserB.promise);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");

      fixtures.auth.status = "authenticated";
      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(16);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.projects[0].title).toBe(localData.projects[0].title);

      await act(async () => {
        delayedUserB.resolve(userBRepository);
        await delayedUserB.promise;
      });
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B after signed-out mode");
    } finally {
      mounted.unmount();
    }
  });

  it("ignores stale user A count completion after user B becomes active", async () => {
    const delayedCounts = createDeferred<Record<string, number>>();
    const userARepository = createCloudRepository(
      dataWithProjectTitle("User A count-delayed project"),
      completedMarker(),
    );
    userARepository.getCounts = vi.fn(() => delayedCounts.promise);
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B after stale counts"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    try {
      await flushAsyncWork(16);
      expect(userARepository.getCounts).toHaveBeenCalledOnce();

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B after stale counts");

      await act(async () => {
        delayedCounts.resolve({ projects: 1 });
        await delayedCounts.promise;
      });
      await flushAsyncWork(24);

      expect(userARepository.getMigrationState).not.toHaveBeenCalled();
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B after stale counts");
    } finally {
      mounted.unmount();
    }
  });

  it("ignores stale user A migration metadata after user B becomes active", async () => {
    const delayedMigration = createDeferred<MigrationState>();
    const userARepository = createCloudRepository(
      dataWithProjectTitle("User A metadata-delayed project"),
      completedMarker(),
    );
    userARepository.getMigrationState = vi.fn(() => delayedMigration.promise);
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B after stale metadata"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    try {
      await flushAsyncWork(16);
      expect(userARepository.getMigrationState).toHaveBeenCalledOnce();

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B after stale metadata");

      await act(async () => {
        delayedMigration.resolve(completedMarker());
        await delayedMigration.promise;
      });
      await flushAsyncWork(24);

      expect(userARepository.load).not.toHaveBeenCalled();
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B after stale metadata");
    } finally {
      mounted.unmount();
    }
  });

  it("hides user A data immediately while user B initializes and ignores held A callbacks", async () => {
    const retainedLocalData = dataWithProjectTitle("Retained device-local project");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(retainedLocalData));
    markLocalDataCloudAcknowledged();
    const userAData = dataWithProjectTitle("Sensitive user A cloud project");
    const userARepository = createCloudRepository(
      userAData,
      completedMarker(),
    );
    const delayedUserB = createDeferred<DashboardRepository>();
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B cloud project after delay"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      uid === "user-a" ? Promise.resolve(userARepository) : delayedUserB.promise,
    );

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("Sensitive user A cloud project");
      const heldUserAUpdate = mounted.contextRef.current!.updateProject;
      const heldUserAMigration = mounted.contextRef.current!.beginMigrationImport;

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      expect(mounted.contextRef.current!.data.projects[0].title)
        .not.toBe("Sensitive user A cloud project");
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.syncStatus).toBe("loading");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "idle",
        markerStatus: "not_started",
      });
      expect(mounted.contextRef.current!.lastActionError).toBeNull();

      const newUserBUpdateBeforeDataIsReady = mounted.contextRef.current!.updateProject;
      act(() => {
        newUserBUpdateBeforeDataIsReady(retainedLocalData.projects[0].id, {
          currentObjective: "Must not project from transition seed data",
        });
      });
      expect(readPersistedDashboard().projects[0].title)
        .toBe("Retained device-local project");
      expect(localStorage.getItem(STORAGE_KEY) ?? "")
        .not.toContain("Must not project from transition seed data");

      act(() => {
        heldUserAUpdate(userAData.projects[0].id, {
          currentObjective: "Held A callback must not persist",
        });
      });
      await act(async () => {
        await heldUserAMigration();
      });
      await flushAsyncWork(16);
      expect(userARepository.applyAction).not.toHaveBeenCalled();
      expect(userBRepository.importData).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain("Held A callback must not persist");

      await act(async () => {
        delayedUserB.resolve(userBRepository);
        await delayedUserB.promise;
      });
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B cloud project after delay");
    } finally {
      mounted.unmount();
    }
  });

  it("retains a failed user A write in A-scoped recovery without mutating user B", async () => {
    const userAData = dataWithProjectTitle("User A action source");
    const userARepository = createCloudRepository(userAData, completedMarker());
    const delayedWrite = createDeferred<void>();
    userARepository.applyAction = vi.fn(() => delayedWrite.promise);
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B remains authoritative"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    const recoveryScopeA = cloudRecoveryScopeForUid("user-a");
    try {
      act(() => {
        mounted.contextRef.current!.addTask({
          projectId: userAData.projects[0].id,
          title: "User A pending cloud task",
          details: "",
          type: "feature",
          status: "backlog",
          priority: "medium",
          blockedReason: "",
          sourceIdeaId: null,
          acceptanceCriteria: "",
          implementationNotes: "",
          startedAt: null,
          completedAt: null,
        });
      });
      await flushAsyncWork(16);
      expect(getPendingCloudReconciliationActions(recoveryScopeA)).toHaveLength(1);

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B remains authoritative");

      await act(async () => {
        delayedWrite.reject(Object.assign(new Error("User A write failed late"), {
          code: "unavailable",
        }));
        await delayedWrite.promise.catch(() => undefined);
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B remains authoritative");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
      expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain("User A pending cloud task");
      expect(getPendingCloudReconciliationActions(recoveryScopeA)).toHaveLength(1);
      expect(loadCloudRecoveryDashboardData(recoveryScopeA)?.tasks.some(
        (task) => task.title === "User A pending cloud task",
      )).toBe(true);

      fixtures.auth.user = { uid: "user-a" };
      mounted.rerender();
      await flushAsyncWork(32);
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.tasks.some(
        (task) => task.title === "User A pending cloud task",
      )).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  it("quarantines a completed user A fallback across user B switch and reload", async () => {
    const userAData = dataWithProjectTitle("User A before fallback");
    const userARepository = createCloudRepository(userAData, completedMarker());
    userARepository.applyAction = vi.fn(async () => {
      throw Object.assign(new Error("User A cloud write failed"), { code: "unavailable" });
    });
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B isolated cloud project"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    const scopeA = cloudRecoveryScopeForUid("user-a");
    try {
      act(() => {
        mounted.contextRef.current!.updateProject(userAData.projects[0].id, {
          currentObjective: "User A fallback must remain account scoped",
        });
      });
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(loadCloudRecoveryDashboardData(scopeA)?.projects[0].currentObjective)
        .toBe("User A fallback must remain account scoped");
      expect(readPersistedDashboard().projects[0].currentObjective)
        .not.toBe("User A fallback must remain account scoped");

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B isolated cloud project");
      expect(mounted.contextRef.current!.data.projects[0].currentObjective)
        .not.toBe("User A fallback must remain account scoped");
      expect(userBRepository.importData).not.toHaveBeenCalled();
      expect(userBRepository.applyAction).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }

    const reloadedAsB = await mountProvider();
    try {
      expect(reloadedAsB.contextRef.current!.repositoryMode).toBe("cloud");
      expect(reloadedAsB.contextRef.current!.data.projects[0].title)
        .toBe("User B isolated cloud project");
      expect(reloadedAsB.contextRef.current!.data.projects[0].currentObjective)
        .not.toBe("User A fallback must remain account scoped");
      expect(loadCloudRecoveryDashboardData(scopeA)?.projects[0].currentObjective)
        .toBe("User A fallback must remain account scoped");

      fixtures.auth.user = { uid: "user-a" };
      reloadedAsB.rerender();
      await flushAsyncWork(32);

      expect(reloadedAsB.contextRef.current!.repositoryMode).toBe("local");
      expect(reloadedAsB.contextRef.current!.data.projects[0].currentObjective)
        .toBe("User A fallback must remain account scoped");
      expect(reloadedAsB.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "local_reconciliation_required",
      });
    } finally {
      reloadedAsB.unmount();
    }
  });

  it("never exposes user A recovery while user B has only a scoped replay journal", async () => {
    const scopeA = cloudRecoveryScopeForUid("user-a");
    const scopeB = cloudRecoveryScopeForUid("user-b");
    const userARecovery = dataWithProjectTitle("User A isolated recovery projection");
    userARecovery.projects[0] = {
      ...userARecovery.projects[0],
      currentObjective: "Only user A may see this recovery",
    };
    saveCloudRecoveryDashboardData(userARecovery, scopeA);

    const userARepository = createCloudRepository(
      dataWithProjectTitle("User A cloud"),
      completedMarker(),
    );
    const userBCloud = dataWithProjectTitle("User B cloud after journal replay");
    const userBRepository = createCloudRepository(userBCloud, completedMarker());
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User A isolated recovery projection");

      const userBJournal = appendPendingCloudReconciliationAction({
        ownerScope: scopeB,
        action: {
          type: "project_update",
          payload: {
            id: userBCloud.projects[0].id,
            updates: { currentBlocker: "User B journal-only recovery" },
          },
        },
      });
      expect(userBJournal).not.toBeNull();

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .not.toBe("User A isolated recovery projection");
      expect(mounted.contextRef.current!.data.projects[0].currentObjective)
        .not.toBe("Only user A may see this recovery");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "local_reconciliation_required",
      });
      expect(userBRepository.load).not.toHaveBeenCalled();

      const exportedForB = await mounted.contextRef.current!.exportLocalData();
      expect(exportedForB.projects[0].title)
        .not.toBe("User A isolated recovery projection");

      await act(async () => {
        await mounted.contextRef.current!.beginMigrationKeepCloud();
      });
      expect(mounted.contextRef.current!.lastActionError).toContain(
        "Import the journal into cloud",
      );
      expect(userBRepository.setMigrationState).not.toHaveBeenCalled();

      await act(async () => {
        await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(32);

      expect(userBRepository.importData).not.toHaveBeenCalled();
      expect(userBRepository.applyAction).toHaveBeenCalledWith(
        userBJournal!.action,
        undefined,
        undefined,
        userBJournal!.id,
        undefined,
      );
      expect(getPendingCloudReconciliationActions(scopeB)).toEqual([]);
      expect(loadCloudRecoveryDashboardData(scopeA)).toEqual(userARecovery);
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B cloud after journal replay");
    } finally {
      mounted.unmount();
    }
  });

  it("quarantines a legacy shared user A fallback while user B initializes and writes locally", async () => {
    const scopeA = cloudRecoveryScopeForUid("user-a");
    const scopeB = cloudRecoveryScopeForUid("user-b");
    const oldSharedFallback = dataWithProjectTitle("Old shared user A fallback");
    oldSharedFallback.projects[0].currentObjective = "Only user A may recover this";
    saveCloudFallbackDashboardData(
      oldSharedFallback,
      "Older cloud fallback awaiting reconciliation.",
      scopeA,
    );

    fixtures.auth.user = { uid: "user-b" };
    const delayedUserB = createDeferred<DashboardRepository>();
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B cloud after quarantine"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockReturnValue(delayedUserB.promise);

    const mounted = await mountProvider();
    const scopedRecoveryKey = `${STORAGE_KEY}:cloud-recovery:${scopeB}`;
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === scopedRecoveryKey) {
        throw new DOMException("Scoped recovery quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .not.toBe("Old shared user A fallback");

      act(() => {
        mounted.contextRef.current!.updateProject(oldSharedFallback.projects[0].id, {
          currentObjective: "User B local work while cloud initializes",
        });
      });
      await flushAsyncWork(24);

      expect(readPersistedDashboard().projects[0].currentObjective)
        .toBe("Only user A may recover this");
      expect(mounted.contextRef.current!.data.projects[0].currentObjective)
        .toBe("User B local work while cloud initializes");
      expect(loadCloudRecoveryDashboardData(scopeB)).toBeNull();
      expect(getPendingCloudReconciliationActions(scopeA)).toEqual([]);
      expect(getPendingCloudReconciliationActions(scopeB)).toEqual([]);
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "local_reconciliation_required",
        reconciliationRequired: true,
      });

      await act(async () => {
        delayedUserB.resolve(userBRepository);
        await delayedUserB.promise;
      });
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
      expect(userBRepository.applyAction).not.toHaveBeenCalled();
      expect(userBRepository.importData).not.toHaveBeenCalled();
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("keeps ownerless legacy recovery local until an explicit account association", async () => {
    const legacyRecovery = dataWithProjectTitle("Legacy recovery before account scoping");
    legacyRecovery.projects[0].currentObjective = "Owner is intentionally unknown";
    saveCloudRecoveryDashboardData(legacyRecovery);
    const legacyEntry = appendPendingCloudReconciliationAction({
      action: {
        type: "project_update",
        payload: {
          id: legacyRecovery.projects[0].id,
          updates: { currentBlocker: "Legacy journal entry" },
        },
      },
    });
    expect(legacyEntry).not.toBeNull();

    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B cloud remains isolated"),
      completedMarker(),
    );
    fixtures.auth.user = { uid: "user-b" };
    fixtures.createFirestoreRepository.mockResolvedValue(userBRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("Legacy recovery before account scoping");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "legacy_recovery_unassigned",
      });
      expect(userBRepository.load).not.toHaveBeenCalled();
      expect(userBRepository.importData).not.toHaveBeenCalled();
      expect(userBRepository.applyAction).not.toHaveBeenCalled();
      expect(getPendingCloudReconciliationActions().map((entry) => entry.id))
        .toEqual([legacyEntry!.id]);
      expect(loadCloudRecoveryDashboardData()?.projects[0].currentObjective)
        .toBe("Owner is intentionally unknown");

      await act(async () => {
        await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(32);

      expect(userBRepository.importData).toHaveBeenCalledWith(legacyRecovery);
      expect(userBRepository.applyAction).toHaveBeenCalledWith(
        legacyEntry!.action,
        undefined,
        undefined,
        legacyEntry!.id,
        undefined,
      );
      expect(loadCloudRecoveryDashboardData()).toBeNull();
      expect(getPendingCloudReconciliationActions()).toEqual([]);
    } finally {
      mounted.unmount();
    }
  });

  it("does not activate cloud over an ownerless legacy snapshot with no journal", async () => {
    const legacySnapshot = dataWithProjectTitle("Legacy snapshot-only recovery");
    legacySnapshot.notes[0] = {
      ...legacySnapshot.notes[0],
      markdown: "Snapshot-only legacy work must remain visible.",
    };
    saveCloudRecoveryDashboardData(legacySnapshot);

    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B cloud must wait"),
      completedMarker(),
    );
    fixtures.auth.user = { uid: "user-b" };
    fixtures.createFirestoreRepository.mockResolvedValue(userBRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.notes[0].markdown)
        .toBe("Snapshot-only legacy work must remain visible.");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "legacy_recovery_unassigned",
      });
      expect(userBRepository.load).not.toHaveBeenCalled();
      expect(userBRepository.importData).not.toHaveBeenCalled();
      expect(loadCloudRecoveryDashboardData()).toEqual(legacySnapshot);
    } finally {
      mounted.unmount();
    }
  });

  it("clears only user A recovery after a late successful A write", async () => {
    const userAData = dataWithProjectTitle("User A successful action source");
    const userARepository = createCloudRepository(userAData, completedMarker());
    const delayedWrite = createDeferred<void>();
    userARepository.applyAction = vi.fn(() => delayedWrite.promise);
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B after late A success"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    const recoveryScopeA = cloudRecoveryScopeForUid("user-a");
    try {
      act(() => {
        mounted.contextRef.current!.updateProject(userAData.projects[0].id, {
          currentObjective: "Late successful A edit",
        });
      });
      await flushAsyncWork(16);
      expect(getPendingCloudReconciliationActions(recoveryScopeA)).toHaveLength(1);

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      delayedWrite.resolve();
      await act(async () => {
        await delayedWrite.promise;
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B after late A success");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
      expect(getPendingCloudReconciliationActions(recoveryScopeA)).toEqual([]);
      expect(loadCloudRecoveryDashboardData(recoveryScopeA)).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  it("makes a stale user A import completion a no-op after user B becomes active", async () => {
    const userARepository = createCloudRepository(
      dataWithProjectTitle("User A import source"),
      completedMarker(),
    );
    const delayedImport = createDeferred<MigrationState>();
    userARepository.importData = vi.fn(() => delayedImport.promise);
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B survives stale import"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    try {
      let importPromise: Promise<MigrationState | null> | null = null;
      act(() => {
        importPromise = mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(16);
      expect(userARepository.importData).toHaveBeenCalledOnce();

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      await act(async () => {
        delayedImport.resolve(migrationState({
          phase: "complete",
          markerStatus: "import_complete",
          completedAt: "2026-08-10T18:00:00.000Z",
          hasCloudData: true,
        }));
        await importPromise;
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B survives stale import");
      expect(mounted.contextRef.current!.migrationState.markerStatus).toBe("import_complete");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
      expect(userARepository.setMigrationState).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it("makes a stale user A keep-cloud failure a no-op after user B becomes active", async () => {
    const userARepository = createCloudRepository(
      dataWithProjectTitle("User A keep-cloud source"),
      completedMarker(),
    );
    const delayedMarkerWrite = createDeferred<void>();
    userARepository.setMigrationState = vi.fn(() => delayedMarkerWrite.promise);
    const userBRepository = createCloudRepository(
      dataWithProjectTitle("User B survives stale keep-cloud"),
      completedMarker(),
    );
    fixtures.createFirestoreRepository.mockImplementation((uid: string) =>
      Promise.resolve(uid === "user-a" ? userARepository : userBRepository),
    );

    const mounted = await mountProvider();
    try {
      let keepCloudPromise: Promise<MigrationState | null> | null = null;
      act(() => {
        keepCloudPromise = mounted.contextRef.current!.beginMigrationKeepCloud();
      });
      await flushAsyncWork(16);
      expect(userARepository.setMigrationState).toHaveBeenCalledOnce();

      fixtures.auth.user = { uid: "user-b" };
      mounted.rerender();
      await flushAsyncWork(32);
      await act(async () => {
        delayedMarkerWrite.reject(new Error("Stale A marker write failed"));
        await keepCloudPromise;
      });
      await flushAsyncWork(24);

      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.data.projects[0].title)
        .toBe("User B survives stale keep-cloud");
      expect(mounted.contextRef.current!.migrationState.markerStatus).toBe("import_complete");
      expect(mounted.contextRef.current!.lastActionError).toBeNull();
      expect(getLocalDataReconciliationState().required).toBe(false);
    } finally {
      mounted.unmount();
    }
  });
});

describe("migration marker startup evaluation", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "owner-user" };
    fixtures.createFirestoreRepository.mockReset();
  });

  const localAndCloudData = () => {
    const seeded = seedDashboardData();
    const localData: DashboardData = {
      ...seeded,
      projects: seeded.projects.map((project, index) =>
        index === 0
          ? { ...project, title: "Retained local project", currentBlocker: "Local-only blocker" }
          : project,
      ),
    };
    const cloudData: DashboardData = {
      ...seeded,
      projects: seeded.projects.map((project, index) =>
        index === 0 ? { ...project, title: "Active cloud project" } : project,
      ),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));
    return { localData, cloudData };
  };

  it("never activates partial cloud data from a reconciliation-pending marker on another device", async () => {
    const cloudData = seedDashboardData();
    const marker = migrationState({
      phase: "running",
      markerStatus: "reconciliation_pending",
      completedAt: null,
      hasCloudData: true,
      reconciliationRequired: true,
      reconciliationReason: "Replay has not completed.",
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "reconciliation_pending",
        reconciliationRequired: true,
      });
      expect(cloudRepository.load).not.toHaveBeenCalled();
      expect(mounted.contextRef.current!.lastActionError).toContain("no local recovery payload");
    } finally {
      mounted.unmount();
    }
  });

  it("does not hide markerless Phase 1A local work behind a completed cloud marker", async () => {
    const { cloudData } = localAndCloudData();
    const marker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-08T11:00:00.000Z",
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        reconciliationRequired: true,
      });
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Retained local project");
      expect(cloudRepository.load).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it("activates completed cloud data for a pristine markerless seed payload", async () => {
    const pristineSeed = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pristineSeed));
    const cloudData = {
      ...pristineSeed,
      projects: pristineSeed.projects.map((project, index) =>
        index === 0 ? { ...project, title: "Cloud active for pristine seed" } : project,
      ),
    };
    const marker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-08T11:15:00.000Z",
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");
      expect(mounted.contextRef.current!.migrationState.phase).toBe("complete");
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Cloud active for pristine seed");
    } finally {
      mounted.unmount();
    }
  });

  it("requires review for a markerless Phase 1A payload with an added entity", async () => {
    const localData = seedDashboardData();
    localData.ideas.push({
      ...localData.ideas[0],
      id: "92929292-9292-4292-8292-929292929292",
      text: "Legacy Phase 1A entity that exists only locally",
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));
    const cloudData = seedDashboardData();
    const marker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-08T11:30:00.000Z",
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
      expect(mounted.contextRef.current!.data.ideas.some(
        (idea) => idea.text === "Legacy Phase 1A entity that exists only locally",
      )).toBe(true);
      expect(cloudRepository.load).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it("does not acknowledge a legacy edit when import reports existing-ID skips without replay actions", async () => {
    const { cloudData } = localAndCloudData();
    const marker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-08T11:45:00.000Z",
      hasCloudData: true,
    });
    const skippedImport = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-10T17:30:00.000Z",
      hasLocalData: true,
      hasCloudData: true,
      importedCounts: { projects: 0 },
      skippedCounts: { projects: cloudData.projects.length },
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    cloudRepository.importData = vi.fn(async () => skippedImport);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
      let result: MigrationState | null = skippedImport;
      await act(async () => {
        result = await mounted.contextRef.current!.beginMigrationImport();
      });

      expect(result).toBeNull();
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "reconciliation_required",
        reconciliationRequired: true,
      });
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Retained local project");
      expect(cloudRepository.applyAction).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it("never replays an ordinary signed-out edit over an existing cloud record", async () => {
    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    const localData = seedDashboardData();
    const cloudData = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localData));

    const skippedImport = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-10T17:45:00.000Z",
      hasLocalData: true,
      hasCloudData: true,
      importedCounts: { projects: 0 },
      skippedCounts: { projects: cloudData.projects.length },
    });
    const cloudRepository = createCloudRepository(
      cloudData,
      migrationState({ markerStatus: "initialized", hasCloudData: true }),
    );
    cloudRepository.importData = vi.fn(async () => skippedImport);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    const projectId = localData.projects[0].id;
    try {
      act(() => {
        mounted.contextRef.current!.updateProject(projectId, {
          currentBlocker: "Signed-out edit must not overwrite existing cloud data",
        });
      });
      await flushAsyncWork(24);
      expect(getPendingCloudReconciliationActions()).toEqual([]);

      fixtures.auth.status = "authenticated";
      fixtures.auth.user = { uid: "owner-user" };
      mounted.rerender();
      await flushAsyncWork(24);
      expect(mounted.contextRef.current!.migrationState.phase).toBe("required");

      let result: MigrationState | null = skippedImport;
      await act(async () => {
        result = await mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork(24);

      expect(result).toBeNull();
      expect(cloudRepository.applyAction).not.toHaveBeenCalled();
      expect(cloudData.projects[0].currentBlocker)
        .not.toBe("Signed-out edit must not overwrite existing cloud data");
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "reconciliation_required",
      });
    } finally {
      mounted.unmount();
    }
  });

  it("keeps a completed import active across reload with retained local data and backup", async () => {
    const { localData, cloudData } = localAndCloudData();
    expect(createLocalDashboardBackup({ data: localData, sourceDevice: "test" })).not.toBeNull();
    markLocalDataCloudAcknowledged();
    const marker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-08T12:00:00.000Z",
      hasLocalData: true,
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const firstLoad = await mountProvider();
    expect(firstLoad.contextRef.current!.migrationState).toMatchObject({
      phase: "complete",
      markerStatus: "import_complete",
      hasLocalData: true,
    });
    expect(firstLoad.contextRef.current!.data.projects[0].title).toBe("Active cloud project");
    firstLoad.unmount();

    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.migrationState.phase).toBe("complete");
      expect(reloaded.contextRef.current!.data.projects[0].title).toBe("Active cloud project");
      expect(getLocalDashboardBackupInfo()).not.toBeNull();
      expect(readPersistedDashboard().projects[0].title).toBe("Retained local project");

      act(() => {
        reloaded.contextRef.current!.addNote({
          projectId: cloudData.projects[0].id,
          title: "Cloud repository remains active",
          section: "test",
          tags: [],
          markdown: "This write must target Firestore.",
        });
      });
      await flushAsyncWork();
      expect(cloudRepository.applyAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note_add" }),
        undefined,
        expect.objectContaining({ projectId: cloudData.projects[0].id }),
        expect.any(String),
        expect.objectContaining({ version: 1, fingerprint: expect.any(String) }),
      );
    } finally {
      reloaded.unmount();
    }
  });

  it("keeps new signed-out local work visible when a completed cloud migration reconnects", async () => {
    const { cloudData } = localAndCloudData();
    markLocalDataCloudAcknowledged();
    const marker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-07T12:00:00.000Z",
      hasLocalData: true,
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    expect(mounted.contextRef.current!.repositoryMode).toBe("cloud");

    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    mounted.rerender();
    await flushAsyncWork();
    act(() => {
      mounted.contextRef.current!.addNote({
        projectId: mounted.contextRef.current!.data.projects[0].id,
        title: "New signed-out work",
        section: "offline",
        tags: [],
        markdown: "This local note must not be hidden on reconnect.",
      });
    });
    await flushAsyncWork(24);

    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "owner-user" };
    mounted.rerender();
    await flushAsyncWork(24);

    expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
    expect(mounted.contextRef.current!.repositoryMode).toBe("local");
    expect(mounted.contextRef.current!.data.notes.some((note) => note.title === "New signed-out work")).toBe(true);
    mounted.unmount();
  });

  it("keeps a degraded signed-out projection local when a completed cloud account signs in", async () => {
    const { localData, cloudData } = localAndCloudData();
    markLocalDataCloudAcknowledged();
    const marker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-07T12:00:00.000Z",
      hasLocalData: true,
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);
    fixtures.auth.status = "unauthenticated";
    fixtures.auth.user = null;
    const mounted = await mountProvider();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEY) {
        throw new DOMException("Local storage quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      act(() => {
        mounted.contextRef.current!.addNote({
          projectId: localData.projects[0].id,
          title: "Unpersisted signed-out work",
          section: "offline",
          tags: [],
          markdown: "Keep this current-tab projection out of cloud activation.",
        });
      });
      await flushAsyncWork(24);
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");
      expect(mounted.contextRef.current!.data.notes.some(
        (note) => note.title === "Unpersisted signed-out work",
      )).toBe(true);
      expect(readPersistedDashboard().notes.some(
        (note) => note.title === "Unpersisted signed-out work",
      )).toBe(false);

      setItemSpy.mockRestore();
      fixtures.auth.status = "authenticated";
      fixtures.auth.user = { uid: "owner-user" };
      mounted.rerender();
      await flushAsyncWork(32);

      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Retained local project");
      expect(mounted.contextRef.current!.data.notes.some(
        (note) => note.title === "Unpersisted signed-out work",
      )).toBe(true);
      expect(mounted.contextRef.current!.localPersistenceStatus).toBe("degraded");
      expect(mounted.contextRef.current!.localPersistenceError).toContain(
        "visible only in this tab and is not durably stored",
      );
      expect(cloudRepository.load).not.toHaveBeenCalled();
      expect(mounted.contextRef.current!.data.projects[0].title)
        .not.toBe(cloudData.projects[0].title);
    } finally {
      setItemSpy.mockRestore();
      mounted.unmount();
    }
  });

  it("honors keep-cloud after reload even though local user data remains", async () => {
    const { cloudData } = localAndCloudData();
    markLocalDataCloudAcknowledged();
    const marker = migrationState({
      phase: "complete",
      markerStatus: "keep-cloud",
      completedAt: "2026-08-08T12:30:00.000Z",
      hasLocalData: true,
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "complete",
        markerStatus: "keep-cloud",
        hasLocalData: true,
      });
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Active cloud project");

      act(() => {
        mounted.contextRef.current!.addTask({
          projectId: cloudData.projects[0].id,
          title: "Keep-cloud write",
          details: "",
          type: "maintenance",
          status: "backlog",
          priority: "medium",
          blockedReason: "",
          sourceIdeaId: null,
          acceptanceCriteria: "",
          implementationNotes: "",
          startedAt: null,
          completedAt: null,
        });
      });
      await flushAsyncWork();
      expect(cloudRepository.applyAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: "task_add" }),
        expect.objectContaining({
          type: "task_created",
          actor: "marwan",
          projectId: cloudData.projects[0].id,
          taskId: expect.any(String),
        }),
        expect.objectContaining({ projectId: cloudData.projects[0].id }),
        expect.any(String),
        expect.objectContaining({ version: 1, fingerprint: expect.any(String) }),
      );
    } finally {
      mounted.unmount();
    }
  });

  it("persists an explicit keep-cloud decision and honors it on the next mount", async () => {
    const { cloudData } = localAndCloudData();
    let persistedMarker = migrationState({ markerStatus: "initialized" });
    const cloudRepository = createCloudRepository(cloudData, persistedMarker);
    cloudRepository.getMigrationState = vi.fn(async () => persistedMarker);
    cloudRepository.setMigrationState = vi.fn(async (next) => {
      persistedMarker = next;
    });
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const firstMount = await mountProvider();
    expect(firstMount.contextRef.current!.migrationState.phase).toBe("required");
    await act(async () => {
      await firstMount.contextRef.current!.beginMigrationKeepCloud();
    });
    expect(persistedMarker).toMatchObject({
      phase: "complete",
      markerStatus: "keep-cloud",
      sourceDevice: "web",
    });
    firstMount.unmount();

    const reloaded = await mountProvider();
    try {
      expect(reloaded.contextRef.current!.migrationState).toMatchObject({
        phase: "complete",
        markerStatus: "keep-cloud",
        hasLocalData: true,
      });
      expect(reloaded.contextRef.current!.repositoryMode).toBe("cloud");
      expect(reloaded.contextRef.current!.data.projects[0].title).toBe("Active cloud project");
    } finally {
      reloaded.unmount();
    }
  });

  it("backs up the exact keep-cloud local snapshot even when an older fallback backup exists", async () => {
    const { localData, cloudData } = localAndCloudData();
    const olderFallbackData = seedDashboardData();
    olderFallbackData.projects[0] = {
      ...olderFallbackData.projects[0],
      currentBlocker: "Older pre-fallback backup",
    };
    expect(ensurePreCloudFallbackBackup({ data: olderFallbackData, sourceDevice: "older-fallback" }))
      .not.toBeNull();

    let persistedMarker = migrationState({ markerStatus: "initialized" });
    const cloudRepository = createCloudRepository(cloudData, persistedMarker);
    cloudRepository.getMigrationState = vi.fn(async () => persistedMarker);
    cloudRepository.setMigrationState = vi.fn(async (next) => {
      persistedMarker = next;
    });
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      let result: MigrationState | null = null;
      await act(async () => {
        result = await mounted.contextRef.current!.beginMigrationKeepCloud();
      });
      expect(result).toMatchObject({
        phase: "complete",
        markerStatus: "keep-cloud",
        backupCreated: true,
      });

      const keepCloudBackup = JSON.parse(getLocalDashboardBackupInfo() ?? "null") as {
        dashboardData: DashboardData;
      };
      expect(keepCloudBackup.dashboardData.projects[0].currentBlocker)
        .toBe(localData.projects[0].currentBlocker);

      cloudRepository.applyAction = vi.fn(async () => {
        throw Object.assign(new Error("Later cloud failure"), { code: "unavailable" });
      });
      act(() => {
        mounted.contextRef.current!.addTask({
          projectId: cloudData.projects[0].id,
          title: "Failure after keep-cloud",
          details: "",
          type: "maintenance",
          status: "backlog",
          priority: "medium",
          blockedReason: "",
          sourceIdeaId: null,
          acceptanceCriteria: "",
          implementationNotes: "",
          startedAt: null,
          completedAt: null,
        });
      });
      await flushAsyncWork(32);

      const backupAfterFailure = JSON.parse(getLocalDashboardBackupInfo() ?? "null") as {
        dashboardData: DashboardData;
      };
      const olderPreFallbackBackup = JSON.parse(getPreCloudFallbackBackupInfo() ?? "null") as {
        dashboardData: DashboardData;
      };
      expect(backupAfterFailure.dashboardData.projects[0].currentBlocker)
        .toBe(localData.projects[0].currentBlocker);
      expect(olderPreFallbackBackup.dashboardData.projects[0].currentBlocker)
        .toBe("Older pre-fallback backup");
    } finally {
      mounted.unmount();
    }
  });

  it("does not acknowledge local work created while keep-cloud is being persisted", async () => {
    const { cloudData } = localAndCloudData();
    const marker = migrationState({ markerStatus: "initialized" });
    const cloudRepository = createCloudRepository(cloudData, marker);
    let finishMarkerWrite: (() => void) | undefined;
    const markerWrite = new Promise<void>((resolve) => {
      finishMarkerWrite = resolve;
    });
    cloudRepository.setMigrationState = vi.fn(() => markerWrite);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      let migrationPromise: Promise<MigrationState | null> | undefined;
      act(() => {
        migrationPromise = mounted.contextRef.current!.beginMigrationKeepCloud();
      });
      await flushAsyncWork();
      expect(cloudRepository.setMigrationState).toHaveBeenCalledOnce();

      act(() => {
        mounted.contextRef.current!.addNote({
          projectId: mounted.contextRef.current!.data.projects[0].id,
          title: "Captured during keep-cloud",
          section: "migration",
          tags: [],
          markdown: "This local action must remain visible and unacknowledged.",
        });
      });
      await flushAsyncWork();

      let result: MigrationState | null | undefined;
      await act(async () => {
        finishMarkerWrite!();
        result = await migrationPromise!;
      });

      expect(result).toBeNull();
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        error: "Local data changed while the migration choice was being saved.",
      });
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.notes.some((note) => note.title === "Captured during keep-cloud")).toBe(
        true,
      );
      expect(readPersistedDashboard().notes.some((note) => note.title === "Captured during keep-cloud")).toBe(true);
      expect(cloudRepository.load).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it("does not acknowledge local work created while importData is running", async () => {
    const { cloudData } = localAndCloudData();
    const marker = migrationState({ markerStatus: "initialized" });
    const importedMarker = migrationState({
      phase: "complete",
      markerStatus: "import_complete",
      completedAt: "2026-08-08T14:00:00.000Z",
      hasLocalData: true,
      hasCloudData: true,
    });
    const cloudRepository = createCloudRepository(cloudData, marker);
    let finishImport: ((nextState: MigrationState) => void) | undefined;
    const importResult = new Promise<MigrationState>((resolve) => {
      finishImport = resolve;
    });
    cloudRepository.importData = vi.fn(() => importResult);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      let migrationPromise: Promise<MigrationState | null> | undefined;
      act(() => {
        migrationPromise = mounted.contextRef.current!.beginMigrationImport();
      });
      await flushAsyncWork();
      expect(cloudRepository.importData).toHaveBeenCalledOnce();

      act(() => {
        mounted.contextRef.current!.addNote({
          projectId: mounted.contextRef.current!.data.projects[0].id,
          title: "Captured during import",
          section: "migration",
          tags: [],
          markdown: "This action was created after the import snapshot.",
        });
      });
      await flushAsyncWork();

      let result: MigrationState | null | undefined;
      await act(async () => {
        finishImport!(importedMarker);
        result = await migrationPromise!;
      });

      expect(result).toBeNull();
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        error: "Local data changed while the migration import was running.",
      });
      expect(mounted.contextRef.current!.repositoryMode).toBe("local");
      expect(mounted.contextRef.current!.data.notes.some((note) => note.title === "Captured during import")).toBe(true);
      expect(readPersistedDashboard().notes.some((note) => note.title === "Captured during import")).toBe(true);
      expect(cloudRepository.load).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });

  it.each([
    {
      label: "failed",
      marker: migrationState({
        phase: "error",
        markerStatus: "import_failed",
        error: "Interrupted import",
        startedAt: "2026-08-08T13:00:00.000Z",
      }),
    },
    {
      label: "incomplete",
      marker: migrationState({
        phase: "running",
        markerStatus: "importing",
        startedAt: "2026-08-08T13:00:00.000Z",
      }),
    },
  ])("recovers a $label migration by requiring a safe choice and retaining local mode", async ({ marker }) => {
    const { cloudData } = localAndCloudData();
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.migrationState.phase).toBe("required");
      expect(mounted.contextRef.current!.migrationState.markerStatus).toBe(marker.markerStatus);
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Retained local project");

      act(() => {
        mounted.contextRef.current!.runQuickCapture({
          projectId: mounted.contextRef.current!.data.projects[0].id,
          text: `Local recovery capture for ${marker.markerStatus}`,
          classification: "note",
        });
      });
      await flushAsyncWork();
      expect(cloudRepository.applyAction).not.toHaveBeenCalled();
      expect(readPersistedDashboard().notes.some((note) => note.markdown.includes("Local recovery capture"))).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  it("requires migration on the first authenticated startup with local user data", async () => {
    const { cloudData } = localAndCloudData();
    const marker = migrationState({ markerStatus: "initialized" });
    const cloudRepository = createCloudRepository(cloudData, marker);
    fixtures.createFirestoreRepository.mockResolvedValue(cloudRepository);

    const mounted = await mountProvider();
    try {
      expect(mounted.contextRef.current!.migrationState).toMatchObject({
        phase: "required",
        markerStatus: "initialized",
        hasLocalData: true,
        hasCloudData: true,
      });
      expect(mounted.contextRef.current!.data.projects[0].title).toBe("Retained local project");
      expect(cloudRepository.load).not.toHaveBeenCalled();
    } finally {
      mounted.unmount();
    }
  });
});
