import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardData } from "../src/lib/models";
import { createFirestoreRepository } from "../src/lib/repositories/firestoreAdapter";
import { seedDashboardData } from "../src/lib/seed";

const firebaseClientState = vi.hoisted(() => ({
  currentUser: null as { uid: string } | null,
  db: null as unknown,
}));

vi.mock("../src/lib/firebase/client", () => ({
  getFirebaseClient: () => ({
    auth: { currentUser: firebaseClientState.currentUser },
    db: firebaseClientState.db,
  }),
  initializeFirebaseFirestorePersistence: vi.fn(async () => ({
    state: "enabled",
    reason: null,
  })),
}));

vi.mock("../src/lib/firebase/userDocument", () => ({
  upsertUserDocument: vi.fn(async () => undefined),
}));

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;

const dashboardCollections = [
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

describeWithEmulator("Firestore client privilege boundaries", () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, portText] = (emulator ?? "127.0.0.1:8080").split(":");
    environment = await initializeTestEnvironment({
      projectId: "developer-dashboard-firestore-rules",
      firestore: { host, port: Number(portText), rules: readFileSync("firestore.rules", "utf8") },
    });
  });

  beforeEach(async () => {
    await environment.clearFirestore();
    firebaseClientState.currentUser = null;
    firebaseClientState.db = null;
  });

  afterAll(async () => environment?.cleanup());

  it("allows owner profile, migration, and Dashboard entity access", async () => {
    const ownerDb = environment.authenticatedContext("owner").firestore();
    const profile = doc(ownerDb, "users/owner");

    await assertSucceeds(setDoc(profile, { displayName: "Owner", schemaVersion: 1 }));
    await assertSucceeds(setDoc(profile, { lastActiveAt: "now" }, { merge: true }));
    await assertSucceeds(getDoc(profile));

    await assertSucceeds(setDoc(
      doc(ownerDb, "users/owner/migrationState/localStorageV1"),
      { markerStatus: "import_complete" },
    ));
    await assertSucceeds(getDoc(doc(ownerDb, "users/owner/migrationState/localStorageV1")));

    for (const collectionName of dashboardCollections) {
      const entity = doc(ownerDb, `users/owner/${collectionName}/entity-1`);
      await assertSucceeds(setDoc(entity, { ownerField: collectionName }));
      await assertSucceeds(getDoc(entity));
    }
  });

  it("denies signed-out and cross-UID access", async () => {
    const ownerDb = environment.authenticatedContext("owner").firestore();
    await assertSucceeds(setDoc(doc(ownerDb, "users/owner"), { displayName: "Owner" }));
    await assertSucceeds(setDoc(
      doc(ownerDb, "users/owner/projects/private-project"),
      { title: "Private repository" },
    ));
    await assertSucceeds(setDoc(
      doc(ownerDb, "users/owner/migrationState/localStorageV1"),
      { markerStatus: "import_complete" },
    ));

    const otherDb = environment.authenticatedContext("other").firestore();
    await assertFails(getDoc(doc(otherDb, "users/owner")));
    await assertFails(getDoc(doc(otherDb, "users/owner/projects/private-project")));
    await assertFails(setDoc(
      doc(otherDb, "users/owner/migrationState/localStorageV1"),
      { markerStatus: "tampered" },
    ));

    const signedOutDb = environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(signedOutDb, "users/owner/projects/private-project")));
    await assertFails(setDoc(
      doc(signedOutDb, "users/owner/projects/unauthorized-project"),
      { title: "Unauthorized" },
    ));
  });

  it("denies browser access to synchronization gates, leases, and audit runs", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, "users/owner/githubSync/state"), {
        syncEnabled: true,
        firstSuccessfulManualImportAt: "2026-08-01T00:00:00.000Z",
        leaseOwner: "backend-run",
        leaseExpiresAt: "2026-08-10T14:00:00.000Z",
      });
      await setDoc(doc(adminDb, "users/owner/githubSyncRuns/run-1"), {
        trigger: "manual",
        status: "completed",
      });
    });

    const ownerDb = environment.authenticatedContext("owner").firestore();
    const syncState = doc(ownerDb, "users/owner/githubSync/state");
    const auditRun = doc(ownerDb, "users/owner/githubSyncRuns/run-1");

    await assertFails(getDoc(syncState));
    await assertFails(setDoc(syncState, { syncEnabled: false }, { merge: true }));
    await assertFails(setDoc(
      syncState,
      { firstSuccessfulManualImportAt: "2026-08-10T00:00:00.000Z" },
      { merge: true },
    ));
    await assertFails(setDoc(
      syncState,
      { leaseOwner: "browser-run", leaseExpiresAt: "2099-01-01T00:00:00.000Z" },
      { merge: true },
    ));
    await assertFails(getDoc(auditRun));
    await assertFails(setDoc(auditRun, { status: "tampered" }, { merge: true }));
    await assertFails(setDoc(
      doc(ownerDb, "users/owner/githubSyncRuns/browser-created-run"),
      { trigger: "manual", status: "completed" },
    ));
    await assertFails(setDoc(
      doc(ownerDb, "users/owner/unknownCollection/unknown-document"),
      { value: true },
    ));
  });

  it("allows only the owner to create immutable, narrowly-shaped reconciliation receipts", async () => {
    const ownerDb = environment.authenticatedContext("owner").firestore();
    const receiptPath =
      "users/owner/sessions/session-1/reconciliationReceipts/reconciliation-operation-1";
    const receipt = doc(ownerDb, receiptPath);
    const validReceipt = {
      operationId: "reconciliation-operation-1",
      actionType: "session_note_append",
      sessionId: "session-1",
      createdAt: serverTimestamp(),
    };

    await assertSucceeds(setDoc(receipt, validReceipt));
    await assertSucceeds(getDoc(receipt));
    await assertFails(setDoc(receipt, { actionType: "session_note_append" }, { merge: true }));
    await assertFails(deleteDoc(receipt));

    const malformedReceipt = doc(
      ownerDb,
      "users/owner/sessions/session-1/reconciliationReceipts/malformed-operation",
    );
    await assertFails(setDoc(malformedReceipt, {
      ...validReceipt,
      operationId: "different-operation-id",
    }));

    const otherDb = environment.authenticatedContext("other").firestore();
    const ownerReceiptFromOtherAccount = doc(otherDb, receiptPath);
    await assertFails(getDoc(ownerReceiptFromOtherAccount));
    await assertFails(setDoc(
      doc(
        otherDb,
        "users/owner/sessions/session-1/reconciliationReceipts/other-operation",
      ),
      {
        operationId: "other-operation",
        actionType: "session_note_append",
        sessionId: "session-1",
        createdAt: serverTimestamp(),
      },
    ));
  });

  it("allows immutable owner-only receipts for guarded Dashboard mutations", async () => {
    const ownerDb = environment.authenticatedContext("owner").firestore();
    const receiptPath = "users/owner/reconciliationReceipts/guarded-operation-1";
    const receipt = doc(ownerDb, receiptPath);
    const validReceipt = {
      operationId: "guarded-operation-1",
      actionType: "task_update",
      fingerprint: "0123456789abcdef",
      contractVersion: 1,
      createdAt: serverTimestamp(),
    };

    await assertSucceeds(setDoc(receipt, validReceipt));
    await assertSucceeds(getDoc(receipt));
    await assertFails(setDoc(receipt, { fingerprint: "changed" }, { merge: true }));
    await assertFails(deleteDoc(receipt));
    await assertFails(setDoc(
      doc(ownerDb, "users/owner/reconciliationReceipts/wrong-id"),
      validReceipt,
    ));

    const otherDb = environment.authenticatedContext("other").firestore();
    await assertFails(getDoc(doc(otherDb, receiptPath)));
    await assertFails(setDoc(
      doc(otherDb, "users/owner/reconciliationReceipts/other-operation"),
      { ...validReceipt, operationId: "other-operation" },
    ));
  });

  it("transactionally deduplicates and serializes session-note reconciliation writes", async () => {
    const ownerDb = environment.authenticatedContext("owner").firestore();
    await assertSucceeds(setDoc(doc(ownerDb, "users/owner"), { displayName: "Owner" }));
    const sessionId = "session-transaction-test";
    const session = doc(ownerDb, `users/owner/sessions/${sessionId}`);
    await assertSucceeds(setDoc(session, { notes: "Starting note" }));
    firebaseClientState.currentUser = { uid: "owner" };
    firebaseClientState.db = ownerDb;
    const repository = await createFirestoreRepository("owner");

    await Promise.all([
      repository.applyAction(
        { type: "session_note_append", payload: { id: sessionId, note: "Concurrent note one" } },
        undefined,
        undefined,
        "emulator-operation-1",
      ),
      repository.applyAction(
        { type: "session_note_append", payload: { id: sessionId, note: "Concurrent note two" } },
        undefined,
        undefined,
        "emulator-operation-2",
      ),
    ]);
    await repository.applyAction(
      { type: "session_note_append", payload: { id: sessionId, note: "Concurrent note one" } },
      undefined,
      undefined,
      "emulator-operation-1",
    );

    const persisted = await assertSucceeds(getDoc(session));
    const notes = String(persisted.data()?.notes ?? "");
    expect(notes.match(/Concurrent note one/g)).toHaveLength(1);
    expect(notes.match(/Concurrent note two/g)).toHaveLength(1);
    await assertSucceeds(getDoc(doc(
      ownerDb,
      `users/owner/sessions/${sessionId}/reconciliationReceipts/emulator-operation-1`,
    )));
    await assertSucceeds(getDoc(doc(
      ownerDb,
      `users/owner/sessions/${sessionId}/reconciliationReceipts/emulator-operation-2`,
    )));
  });

  it("atomically preserves existing data and creates an absent concurrent import once", async () => {
    const ownerDb = environment.authenticatedContext("owner").firestore();
    await assertSucceeds(setDoc(doc(ownerDb, "users/owner"), { displayName: "Owner" }));
    firebaseClientState.currentUser = { uid: "owner" };
    firebaseClientState.db = ownerDb;

    const seed = seedDashboardData();
    const existingProject = {
      ...seed.projects[0],
      title: "Cloud-owned project title",
      currentBlocker: "Cloud edit must survive migration",
    };
    const existingDocument = { ...existingProject } as Record<string, unknown>;
    delete existingDocument.id;
    await assertSucceeds(setDoc(
      doc(ownerDb, `users/owner/projects/${existingProject.id}`),
      existingDocument,
    ));

    const project = {
      ...seed.projects[0],
      id: "73000000-0000-4000-8000-000000000001",
      title: "Emulator concurrent migration project",
    };
    const payload: DashboardData = {
      ...seed,
      projects: [
        {
          ...existingProject,
          title: "Conflicting local project title",
          currentBlocker: "Local conflict must not overwrite cloud",
        },
        project,
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
    const firstRepository = await createFirestoreRepository("owner");
    const secondRepository = await createFirestoreRepository("owner");

    const results = await Promise.all([
      firstRepository.importData(payload),
      secondRepository.importData(payload),
    ]);

    expect(
      results.map((result) => result.importedCounts?.projects ?? -1).sort((a, b) => a - b),
    ).toEqual([0, 1]);
    expect(
      results.map((result) => result.skippedCounts?.projects ?? -1).sort((a, b) => a - b),
    ).toEqual([1, 2]);
    const preservedProject = await assertSucceeds(getDoc(
      doc(ownerDb, `users/owner/projects/${existingProject.id}`),
    ));
    expect(preservedProject.data()).toMatchObject({
      title: existingProject.title,
      currentBlocker: existingProject.currentBlocker,
    });
    const importedProject = await assertSucceeds(getDoc(
      doc(ownerDb, `users/owner/projects/${project.id}`),
    ));
    expect(importedProject.exists()).toBe(true);
    expect(importedProject.data()?.title).toBe(project.title);
    const persistedMarker = await firstRepository.getMigrationState();
    expect((persistedMarker.importedCounts?.projects ?? 0)
      + (persistedMarker.skippedCounts?.projects ?? 0)).toBe(2);
    expect(persistedMarker).toMatchObject({
      phase: "running",
      markerStatus: "reconciliation_pending",
      completedAt: null,
      reconciliationRequired: true,
    });
  });
});
