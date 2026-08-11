import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  app,
  db,
  enableIndexedDbPersistenceMock,
  getAppsMock,
  getAppMock,
  getAuthMock,
  getFirestoreMock,
  initializeAppMock,
  initializeFirestoreMock,
  setCustomParametersMock,
} = vi.hoisted(() => {
  const app = { name: "dashboard-test-app" };
  const auth = { currentUser: null };
  const db = { name: "dashboard-test-firestore" };
  return {
    app,
    auth,
    db,
    enableIndexedDbPersistenceMock: vi.fn(async () => undefined),
    getAppsMock: vi.fn<() => Array<typeof app>>(() => []),
    getAppMock: vi.fn(() => app),
    getAuthMock: vi.fn(() => auth),
    getFirestoreMock: vi.fn(() => db),
    initializeAppMock: vi.fn(() => app),
    initializeFirestoreMock: vi.fn(() => db),
    setCustomParametersMock: vi.fn(),
  };
});

vi.mock("firebase/app", () => ({
  getApp: getAppMock,
  getApps: getAppsMock,
  initializeApp: initializeAppMock,
}));

vi.mock("firebase/auth", () => ({
  getAuth: getAuthMock,
  GoogleAuthProvider: class MockGoogleAuthProvider {
    setCustomParameters = setCustomParametersMock;
  },
}));

vi.mock("firebase/firestore", () => ({
  enableIndexedDbPersistence: enableIndexedDbPersistenceMock,
  getFirestore: getFirestoreMock,
  initializeFirestore: initializeFirestoreMock,
}));

import {
  getFirebaseClient,
  getFirebaseFirestorePersistenceStatus,
  initializeFirebaseFirestorePersistence,
  readAndValidateFirebaseConfig,
} from "../src/lib/firebase/client";

describe("firebase client environment configuration", () => {
  const original = {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  beforeEach(() => {
    enableIndexedDbPersistenceMock.mockReset();
    enableIndexedDbPersistenceMock.mockResolvedValue(undefined);
    getAppsMock.mockReset();
    getAppsMock.mockReturnValue([]);
    getAppMock.mockReset();
    getAppMock.mockReturnValue(app);
    getAuthMock.mockReset();
    initializeAppMock.mockReset();
    initializeAppMock.mockReturnValue(app);
    initializeFirestoreMock.mockReset();
    initializeFirestoreMock.mockReturnValue(db);
    getFirestoreMock.mockReset();
    getFirestoreMock.mockReturnValue(db);
    setCustomParametersMock.mockClear();
  });

  it("throws when required Firebase environment variables are missing", () => {
    try {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "";
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "";
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "";
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "";
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "";
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "";

      expect(() => readAndValidateFirebaseConfig()).toThrow("Missing Firebase config keys");
    } finally {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = original.NEXT_PUBLIC_FIREBASE_API_KEY;
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = original.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = original.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = original.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = original.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID = original.NEXT_PUBLIC_FIREBASE_APP_ID;
    }
  });

  it("reads Firebase browser keys via explicit static references", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/lib/firebase/client.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/process\.env\["NEXT_PUBLIC_FIREBASE/);
    expect(source).toContain("process.env.NEXT_PUBLIC_FIREBASE_API_KEY");
    expect(source).toContain("process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
    expect(source).toContain("process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID");
    expect(source).toContain("process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
    expect(source).toContain("process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
    expect(source).toContain("process.env.NEXT_PUBLIC_FIREBASE_APP_ID");
  });

  it("returns config when all required Firebase environment variables are present", () => {
    const nextPublicFirebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const nextPublicFirebaseAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
    const nextPublicFirebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const nextPublicFirebaseStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    const nextPublicFirebaseMessagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
    const nextPublicFirebaseAppId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

    try {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "test-auth-domain";
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project-id";
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "test-storage-bucket";
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "1234567890";
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "test-app-id";

      expect(readAndValidateFirebaseConfig()).toEqual({
        apiKey: "test-api-key",
        authDomain: "test-auth-domain",
        projectId: "test-project-id",
        storageBucket: "test-storage-bucket",
        messagingSenderId: "1234567890",
        appId: "test-app-id",
      });
    } finally {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = nextPublicFirebaseApiKey;
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = nextPublicFirebaseAuthDomain;
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = nextPublicFirebaseProjectId;
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = nextPublicFirebaseStorageBucket;
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = nextPublicFirebaseMessagingSenderId;
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID = nextPublicFirebaseAppId;
    }
  });

  it("applies Firestore initialization options before returning the instance", () => {
    const previous = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };

    try {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "test-auth-domain";
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project-id";
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "test-storage-bucket";
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "1234567890";
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "test-app-id";

      const client = getFirebaseClient();

      expect(client.db).toBe(db);
      expect(initializeFirestoreMock).toHaveBeenCalledWith(app, {
        experimentalAutoDetectLongPolling: true,
      });
      expect(getFirestoreMock).not.toHaveBeenCalled();
      expect(
        initializeFirestoreMock.mock.invocationCallOrder[0],
      ).toBeLessThan(getAuthMock.mock.invocationCallOrder[0]);
    } finally {
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY = previous.apiKey;
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = previous.authDomain;
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = previous.projectId;
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = previous.storageBucket;
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = previous.messagingSenderId;
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID = previous.appId;
    }
  });

  it("narrowly reuses an HMR-retained Firestore instance after attempting configuration", async () => {
    getAppsMock.mockReturnValue([app]);
    initializeFirestoreMock.mockImplementationOnce(() => {
      throw {
        code: "failed-precondition",
        message: "initializeFirestore() has already been called with different options.",
      };
    });
    const previousProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project-id";

    try {
      vi.resetModules();
      const freshClientModule = await import("../src/lib/firebase/client");
      const client = freshClientModule.getFirebaseClient();

      expect(client.db).toBe(db);
      expect(initializeFirestoreMock).toHaveBeenCalledBefore(getFirestoreMock);
      expect(getFirestoreMock).toHaveBeenCalledWith(app);
    } finally {
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = previousProjectId;
    }
  });

  it("records successful persistence and initializes each Firestore instance once", async () => {
    const firestore = {} as Parameters<typeof initializeFirebaseFirestorePersistence>[0];

    await expect(initializeFirebaseFirestorePersistence(firestore)).resolves.toEqual({
      state: "enabled",
      reason: null,
    });
    await expect(initializeFirebaseFirestorePersistence(firestore)).resolves.toEqual({
      state: "enabled",
      reason: null,
    });

    expect(enableIndexedDbPersistenceMock).toHaveBeenCalledTimes(1);
    expect(enableIndexedDbPersistenceMock).toHaveBeenCalledWith(firestore);
    expect(getFirebaseFirestorePersistenceStatus(firestore)).toEqual({
      state: "enabled",
      reason: null,
    });
  });

  it("classifies multiple-tab and unsupported persistence failures safely", async () => {
    const multiTabFirestore = {} as Parameters<typeof initializeFirebaseFirestorePersistence>[0];
    const unsupportedFirestore = {} as Parameters<typeof initializeFirebaseFirestorePersistence>[0];
    enableIndexedDbPersistenceMock
      .mockRejectedValueOnce({
        code: "failed-precondition",
        message: "Failed to obtain exclusive access to the persistence layer because another browser tab owns it.",
      })
      .mockRejectedValueOnce({ code: "firestore/unimplemented", message: "private details" });

    await expect(initializeFirebaseFirestorePersistence(multiTabFirestore)).resolves.toEqual({
      state: "unavailable",
      reason: "multiple-tabs",
    });
    await expect(initializeFirebaseFirestorePersistence(unsupportedFirestore)).resolves.toEqual({
      state: "unavailable",
      reason: "unsupported",
    });
  });

  it("does not misclassify an already-started Firestore instance as multi-tab contention", async () => {
    const firestore = {} as Parameters<typeof initializeFirebaseFirestorePersistence>[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    enableIndexedDbPersistenceMock.mockRejectedValueOnce({
      code: "failed-precondition",
      message: "Firestore has already been started and persistence can no longer be enabled. secret-details",
    });

    try {
      await expect(initializeFirebaseFirestorePersistence(firestore)).resolves.toEqual({
        state: "unavailable",
        reason: "unexpected",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).not.toContain("secret-details");
    } finally {
      warn.mockRestore();
    }
  });

  it("records an unexpected persistence failure without exposing its details", async () => {
    const firestore = {} as Parameters<typeof initializeFirebaseFirestorePersistence>[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    enableIndexedDbPersistenceMock.mockRejectedValueOnce({
      code: "internal",
      message: "secret-token-or-user-identifier",
    });

    try {
      await expect(initializeFirebaseFirestorePersistence(firestore)).resolves.toEqual({
        state: "unavailable",
        reason: "unexpected",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).not.toContain("secret-token-or-user-identifier");
      expect(getFirebaseFirestorePersistenceStatus(firestore)).toEqual({
        state: "unavailable",
        reason: "unexpected",
      });
    } finally {
      warn.mockRestore();
    }
  });
});
