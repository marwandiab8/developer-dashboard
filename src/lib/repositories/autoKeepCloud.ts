import type { MigrationState } from "./types";

// The owner only works from the cloud copy. When a signed-in session finds this browser's local copy out of
// step with cloud data that already exists, keep the cloud data automatically instead of asking every time.
// Keep-cloud backs up the local copy first (createLocalDashboardBackup), so nothing is lost. It is never
// automatic when this browser holds work that hasn't reached the cloud yet (failed cloud writes waiting to be
// replayed, a recovery copy, a reconciliation flag, or work only in this tab): that work belongs in the cloud,
// not in a backup, so the usual prompt stays. Only for an account whose move to the cloud has already
// completed (marker import_complete / keep-cloud): a first sign-in, or a failed, partial or in-progress move -
// where the cloud copy itself may be incomplete - still asks. Nor for ownerless legacy recovery or an empty cloud.
const COMPLETED_CLOUD_MARKERS = new Set(["import_complete", "keep-cloud"]);
let autoKeepCloud = true;

/** On by default for this dashboard's owner; tests of the manual choice switch it off. */
export const setAutoKeepCloud = (enabled: boolean): void => {
  autoKeepCloud = enabled;
};

export const shouldAutoKeepCloud = (state: MigrationState, signedIn: boolean, hasUnsentWork: boolean): boolean => {
  if (!autoKeepCloud || !signedIn || hasUnsentWork || state.phase !== "required") return false;
  if (!COMPLETED_CLOUD_MARKERS.has(state.markerStatus) || !state.completedAt) return false;
  const cloudCount = Object.values(state.cloudRecordCounts ?? {}).reduce((total, value) => total + value, 0);
  return state.hasCloudData || cloudCount > 0;
};
