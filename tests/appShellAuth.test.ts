import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { User } from "firebase/auth";
import { AppShell } from "../src/components/AppShell";
import { seedDashboardData } from "../src/lib/seed";

type AuthFixtureState = {
  status: "loading" | "authenticated" | "unauthenticated";
  user: User | null;
  lastError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const authFixture = vi.hoisted<AuthFixtureState>(() => ({
  status: "loading",
  user: null,
  lastError: null,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

const dashboardFixture = {
  data: seedDashboardData(),
  beginMigrationImport: vi.fn(),
  beginMigrationKeepCloud: vi.fn(),
  repositoryMode: "local" as "local" | "cloud",
  migrationState: {
    phase: "idle",
    hasLocalData: false,
    hasCloudData: false,
    localRecordCounts: {},
    cloudRecordCounts: {},
    markerStatus: "not_started",
    error: null,
    startedAt: null,
    completedAt: null,
    version: 1,
  },
  localPersistenceStatus: "durable" as "durable" | "degraded",
  localPersistenceError: null as string | null,
  isMutationReady: true,
  syncStatus: "synced" as const,
  lastActionError: null,
  clearLastActionError: vi.fn(),
  runQuickCapture: vi.fn(),
};

vi.mock("../src/lib/auth/useAuth", () => ({
  useAuth: () => authFixture,
}));

vi.mock("../src/lib/repositories/repositoryContext", () => ({
  useDashboard: () => dashboardFixture,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const mountShell = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      createElement(
        AppShell,
        null,
        createElement("div", { "data-testid": "shell-child" }, "Dashboard content"),
      ),
    );
  });

  return { container, root };
};

describe("AppShell authentication states", () => {
  beforeEach(() => {
    authFixture.status = "loading";
    authFixture.user = null;
    authFixture.lastError = null;
    authFixture.signInWithGoogle = vi.fn();
    authFixture.signOut = vi.fn();
    dashboardFixture.beginMigrationImport.mockReset();
    dashboardFixture.beginMigrationKeepCloud.mockReset();
    dashboardFixture.runQuickCapture.mockReset();
    dashboardFixture.runQuickCapture.mockResolvedValue({ ok: true });
    dashboardFixture.isMutationReady = true;
    dashboardFixture.repositoryMode = "local";
    dashboardFixture.localPersistenceStatus = "durable";
    dashboardFixture.localPersistenceError = null;
    dashboardFixture.migrationState.phase = "idle";
    dashboardFixture.migrationState.markerStatus = "not_started";
    dashboardFixture.migrationState.hasLocalData = false;
    dashboardFixture.migrationState.localRecordCounts = {};
    dashboardFixture.migrationState.hasCloudData = false;
    dashboardFixture.migrationState.cloudRecordCounts = {};
  });

  it("keeps the complete local shell available while auth status is resolving", () => {
    authFixture.status = "loading";
    authFixture.user = null;
    authFixture.lastError = null;

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain("Dashboard content");
      expect(container.textContent).toContain("Local mode · Checking cloud sign-in");
      expect(container.textContent).toContain("Projects");
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="Open quick capture"]')?.disabled).toBe(false);
      const signInButton = Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Checking sign-in"));
      expect(signInButton?.disabled).toBe(true);
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("lets a signed-out user open and save a local quick capture", async () => {
    authFixture.status = "unauthenticated";
    authFixture.user = null;
    authFixture.lastError = null;

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain("Dashboard content");
      expect(container.textContent).toContain("Local mode");
      expect(container.textContent).toContain("Sign in to sync");

      const quickCaptureButton = container.querySelector<HTMLButtonElement>('button[aria-label="Open quick capture"]');
      await act(async () => {
        quickCaptureButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
      const textarea = dialog?.querySelector<HTMLTextAreaElement>("textarea");
      expect(dialog?.textContent).toContain("Quick Capture");
      expect(textarea).toBeTruthy();

      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        valueSetter?.call(textarea, "Signed-out local capture");
        textarea?.dispatchEvent(new Event("input", { bubbles: true }));
        await Promise.resolve();
      });

      const saveButton = Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Save");
      expect(saveButton?.disabled).toBe(false);

      await act(async () => {
        saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(dashboardFixture.runQuickCapture).toHaveBeenCalledWith(expect.objectContaining({
        text: "Signed-out local capture",
      }));
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("shows auth/configuration failure without replacing local content", () => {
    authFixture.status = "unauthenticated";
    authFixture.user = null;
    authFixture.lastError = "Unable to reach authentication service.";

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain("Dashboard content");
      expect(container.textContent).toContain("Local mode");
      expect(container.textContent).toContain("Cloud sign-in unavailable");
      expect(container.textContent).toContain("Local data remains available");
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("clearly warns when local work is visible but not durably stored", () => {
    authFixture.status = "unauthenticated";
    dashboardFixture.localPersistenceStatus = "degraded";
    dashboardFixture.localPersistenceError =
      "Local persistence is degraded. Latest work remains visible only in this tab and is not durably stored.";

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain("Local mode · Persistence degraded");
      expect(container.textContent).toContain("visible only in this tab");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("does not expose cloud migration while signed out", () => {
    authFixture.status = "unauthenticated";
    dashboardFixture.migrationState.phase = "required";

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain("Dashboard content");
      expect(container.textContent).not.toContain("Import local backup");
      expect(dashboardFixture.beginMigrationImport).not.toHaveBeenCalled();
      const signInButton = Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Sign in to sync"));
      expect(signInButton?.disabled).toBe(false);
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("shows user profile and sign-out control when signed in", () => {
    const user: User = {
      uid: "u1",
      email: "dev@example.com",
      displayName: "Developer",
      photoURL: "https://example.com/photo.jpg",
    } as User;

    authFixture.status = "authenticated";
    authFixture.user = user;
    authFixture.lastError = null;

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain("Developer");
      expect(container.textContent).toContain("dev@example.com");
      expect(container.textContent).toContain("Sign out");
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("offers the migration flow only after sign-in", () => {
    authFixture.status = "authenticated";
    authFixture.user = {
      uid: "u1",
      email: "dev@example.com",
      displayName: "Developer",
    } as User;
    dashboardFixture.migrationState.phase = "required";

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain("Import local backup");
      expect(container.textContent).toContain("Cloud is empty. Import local data to start cloud sync.");
      expect(container.textContent).toContain("Local mode · Cloud sync synced");
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("requires explicit account association for ownerless legacy recovery", () => {
    authFixture.status = "authenticated";
    authFixture.user = {
      uid: "u1",
      email: "dev@example.com",
      displayName: "Developer",
    } as User;
    dashboardFixture.migrationState.phase = "required";
    dashboardFixture.migrationState.markerStatus = "legacy_recovery_unassigned";
    dashboardFixture.migrationState.hasLocalData = true;
    dashboardFixture.migrationState.localRecordCounts = { projects: 1 };

    const { container, root } = mountShell();

    try {
      expect(container.textContent).toContain(
        "Legacy recovery is local-only until you explicitly associate it with this account.",
      );
      expect(container.textContent).toContain("Associate recovery and import");
      expect(container.textContent).not.toContain("Import local backup");
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("offers and invokes keep-cloud when authenticated cloud data already exists", async () => {
    authFixture.status = "authenticated";
    authFixture.user = {
      uid: "u1",
      email: "dev@example.com",
      displayName: "Developer",
    } as User;
    dashboardFixture.migrationState.phase = "required";
    dashboardFixture.migrationState.hasCloudData = true;
    dashboardFixture.migrationState.cloudRecordCounts = { projects: 1 };
    dashboardFixture.beginMigrationKeepCloud.mockResolvedValue(undefined);

    const { container, root } = mountShell();

    try {
      const keepCloudButton = Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Keep cloud data"));
      expect(keepCloudButton).toBeTruthy();

      await act(async () => {
        keepCloudButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(dashboardFixture.beginMigrationKeepCloud).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });

  it("calls signOut when sign-out button is clicked", () => {
    const user: User = {
      uid: "u1",
      email: "dev@example.com",
      displayName: "Developer",
      photoURL: "https://example.com/photo.jpg",
    } as User;

    authFixture.status = "authenticated";
    authFixture.user = user;
    authFixture.signOut = vi.fn();
    authFixture.lastError = null;

    const { container, root } = mountShell();

    try {
      const signOutButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Sign out"),
      ) as HTMLButtonElement | undefined;

      expect(signOutButton).toBeTruthy();
      act(() => {
        signOutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(authFixture.signOut).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
      document.body.innerHTML = "";
    }
  });
});
