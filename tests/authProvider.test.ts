import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import { setPersistence, signInWithPopup, signOut as signOutAuth } from "firebase/auth";

const fixtures = vi.hoisted(() => ({
  auth: {
    currentUser: null as User | null,
  },
  authStateCallback: null as ((user: User | null) => void) | null,
  upsertUserDocument: vi.fn<(uid: string) => Promise<void>>(),
}));

vi.mock("firebase/auth", () => ({
  browserLocalPersistence: {},
  onAuthStateChanged: vi.fn((_auth, callback: (user: User | null) => void) => {
    fixtures.authStateCallback = callback;
    return vi.fn();
  }),
  setPersistence: vi.fn(async () => undefined),
  signInWithPopup: vi.fn(async () => undefined),
  signInWithRedirect: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/firebase/client", () => ({
  getFirebaseClient: () => ({
    auth: fixtures.auth,
    googleProvider: {},
  }),
}));

vi.mock("../src/lib/firebase/userDocument", () => ({
  upsertUserDocument: fixtures.upsertUserDocument,
}));

import {
  AuthProvider,
  type AuthContextValue,
  useAuth,
} from "../src/lib/auth/AuthProvider";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const flushAsyncWork = async (rounds = 8) => {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
    }
  });
};

const mountProvider = async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const contextRef: { current: AuthContextValue | null } = { current: null };

  function Probe() {
    contextRef.current = useAuth();
    return createElement("div", null, contextRef.current.user?.uid ?? "signed-out");
  }

  act(() => {
    root.render(createElement(AuthProvider, null, createElement(Probe)));
  });
  await flushAsyncWork();

  return {
    contextRef,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const user = (uid: string) => ({
  uid,
  displayName: uid,
  email: `${uid}@example.com`,
  photoURL: null,
} as User);

describe("AuthProvider profile synchronization isolation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    fixtures.auth.currentUser = null;
    fixtures.authStateCallback = null;
    fixtures.upsertUserDocument.mockReset();
    fixtures.upsertUserDocument.mockResolvedValue(undefined);
    vi.mocked(signInWithPopup).mockReset();
    vi.mocked(signInWithPopup).mockResolvedValue(undefined as never);
    vi.mocked(setPersistence).mockClear();
    vi.mocked(signOutAuth).mockReset();
    vi.mocked(signOutAuth).mockResolvedValue(undefined);
  });

  it("uses popup sign-in after enabling durable auth persistence", async () => {
    const mounted = await mountProvider();

    try {
      await act(async () => {
        await mounted.contextRef.current!.signInWithGoogle();
      });

      expect(setPersistence).toHaveBeenCalledWith(fixtures.auth, expect.anything());
      expect(signInWithPopup).toHaveBeenCalledWith(fixtures.auth, expect.anything());
    } finally {
      mounted.unmount();
    }
  });

  it("surfaces a blocked popup instead of silently falling back to a broken redirect", async () => {
    vi.mocked(signInWithPopup).mockRejectedValue({
      code: "auth/popup-blocked",
      message: "Popup blocked",
    });
    const mounted = await mountProvider();

    try {
      await act(async () => {
        await mounted.contextRef.current!.signInWithGoogle();
      });

      expect(mounted.contextRef.current).toMatchObject({
        status: "unauthenticated",
        lastError: "Google sign-in was blocked. Allow pop-ups for this site, then try again.",
      });
    } finally {
      mounted.unmount();
    }
  });

  it("does not block authenticated state while an offline profile write is pending", async () => {
    const delayedProfile = createDeferred<void>();
    fixtures.upsertUserDocument.mockReturnValue(delayedProfile.promise);
    const mounted = await mountProvider();

    try {
      const activeUser = user("offline-user");
      fixtures.auth.currentUser = activeUser;
      act(() => fixtures.authStateCallback?.(activeUser));
      await flushAsyncWork();

      expect(mounted.contextRef.current).toMatchObject({
        status: "authenticated",
        user: activeUser,
        lastError: null,
      });
      expect(fixtures.upsertUserDocument).toHaveBeenCalledWith("offline-user");

      await act(async () => {
        delayedProfile.resolve();
        await delayedProfile.promise;
      });
    } finally {
      mounted.unmount();
    }
  });

  it("ignores a stale user A profile failure after user B becomes active", async () => {
    const delayedUserA = createDeferred<void>();
    fixtures.upsertUserDocument.mockImplementation((uid) =>
      uid === "user-a" ? delayedUserA.promise : Promise.resolve(),
    );
    const mounted = await mountProvider();

    try {
      const userA = user("user-a");
      fixtures.auth.currentUser = userA;
      act(() => fixtures.authStateCallback?.(userA));
      await flushAsyncWork();

      const userB = user("user-b");
      fixtures.auth.currentUser = userB;
      act(() => fixtures.authStateCallback?.(userB));
      await flushAsyncWork();
      expect(mounted.contextRef.current).toMatchObject({
        status: "authenticated",
        user: userB,
        lastError: null,
      });

      await act(async () => {
        delayedUserA.reject(new Error("obsolete user A profile failure"));
        await delayedUserA.promise.catch(() => undefined);
      });
      await flushAsyncWork();

      expect(mounted.contextRef.current).toMatchObject({
        status: "authenticated",
        user: userB,
        lastError: null,
      });
    } finally {
      mounted.unmount();
    }
  });

  it("still reports a profile failure for the currently active user", async () => {
    const delayedUser = createDeferred<void>();
    fixtures.upsertUserDocument.mockReturnValue(delayedUser.promise);
    const mounted = await mountProvider();

    try {
      const activeUser = user("current-user");
      fixtures.auth.currentUser = activeUser;
      act(() => fixtures.authStateCallback?.(activeUser));
      await flushAsyncWork();

      await act(async () => {
        delayedUser.reject(new Error("current profile failure"));
        await delayedUser.promise.catch(() => undefined);
      });
      await flushAsyncWork();

      expect(mounted.contextRef.current).toMatchObject({
        status: "authenticated",
        user: activeUser,
        lastError: "Signed in but user profile sync failed. Check Firestore permissions and retry.",
      });
    } finally {
      mounted.unmount();
    }
  });

  it("ignores a stale sign-in failure after user B becomes active", async () => {
    const delayedPopup = createDeferred<never>();
    vi.mocked(signInWithPopup).mockReturnValue(delayedPopup.promise);
    const mounted = await mountProvider();

    try {
      let signInPromise: Promise<void> | null = null;
      act(() => {
        signInPromise = mounted.contextRef.current!.signInWithGoogle();
      });
      await flushAsyncWork();

      const userB = user("user-b");
      fixtures.auth.currentUser = userB;
      act(() => fixtures.authStateCallback?.(userB));
      await flushAsyncWork();

      await act(async () => {
        delayedPopup.reject({
          code: "auth/popup-closed-by-user",
          message: "Obsolete popup closed",
        });
        await signInPromise;
      });
      await flushAsyncWork();

      expect(mounted.contextRef.current).toMatchObject({
        status: "authenticated",
        user: userB,
        lastError: null,
      });
    } finally {
      mounted.unmount();
    }
  });

  it("ignores a stale sign-out failure after user B becomes active", async () => {
    const delayedSignOut = createDeferred<void>();
    vi.mocked(signOutAuth).mockReturnValue(delayedSignOut.promise);
    const mounted = await mountProvider();

    try {
      const userA = user("user-a");
      fixtures.auth.currentUser = userA;
      act(() => fixtures.authStateCallback?.(userA));
      await flushAsyncWork();

      let signOutPromise: Promise<void> | null = null;
      act(() => {
        signOutPromise = mounted.contextRef.current!.signOut();
      });
      await flushAsyncWork();

      const userB = user("user-b");
      fixtures.auth.currentUser = userB;
      act(() => fixtures.authStateCallback?.(userB));
      await flushAsyncWork();

      await act(async () => {
        delayedSignOut.reject(new Error("Obsolete sign-out failure"));
        await signOutPromise;
      });
      await flushAsyncWork();

      expect(mounted.contextRef.current).toMatchObject({
        status: "authenticated",
        user: userB,
        lastError: null,
      });
    } finally {
      mounted.unmount();
    }
  });
});
