import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDashboardData } from "../src/lib/seed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = seedDashboardData();
const task = data.tasks[0];
const project = data.projects.find((candidate) => candidate.id === task.projectId)!;

const fixture = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  params: { projectId: "", taskId: "" },
}));

vi.mock("next/navigation", () => ({ useParams: () => fixture.params }));
vi.mock("../src/lib/repositories/repositoryContext", () => ({ useDashboard: () => fixture.current }));

import TaskDetailPage from "../src/app/projects/[projectId]/tasks/[taskId]/page";

const mount = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(TaskDetailPage)));
  return { container, close: () => act(() => root.unmount()) };
};

describe("focused task detail", () => {
  beforeEach(() => {
    fixture.params = { projectId: project.id, taskId: task.id };
    fixture.current = {
      data,
      updateTask: vi.fn(),
      setTaskStatus: vi.fn(),
      createTaskPromptRecord: vi.fn(() => ({ sequenceNumber: 2 })),
      startTaskWorkSession: vi.fn(),
      pauseTaskWorkSession: vi.fn(),
      resumeTaskWorkSession: vi.fn(),
      finishTaskWorkSession: vi.fn(),
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows one focused task workflow with bounded history sections", () => {
    const view = mount();
    try {
      expect(view.container.querySelector("h1")?.textContent).toBe(task.title);
      expect(view.container.textContent).toContain("Next recommended step");
      expect(view.container.textContent).toContain("Total active time");
      expect(view.container.textContent).toContain("Prompt history");
      expect(view.container.textContent).toContain("Task timeline");
      expect(view.container.querySelectorAll("details").length).toBeGreaterThan(0);
      expect(view.container.scrollWidth).toBeLessThanOrEqual(view.container.clientWidth || view.container.scrollWidth);
    } finally {
      view.close();
    }
  });

  it("stores the mandatory summary before exposing the generated Codex prompt", async () => {
    const view = mount();
    try {
      const summaryField = Array.from(view.container.querySelectorAll("textarea"))
        .find((field) => field.getAttribute("placeholder")?.startsWith("Plain-language summary"));
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(summaryField, "Add the task workflow to the shared dashboard.");
        summaryField?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const submit = Array.from(view.container.querySelectorAll("button"))
        .find((button) => button.textContent === "Save and prepare prompt");
      await act(async () => submit?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

      const createPrompt = fixture.current.createTaskPromptRecord as ReturnType<typeof vi.fn>;
      expect(createPrompt).toHaveBeenCalledWith(expect.objectContaining({
        taskId: task.id,
        summary: "Add the task workflow to the shared dashboard.",
        source: "chatgpt",
      }));
      const fullPrompt = createPrompt.mock.calls[0][0].prompt as string;
      expect(fullPrompt.trimEnd().endsWith("Add the task workflow to the shared dashboard.")).toBe(true);
      expect(view.container.textContent).toContain("Prompt 2 saved before Codex work begins.");
    } finally {
      view.close();
    }
  });
});
