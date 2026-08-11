import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  docMock,
  getDocMock,
  getFirebaseClientMock,
  initializeFirebaseFirestorePersistenceMock,
  setDocMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(() => ({ path: "users/owner" })),
  getDocMock: vi.fn(),
  getFirebaseClientMock: vi.fn(),
  initializeFirebaseFirestorePersistenceMock: vi.fn(),
  setDocMock: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: docMock,
  getDoc: getDocMock,
  serverTimestamp: () => "server-timestamp",
  setDoc: setDocMock,
}));

vi.mock("../src/lib/firebase/client", () => ({
  getFirebaseClient: getFirebaseClientMock,
  initializeFirebaseFirestorePersistence: initializeFirebaseFirestorePersistenceMock,
}));

import {
  mapUserDocumentPayload,
  upsertUserDocument,
} from "../src/lib/firebase/userDocument";

describe("user document mapping", () => {
  const db = {};
  const auth: {
    currentUser: null | {
      uid: string;
      displayName: string;
      email: string;
      photoURL: string | null;
    };
  } = {
    currentUser: null,
  };

  beforeEach(() => {
    docMock.mockClear();
    getDocMock.mockReset();
    getDocMock.mockResolvedValue({
      exists: () => false,
      data: () => ({}),
    });
    setDocMock.mockReset();
    setDocMock.mockResolvedValue(undefined);
    initializeFirebaseFirestorePersistenceMock.mockReset();
    initializeFirebaseFirestorePersistenceMock.mockResolvedValue({
      state: "enabled",
      reason: null,
    });
    getFirebaseClientMock.mockReset();
    auth.currentUser = {
      uid: "owner",
      displayName: "Developer",
      email: "dev@example.com",
      photoURL: null,
    };
    getFirebaseClientMock.mockReturnValue({ auth, db });
  });

  it("preserves existing createdAt and merges default settings", () => {
    const existing = {
      createdAt: { seconds: 1732800 },
      settings: {
        preferredTheme: "dark",
      },
    };

    const payload = mapUserDocumentPayload({
      displayName: "Developer",
      email: "dev@example.com",
      photoURL: "https://example.com/photo.jpg",
      existing,
    });

    expect(payload.displayName).toBe("Developer");
    expect(payload.email).toBe("dev@example.com");
    expect(payload.photoURL).toBe("https://example.com/photo.jpg");
    expect(payload.createdAt).toBe(existing.createdAt);
    expect(payload.settings).toMatchObject({
      preferredLocale: "en-CA",
      preferredTheme: "dark",
    });
    expect(payload.schemaVersion).toBe(1);
  });

  it("awaits persistence before the first user-document read or write", async () => {
    let releasePersistence: () => void = () => undefined;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    initializeFirebaseFirestorePersistenceMock.mockImplementation(async () => {
      await persistenceGate;
      return { state: "enabled", reason: null };
    });

    const upsert = upsertUserDocument("owner");
    await Promise.resolve();

    expect(initializeFirebaseFirestorePersistenceMock).toHaveBeenCalledWith(db);
    expect(docMock).not.toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();

    releasePersistence();
    await upsert;

    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(
      initializeFirebaseFirestorePersistenceMock.mock.invocationCallOrder[0],
    ).toBeLessThan(getDocMock.mock.invocationCallOrder[0]);
  });

  it("continues user-profile synchronization when native persistence is unavailable", async () => {
    initializeFirebaseFirestorePersistenceMock.mockResolvedValue({
      state: "unavailable",
      reason: "multiple-tabs",
    });

    await expect(upsertUserDocument("owner")).resolves.toBeUndefined();

    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });

  it("does not access the old user document when authentication changes during persistence setup", async () => {
    let releasePersistence: () => void = () => undefined;
    initializeFirebaseFirestorePersistenceMock.mockImplementation(() => new Promise((resolve) => {
      releasePersistence = () => resolve({ state: "enabled", reason: null });
    }));

    const upsert = upsertUserDocument("owner");
    await Promise.resolve();
    auth.currentUser = {
      uid: "new-owner",
      displayName: "Other account",
      email: "other@example.com",
      photoURL: null,
    };
    releasePersistence();
    await upsert;

    expect(docMock).not.toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("does not write the old user document when authentication changes during its read", async () => {
    let releaseRead: (snapshot: { exists: () => boolean; data: () => object }) => void = () => undefined;
    getDocMock.mockImplementation(() => new Promise((resolve) => {
      releaseRead = resolve;
    }));

    const upsert = upsertUserDocument("owner");
    await Promise.resolve();
    await Promise.resolve();
    expect(getDocMock).toHaveBeenCalledTimes(1);

    auth.currentUser = {
      uid: "new-owner",
      displayName: "Other account",
      email: "other@example.com",
      photoURL: null,
    };
    releaseRead({
      exists: () => false,
      data: () => ({}),
    });
    await upsert;

    expect(setDocMock).not.toHaveBeenCalled();
  });
});
