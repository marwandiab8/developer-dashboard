import { describe, expect, it } from "vitest";

import type { DashboardData } from "../src/lib/models";
import { createCloudMutationContract } from "../src/lib/repositories/cloudMutationContract";
import { buildRecoveryProjection } from "../src/lib/repositories/recoveryProjection";
import { dashboardReducer } from "../src/lib/repositories/reducer";
import type {
  DashboardAction,
  PendingCloudReconciliationAction,
} from "../src/lib/repositories/types";
import { seedDashboardData } from "../src/lib/seed";

const pendingMutation = (
  id: string,
  before: DashboardData,
  action: DashboardAction,
): { pending: PendingCloudReconciliationAction; projected: DashboardData } => {
  const projected = dashboardReducer(before, action);
  return {
    pending: {
      id,
      ownerScope: "uid:owner-user",
      action,
      mutation: createCloudMutationContract(before, projected),
      recordedAt: `2026-08-11T12:00:0${id}.000Z`,
    },
    projected,
  };
};

describe("buildRecoveryProjection", () => {
  it("overlays A then B in invocation order while preserving unrelated remote fields", () => {
    const remoteBase = seedDashboardData();
    const taskId = remoteBase.tasks[0].id;
    const first = pendingMutation("1", remoteBase, {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Mutation A" } },
    });
    const second = pendingMutation("2", first.projected, {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Mutation B" } },
    });
    const newerRemoteBase: DashboardData = {
      ...remoteBase,
      tasks: remoteBase.tasks.map((task) => task.id === taskId
        ? { ...task, acceptanceCriteria: "Unrelated remote field survives" }
        : task),
    };

    const projected = buildRecoveryProjection(newerRemoteBase, [first.pending, second.pending]);
    expect(projected.tasks.find((task) => task.id === taskId)).toMatchObject({
      details: "Mutation B",
      acceptanceCriteria: "Unrelated remote field survives",
    });
  });

  it("keeps a conflicting local field visible without duplicating an already-reflected stable ID", () => {
    const remoteBase = seedDashboardData();
    const taskId = remoteBase.tasks[0].id;
    const conflict = pendingMutation("1", remoteBase, {
      type: "task_update",
      payload: { id: taskId, updates: { details: "Pending local conflict" } },
    });
    const divergedRemote: DashboardData = {
      ...remoteBase,
      tasks: remoteBase.tasks.map((task) => task.id === taskId
        ? {
            ...task,
            details: "Newer remote conflict",
            acceptanceCriteria: "Newer unrelated remote work",
          }
        : task),
    };
    const reflectedAdd = pendingMutation("2", conflict.projected, {
      type: "task_add",
      payload: {
        ...remoteBase.tasks[0],
        id: "99999999-9999-4999-8999-999999999999",
        title: "Stable recovery task",
      },
    });
    const remoteWithReflectedAdd = dashboardReducer(divergedRemote, reflectedAdd.pending.action);

    const projected = buildRecoveryProjection(remoteWithReflectedAdd, [
      conflict.pending,
      reflectedAdd.pending,
    ]);
    expect(projected.tasks.find((task) => task.id === taskId)).toMatchObject({
      details: "Pending local conflict",
      acceptanceCriteria: "Newer unrelated remote work",
    });
    expect(projected.tasks.filter(
      (task) => task.id === "99999999-9999-4999-8999-999999999999",
    )).toHaveLength(1);
  });
});
