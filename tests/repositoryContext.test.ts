import { renderToString } from "react-dom/server";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { beforeEach } from "vitest";
import { DashboardProvider } from "../src/lib/repositories/repositoryContext";
import { useDashboard } from "../src/lib/repositories/repositoryContext";
import { STORAGE_KEY } from "../src/lib/constants";
import { seedDashboardData } from "../src/lib/seed";

describe("repository provider loading state", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("renders a deterministic loading state before client hydration", () => {
    const markup = renderToString(
      React.createElement(DashboardProvider, null, React.createElement("div", null, "DASHBOARD_MARKER")),
    );

    expect(markup).toContain("Loading dashboard data...");
    expect(markup).not.toContain("DASHBOARD_MARKER");
  });

  it("hydrates from persisted localStorage after mount and replaces loading state", async () => {
    const seeded = seedDashboardData();
    const hydratedData = {
      ...seeded,
      projects: seeded.projects.map((project, index) =>
        index === 0 ? { ...project, title: "Hydrated project title" } : project,
      ),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(hydratedData));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe() {
      const { data } = useDashboard();
      return React.createElement("div", null, data.projects[0]?.title);
    }

    act(() => {
      root.render(React.createElement(DashboardProvider, null, React.createElement(Probe)));
    });

    try {
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(container.textContent).toContain("Hydrated project title");
    } finally {
      act(() => {
        root.unmount();
      });
    }
  });
});
