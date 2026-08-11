import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_VERSION } from "../src/lib/constants";
import {
  CloudMutationConflictError,
  createFirestoreRepository,
  mapActivity,
  mapCodexPrompt,
  mapIdea,
  mapProject,
  mapSession,
} from "../src/lib/repositories/firestoreAdapter";
import { createCloudMutationContract } from "../src/lib/repositories/cloudMutationContract";
import { dashboardReducer } from "../src/lib/repositories/reducer";
import { seedDashboardData } from "../src/lib/seed";
import type { DashboardData } from "../src/lib/models";
import type { DashboardAction, ProjectRecencyTouch } from "../src/lib/repositories/types";

type MockRef = { path: string };

type MockBatch = {
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
};

type MockTransaction = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const {
  collectionMock,
  docMock,
  getDocMock,
  getDocsMock,
  runTransactionMock,
  setDocMock,
  writeBatchMock,
  updateDocMock,
  deleteDocMock,
  initializeFirebaseFirestorePersistenceMock,
  onSnapshotMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  docMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  runTransactionMock: vi.fn(),
  setDocMock: vi.fn(),
  writeBatchMock: vi.fn(),
  updateDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
  initializeFirebaseFirestorePersistenceMock: vi.fn(),
  onSnapshotMock: vi.fn((...args: unknown[]) => {
    void args;
    return () => undefined;
  }),
}));

vi.mock("firebase/firestore", () => ({
  collection: collectionMock,
  doc: docMock,
  getDoc: getDocMock,
  getDocs: getDocsMock,
  runTransaction: runTransactionMock,
  setDoc: setDocMock,
  updateDoc: updateDocMock,
  deleteDoc: deleteDocMock,
  onSnapshot: onSnapshotMock,
  writeBatch: writeBatchMock,
  serverTimestamp: () => "server-timestamp",
  Timestamp: class MockFirestoreTimestamp {
    private readonly value: Date;

    constructor(value: Date | number = new Date(0), nanoseconds = 0) {
      this.value = value instanceof Date
        ? value
        : new Date(value * 1000 + nanoseconds / 1_000_000);
    }

    toDate() {
      return this.value;
    }

    static now() {
      return new MockFirestoreTimestamp(new Date());
    }

    static fromDate(value: Date) {
      return new MockFirestoreTimestamp(value);
    }

    static fromMillis(value: number) {
      return new MockFirestoreTimestamp(new Date(value));
    }
  },
}));

vi.mock("../src/lib/firebase/client", () => ({
  getFirebaseClient: vi.fn(),
  initializeFirebaseFirestorePersistence: initializeFirebaseFirestorePersistenceMock,
}));

import { getFirebaseClient } from "../src/lib/firebase/client";

const makeDocSnapshot = (exists: boolean, data?: Record<string, unknown>) => ({
  exists: () => exists,
  data: () => data ?? {},
});

type MockQueryDocumentSnapshot = {
  id: string;
  data: () => Record<string, unknown>;
};

type MockQuerySnapshot = {
  size: number;
  docs: Array<MockQueryDocumentSnapshot>;
  forEach: (callback: (entry: MockQueryDocumentSnapshot) => void) => void;
};

const makeQuerySnapshot = (ids: string[]) => ({
  size: ids.length,
  docs: ids.map((id) => ({
    id,
    data: () => ({ id }),
  })),
  forEach: (callback: (entry: MockQueryDocumentSnapshot) => void) => {
    ids.forEach((id) => callback({ id, data: () => ({ id }) }));
  },
}) as MockQuerySnapshot;

const installDocumentQueries = (documents: Map<string, Record<string, unknown>>) => {
  getDocsMock.mockImplementation((ref: MockRef) => {
    const prefix = `${ref.path}/`;
    const docs = Array.from(documents.entries())
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({
        id: path.slice(prefix.length),
        data: () => data,
      }));

    return Promise.resolve({
      size: docs.length,
      docs,
      forEach: (callback: (entry: MockQueryDocumentSnapshot) => void) => docs.forEach(callback),
    } as MockQuerySnapshot);
  });
};

const dashboardDocuments = (uid: string, data: DashboardData) => {
  const documents = new Map<string, Record<string, unknown>>();
  const add = (
    collectionName: string,
    rows: Array<Record<string, unknown>>,
    getId: (row: Record<string, unknown>) => string = (row) => String(row.id),
  ) => {
    rows.forEach((row) => {
      const stored = { ...row };
      delete stored.id;
      documents.set(`users/${uid}/${collectionName}/${getId(row)}`, stored);
    });
  };

  add("projects", data.projects as unknown as Array<Record<string, unknown>>);
  add("ideas", data.ideas as unknown as Array<Record<string, unknown>>);
  add("tasks", data.tasks as unknown as Array<Record<string, unknown>>);
  add("brainDumps", data.brainDumps as unknown as Array<Record<string, unknown>>);
  add(
    "scratchpads",
    data.scratchpads as unknown as Array<Record<string, unknown>>,
    (row) => String(row.projectId),
  );
  add(
    "architectureDecisions",
    data.architectureDecisions as unknown as Array<Record<string, unknown>>,
  );
  add("codexPrompts", data.codexPrompts as unknown as Array<Record<string, unknown>>);
  add("notes", data.notes as unknown as Array<Record<string, unknown>>);
  add("links", data.importantLinks as unknown as Array<Record<string, unknown>>);
  add("sessions", data.developmentSessions as unknown as Array<Record<string, unknown>>);
  add("activity", data.activities as unknown as Array<Record<string, unknown>>);
  return documents;
};

const installSerializedTransactionStore = (
  documents: Map<string, Record<string, unknown>>,
  transactions: MockTransaction[] = [],
) => {
  let transactionTail = Promise.resolve();

  runTransactionMock.mockImplementation(
    async (
      _db: unknown,
      updateFunction: (transaction: MockTransaction) => Promise<unknown> | unknown,
    ) => {
      let releaseTransaction: () => void = () => undefined;
      const previousTransaction = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      await previousTransaction;

      const pendingOperations: Array<() => void> = [];
      const transaction: MockTransaction = {
        get: vi.fn(async (ref: MockRef) =>
          makeDocSnapshot(documents.has(ref.path), documents.get(ref.path))),
        set: vi.fn((
          ref: MockRef,
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          pendingOperations.push(() => {
            const current = options?.merge ? documents.get(ref.path) ?? {} : {};
            documents.set(ref.path, { ...current, ...data });
          });
        }),
        update: vi.fn((ref: MockRef, data: Record<string, unknown>) => {
          pendingOperations.push(() => {
            documents.set(ref.path, { ...(documents.get(ref.path) ?? {}), ...data });
          });
        }),
        delete: vi.fn((ref: MockRef) => {
          pendingOperations.push(() => {
            documents.delete(ref.path);
          });
        }),
      };
      transactions.push(transaction);

      try {
        const result = await updateFunction(transaction);
        pendingOperations.forEach((operation) => operation());
        return result;
      } finally {
        releaseTransaction();
      }
    },
  );
};

const collectionNameFromPath = (path: string) => {
  const match = /^users\/[^/]+\/(.+)$/.exec(path);
  if (!match) {
    return null;
  }

  const suffix = match[1];
  return suffix.includes("/") ? suffix.split("/")[0] : suffix;
};

describe("firestore adapter ownership", () => {
  beforeEach(() => {
    collectionMock.mockImplementation((...args: unknown[]) => {
      return { path: args.slice(1).join("/") };
    });

    docMock.mockImplementation((...args: unknown[]) => {
      return { path: args.slice(1).join("/") };
    });

    getDocsMock.mockReset();
    runTransactionMock.mockReset();
    getDocMock.mockReset();
    setDocMock.mockReset();
    writeBatchMock.mockReset();
    updateDocMock.mockReset();
    deleteDocMock.mockReset();
    initializeFirebaseFirestorePersistenceMock.mockReset();
    initializeFirebaseFirestorePersistenceMock.mockResolvedValue({
      state: "enabled",
      reason: null,
    });
    onSnapshotMock.mockClear();
    (getFirebaseClient as ReturnType<typeof vi.fn>).mockReset();
  });

  it("rejects repository creation when no user is signed in", async () => {
    (getFirebaseClient as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { currentUser: null },
      db: {},
    });

    await expect(createFirestoreRepository("u-auth"))
      .rejects.toThrow("Authenticated user does not match repository owner.");
  });

  it("rejects repository creation for a different authenticated user", async () => {
    (getFirebaseClient as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { currentUser: { uid: "other-user" } },
      db: {},
    });

    await expect(createFirestoreRepository("target-user")).rejects.toThrow(
      "Authenticated user does not match repository owner.",
    );
  });
});

describe("firestore adapter import behavior", () => {
  it("hydrates Codex source metadata and authored session context without trimming it", () => {
    const seeded = seedDashboardData();
    const externalSessionId = "codex:session/2026-08-11_01";
    const session = mapSession(seeded.developmentSessions[0].id, {
      ...seeded.developmentSessions[0],
      source: "codex",
      externalSessionId,
      branch: "feature/codex-ingestion",
      completedItems: ["  completed with indentation\n"],
      unfinishedItems: ["unfinished  "],
      currentBlocker: "  blocker context\n",
    });
    const prompt = mapCodexPrompt(seeded.codexPrompts[0].id, {
      ...seeded.codexPrompts[0],
      source: "codex",
      externalSessionId,
      relatedSessionId: seeded.developmentSessions[0].id,
      prompt: "  indented\n    child\n\n",
    });
    const idea = mapIdea(seeded.ideas[0].id, {
      ...seeded.ideas[0],
      source: "Codex",
      externalSessionId,
    });
    const activity = mapActivity("dddddddd-1111-4111-8111-111111111112", {
      projectId: seeded.projects[0].id,
      type: "session_completed",
      summary: "Codex session completed",
      entityType: "session",
      entityId: seeded.developmentSessions[0].id,
      metadata: "{\"source\":\"codex\"}",
      source: "codex",
      externalSessionId,
      createdAt: "2026-08-11T13:00:00.000Z",
    });

    expect(session).toMatchObject({
      source: "codex",
      externalSessionId,
      branch: "feature/codex-ingestion",
      completedItems: ["  completed with indentation\n"],
      unfinishedItems: ["unfinished  "],
      currentBlocker: "  blocker context\n",
    });
    expect(prompt?.prompt).toBe("  indented\n    child\n\n");
    expect(prompt?.relatedSessionId).toBe(seeded.developmentSessions[0].id);
    expect(idea?.externalSessionId).toBe(externalSessionId);
    expect(activity).toMatchObject({ source: "codex", externalSessionId });
  });

  it("maps GitHub project metadata losslessly without inventing manual activity", () => {
    const mapped = mapProject("90000000-0000-4000-8000-000000000090", {
      title: "Private workbench",
      slug: "private-workbench",
      purpose: "Imported repository workbench",
      status: "active",
      manualStatus: "planning",
      currentBranch: "main",
      currentObjective: "Keep manual objective",
      currentBlocker: "",
      nextRecommendedTask: "Review import",
      externalSources: {
        github: {
          sourceType: "github",
          externalRepositoryId: "900090",
          ownerLogin: "dashboard-owner",
          repositoryName: "private-workbench",
          repositoryFullName: "dashboard-owner/private-workbench",
          repositoryUrl: "https://github.com/dashboard-owner/private-workbench",
          defaultBranch: "main",
          visibility: "internal",
          isArchived: true,
          isFork: true,
          description: "Imported repository workbench",
          primaryLanguage: "TypeScript",
          topics: ["dashboard"],
          createdDate: "2026-01-01T00:00:00.000Z",
          updatedDate: "2026-08-01T00:00:00.000Z",
          pushedDate: "2026-07-31T00:00:00.000Z",
          latestKnownPersonalCommitDate: null,
          latestKnownPersonalCommitMessage: null,
          lastWorkedAt: "2026-08-01T00:00:00.000Z",
          lastWorkedAtSource: "repository_updated",
          openIssueCount: null,
          openPullRequestCount: null,
          synchronizationTimestamp: "2026-08-05T00:00:00.000Z",
          synchronizationStatus: "success",
          sourceError: null,
          firebaseAssociation: {
            status: "detected",
            evidence: ".firebaserc: dashboard-staging",
            detectedAt: "2026-08-05T00:00:00.000Z",
          },
        },
      },
      externalActivityStatus: "active_recently",
      externalActivityUpdatedAt: "2026-08-05T00:00:00.000Z",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });

    expect(mapped?.manualStatus).toBe("planning");
    expect(mapped?.externalSources?.github?.visibility).toBe("internal");
    expect(mapped?.externalSources?.github?.lastWorkedAtSource).toBe("repository_updated");
    expect(mapped?.externalActivityStatus).toBe("active_recently");
    expect(mapped?.lastWorkedAt).toBeUndefined();
  });

  it("recovers a legacy GitHub project with a blank purpose in memory only", () => {
    const snapshot = {
      title: "Time Left To Live",
      slug: "timelefttolive",
      purpose: "",
      status: "active",
      manualStatus: "active",
      currentBranch: "main",
      currentObjective: "",
      currentBlocker: "",
      nextRecommendedTask: "",
      externalSources: {
        github: {
          sourceType: "github",
          externalRepositoryId: "900091",
          ownerLogin: "dashboard-owner",
          repositoryName: "timelefttolive",
          repositoryFullName: "dashboard-owner/timelefttolive",
          repositoryUrl: "https://github.com/dashboard-owner/timelefttolive",
          defaultBranch: "main",
          visibility: "private",
          isArchived: false,
          isFork: false,
          description: "",
          primaryLanguage: "JavaScript",
          topics: [],
          createdDate: "2026-01-01T00:00:00.000Z",
          updatedDate: "2026-08-01T00:00:00.000Z",
          pushedDate: "2026-07-31T00:00:00.000Z",
          latestKnownPersonalCommitDate: null,
          latestKnownPersonalCommitMessage: null,
          lastWorkedAt: "2026-08-01T00:00:00.000Z",
          lastWorkedAtSource: "repository_updated",
          openIssueCount: null,
          openPullRequestCount: null,
          synchronizationTimestamp: "2026-08-05T00:00:00.000Z",
          synchronizationStatus: "success",
          sourceError: null,
          firebaseAssociation: {
            status: "detected",
            evidence: ".firebaserc: dashboard-staging",
            detectedAt: "2026-08-05T00:00:00.000Z",
          },
        },
      },
      externalActivityStatus: "active_recently",
      externalActivityUpdatedAt: "2026-08-05T00:00:00.000Z",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    };

    const recovered = mapProject("90000000-0000-4000-8000-000000000091", snapshot);
    const manual = mapProject("90000000-0000-4000-8000-000000000092", {
      ...snapshot,
      purpose: "Manual dashboard purpose",
    });

    expect(recovered?.purpose).toBe("GitHub repository dashboard-owner/timelefttolive.");
    expect(recovered?.externalSources?.github?.description).toBe("");
    expect(manual?.purpose).toBe("Manual dashboard purpose");
  });

  it("continues to reject a non-GitHub project with a blank purpose", () => {
    const project = seedDashboardData().projects[0];
    expect(mapProject(project.id, { ...project, purpose: "", externalSources: undefined })).toBeNull();
  });

  const uid = "u-auth";

  beforeEach(() => {
    collectionMock.mockClear();
    collectionMock.mockImplementation((...args: unknown[]) => {
      return { path: args.slice(1).join("/") };
    });
    docMock.mockClear();
    docMock.mockImplementation((...args: unknown[]) => {
      return { path: args.slice(1).join("/") };
    });
    getDocMock.mockReset();
    getDocsMock.mockReset();
    runTransactionMock.mockReset();
    setDocMock.mockReset();
    writeBatchMock.mockReset();
    updateDocMock.mockReset();
    deleteDocMock.mockReset();
    initializeFirebaseFirestorePersistenceMock.mockReset();
    initializeFirebaseFirestorePersistenceMock.mockResolvedValue({
      state: "enabled",
      reason: null,
    });
    onSnapshotMock.mockClear();

    (getFirebaseClient as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { currentUser: { uid } },
      db: {},
    });

    const collectionToExistingIds: Record<string, Set<string>> = {
      projects: new Set([seedDashboardData().projects[0].id]),
      ideas: new Set<string>(),
      tasks: new Set<string>(),
      brainDumps: new Set<string>(),
      scratchpads: new Set<string>(),
      architectureDecisions: new Set<string>(),
      codexPrompts: new Set<string>(),
      notes: new Set<string>(),
      links: new Set<string>(),
      sessions: new Set<string>(),
      activity: new Set<string>(),
    };

    getDocMock.mockImplementation((ref: MockRef) => {
      if (ref.path === `users/${uid}`) {
        return Promise.resolve(makeDocSnapshot(true, { createdAt: "ts" }));
      }

      return Promise.resolve(makeDocSnapshot(false));
    });

    getDocsMock.mockImplementation((ref: MockRef) => {
      const collectionName = collectionNameFromPath(ref.path);
      const ids = collectionName ? collectionToExistingIds[collectionName] : new Set<string>();
      return Promise.resolve(makeQuerySnapshot(Array.from(ids ?? new Set<string>())));
    });

    runTransactionMock.mockImplementation(
      async (
        _db: unknown,
        updateFunction: (transaction: MockTransaction) => Promise<unknown> | unknown,
      ) => updateFunction({
        get: vi.fn(async () => makeDocSnapshot(false)),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }),
    );
  });

  it("initializes persistence before repository reads and listeners", async () => {
    let releasePersistence: () => void = () => undefined;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });

    initializeFirebaseFirestorePersistenceMock.mockImplementation(async () => {
      await persistenceGate;
      return { state: "enabled", reason: null };
    });

    const repositoryPromise = createFirestoreRepository(uid);
    await Promise.resolve();

    expect(initializeFirebaseFirestorePersistenceMock).toHaveBeenCalledTimes(1);
    expect(getDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
    expect(onSnapshotMock).not.toHaveBeenCalled();

    releasePersistence();
    const repository = await repositoryPromise;

    expect(getDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
    expect(onSnapshotMock).not.toHaveBeenCalled();

    await repository.load();
    const unsubscribe = repository.subscribe(() => undefined);
    unsubscribe();

    expect(getDocsMock).toHaveBeenCalled();
    expect(onSnapshotMock).toHaveBeenCalled();
    expect(
      initializeFirebaseFirestorePersistenceMock.mock.invocationCallOrder[0],
    ).toBeLessThan(getDocsMock.mock.invocationCallOrder[0]);
    expect(
      initializeFirebaseFirestorePersistenceMock.mock.invocationCallOrder[0],
    ).toBeLessThan(onSnapshotMock.mock.invocationCallOrder[0]);
  });

  it("keeps listener data authoritative when a separately started bootstrap load resolves later", async () => {
    const collectionNames = [
      "projects",
      "ideas",
      "tasks",
      "brainDumps",
      "scratchpads",
      "architectureDecisions",
      "codexPrompts",
      "notes",
      "links",
      "sessions",
      "activity",
    ] as const;
    const olderBootstrap = seedDashboardData();
    olderBootstrap.projects[0] = {
      ...olderBootstrap.projects[0],
      title: "Older delayed bootstrap",
    };
    const newerRealtime = structuredClone(olderBootstrap);
    newerRealtime.projects[0] = {
      ...newerRealtime.projects[0],
      title: "Newer listener snapshot",
    };
    const olderDocuments = dashboardDocuments(uid, olderBootstrap);
    const newerDocuments = dashboardDocuments(uid, newerRealtime);
    const loadGates = new Map<string, {
      promise: Promise<MockQuerySnapshot>;
      resolve: (snapshot: MockQuerySnapshot) => void;
    }>();
    for (const collectionName of collectionNames) {
      let resolve!: (snapshot: MockQuerySnapshot) => void;
      const promise = new Promise<MockQuerySnapshot>((resolvePromise) => {
        resolve = resolvePromise;
      });
      loadGates.set(collectionName, { promise, resolve });
    }
    const listenerCallbacks = new Map<string, (snapshot: MockQuerySnapshot) => void>();
    const snapshotFor = (
      documents: Map<string, Record<string, unknown>>,
      collectionName: string,
    ): MockQuerySnapshot => {
      const prefix = `users/${uid}/${collectionName}/`;
      const docs = Array.from(documents.entries())
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, data]) => ({
          id: path.slice(prefix.length),
          data: () => data,
        }));
      return {
        size: docs.length,
        docs,
        forEach: (callback: (entry: MockQueryDocumentSnapshot) => void) => docs.forEach(callback),
      };
    };

    getDocsMock.mockImplementation((ref: MockRef) => {
      const collectionName = collectionNameFromPath(ref.path)!;
      return loadGates.get(collectionName)!.promise;
    });
    onSnapshotMock.mockImplementation((...args: unknown[]) => {
      const ref = args[0] as MockRef;
      const onChange = args[1] as (snapshot: MockQuerySnapshot) => void;
      listenerCallbacks.set(collectionNameFromPath(ref.path)!, onChange);
      return () => undefined;
    });

    const repository = await createFirestoreRepository(uid);
    const delayedBootstrap = repository.load();
    const realtimeSnapshots: DashboardData[] = [];
    const unsubscribe = repository.subscribe((snapshot) => realtimeSnapshots.push(snapshot));

    for (const collectionName of collectionNames) {
      listenerCallbacks.get(collectionName)?.(snapshotFor(newerDocuments, collectionName));
    }
    expect(realtimeSnapshots.at(-1)?.projects[0].title).toBe("Newer listener snapshot");

    for (const collectionName of collectionNames) {
      loadGates.get(collectionName)?.resolve(snapshotFor(olderDocuments, collectionName));
    }
    const loaded = await delayedBootstrap;
    await Promise.resolve();
    await Promise.resolve();

    expect(loaded.projects[0].title).toBe("Older delayed bootstrap");
    expect(realtimeSnapshots.at(-1)?.projects[0].title).toBe("Newer listener snapshot");
    expect(getDocsMock).toHaveBeenCalledTimes(collectionNames.length);
    unsubscribe();
  });

  it("continues repository initialization when native persistence is unavailable", async () => {
    initializeFirebaseFirestorePersistenceMock.mockResolvedValue({
      state: "unavailable",
      reason: "unsupported",
    });

    const repository = await createFirestoreRepository(uid);

    expect(initializeFirebaseFirestorePersistenceMock).toHaveBeenCalledTimes(1);
    await expect(repository.load()).resolves.toMatchObject({
      schemaVersion: SCHEMA_VERSION,
    });
  });

  it("stops repository initialization when authentication changes during persistence setup", async () => {
    const auth = { currentUser: { uid } };
    (getFirebaseClient as ReturnType<typeof vi.fn>).mockReturnValue({ auth, db: {} });
    let releasePersistence: () => void = () => undefined;
    initializeFirebaseFirestorePersistenceMock.mockImplementation(() => new Promise((resolve) => {
      releasePersistence = () => resolve({ state: "enabled", reason: null });
    }));

    const repository = createFirestoreRepository(uid);
    await Promise.resolve();
    auth.currentUser = { uid: "different-user" };
    releasePersistence();

    await expect(repository).rejects.toThrow(
      "Authentication changed while initializing the repository.",
    );
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it("returns a cache-capable repository without waiting for a profile document write", async () => {
    const repository = await createFirestoreRepository(uid);

    expect(getDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
    await expect(repository.load()).resolves.toMatchObject({
      schemaVersion: SCHEMA_VERSION,
    });
    const unsubscribe = repository.subscribe(() => undefined);
    unsubscribe();
    expect(getDocsMock).toHaveBeenCalled();
    expect(onSnapshotMock).toHaveBeenCalled();
  });

  it("omits undefined optional migration fields from Firestore writes", async () => {
    const repo = await createFirestoreRepository(uid);
    const nextState = {
      phase: "complete" as const,
      hasLocalData: true,
      hasCloudData: true,
      localRecordCounts: { projects: 1 },
      cloudRecordCounts: { projects: 1 },
      markerStatus: "keep-cloud",
      error: null,
      startedAt: "2026-08-07T12:00:00.000Z",
      completedAt: "2026-08-07T12:01:00.000Z",
      version: 1,
    };

    await repo.setMigrationState(nextState);

    const payload = setDocMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      markerStatus: "keep-cloud",
      localStorageKey: "developer-dashboard:data:v1",
    });
    expect("sourceDevice" in payload).toBe(false);
    expect(Object.values(payload)).not.toContain(undefined);
  });

  it("treats all-zero collection counts as no cloud data", async () => {
    getDocsMock.mockResolvedValue(makeQuerySnapshot([]));
    const repo = await createFirestoreRepository(uid);

    const [migrationState, hasData] = await Promise.all([
      repo.getMigrationState(),
      repo.hasData(),
    ]);

    expect(migrationState.hasCloudData).toBe(false);
    expect(Object.values(migrationState.cloudRecordCounts).every((count) => count === 0)).toBe(true);
    expect(hasData).toBe(false);
  });

  it("round-trips migration reconciliation metadata", async () => {
    getDocMock.mockImplementation((ref: MockRef) => {
      if (ref.path === `users/${uid}`) {
        return Promise.resolve(makeDocSnapshot(true, { createdAt: "ts" }));
      }
      if (ref.path === `users/${uid}/migrationState/localStorageV1`) {
        return Promise.resolve(makeDocSnapshot(true, {
          phase: "complete",
          markerStatus: "import_complete",
          reconciliationRequired: true,
          reconciliationReason: "Existing remote IDs were skipped.",
        }));
      }
      return Promise.resolve(makeDocSnapshot(false));
    });
    const repo = await createFirestoreRepository(uid);

    await expect(repo.getMigrationState()).resolves.toMatchObject({
      reconciliationRequired: true,
      reconciliationReason: "Existing remote IDs were skipped.",
    });
  });

  it("preserves user-authored whitespace exactly during Firestore hydration", async () => {
    const seed = seedDashboardData();
    const exact = "  indented\n    child\n\n";
    const leadingBlank = "\nfirst line\nsecond line";
    const trailingSpaces = "value with trailing spaces   ";
    const project = { ...seed.projects[0], currentObjective: exact };
    const task = {
      ...seed.tasks[0],
      details: exact,
      acceptanceCriteria: trailingSpaces,
      implementationNotes: leadingBlank,
    };
    const scratchpad = {
      projectId: seed.projects[0].id,
      markdown: `${leadingBlank}\n${exact}`,
      updatedAt: "2026-08-10T18:00:00.000Z",
    };
    const prompt = { ...seed.codexPrompts[0], prompt: `${exact}${trailingSpaces}\n` };
    const note = { ...seed.notes[0], markdown: `\n${exact}${trailingSpaces}\n` };
    const session = { ...seed.developmentSessions[0], notes: `${leadingBlank}\n\n${trailingSpaces}` };
    const brainDump = { ...seed.brainDumps[0], text: `${exact}${trailingSpaces}` };
    const decision = { ...seed.architectureDecisions[0], decision: `\n${exact}` };

    const withoutId = (value: Record<string, unknown>) => {
      const copy = { ...value };
      delete copy.id;
      return copy;
    };
    const documents = new Map<string, Record<string, unknown>>([
      [`users/${uid}/projects/${project.id}`, withoutId(project as unknown as Record<string, unknown>)],
      [`users/${uid}/tasks/${task.id}`, withoutId(task as unknown as Record<string, unknown>)],
      [
        `users/${uid}/scratchpads/${scratchpad.projectId}`,
        scratchpad as unknown as Record<string, unknown>,
      ],
      [`users/${uid}/codexPrompts/${prompt.id}`, withoutId(prompt as unknown as Record<string, unknown>)],
      [`users/${uid}/notes/${note.id}`, withoutId(note as unknown as Record<string, unknown>)],
      [`users/${uid}/sessions/${session.id}`, withoutId(session as unknown as Record<string, unknown>)],
      [`users/${uid}/brainDumps/${brainDump.id}`, withoutId(brainDump as unknown as Record<string, unknown>)],
      [
        `users/${uid}/architectureDecisions/${decision.id}`,
        withoutId(decision as unknown as Record<string, unknown>),
      ],
    ]);
    installDocumentQueries(documents);

    const repository = await createFirestoreRepository(uid);
    const hydrated = await repository.load();

    expect(hydrated.projects[0].currentObjective).toBe(exact);
    expect(hydrated.tasks[0]).toMatchObject({
      details: exact,
      acceptanceCriteria: trailingSpaces,
      implementationNotes: leadingBlank,
    });
    expect(hydrated.scratchpads[0].markdown).toBe(`${leadingBlank}\n${exact}`);
    expect(hydrated.codexPrompts[0].prompt).toBe(`${exact}${trailingSpaces}\n`);
    expect(hydrated.notes[0].markdown).toBe(`\n${exact}${trailingSpaces}\n`);
    expect(hydrated.developmentSessions[0].notes).toBe(`${leadingBlank}\n\n${trailingSpaces}`);
    expect(hydrated.brainDumps[0].text).toBe(`${exact}${trailingSpaces}`);
    expect(hydrated.architectureDecisions[0].decision).toBe(`\n${exact}`);
  });

  it("replays a rejected guarded write once against its recorded base", async () => {
    const base = seedDashboardData();
    const taskId = base.tasks[0].id;
    const action: DashboardAction = {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Recovered once" } },
    };
    const projected = dashboardReducer(base, action);
    const contract = createCloudMutationContract(base, projected);
    const documents = dashboardDocuments(uid, base);
    installDocumentQueries(documents);
    const repository = await createFirestoreRepository(uid);

    runTransactionMock.mockRejectedValueOnce(new Error("write rejected before commit"));
    await expect(repository.applyAction(action, undefined, undefined, "rejected-once", contract))
      .rejects.toThrow("write rejected before commit");
    expect(documents.get(`users/${uid}/tasks/${taskId}`)?.details).not.toBe("Recovered once");

    installSerializedTransactionStore(documents);
    await repository.applyAction(action, undefined, undefined, "rejected-once", contract);
    expect(documents.get(`users/${uid}/tasks/${taskId}`)?.details).toBe("Recovered once");
    expect(documents.has(`users/${uid}/reconciliationReceipts/rejected-once`)).toBe(true);
  });

  it("uses an immutable receipt after an acknowledged write is lost and never rewrites newer data", async () => {
    const base = seedDashboardData();
    const taskId = base.tasks[0].id;
    const taskPath = `users/${uid}/tasks/${taskId}`;
    const action: DashboardAction = {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Originally committed" } },
    };
    const projected = dashboardReducer(base, action);
    const contract = createCloudMutationContract(base, projected);
    const documents = dashboardDocuments(uid, base);
    const transactions: MockTransaction[] = [];
    installDocumentQueries(documents);
    installSerializedTransactionStore(documents, transactions);
    const repository = await createFirestoreRepository(uid);

    await repository.applyAction(action, undefined, undefined, "ambiguous-commit", contract);
    documents.set(taskPath, {
      ...documents.get(taskPath),
      details: "Newer edit from another client",
      updatedAt: "2026-08-10T20:00:00.000Z",
    });
    await repository.applyAction(action, undefined, undefined, "ambiguous-commit", contract);

    expect(documents.get(taskPath)?.details).toBe("Newer edit from another client");
    expect(transactions).toHaveLength(2);
    expect(transactions[1].set).not.toHaveBeenCalled();
    expect(transactions[1].update).not.toHaveBeenCalled();
    expect(transactions[1].delete).not.toHaveBeenCalled();
  });

  it("records completion without rewriting when the desired mutation is already reflected", async () => {
    const base = seedDashboardData();
    const taskId = base.tasks[0].id;
    const action: DashboardAction = {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Already reflected" } },
    };
    const projected = dashboardReducer(base, action);
    const contract = createCloudMutationContract(base, projected);
    const documents = dashboardDocuments(uid, projected);
    const transactions: MockTransaction[] = [];
    installSerializedTransactionStore(documents, transactions);
    const repository = await createFirestoreRepository(uid);

    await repository.applyAction(action, undefined, undefined, "already-reflected", contract);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].set).toHaveBeenCalledTimes(1);
    expect((transactions[0].set.mock.calls[0][0] as MockRef).path)
      .toBe(`users/${uid}/reconciliationReceipts/already-reflected`);
    expect(transactions[0].update).not.toHaveBeenCalled();
    expect(transactions[0].delete).not.toHaveBeenCalled();
    expect(documents.get(`users/${uid}/tasks/${taskId}`)?.details).toBe("Already reflected");
  });

  it("refuses stale replay when a targeted remote field or project recency diverged", async () => {
    const base = seedDashboardData();
    const taskId = base.tasks[0].id;
    const projectId = base.projects[0].id;
    const taskPath = `users/${uid}/tasks/${taskId}`;
    const projectPath = `users/${uid}/projects/${projectId}`;
    const action: DashboardAction = {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Stale replay value" } },
    };
    const projected = dashboardReducer(base, action);
    const contract = createCloudMutationContract(base, projected);

    for (const divergence of ["target", "recency"] as const) {
      const documents = dashboardDocuments(uid, base);
      if (divergence === "target") {
        documents.set(taskPath, {
          ...documents.get(taskPath),
          details: "Newer remote task details",
          updatedAt: "2026-08-10T21:00:00.000Z",
        });
      } else {
        documents.set(projectPath, {
          ...documents.get(projectPath),
          updatedAt: "2026-08-10T21:00:00.000Z",
          lastWorkedAt: "2026-08-10T21:00:00.000Z",
        });
      }
      installSerializedTransactionStore(documents);
      const repository = await createFirestoreRepository(uid);

      await expect(repository.applyAction(
        action,
        undefined,
        undefined,
        `diverged-${divergence}`,
        contract,
      )).rejects.toBeInstanceOf(CloudMutationConflictError);
      expect(documents.get(taskPath)?.details).toBe(
        divergence === "target" ? "Newer remote task details" : base.tasks[0].details,
      );
      expect(documents.get(projectPath)?.lastWorkedAt).toBe(
        divergence === "recency" ? "2026-08-10T21:00:00.000Z" : base.projects[0].lastWorkedAt,
      );
      expect(documents.has(`users/${uid}/reconciliationReceipts/diverged-${divergence}`)).toBe(false);
    }
  });

  it("preserves unrelated remote fields while safely applying guarded fields", async () => {
    const base = seedDashboardData();
    const taskId = base.tasks[0].id;
    const taskPath = `users/${uid}/tasks/${taskId}`;
    const action: DashboardAction = {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Guarded detail" } },
    };
    const projected = dashboardReducer(base, action);
    const contract = createCloudMutationContract(base, projected);
    const documents = dashboardDocuments(uid, base);
    documents.set(taskPath, {
      ...documents.get(taskPath),
      blockedReason: "Unrelated remote field stays intact",
    });
    installSerializedTransactionStore(documents);
    const repository = await createFirestoreRepository(uid);

    await repository.applyAction(action, undefined, undefined, "unrelated-field", contract);

    expect(documents.get(taskPath)).toMatchObject({
      details: "Guarded detail",
      blockedReason: "Unrelated remote field stays intact",
    });
  });

  it("refuses a guarded delete when the remote document gained an unrecorded field", async () => {
    const base = seedDashboardData();
    const brainDumpId = base.brainDumps[0].id;
    const brainDumpPath = `users/${uid}/brainDumps/${brainDumpId}`;
    const action: DashboardAction = {
      type: "brain_dump_delete",
      payload: { id: brainDumpId },
    };
    const projected = dashboardReducer(base, action);
    const contract = createCloudMutationContract(base, projected);
    const documents = dashboardDocuments(uid, base);
    documents.set(brainDumpPath, {
      ...documents.get(brainDumpPath),
      newerRemoteField: "must survive stale recovery",
    });
    installSerializedTransactionStore(documents);
    const repository = await createFirestoreRepository(uid);

    await expect(repository.applyAction(
      action,
      undefined,
      undefined,
      "delete-with-newer-field",
      contract,
    )).rejects.toBeInstanceOf(CloudMutationConflictError);

    expect(documents.get(brainDumpPath)?.newerRemoteField)
      .toBe("must survive stale recovery");
    expect(documents.has(`users/${uid}/reconciliationReceipts/delete-with-newer-field`))
      .toBe(false);
  });

  it("builds guarded replay coverage for every replayable Dashboard collection", () => {
    const before = seedDashboardData();
    const after = structuredClone(before);
    after.projects[0].currentObjective = "changed";
    after.ideas[0].description = "changed";
    after.tasks[0].details = "changed";
    after.brainDumps[0].text = "changed";
    after.scratchpads.push({
      projectId: after.projects[0].id,
      markdown: "changed",
      updatedAt: "2026-08-10T19:00:00.000Z",
    });
    after.architectureDecisions[0].decision = "changed";
    after.codexPrompts[0].prompt = "changed";
    after.notes[0].markdown = "changed";
    after.importantLinks[0].notes = "changed";
    after.developmentSessions[0].notes = "changed";
    after.activities.push({
      id: "89000000-0000-4000-8000-000000000001",
      projectId: after.projects[0].id,
      type: "project_created",
      summary: "changed",
      entityType: "project",
      entityId: after.projects[0].id,
      metadata: "",
      createdAt: "2026-08-10T19:00:00.000Z",
    });

    const contract = createCloudMutationContract(before, after);
    expect(new Set(contract.documents.map((document) => document.collection))).toEqual(new Set([
      "projects",
      "ideas",
      "tasks",
      "brainDumps",
      "scratchpads",
      "architectureDecisions",
      "codexPrompts",
      "notes",
      "links",
      "sessions",
      "activity",
    ]));
  });

  it("atomically persists one action with the same activity record and reloads it", async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const batches: MockBatch[] = [];

    getDocsMock.mockImplementation((ref: MockRef) => {
      const prefix = `${ref.path}/`;
      const docs = Array.from(documents.entries())
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, data]) => ({
          id: path.slice(prefix.length),
          data: () => data,
        }));

      return Promise.resolve({
        size: docs.length,
        docs,
        forEach: (callback: (entry: MockQueryDocumentSnapshot) => void) => docs.forEach(callback),
      } as MockQuerySnapshot);
    });

    writeBatchMock.mockImplementation(() => {
      const operations: Array<() => void> = [];
      const batch: MockBatch = {
        set: vi.fn((ref: MockRef, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          operations.push(() => {
            const current = options?.merge ? documents.get(ref.path) ?? {} : {};
            documents.set(ref.path, { ...current, ...data });
          });
        }),
        update: vi.fn((ref: MockRef, data: Record<string, unknown>) => {
          operations.push(() => {
            documents.set(ref.path, { ...(documents.get(ref.path) ?? {}), ...data });
          });
        }),
        delete: vi.fn((ref: MockRef) => {
          operations.push(() => {
            documents.delete(ref.path);
          });
        }),
        commit: vi.fn(async () => {
          operations.forEach((operation) => operation());
        }),
      };
      batches.push(batch);
      return batch;
    });

    const project = {
      ...seedDashboardData().projects[0],
      id: "70000000-0000-4000-8000-000000000007",
      title: "Activity persistence project",
      slug: "activity-persistence-project",
    };
    const activity = {
      id: "89c84c74-f28d-5e09-8dd1-c6e8f5ee1fd2",
      projectId: project.id,
      type: "project_created" as const,
      summary: `Created project ${project.title}`,
      entityType: "project",
      entityId: project.id,
      metadata: "manual",
      createdAt: "2026-08-07T12:00:00.000Z",
    };

    const repo = await createFirestoreRepository(uid);
    await repo.applyAction({ type: "project_upsert", payload: project }, activity);

    expect(batches).toHaveLength(1);
    expect(batches[0].commit).toHaveBeenCalledTimes(1);
    expect(batches[0].set.mock.calls.map((call) => (call[0] as MockRef).path)).toEqual([
      `users/${uid}/projects/${project.id}`,
      `users/${uid}/activity/${activity.id}`,
    ]);

    const activityWrite = batches[0].set.mock.calls[1]?.[1] as Record<string, unknown>;
    const activityFields = { ...activity } as Record<string, unknown>;
    delete activityFields.id;
    expect(activityWrite).toMatchObject(activityFields);
    expect(activityWrite.createdAt).toBe(activity.createdAt);

    const reloaded = await repo.load();
    expect(reloaded.projects.some((entry) => entry.id === project.id)).toBe(true);
    expect(reloaded.activities).toEqual([activity]);
  });

  it("writes parent recency in the same batch for every supported child collection", async () => {
    const batches: MockBatch[] = [];
    writeBatchMock.mockImplementation(() => {
      const batch: MockBatch = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(async () => undefined),
      };
      batches.push(batch);
      return batch;
    });

    const seed = seedDashboardData();
    const projectId = seed.projects[0].id;
    const recency: ProjectRecencyTouch = {
      projectId,
      updatedAt: "2026-08-07T14:00:00.000Z",
      lastWorkedAt: "2026-08-07T14:00:00.000Z",
    };
    const childActions: DashboardAction[] = [
      { type: "idea_add", payload: { ...seed.ideas[0], id: "71000000-0000-4000-8000-000000000001" } },
      { type: "task_add", payload: { ...seed.tasks[0], id: "71000000-0000-4000-8000-000000000002" } },
      { type: "brain_dump_add", payload: { ...seed.brainDumps[0], id: "71000000-0000-4000-8000-000000000003" } },
      { type: "scratchpad_update", payload: { projectId, markdown: "Updated scratchpad" } },
      {
        type: "architecture_decision_upsert",
        payload: { ...seed.architectureDecisions[0], id: "71000000-0000-4000-8000-000000000004" },
      },
      { type: "prompt_upsert", payload: { ...seed.codexPrompts[0], id: "71000000-0000-4000-8000-000000000005" } },
      { type: "note_add", payload: { ...seed.notes[0], id: "71000000-0000-4000-8000-000000000006" } },
      { type: "link_add", payload: { ...seed.importantLinks[0], id: "71000000-0000-4000-8000-000000000007" } },
      {
        type: "session_start",
        payload: {
          ...seed.developmentSessions[0],
          id: "71000000-0000-4000-8000-000000000008",
          status: "active",
          endedAt: null,
        },
      },
    ];

    const repo = await createFirestoreRepository(uid);
    for (const action of childActions) {
      await repo.applyAction(action, undefined, recency);
    }

    expect(batches).toHaveLength(childActions.length);
    for (const batch of batches) {
      expect(batch.commit).toHaveBeenCalledTimes(1);
      expect(batch.update).toHaveBeenCalledWith(
        { path: `users/${uid}/projects/${projectId}` },
        { updatedAt: recency.updatedAt, lastWorkedAt: recency.lastWorkedAt },
      );
      expect(batch.set.mock.calls.length + batch.update.mock.calls.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("retains a child edit and its parent recency for reload and another client", async () => {
    const seed = seedDashboardData();
    const project = seed.projects[0];
    const note = seed.notes[0];
    const projectPath = `users/${uid}/projects/${project.id}`;
    const notePath = `users/${uid}/notes/${note.id}`;
    const projectDocument = { ...project } as Record<string, unknown>;
    const noteDocument = { ...note } as Record<string, unknown>;
    delete projectDocument.id;
    delete noteDocument.id;
    const documents = new Map<string, Record<string, unknown>>([
      [projectPath, projectDocument],
      [notePath, noteDocument],
    ]);
    const batches: MockBatch[] = [];

    getDocsMock.mockImplementation((ref: MockRef) => {
      const prefix = `${ref.path}/`;
      const docs = Array.from(documents.entries())
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => data }));
      return Promise.resolve({
        size: docs.length,
        docs,
        forEach: (callback: (entry: MockQueryDocumentSnapshot) => void) => docs.forEach(callback),
      } as MockQuerySnapshot);
    });
    writeBatchMock.mockImplementation(() => {
      const operations: Array<() => void> = [];
      const batch: MockBatch = {
        set: vi.fn((ref: MockRef, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          operations.push(() => {
            const current = options?.merge ? documents.get(ref.path) ?? {} : {};
            documents.set(ref.path, { ...current, ...data });
          });
        }),
        update: vi.fn((ref: MockRef, data: Record<string, unknown>) => {
          operations.push(() => {
            documents.set(ref.path, { ...(documents.get(ref.path) ?? {}), ...data });
          });
        }),
        delete: vi.fn(),
        commit: vi.fn(async () => operations.forEach((operation) => operation())),
      };
      batches.push(batch);
      return batch;
    });

    const recency: ProjectRecencyTouch = {
      projectId: project.id,
      updatedAt: "2035-08-07T15:00:00.000Z",
      lastWorkedAt: "2035-08-07T15:00:00.000Z",
    };
    expect(Date.parse(recency.updatedAt)).toBeGreaterThan(Date.parse(project.updatedAt));
    const firstClient = await createFirestoreRepository(uid);
    await firstClient.applyAction(
      { type: "note_update", payload: { id: note.id, updates: { markdown: "Edited on the first client" } } },
      undefined,
      recency,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0].commit).toHaveBeenCalledTimes(1);
    expect(batches[0].update.mock.calls.map((call) => (call[0] as MockRef).path)).toEqual([
      notePath,
      projectPath,
    ]);

    const firstReload = await firstClient.load();
    const secondClient = await createFirestoreRepository(uid);
    const secondReload = await secondClient.load();
    for (const snapshot of [firstReload, secondReload]) {
      expect(snapshot.notes.find((entry) => entry.id === note.id)?.markdown).toBe("Edited on the first client");
      expect(snapshot.projects.find((entry) => entry.id === project.id)).toMatchObject({
        updatedAt: recency.updatedAt,
        lastWorkedAt: recency.lastWorkedAt,
      });
    }
  });

  it("persists reducer-owned recency for a direct project edit across snapshots and clients", async () => {
    const seed = seedDashboardData();
    const project = {
      ...seed.projects[0],
      updatedAt: "2025-01-01T00:00:00.000Z",
      lastWorkedAt: "2025-01-01T00:00:00.000Z",
    };
    const projectPath = `users/${uid}/projects/${project.id}`;
    const projectDocument = { ...project } as Record<string, unknown>;
    delete projectDocument.id;
    const documents = new Map<string, Record<string, unknown>>([
      [projectPath, projectDocument],
    ]);
    const batches: MockBatch[] = [];

    const querySnapshotFor = (ref: MockRef): MockQuerySnapshot => {
      const prefix = `${ref.path}/`;
      const docs = Array.from(documents.entries())
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, value]) => ({
          id: path.slice(prefix.length),
          data: () => value,
        }));
      return {
        size: docs.length,
        docs,
        forEach: (callback) => docs.forEach(callback),
      };
    };
    getDocsMock.mockImplementation((ref: MockRef) => Promise.resolve(querySnapshotFor(ref)));
    writeBatchMock.mockImplementation(() => {
      const operations: Array<() => void> = [];
      const batch: MockBatch = {
        set: vi.fn(),
        update: vi.fn((ref: MockRef, value: Record<string, unknown>) => {
          operations.push(() => {
            documents.set(ref.path, { ...(documents.get(ref.path) ?? {}), ...value });
          });
        }),
        delete: vi.fn(),
        commit: vi.fn(async () => operations.forEach((operation) => operation())),
      };
      batches.push(batch);
      return batch;
    });

    const snapshotListeners = new Map<string, (snapshot: MockQuerySnapshot) => void>();
    onSnapshotMock.mockImplementation(
      (...args: unknown[]) => {
        const ref = args[0] as MockRef;
        const onChange = args[1] as (snapshot: MockQuerySnapshot) => void;
        snapshotListeners.set(ref.path, onChange);
        onChange(querySnapshotFor(ref));
        return () => undefined;
      },
    );

    const recency: ProjectRecencyTouch = {
      projectId: project.id,
      updatedAt: "2037-08-10T13:00:00.000Z",
      lastWorkedAt: "2037-08-10T13:00:00.000Z",
    };
    const untrustedAction = {
      type: "project_update",
      payload: {
        id: project.id,
        updates: {
          currentObjective: "Manual edit with durable recency",
          id: "different-project",
          createdAt: "2000-01-01T00:00:00.000Z",
          updatedAt: "2000-01-01T00:00:00.000Z",
          lastWorkedAt: "2000-01-01T00:00:00.000Z",
        },
      },
    } as unknown as DashboardAction;

    const firstClient = await createFirestoreRepository(uid);
    const realtimeSnapshots: DashboardData[] = [];
    const unsubscribe = firstClient.subscribe((snapshot) => realtimeSnapshots.push(snapshot));
    try {
      await firstClient.applyAction(untrustedAction, undefined, recency);

      expect(batches).toHaveLength(1);
      expect(batches[0].commit).toHaveBeenCalledOnce();
      expect(batches[0].update).toHaveBeenCalledOnce();
      expect(batches[0].update).toHaveBeenCalledWith(
        { path: projectPath },
        {
          currentObjective: "Manual edit with durable recency",
          updatedAt: recency.updatedAt,
          lastWorkedAt: recency.lastWorkedAt,
        },
      );

      snapshotListeners.get(`users/${uid}/projects`)?.(
        querySnapshotFor({ path: `users/${uid}/projects` }),
      );
      expect(realtimeSnapshots.at(-1)?.projects[0]).toMatchObject({
        currentObjective: "Manual edit with durable recency",
        updatedAt: recency.updatedAt,
        lastWorkedAt: recency.lastWorkedAt,
      });

      const reloaded = await firstClient.load();
      const secondClient = await createFirestoreRepository(uid);
      const secondClientData = await secondClient.load();
      for (const snapshot of [reloaded, secondClientData]) {
        expect(snapshot.projects[0]).toMatchObject({
          currentObjective: "Manual edit with durable recency",
          updatedAt: recency.updatedAt,
          lastWorkedAt: recency.lastWorkedAt,
        });
      }
    } finally {
      unsubscribe();
      onSnapshotMock.mockImplementation(() => () => undefined);
    }
  });

  it("does not duplicate a session note after an ambiguous committed acknowledgement", async () => {
    const seed = seedDashboardData();
    const project = seed.projects[0];
    const session = seed.developmentSessions[0];
    const operationId = "reconciliation-operation-1";
    const projectPath = `users/${uid}/projects/${project.id}`;
    const sessionPath = `users/${uid}/sessions/${session.id}`;
    const activityId = "74000000-0000-4000-8000-000000000001";
    const activityPath = `users/${uid}/activity/${activityId}`;
    const receiptPath = `${sessionPath}/reconciliationReceipts/${operationId}`;
    const projectDocument = { ...project } as Record<string, unknown>;
    const sessionDocument = { ...session, notes: "Existing session note" } as Record<string, unknown>;
    delete projectDocument.id;
    delete sessionDocument.id;
    const documents = new Map<string, Record<string, unknown>>([
      [projectPath, projectDocument],
      [sessionPath, sessionDocument],
    ]);
    const transactions: MockTransaction[] = [];
    let transactionAttempt = 0;

    runTransactionMock.mockImplementation(async (
      _db: unknown,
      updateFunction: (transaction: MockTransaction) => Promise<unknown> | unknown,
    ) => {
      transactionAttempt += 1;
      const pendingOperations: Array<() => void> = [];
      const transaction: MockTransaction = {
        get: vi.fn(async (ref: MockRef) =>
          makeDocSnapshot(documents.has(ref.path), documents.get(ref.path))),
        set: vi.fn((
          ref: MockRef,
          value: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          pendingOperations.push(() => {
            const current = options?.merge ? documents.get(ref.path) ?? {} : {};
            documents.set(ref.path, { ...current, ...value });
          });
        }),
        update: vi.fn((ref: MockRef, value: Record<string, unknown>) => {
          pendingOperations.push(() => {
            documents.set(ref.path, { ...(documents.get(ref.path) ?? {}), ...value });
          });
        }),
        delete: vi.fn(),
      };
      transactions.push(transaction);
      const result = await updateFunction(transaction);
      pendingOperations.forEach((operation) => operation());
      if (transactionAttempt === 1) {
        throw Object.assign(new Error("Commit acknowledgement unavailable"), { code: "unavailable" });
      }
      return result;
    });

    const recency: ProjectRecencyTouch = {
      projectId: project.id,
      updatedAt: "2036-08-10T12:00:00.000Z",
      lastWorkedAt: "2036-08-10T12:00:00.000Z",
    };
    const activity = {
      id: activityId,
      projectId: project.id,
      type: "session_completed" as const,
      summary: "Recorded a session note",
      entityType: "session",
      entityId: session.id,
      metadata: "reconciliation-test",
      createdAt: "2036-08-10T12:00:00.000Z",
    };
    const action: DashboardAction = {
      type: "session_note_append",
      payload: { id: session.id, note: "Append exactly once" },
    };
    const repository = await createFirestoreRepository(uid);

    await expect(repository.applyAction(action, activity, recency, operationId))
      .rejects.toThrow("Commit acknowledgement unavailable");
    await expect(repository.applyAction(action, activity, recency, operationId)).resolves.toBeUndefined();

    expect(documents.get(sessionPath)?.notes).toBe("Existing session note\n\nAppend exactly once");
    expect(documents.get(projectPath)).toMatchObject({
      updatedAt: recency.updatedAt,
      lastWorkedAt: recency.lastWorkedAt,
    });
    expect(documents.get(activityPath)).toMatchObject({
      summary: activity.summary,
      entityId: session.id,
    });
    expect(documents.get(receiptPath)).toMatchObject({
      operationId,
      actionType: "session_note_append",
      sessionId: session.id,
    });
    expect(transactions).toHaveLength(2);
    expect(transactions[1].update).not.toHaveBeenCalled();
    expect(transactions[1].set).not.toHaveBeenCalled();
  });

  it("serializes concurrent session-note appends without losing either note", async () => {
    const seed = seedDashboardData();
    const session = seed.developmentSessions[0];
    const sessionPath = `users/${uid}/sessions/${session.id}`;
    const sessionDocument = { ...session, notes: "Starting note" } as Record<string, unknown>;
    delete sessionDocument.id;
    const documents = new Map<string, Record<string, unknown>>([
      [sessionPath, sessionDocument],
    ]);
    installSerializedTransactionStore(documents);
    const repository = await createFirestoreRepository(uid);

    await Promise.all([
      repository.applyAction(
        { type: "session_note_append", payload: { id: session.id, note: "First concurrent note" } },
        undefined,
        undefined,
        "concurrent-note-1",
      ),
      repository.applyAction(
        { type: "session_note_append", payload: { id: session.id, note: "Second concurrent note" } },
        undefined,
        undefined,
        "concurrent-note-2",
      ),
    ]);

    expect(documents.get(sessionPath)?.notes).toBe(
      "Starting note\n\nFirst concurrent note\n\nSecond concurrent note",
    );
    expect(documents.has(`${sessionPath}/reconciliationReceipts/concurrent-note-1`)).toBe(true);
    expect(documents.has(`${sessionPath}/reconciliationReceipts/concurrent-note-2`)).toBe(true);
  });

  it("deduplicates existing IDs during migration import", async () => {
    const seed = seedDashboardData();
    const existingProject = { ...seed.projects[0] } as Record<string, unknown>;
    delete existingProject.id;
    const existingPath = `users/${uid}/projects/${seed.projects[0].id}`;
    const newPath = `${existingPath}-new`;
    const documents = new Map<string, Record<string, unknown>>([
      [existingPath, existingProject],
    ]);
    const transactions: MockTransaction[] = [];
    installDocumentQueries(documents);
    installSerializedTransactionStore(documents, transactions);

    const newProject = {
      ...seed.projects[0],
      id: `${seed.projects[0].id}-new`,
      title: "Fresh project",
    };
    const payload: DashboardData = {
      ...seed,
      schemaVersion: SCHEMA_VERSION,
      projects: [
        { ...seed.projects[0] },
        newProject,
        { ...newProject, title: "Duplicate input must not inflate the count" },
      ],
      ideas: [],
      tasks: [],
      brainDumps: [],
      scratchpads: [],
      architectureDecisions: [],
      codexPrompts: [],
      notes: [],
      importantLinks: [],
      developmentSessions: [],
      activities: [],
    };

    const repo = await createFirestoreRepository(uid);
    const result = await repo.importData(payload);

    expect(result.importedCounts?.projects).toBe(1);
    expect(result.skippedCounts?.projects).toBe(2);
    const pendingMarker = setDocMock.mock.calls
      .filter((entry) => (entry[0] as MockRef).path.includes("migrationState/localStorageV1"))
      .at(-1)?.[1] as Record<string, unknown>;
    expect(result).toMatchObject({
      phase: "running",
      markerStatus: "reconciliation_pending",
      completedAt: null,
      reconciliationRequired: true,
    });
    expect(pendingMarker).toMatchObject({
      phase: "running",
      markerStatus: "reconciliation_pending",
      importedCounts: { projects: 1 },
      skippedCounts: { projects: 2 },
      completedAt: null,
      reconciliationRequired: true,
    });
    const writePaths = transactions.flatMap((transaction) =>
      transaction.set.mock.calls.map((entry) => (entry[0] as MockRef).path));
    expect(writePaths).toEqual([newPath]);
    expect(documents.get(existingPath)?.title).toBe(seed.projects[0].title);
    expect(documents.get(newPath)?.title).toBe("Fresh project");
  });

  it("creates each document once across concurrent migration imports", async () => {
    const seed = seedDashboardData();
    const project = {
      ...seed.projects[0],
      id: "72000000-0000-4000-8000-000000000001",
      title: "Concurrent migration project",
    };
    const projectPath = `users/${uid}/projects/${project.id}`;
    const documents = new Map<string, Record<string, unknown>>();
    const transactions: MockTransaction[] = [];
    installDocumentQueries(documents);
    installSerializedTransactionStore(documents, transactions);

    const payload: DashboardData = {
      ...seed,
      projects: [project],
      ideas: [],
      tasks: [],
      brainDumps: [],
      scratchpads: [],
      architectureDecisions: [],
      codexPrompts: [],
      notes: [],
      importantLinks: [],
      developmentSessions: [],
      activities: [],
    };
    const firstRepository = await createFirestoreRepository(uid);
    const secondRepository = await createFirestoreRepository(uid);

    const results = await Promise.all([
      firstRepository.importData(payload),
      secondRepository.importData(payload),
    ]);

    expect(
      results.map((result) => result.importedCounts?.projects ?? -1).sort((a, b) => a - b),
    ).toEqual([0, 1]);
    expect(
      results.map((result) => result.skippedCounts?.projects ?? -1).sort((a, b) => a - b),
    ).toEqual([0, 1]);
    expect(documents.get(projectPath)?.title).toBe(project.title);
    const projectWrites = transactions.flatMap((transaction) =>
      transaction.set.mock.calls.filter((entry) => (entry[0] as MockRef).path === projectPath));
    expect(projectWrites).toHaveLength(1);
  });

  it("chunks large imports while reporting the exact created count", async () => {
    const seed = seedDashboardData();
    const documents = new Map<string, Record<string, unknown>>();
    const transactions: MockTransaction[] = [];
    installDocumentQueries(documents);
    installSerializedTransactionStore(documents, transactions);

    const projects = Array.from({ length: 401 }, (_, index) => ({
      ...seed.projects[0],
      id: `migration-project-${index}`,
      title: `Migration project ${index}`,
    }));
    const payload: DashboardData = {
      ...seed,
      projects,
      ideas: [],
      tasks: [],
      brainDumps: [],
      scratchpads: [],
      architectureDecisions: [],
      codexPrompts: [],
      notes: [],
      importantLinks: [],
      developmentSessions: [],
      activities: [],
    };

    const repository = await createFirestoreRepository(uid);
    const result = await repository.importData(payload);

    expect(result.importedCounts?.projects).toBe(401);
    expect(result.skippedCounts?.projects).toBe(0);
    expect(transactions.map((transaction) => transaction.get.mock.calls.length)).toEqual([400, 1]);
    expect(
      Array.from(documents.keys()).filter((path) => path.includes("/projects/")),
    ).toHaveLength(401);
  });

  it("records import failure state when a transaction write fails", async () => {
    runTransactionMock.mockRejectedValueOnce(new Error("Simulated import failure"));

    getDocsMock.mockImplementation((ref: MockRef) => {
      const collectionName = collectionNameFromPath(ref.path);
      return Promise.resolve(makeQuerySnapshot(collectionName === "projects" ? ["pre-existing-id"] : []));
    });

    const seed = seedDashboardData();
    const payload: DashboardData = {
      ...seed,
      schemaVersion: SCHEMA_VERSION,
      projects: [{ ...seed.projects[0], id: `${seed.projects[0].id}-new`, title: "Fresh project" }],
      ideas: [],
      tasks: [],
      brainDumps: [],
      scratchpads: [],
      architectureDecisions: [],
      codexPrompts: [],
      notes: [],
      importantLinks: [],
      developmentSessions: [],
      activities: [],
    };

    const repo = await createFirestoreRepository(uid);

    await expect(repo.importData(payload)).rejects.toThrow("Simulated import failure");
    const migrationWrites = setDocMock.mock.calls.filter((entry) =>
      (entry[0] as MockRef).path.includes("migrationState/localStorageV1"),
    );

    expect(migrationWrites.length).toBeGreaterThanOrEqual(2);
    const lastState = migrationWrites.at(-1)?.[1] as Record<string, unknown>;
    expect(lastState).toMatchObject({
      phase: "error",
      markerStatus: "import_failed",
      importedCounts: { projects: 0 },
      skippedCounts: { projects: 0 },
      reconciliationRequired: true,
    });
  });

  it("records committed progress when a later migration chunk fails", async () => {
    const seed = seedDashboardData();
    const projects = Array.from({ length: 401 }, (_, index) => ({
      ...seed.projects[0],
      id: `partial-migration-project-${index}`,
      title: `Partial migration project ${index}`,
    }));
    const existingPath = `users/${uid}/projects/${projects[0].id}`;
    const existingDocument = { ...projects[0], title: "Existing cloud project" } as Record<string, unknown>;
    delete existingDocument.id;
    const documents = new Map<string, Record<string, unknown>>([
      [existingPath, existingDocument],
    ]);
    installDocumentQueries(documents);

    let transactionAttempt = 0;
    runTransactionMock.mockImplementation(
      async (
        _db: unknown,
        updateFunction: (transaction: MockTransaction) => Promise<unknown> | unknown,
      ) => {
        transactionAttempt += 1;
        if (transactionAttempt === 2) {
          throw new Error("Second migration chunk failed");
        }

        const pendingWrites = new Map<string, Record<string, unknown>>();
        const transaction: MockTransaction = {
          get: vi.fn(async (ref: MockRef) =>
            makeDocSnapshot(documents.has(ref.path), documents.get(ref.path))),
          set: vi.fn((ref: MockRef, data: Record<string, unknown>) => {
            pendingWrites.set(ref.path, data);
          }),
          update: vi.fn(),
          delete: vi.fn(),
        };
        const result = await updateFunction(transaction);
        pendingWrites.forEach((value, path) => documents.set(path, value));
        return result;
      },
    );

    const payload: DashboardData = {
      ...seed,
      projects,
      ideas: [],
      tasks: [],
      brainDumps: [],
      scratchpads: [],
      architectureDecisions: [],
      codexPrompts: [],
      notes: [],
      importantLinks: [],
      developmentSessions: [],
      activities: [],
    };
    const repo = await createFirestoreRepository(uid);

    await expect(repo.importData(payload)).rejects.toThrow("Second migration chunk failed");

    expect(
      Array.from(documents.keys()).filter((path) => path.includes("/projects/")),
    ).toHaveLength(400);
    expect(documents.get(existingPath)?.title).toBe("Existing cloud project");
    const migrationWrites = setDocMock.mock.calls.filter((entry) =>
      (entry[0] as MockRef).path.includes("migrationState/localStorageV1"),
    );
    expect(migrationWrites).toHaveLength(3);
    expect(migrationWrites[1]?.[1]).toMatchObject({
      phase: "running",
      markerStatus: "importing",
      importedCounts: { projects: 399 },
      skippedCounts: { projects: 1 },
    });
    expect(migrationWrites.at(-1)?.[1]).toMatchObject({
      phase: "error",
      markerStatus: "import_failed",
      importedCounts: { projects: 399 },
      skippedCounts: { projects: 1 },
      cloudRecordCounts: { projects: 400 },
      hasCloudData: true,
      completedAt: null,
      reconciliationRequired: true,
    });
  });
});
