import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import {
  enableIndexedDbPersistence,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";

type FirebaseClient = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  googleProvider: GoogleAuthProvider;
};

export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type FirestorePersistenceStatus =
  | { state: "enabled"; reason: null }
  | {
      state: "unavailable";
      reason: "multiple-tabs" | "unsupported" | "non-browser" | "unexpected";
    };

const FIRESTORE_SETTINGS = {
  experimentalAutoDetectLongPolling: true,
} as const;

export const readAndValidateFirebaseConfig = (): FirebaseConfig => {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const trimmed = {
    apiKey: config.apiKey?.trim() ?? "",
    authDomain: config.authDomain?.trim() ?? "",
    projectId: config.projectId?.trim() ?? "",
    storageBucket: config.storageBucket?.trim() ?? "",
    messagingSenderId: config.messagingSenderId?.trim() ?? "",
    appId: config.appId?.trim() ?? "",
  };

  const missing: string[] = [];
  if (!trimmed.apiKey) {
    missing.push("API Key");
  }
  if (!trimmed.authDomain) {
    missing.push("Auth domain");
  }
  if (!trimmed.projectId) {
    missing.push("Project ID");
  }
  if (!trimmed.storageBucket) {
    missing.push("Storage bucket");
  }
  if (!trimmed.messagingSenderId) {
    missing.push("Messaging sender ID");
  }
  if (!trimmed.appId) {
    missing.push("App ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing Firebase config keys: ${missing.join(", ")}. Create a browser environment file with the required NEXT_PUBLIC_FIREBASE_* values.`);
  }

  return {
    apiKey: trimmed.apiKey,
    authDomain: trimmed.authDomain,
    projectId: trimmed.projectId,
    storageBucket: trimmed.storageBucket,
    messagingSenderId: trimmed.messagingSenderId,
    appId: trimmed.appId,
  };
};

let cached: FirebaseClient | null = null;
const persistencePromises = new WeakMap<Firestore, Promise<FirestorePersistenceStatus>>();
const persistenceStatuses = new WeakMap<Firestore, FirestorePersistenceStatus>();

const firebaseErrorCode = (error: unknown): string => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "";
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.replace(/^firestore\//, "") : "";
};

const firebaseErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return "";
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.toLowerCase() : "";
};

const isMultipleTabPersistenceError = (error: unknown): boolean => {
  if (firebaseErrorCode(error) !== "failed-precondition") {
    return false;
  }

  const message = firebaseErrorMessage(error);
  return message.includes("failed to obtain exclusive access to the persistence layer")
    || message.includes("another browser tab")
    || message.includes("another tab is open");
};

const isExistingFirestoreWithDifferentSettings = (error: unknown): boolean => {
  if (firebaseErrorCode(error) !== "failed-precondition" || !error || typeof error !== "object") {
    return false;
  }

  const message = "message" in error ? (error as { message?: unknown }).message : "";
  return typeof message === "string"
    && message.includes("initializeFirestore() has already been called with different options");
};

const createFirebaseClient = (): FirebaseClient => {
  const app = getApps().length > 0 ? getApp() : initializeApp(readAndValidateFirebaseConfig());
  // initializeFirestore returns the existing instance when these exact settings
  // were already applied (for example after a client-side module refresh). It
  // must be the first Firestore factory called so settings are never applied
  // after getFirestore() has already created the default instance.
  let db: Firestore;
  try {
    db = initializeFirestore(app, FIRESTORE_SETTINGS);
  } catch (error) {
    if (!isExistingFirestoreWithDifferentSettings(error)) {
      throw error;
    }

    // A Fast Refresh can retain a Firestore instance created by an older
    // module revision. Reuse only this specifically identified instance;
    // every other initialization error remains actionable.
    db = getFirestore(app);
  }
  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });

  return {
    app,
    auth,
    db,
    googleProvider,
  };
};

export function getFirebaseClient(): FirebaseClient {
  if (cached) {
    return cached;
  }

  if (typeof window === "undefined") {
    throw new Error("Firebase client module can only be used in the browser.");
  }

  cached = createFirebaseClient();
  return cached;
}

/**
 * Attempts to activate Firestore's durable browser cache exactly once for a
 * configured Firestore instance. Every repository entry point awaits this
 * promise before its first read, write, or listener. A persistence limitation
 * is reported as a non-sensitive status instead of blocking the local-first UI.
 */
export function initializeFirebaseFirestorePersistence(
  firestore: Firestore = getFirebaseClient().db,
): Promise<FirestorePersistenceStatus> {
  const existing = persistencePromises.get(firestore);
  if (existing) {
    return existing;
  }

  const initialization = (async (): Promise<FirestorePersistenceStatus> => {
    if (typeof window === "undefined") {
      return { state: "unavailable", reason: "non-browser" };
    }

    try {
      await enableIndexedDbPersistence(firestore);
      return { state: "enabled", reason: null };
    } catch (error) {
      const code = firebaseErrorCode(error);
      if (isMultipleTabPersistenceError(error)) {
        return { state: "unavailable", reason: "multiple-tabs" };
      }
      if (code === "unimplemented") {
        return { state: "unavailable", reason: "unsupported" };
      }

      // Do not include the SDK error or identifiers in this message. The
      // category is sufficient operational evidence and local recovery remains
      // available when native Firestore persistence cannot start.
      console.warn(
        "Firestore offline persistence is unavailable due to an unexpected initialization error; local recovery remains active.",
      );
      return { state: "unavailable", reason: "unexpected" };
    }
  })().then((status) => {
    persistenceStatuses.set(firestore, status);
    return status;
  });

  persistencePromises.set(firestore, initialization);
  return initialization;
}

export const getFirebaseFirestorePersistenceStatus = (
  firestore: Firestore = getFirebaseClient().db,
): FirestorePersistenceStatus | null => persistenceStatuses.get(firestore) ?? null;

export const getFirebaseApp = (): FirebaseApp => getFirebaseClient().app;
export const getFirebaseAuth = (): Auth => getFirebaseClient().auth;
export const getFirebaseFirestore = (): Firestore => getFirebaseClient().db;
