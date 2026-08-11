import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../src/lib/constants";
import {
  appendPendingCloudReconciliationAction,
  claimLegacyCloudRecovery,
  clearCloudRecoveryDashboardData,
  clearPendingCloudReconciliationActions,
  cloudRecoveryScopeForUid,
  getPendingCloudReconciliationActions,
  getLocalDataOwnership,
  hasUnacknowledgedLocalData,
  hasUserLocalData,
  isSeedDashboardData,
  loadDashboardData,
  loadCloudRecoveryDashboardData,
  markLocalDataCloudAcknowledged,
  saveCloudFallbackDashboardData,
  saveCloudRecoveryDashboardData,
  saveDashboardData,
} from "../src/lib/repositories/localAdapter";
import { seedDashboardData } from "../src/lib/seed";

const cloneSeed = () => structuredClone(seedDashboardData());

const storeWithoutMarker = (data: ReturnType<typeof seedDashboardData>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

describe("local seed data classification", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("classifies a pristine canonical seed as not containing user data", () => {
    const data = cloneSeed();

    storeWithoutMarker(data);

    expect(isSeedDashboardData(data)).toBe(true);
    expect(hasUserLocalData()).toBe(false);
  });

  it("classifies a pristine seed from an earlier module lifetime as not containing user data", () => {
    const data = cloneSeed();
    const earlierSeedTimestamp = "2024-01-02T03:04:05.000Z";

    data.projects = data.projects.map((project) => ({
      ...project,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
      lastWorkedAt: earlierSeedTimestamp,
    }));
    data.ideas = data.ideas.map((record) => ({
      ...record,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
    }));
    data.tasks = data.tasks.map((task) => ({
      ...task,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
      startedAt: task.startedAt === null ? null : earlierSeedTimestamp,
      completedAt: task.completedAt === null ? null : earlierSeedTimestamp,
    }));
    data.brainDumps = data.brainDumps.map((record) => ({
      ...record,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
    }));
    data.architectureDecisions = data.architectureDecisions.map((decision) => ({
      ...decision,
      decidedAt: earlierSeedTimestamp,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
    }));
    data.codexPrompts = data.codexPrompts.map((record) => ({
      ...record,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
    }));
    data.notes = data.notes.map((record) => ({
      ...record,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
    }));
    data.importantLinks = data.importantLinks.map((record) => ({
      ...record,
      createdAt: earlierSeedTimestamp,
      updatedAt: earlierSeedTimestamp,
    }));
    data.developmentSessions = data.developmentSessions.map((session) => ({
      ...session,
      startedAt: earlierSeedTimestamp,
      endedAt: session.endedAt === null ? null : earlierSeedTimestamp,
    }));
    data.activities = data.activities.map((activity) => ({
      ...activity,
      createdAt: earlierSeedTimestamp,
    }));

    storeWithoutMarker(data);

    expect(isSeedDashboardData(data)).toBe(true);
    expect(hasUserLocalData()).toBe(false);
  });

  it("classifies an edited seeded note as user data", () => {
    const data = cloneSeed();
    data.notes[0].markdown = "My locally edited implementation notes.";

    storeWithoutMarker(data);

    expect(isSeedDashboardData(data)).toBe(false);
    expect(hasUserLocalData()).toBe(true);
  });

  it("classifies a changed seeded task status as user data", () => {
    const data = cloneSeed();
    data.tasks[0].status = "in_progress";

    storeWithoutMarker(data);

    expect(isSeedDashboardData(data)).toBe(false);
    expect(hasUserLocalData()).toBe(true);
  });

  it("classifies a changed seeded project blocker as user data", () => {
    const data = cloneSeed();
    data.projects[0].currentBlocker = "Waiting for a local integration test.";

    storeWithoutMarker(data);

    expect(isSeedDashboardData(data)).toBe(false);
    expect(hasUserLocalData()).toBe(true);
  });

  it("classifies an added entity as user data", () => {
    const data = cloneSeed();
    data.ideas.push({
      ...data.ideas[0],
      id: "91919191-9191-4191-8191-919191919191",
      text: "A locally captured idea",
    });

    storeWithoutMarker(data);

    expect(isSeedDashboardData(data)).toBe(false);
    expect(hasUserLocalData()).toBe(true);
  });

  it("ignores only generated record and synchronization timestamps", () => {
    const data = cloneSeed();
    const volatileTimestamp = "2035-01-02T03:04:05.000Z";

    data.projects = data.projects.map((project) => ({
      ...project,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
      lastWorkedAt: volatileTimestamp,
      externalActivityUpdatedAt: volatileTimestamp,
    }));
    data.ideas = data.ideas.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
    }));
    data.tasks = data.tasks.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
    }));
    data.brainDumps = data.brainDumps.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
    }));
    data.architectureDecisions = data.architectureDecisions.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
    }));
    data.codexPrompts = data.codexPrompts.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
    }));
    data.notes = data.notes.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
    }));
    data.importantLinks = data.importantLinks.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
      updatedAt: volatileTimestamp,
    }));
    data.activities = data.activities.map((record) => ({
      ...record,
      createdAt: volatileTimestamp,
    }));

    storeWithoutMarker(data);

    expect(isSeedDashboardData(data)).toBe(true);
    expect(hasUserLocalData()).toBe(false);
  });

  it("still treats lifecycle timestamps as meaningful persisted data", () => {
    const data = cloneSeed();
    data.developmentSessions[0].startedAt = "2035-01-02T03:04:05.000Z";

    expect(isSeedDashboardData(data)).toBe(false);
  });

  it("does not hide coordinated lifecycle timestamp edits behind legacy-seed normalization", () => {
    const data = cloneSeed();
    const editedTimestamp = "2036-02-03T04:05:06.000Z";

    data.tasks = data.tasks.map((task) => ({
      ...task,
      startedAt: task.startedAt === null ? null : editedTimestamp,
      completedAt: task.completedAt === null ? null : editedTimestamp,
    }));
    data.architectureDecisions = data.architectureDecisions.map((decision) => ({
      ...decision,
      decidedAt: editedTimestamp,
    }));
    data.developmentSessions = data.developmentSessions.map((session) => ({
      ...session,
      startedAt: editedTimestamp,
      endedAt: session.endedAt === null ? null : editedTimestamp,
    }));

    expect(isSeedDashboardData(data)).toBe(false);
  });
});

describe("legacy local revision acknowledgement", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("treats an edited markerless Phase 1A payload as unacknowledged local work", () => {
    const phase1APayload = cloneSeed();
    phase1APayload.notes[0] = {
      ...phase1APayload.notes[0],
      markdown: "Work captured by the Phase 1A local-only dashboard.",
    };
    storeWithoutMarker(phase1APayload);

    expect(hasUserLocalData()).toBe(true);
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(true);
  });

  it("does not reopen migration for a pristine markerless seed payload", () => {
    storeWithoutMarker(cloneSeed());

    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(false);
  });

  it("acknowledges only the current legacy revision and detects a newer local save", () => {
    const phase1APayload = cloneSeed();
    phase1APayload.projects[0] = {
      ...phase1APayload.projects[0],
      currentObjective: "Legacy objective awaiting acknowledgement",
    };
    storeWithoutMarker(phase1APayload);

    markLocalDataCloudAcknowledged();
    expect(hasUnacknowledgedLocalData("2026-08-10T12:00:00.000Z")).toBe(false);

    const newerRevision = structuredClone(phase1APayload);
    newerRevision.projects[0].currentBlocker = "New work after cloud acknowledgement";
    saveDashboardData(newerRevision);

    expect(hasUnacknowledgedLocalData("2026-08-10T12:00:00.000Z")).toBe(true);
  });
});

describe("atomic local payload and revision marker durability", () => {
  const stateKey = `${STORAGE_KEY}:state`;

  beforeEach(() => {
    localStorage.clear();
  });

  const makeUserData = (objective: string) => {
    const data = cloneSeed();
    data.projects[0].currentObjective = objective;
    return data;
  };

  const establishAcknowledgedBaseline = () => {
    const baseline = makeUserData("Acknowledged baseline");
    saveDashboardData(baseline);
    markLocalDataCloudAcknowledged();
    return {
      baseline,
      payload: localStorage.getItem(STORAGE_KEY),
      marker: localStorage.getItem(stateKey),
    };
  };

  it("does not touch the payload when the preparation marker fails", () => {
    const baseline = establishAcknowledgedBaseline();
    const next = makeUserData("Capture blocked before payload");
    const attemptedKeys: string[] = [];
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      attemptedKeys.push(key);
      if (key === stateKey) {
        throw new DOMException("Preparation marker unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });

    try {
      expect(() => saveDashboardData(next)).toThrow("Preparation marker unavailable");
    } finally {
      setItemSpy.mockRestore();
    }

    expect(attemptedKeys).toEqual([stateKey]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(baseline.payload);
    expect(localStorage.getItem(stateKey)).toBe(baseline.marker);
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(false);
  });

  it("restores the prior marker when the payload write fails", () => {
    const baseline = establishAcknowledgedBaseline();
    const next = makeUserData("Capture rejected by payload storage");
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === STORAGE_KEY) {
        throw new DOMException("Payload unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });

    try {
      expect(() => saveDashboardData(next)).toThrow("Payload unavailable");
    } finally {
      setItemSpy.mockRestore();
    }

    expect(localStorage.getItem(STORAGE_KEY)).toBe(baseline.payload);
    expect(localStorage.getItem(stateKey)).toBe(baseline.marker);
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(false);
  });

  it("keeps a matching pending revision when the payload succeeds but final marker fails", () => {
    const baseline = establishAcknowledgedBaseline();
    const next = makeUserData("Capture durable with pending final marker");
    const originalSetItem = Storage.prototype.setItem;
    let markerWriteCount = 0;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === stateKey) {
        markerWriteCount += 1;
        if (markerWriteCount === 2) {
          throw new DOMException("Final marker unavailable", "QuotaExceededError");
        }
      }
      originalSetItem.call(this, key, value);
    });

    try {
      expect(() => saveDashboardData(next)).toThrow("Final marker unavailable");
    } finally {
      setItemSpy.mockRestore();
    }

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"))
      .toEqual(next);
    const preparedMarker = JSON.parse(localStorage.getItem(stateKey) ?? "null") as {
      revision: number;
      acknowledgedRevision: number;
      pendingWrite?: { marker?: { revision?: number; acknowledgedRevision?: number } };
    };
    expect(preparedMarker).toMatchObject({
      revision: 1,
      acknowledgedRevision: 1,
      pendingWrite: {
        marker: {
          revision: 2,
          acknowledgedRevision: 1,
        },
      },
    });

    // A completed cloud migration must not hide the newer, partially finalized
    // local capture after a reload.
    expect(loadDashboardData().projects[0].currentObjective)
      .toBe("Capture durable with pending final marker");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(true);

    markLocalDataCloudAcknowledged();
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).toMatchObject({
      revision: 2,
      acknowledgedRevision: 2,
    });
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).not.toHaveProperty("pendingWrite");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(false);
    expect(baseline.payload).not.toBe(localStorage.getItem(STORAGE_KEY));
  });

  it("retains an explicit pending state if payload-marker rollback also fails", () => {
    const baseline = establishAcknowledgedBaseline();
    const next = makeUserData("Capture whose payload and rollback fail");
    const originalSetItem = Storage.prototype.setItem;
    let markerWriteCount = 0;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === stateKey) {
        markerWriteCount += 1;
        if (markerWriteCount === 2) {
          throw new DOMException("Marker rollback unavailable", "QuotaExceededError");
        }
      }
      if (key === STORAGE_KEY) {
        throw new DOMException("Payload unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });

    try {
      expect(() => saveDashboardData(next)).toThrow(
        "Unable to persist the local dashboard payload or restore its prior marker.",
      );
    } finally {
      setItemSpy.mockRestore();
    }

    expect(localStorage.getItem(STORAGE_KEY)).toBe(baseline.payload);
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).toHaveProperty("pendingWrite");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(true);

    markLocalDataCloudAcknowledged();
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).toHaveProperty("pendingWrite");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(true);
  });

  it("treats a rollback-failed pending write as unacknowledged even over a pristine seed", () => {
    loadDashboardData();
    const pristinePayload = localStorage.getItem(STORAGE_KEY);
    const originalSetItem = Storage.prototype.setItem;
    let markerWriteCount = 0;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === stateKey) {
        markerWriteCount += 1;
        if (markerWriteCount === 2) {
          throw new DOMException("Seed marker rollback unavailable", "QuotaExceededError");
        }
      }
      if (key === STORAGE_KEY) {
        throw new DOMException("Seed payload unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });

    try {
      expect(() => saveDashboardData(cloneSeed())).toThrow(
        "Unable to persist the local dashboard payload or restore its prior marker.",
      );
    } finally {
      setItemSpy.mockRestore();
    }

    expect(localStorage.getItem(STORAGE_KEY)).toBe(pristinePayload);
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).toHaveProperty("pendingWrite");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(true);
  });

  it("commits and acknowledges only the matching successful revision", () => {
    establishAcknowledgedBaseline();
    const next = makeUserData("Successfully committed next revision");

    saveDashboardData(next);

    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).toMatchObject({
      revision: 2,
      acknowledgedRevision: 1,
    });
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).not.toHaveProperty("pendingWrite");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(true);

    markLocalDataCloudAcknowledged();
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).toMatchObject({
      revision: 2,
      acknowledgedRevision: 2,
    });
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(false);
  });

  it("continues to read legacy payloads and timestamp-only markers", () => {
    const legacy = makeUserData("Legacy old-key capture");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    localStorage.setItem(stateKey, JSON.stringify({
      hasUserData: true,
      updatedAt: "2026-08-10T12:00:00.000Z",
      source: "user",
    }));

    expect(loadDashboardData().projects[0].currentObjective).toBe("Legacy old-key capture");
    expect(hasUnacknowledgedLocalData("2026-08-10T11:59:59.000Z")).toBe(true);
    expect(hasUnacknowledgedLocalData("2026-08-10T12:00:01.000Z")).toBe(false);

    const next = structuredClone(legacy);
    next.projects[0].currentObjective = "Legacy payload upgraded by next save";
    saveDashboardData(next);
    expect(JSON.parse(localStorage.getItem(stateKey) ?? "null")).toMatchObject({
      revision: 1,
      acknowledgedRevision: 0,
    });
  });
});

describe("account-scoped cloud recovery", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps account recovery snapshots and journals isolated without storing raw UIDs", () => {
    const uidA = "private-owner-uid-a";
    const uidB = "private-owner-uid-b";
    const scopeA = cloudRecoveryScopeForUid(uidA);
    const scopeB = cloudRecoveryScopeForUid(uidB);
    const recoveryA = cloneSeed();
    const recoveryB = cloneSeed();
    recoveryA.projects[0].currentObjective = "Account A recovery";
    recoveryB.projects[0].currentObjective = "Account B recovery";

    saveCloudRecoveryDashboardData(recoveryA, scopeA);
    saveCloudRecoveryDashboardData(recoveryB, scopeB);
    expect(loadCloudRecoveryDashboardData(scopeA)?.projects[0].currentObjective)
      .toBe("Account A recovery");
    expect(loadCloudRecoveryDashboardData(scopeB)?.projects[0].currentObjective)
      .toBe("Account B recovery");

    const action = (objective: string) => ({
      action: {
        type: "project_update" as const,
        payload: {
          id: recoveryA.projects[0].id,
          updates: { currentObjective: objective },
        },
      },
    });
    appendPendingCloudReconciliationAction({ ownerScope: scopeA, ...action("A") });
    appendPendingCloudReconciliationAction({ ownerScope: scopeB, ...action("B") });
    appendPendingCloudReconciliationAction(action("Legacy unscoped"));

    expect(getPendingCloudReconciliationActions(scopeA)).toHaveLength(1);
    expect(getPendingCloudReconciliationActions(scopeB)).toHaveLength(1);
    clearPendingCloudReconciliationActions(scopeA);
    clearCloudRecoveryDashboardData(scopeA);

    expect(getPendingCloudReconciliationActions(scopeA)).toEqual([]);
    expect(getPendingCloudReconciliationActions(scopeB)).toHaveLength(1);
    expect(getPendingCloudReconciliationActions().map((entry) => entry.ownerScope)).toEqual([
      scopeB,
      undefined,
    ]);
    expect(loadCloudRecoveryDashboardData(scopeA)).toBeNull();
    expect(loadCloudRecoveryDashboardData(scopeB)?.projects[0].currentObjective)
      .toBe("Account B recovery");

    const persistedStorage = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return `${key}:${localStorage.getItem(key) ?? ""}`;
    }).join("\n");
    expect(persistedStorage).not.toContain(uidA);
    expect(persistedStorage).not.toContain(uidB);
  });

  it("tags a shared cloud-fallback payload with an opaque owner scope", () => {
    const uidA = "private-owner-uid-a";
    const uidB = "private-owner-uid-b";
    const scopeA = cloudRecoveryScopeForUid(uidA);
    const scopeB = cloudRecoveryScopeForUid(uidB);
    const recovery = cloneSeed();
    recovery.projects[0].currentObjective = "Durably retained after an account A write failure";

    saveCloudFallbackDashboardData(
      recovery,
      "Cloud reconciliation is required.",
      scopeA,
    );

    expect(getLocalDataOwnership(scopeA)).toBe("current-owner");
    expect(getLocalDataOwnership(scopeB)).toBe("different-owner");

    const persistedStorage = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return `${key}:${localStorage.getItem(key) ?? ""}`;
    }).join("\n");
    expect(persistedStorage).toContain(scopeA);
    expect(persistedStorage).not.toContain(uidA);
    expect(persistedStorage).not.toContain(uidB);
  });

  it("preserves the owner scope through later saves and releases it on acknowledgement", () => {
    const scope = cloudRecoveryScopeForUid("private-owner-uid-a");
    const recovery = cloneSeed();
    recovery.projects[0].currentObjective = "First retained projection";

    saveCloudFallbackDashboardData(
      recovery,
      "Cloud reconciliation is required.",
      scope,
    );

    const nextRecovery = structuredClone(recovery);
    nextRecovery.projects[0].currentObjective = "Newer retained projection";
    saveDashboardData(nextRecovery);
    expect(getLocalDataOwnership(scope)).toBe("current-owner");

    markLocalDataCloudAcknowledged();
    expect(getLocalDataOwnership(scope)).toBe("unscoped");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(false);
  });

  it("keeps markerless legacy user data unscoped and unacknowledged", () => {
    const scope = cloudRecoveryScopeForUid("private-owner-uid-a");
    const phase1APayload = cloneSeed();
    phase1APayload.notes[0].markdown = "Markerless local work from Phase 1A";
    storeWithoutMarker(phase1APayload);

    expect(getLocalDataOwnership(scope)).toBe("unscoped");
    expect(hasUnacknowledgedLocalData("2099-01-01T00:00:00.000Z")).toBe(true);
    expect(getLocalDataOwnership(scope)).toBe("unscoped");
  });

  it.each([
    ["preparation marker", 1],
    ["payload", 2],
  ] as const)("restores the prior payload and marker when the %s write fails", (_target, failureCall) => {
    const stateKey = `${STORAGE_KEY}:state`;
    const priorScope = cloudRecoveryScopeForUid("private-owner-uid-before");
    const nextScope = cloudRecoveryScopeForUid("private-owner-uid-after");
    const prior = cloneSeed();
    prior.projects[0].currentObjective = "Prior durable local projection";
    saveCloudFallbackDashboardData(prior, "Prior reconciliation", priorScope);
    const priorPayload = localStorage.getItem(STORAGE_KEY);
    const priorMarker = localStorage.getItem(stateKey);

    const next = cloneSeed();
    next.projects[0].currentObjective = "Projection whose fallback write fails";
    const originalSetItem = Storage.prototype.setItem;
    let setItemCall = 0;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      setItemCall += 1;
      if (setItemCall === failureCall) {
        throw new DOMException("Simulated localStorage failure", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });

    try {
      expect(() => saveCloudFallbackDashboardData(
        next,
        "New reconciliation",
        nextScope,
      )).toThrow("Simulated localStorage failure");
    } finally {
      setItemSpy.mockRestore();
    }

    expect(localStorage.getItem(STORAGE_KEY)).toBe(priorPayload);
    expect(localStorage.getItem(stateKey)).toBe(priorMarker);
    expect(getLocalDataOwnership(priorScope)).toBe("current-owner");
    expect(getLocalDataOwnership(nextScope)).toBe("different-owner");
  });

  it("claims an ownerless snapshot and journal without changing entry identity or order", () => {
    const scopeA = cloudRecoveryScopeForUid("private-owner-uid-a");
    const scopeB = cloudRecoveryScopeForUid("private-owner-uid-b");
    const recovery = cloneSeed();
    recovery.projects[0].currentObjective = "Legacy recovery selected for account A";
    saveCloudRecoveryDashboardData(recovery);

    const projectId = recovery.projects[0].id;
    const firstLegacy = appendPendingCloudReconciliationAction({
      action: {
        type: "project_update",
        payload: { id: projectId, updates: { currentObjective: "First legacy edit" } },
      },
      activity: recovery.activities[0],
      projectRecency: {
        projectId,
        updatedAt: "2026-08-10T12:00:00.000Z",
        lastWorkedAt: "2026-08-10T12:00:00.000Z",
      },
    });
    const existingB = appendPendingCloudReconciliationAction({
      ownerScope: scopeB,
      action: {
        type: "project_update",
        payload: { id: projectId, updates: { currentObjective: "Account B edit" } },
      },
    });
    const secondLegacy = appendPendingCloudReconciliationAction({
      action: {
        type: "project_update",
        payload: { id: projectId, updates: { currentObjective: "Second legacy edit" } },
      },
    });
    const before = getPendingCloudReconciliationActions();

    expect(claimLegacyCloudRecovery(scopeA)).toEqual({
      ok: true,
      status: "claimed",
      snapshotClaimed: true,
      claimedActionCount: 2,
    });

    expect(loadCloudRecoveryDashboardData()).toBeNull();
    expect(loadCloudRecoveryDashboardData(scopeA)).toEqual(recovery);
    const after = getPendingCloudReconciliationActions();
    expect(after.map((entry) => entry.id)).toEqual(before.map((entry) => entry.id));
    expect(after.map((entry) => entry.ownerScope)).toEqual([scopeA, scopeB, scopeA]);
    expect(after[0].activity).toEqual(firstLegacy?.activity);
    expect(after[0].projectRecency).toEqual(firstLegacy?.projectRecency);
    expect(after[1]).toEqual(existingB);
    expect(after[2].id).toBe(secondLegacy?.id);

    const stableState = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)] as const;
    }).sort(([left], [right]) => left.localeCompare(right));
    expect(claimLegacyCloudRecovery(scopeA)).toEqual({
      ok: true,
      status: "nothing-to-claim",
      snapshotClaimed: false,
      claimedActionCount: 0,
    });
    expect(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)] as const;
    }).sort(([left], [right]) => left.localeCompare(right))).toEqual(stableState);
  });

  it("rejects a conflicting scoped snapshot without mutating any recovery state", () => {
    const scope = cloudRecoveryScopeForUid("private-owner-uid-a");
    const legacy = cloneSeed();
    const scoped = cloneSeed();
    legacy.projects[0].currentObjective = "Legacy recovery";
    scoped.projects[0].currentObjective = "Different scoped recovery";
    saveCloudRecoveryDashboardData(legacy);
    saveCloudRecoveryDashboardData(scoped, scope);
    appendPendingCloudReconciliationAction({
      action: {
        type: "project_update",
        payload: {
          id: legacy.projects[0].id,
          updates: { currentObjective: "Ownerless journal mutation" },
        },
      },
    });
    const before = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)] as const;
    }).sort(([left], [right]) => left.localeCompare(right));

    expect(claimLegacyCloudRecovery(scope)).toEqual({
      ok: false,
      status: "conflict",
      reason: "scoped-snapshot-conflict",
    });

    expect(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)] as const;
    }).sort(([left], [right]) => left.localeCompare(right))).toEqual(before);
  });

  it("retains legacy recovery across an interrupted claim and completes on retry", () => {
    const scope = cloudRecoveryScopeForUid("private-owner-uid-a");
    const recovery = cloneSeed();
    recovery.projects[0].currentObjective = "Crash-safe legacy recovery";
    saveCloudRecoveryDashboardData(recovery);
    appendPendingCloudReconciliationAction({
      action: {
        type: "project_update",
        payload: {
          id: recovery.projects[0].id,
          updates: { currentObjective: "Crash-safe journal edit" },
        },
      },
    });

    const journalKey = `${STORAGE_KEY}:reconciliation-actions`;
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === journalKey) {
        throw new DOMException("Simulated interrupted journal claim", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });

    try {
      expect(() => claimLegacyCloudRecovery(scope)).toThrow(
        "Simulated interrupted journal claim",
      );
    } finally {
      setItemSpy.mockRestore();
    }

    expect(loadCloudRecoveryDashboardData()).toEqual(recovery);
    expect(loadCloudRecoveryDashboardData(scope)).toEqual(recovery);
    expect(getPendingCloudReconciliationActions()[0].ownerScope).toBeUndefined();

    expect(claimLegacyCloudRecovery(scope)).toEqual({
      ok: true,
      status: "claimed",
      snapshotClaimed: true,
      claimedActionCount: 1,
    });
    expect(loadCloudRecoveryDashboardData()).toBeNull();
    expect(getPendingCloudReconciliationActions(scope)).toHaveLength(1);
  });
});
