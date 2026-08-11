import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { readOptionalGithubCredential, requireDashboardOwner, requireGithubCredential, safeErrorCode, toSafeHttpsError } from "./github/auth";
import { FirestoreGithubPersistence } from "./github/persistence";
import { GithubSyncService } from "./github/syncService";
import { FUNCTIONS_REGION } from "./github/types";

setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 5 });
initializeApp();
const githubReadCredential = defineSecret("GITHUB_READ_TOKEN");
const dashboardOwnerUid = defineSecret("DASHBOARD_OWNER_UID");
const service = new GithubSyncService({ persistence: new FirestoreGithubPersistence(getFirestore()), logger });
const callableOptions = { region: FUNCTIONS_REGION, secrets: [githubReadCredential, dashboardOwnerUid], timeoutSeconds: 540, memory: "512MiB" as const };

export const getGitHubConnectionStatus = onCall(callableOptions, async (request) => {
  const uid = requireDashboardOwner(request.auth, dashboardOwnerUid);
  return service.getConnectionStatus(uid, readOptionalGithubCredential(githubReadCredential));
});

export const syncGitHubRepositories = onCall(callableOptions, async (request) => {
  const uid = requireDashboardOwner(request.auth, dashboardOwnerUid);
  try {
    return await service.synchronize({ uid, credential: requireGithubCredential(githubReadCredential), mode: "manual" });
  } catch (error) {
    throw toSafeHttpsError(error);
  }
});

export const scheduledSyncGitHubRepositories = onSchedule({
  region: FUNCTIONS_REGION,
  schedule: "15 3 * * *",
  timeZone: "America/Toronto",
  secrets: [githubReadCredential, dashboardOwnerUid],
  timeoutSeconds: 540,
  memory: "512MiB",
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  try {
    const uid = dashboardOwnerUid.value().trim();
    if (!uid) throw new Error("Owner configuration unavailable.");
    await service.synchronize({ uid, credential: requireGithubCredential(githubReadCredential), mode: "scheduled" });
  } catch (error) {
    logger.error("Scheduled GitHub synchronization failed.", { errorCode: safeErrorCode(error) });
    throw toSafeHttpsError(error);
  }
});
