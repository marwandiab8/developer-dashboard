import { doc, getDoc, serverTimestamp, setDoc, type DocumentData } from "firebase/firestore";
import { SCHEMA_VERSION } from "../constants";
import {
  getFirebaseClient,
  initializeFirebaseFirestorePersistence,
} from "./client";

type SnapshotData = DocumentData & {
  createdAt?: unknown;
  settings?: Record<string, unknown>;
};

export const DEFAULT_USER_SETTINGS = {
  preferredLocale: "en-CA",
} as const;

export type UserDocument = {
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: unknown;
  updatedAt: unknown;
  lastActiveAt: unknown;
  schemaVersion: number;
  settings: Record<string, unknown>;
};

export const mapUserDocumentPayload = (
  input: {
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
    existing?: SnapshotData;
  },
): UserDocument => {
  const existingSettings = input.existing?.settings;
  const mergedSettings = {
    ...DEFAULT_USER_SETTINGS,
    ...(typeof existingSettings === "object" && existingSettings !== null ? existingSettings : {}),
  };

  return {
    displayName: input.displayName || "",
    email: input.email || "",
    photoURL: input.photoURL || "",
    createdAt: input.existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    schemaVersion: SCHEMA_VERSION,
    settings: mergedSettings,
  };
};

export const upsertUserDocument = async (uid: string): Promise<void> => {
  const { auth, db } = getFirebaseClient();
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    return;
  }

  // AuthProvider can synchronize this document before the repository is
  // created. Keep persistence preparation at this boundary as well so no
  // caller can start Firestore with an earlier read or write.
  await initializeFirebaseFirestorePersistence(db);

  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    return;
  }

  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);
  const user = auth.currentUser;
  if (!user || user.uid !== uid) {
    return;
  }
  const existing = snapshot.exists() ? (snapshot.data() as SnapshotData) : undefined;

  await setDoc(
    userRef,
    {
      ...mapUserDocumentPayload({
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        existing,
      }),
    },
    { merge: true },
  );
};
