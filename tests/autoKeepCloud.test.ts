import { describe, expect, it } from "vitest";

import { shouldAutoKeepCloud } from "../src/lib/repositories/autoKeepCloud";
import type { MigrationState } from "../src/lib/repositories/types";

const base: MigrationState = {
  phase: "required",
  hasLocalData: true,
  hasCloudData: true,
  localRecordCounts: { projects: 3 },
  cloudRecordCounts: { projects: 20 },
  markerStatus: "keep-cloud",
  error: null,
  startedAt: null,
  completedAt: "2026-09-21T12:00:00.000Z",
  version: 1,
};

describe("keeping cloud data automatically", () => {
  it("keeps the cloud when signed in and the cloud already has data", () => {
    expect(shouldAutoKeepCloud(base, true, false)).toBe(true);
    expect(shouldAutoKeepCloud({ ...base, hasCloudData: false }, true, false)).toBe(true); // counts still show cloud data
  });

  it("still asks when there is nothing in the cloud to keep", () => {
    expect(shouldAutoKeepCloud({ ...base, hasCloudData: false, cloudRecordCounts: {} }, true, false)).toBe(false);
  });

  it("still asks unless this account already finished moving to the cloud", () => {
    expect(shouldAutoKeepCloud({ ...base, markerStatus: "import_complete" }, true, false)).toBe(true);
    for (const markerStatus of ["legacy_recovery_unassigned", "not_started", "importing", "import_failed", "reconciliation_pending", "reconciliation_required", "local_reconciliation_required"]) {
      expect(shouldAutoKeepCloud({ ...base, markerStatus }, true, false)).toBe(false);
    }
    expect(shouldAutoKeepCloud({ ...base, completedAt: null }, true, false)).toBe(false);
  });

  it("never when this browser has work that hasn't reached the cloud yet", () => {
    expect(shouldAutoKeepCloud(base, true, true)).toBe(false);
  });

  it("does nothing when signed out or when no decision is pending", () => {
    expect(shouldAutoKeepCloud(base, false, false)).toBe(false);
    for (const phase of ["idle", "running", "complete", "error"] as const) {
      expect(shouldAutoKeepCloud({ ...base, phase }, true, false)).toBe(false);
    }
  });
});
