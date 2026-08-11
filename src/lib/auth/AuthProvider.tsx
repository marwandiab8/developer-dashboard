"use client";

import {
  type AuthError,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut as signOutAuth,
  type User,
} from "firebase/auth";
import {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getFirebaseClient } from "../firebase/client";
import { upsertUserDocument } from "../firebase/userDocument";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  lastError: string | null;
}

const fallbackAuthContext: AuthContextValue = {
  status: "loading",
  user: null,
  signInWithGoogle: async () => {
    throw new Error("Authentication provider is not mounted.");
  },
  signOut: async () => {
    return;
  },
  lastError: null,
};

const AuthContext = createContext<AuthContextValue>(fallbackAuthContext);

const parseAuthError = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const typed = error as AuthError;

    if (typed.code === "auth/popup-blocked") {
      return "auth/popup-blocked";
    }

    if (typed.code === "auth/popup-closed-by-user" || typed.code === "auth/cancelled-popup-request") {
      return "auth/popup-closed";
    }

    if (typed.code === "auth/operation-not-allowed") {
      return "auth/operation-not-allowed";
    }

    if (typed.code === "auth/unauthorized-domain") {
      return "auth/unauthorized-domain";
    }

    if (typed.code === "auth/network-request-failed") {
      return "auth/network-request-failed";
    }

    return typed.code || typed.message;
  }

  if (error instanceof Error) return error.message;
  return "Unable to sign in.";
};

const errorMessageForCode = (code: string) => {
  switch (code) {
    case "auth/popup-blocked":
      return "Sign-in popup was blocked. Using redirect as a fallback.";
    case "auth/popup-closed":
      return "Sign-in popup was closed before login completed.";
    case "auth/operation-not-allowed":
      return "Google sign-in is disabled. Enable it in Firebase Console > Authentication > Sign-in method.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized for authentication. Add it in Firebase Console.";
    case "auth/network-request-failed":
      return "Unable to reach authentication service. Check your network and try again.";
    default:
      return "Unable to sign in.";
  }
};

const isAppleMobile = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /iPad|iPhone|iPod/.test(navigator.userAgent);
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const authGenerationRef = useRef(0);

  const syncUserDocument = useCallback(async (
    uid: string,
    generation = authGenerationRef.current,
  ) => {
    try {
      await upsertUserDocument(uid);
    } catch {
      let currentUid: string | null = null;
      try {
        currentUid = getFirebaseClient().auth.currentUser?.uid ?? null;
      } catch {
        return;
      }

      if (authGenerationRef.current !== generation || currentUid !== uid) {
        return;
      }
      setLastError("Signed in but user profile sync failed. Check Firestore permissions and retry.");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    const initialize = async () => {
      try {
        const { auth } = getFirebaseClient();
        unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          if (!mounted) return;
          const generation = authGenerationRef.current + 1;
          authGenerationRef.current = generation;
          setUser(nextUser);
          setStatus(nextUser ? "authenticated" : "unauthenticated");
          setLastError(null);

          if (nextUser?.uid) {
            void syncUserDocument(nextUser.uid, generation);
          }
        });
      } catch (error) {
        if (!mounted) {
          return;
        }
        authGenerationRef.current += 1;
        setStatus("unauthenticated");
        setLastError(parseAuthError(error));
      }
    };

    void initialize();

    return () => {
      mounted = false;
      authGenerationRef.current += 1;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [syncUserDocument]);

  const signInWithGoogle = useCallback(async () => {
    const operationGeneration = authGenerationRef.current + 1;
    authGenerationRef.current = operationGeneration;
    const isCurrentOperation = () => authGenerationRef.current === operationGeneration;
    setLastError(null);

    try {
      setStatus("loading");
      const { auth, googleProvider } = getFirebaseClient();
      await setPersistence(auth, browserLocalPersistence);
      if (!isCurrentOperation()) {
        return;
      }

      if (isAppleMobile()) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      try {
        await signInWithPopup(auth, googleProvider);
        if (!isCurrentOperation()) {
          return;
        }
        if (auth.currentUser?.uid) {
          await syncUserDocument(auth.currentUser.uid, operationGeneration);
        }
        return;
      } catch (error) {
        if (!isCurrentOperation()) {
          return;
        }
        const code = parseAuthError(error);
        if (code === "auth/popup-blocked") {
          await signInWithRedirect(auth, googleProvider);
          return;
        }

        setStatus("unauthenticated");
        setLastError(errorMessageForCode(code));
      }
    } catch (error) {
      if (!isCurrentOperation()) {
        return;
      }
      setStatus("unauthenticated");
      setLastError(errorMessageForCode(parseAuthError(error)));
    }
  }, [syncUserDocument]);

  const signOut = useCallback(async () => {
    const operationGeneration = authGenerationRef.current + 1;
    authGenerationRef.current = operationGeneration;
    const isCurrentOperation = () => authGenerationRef.current === operationGeneration;
    try {
      const { auth } = getFirebaseClient();
      await signOutAuth(auth);
      if (!isCurrentOperation()) {
        return;
      }
      setUser(null);
      setLastError(null);
      setStatus("unauthenticated");
    } catch (error) {
      if (!isCurrentOperation()) {
        return;
      }
      setLastError(parseAuthError(error));
      throw error;
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      status,
      user,
      signInWithGoogle,
      signOut,
      lastError,
    }),
    [lastError, signInWithGoogle, signOut, status, user],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
