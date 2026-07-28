import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { QUICK_CAPTURE_PREFERENCES_KEY } from "../src/lib/constants";
import { QuickCaptureDialog } from "../src/components/QuickCaptureDialog";

const projects = [
  { id: "22222222-2222-4222-8222-222222222221", title: "GridlineAI" },
  { id: "33333333-3333-4333-8333-333333333331", title: "Time Left To Live" },
  { id: "44444444-4444-4444-8444-444444444441", title: "Developer Dashboard" },
] as const;

const runQuickCapture = vi.fn();

vi.mock("../src/lib/repositories/repositoryContext", () => ({
  useDashboard: () => ({
    data: { projects },
    runQuickCapture,
  }),
}));

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("QuickCaptureDialog", () => {
  let originalConfirm = window.confirm;

  beforeEach(() => {
    localStorage.clear();
    runQuickCapture.mockReset();
    runQuickCapture.mockImplementation(() => undefined);
    originalConfirm = window.confirm;
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    document.body.innerHTML = "";
  });

  const renderDialog = ({
    open = true,
    projectId,
    onClose = vi.fn(),
  }: {
    open?: boolean;
    projectId?: string;
    onClose?: () => void;
  }) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    document.body.appendChild(container);

    act(() => {
      root.render(
        createElement(QuickCaptureDialog, {
          open,
          onClose,
          projectId,
        }),
      );
    });

    return {
      container,
      root,
      onClose,
      close: () => {
        act(() => {
          root.unmount();
        });
      },
    };
  };

  const setTextareaValue = (textarea: HTMLTextAreaElement, value: string) => {
    textarea.value = value;
    act(() => {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  const setCheckboxValue = (checkbox: HTMLInputElement, checked: boolean) => {
    act(() => {
      checkbox.checked = checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("opens and autofocuses text area", async () => {
    const { container, close } = renderDialog({ projectId: projects[0].id });

    await flushMicrotasks();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);

    close();
  });

  it("prefills with requested project id when opened from project page", async () => {
    const { container, close } = renderDialog({
      projectId: projects[1].id,
    });

    await flushMicrotasks();

    const projectButton = container.querySelector('[aria-label="Select quick capture project"]') as HTMLButtonElement;
    expect(projectButton.textContent).toContain("Time Left To Live");

    close();
  });

  it("falls back to most recent project preference when no requested project is set", async () => {
    localStorage.setItem(
      QUICK_CAPTURE_PREFERENCES_KEY,
      JSON.stringify({
        lastProjectId: projects[1].id,
        recentProjects: [projects[1].id, projects[0].id],
      }),
    );

    const { container, close } = renderDialog({});

    await flushMicrotasks();

    const projectButton = container.querySelector('[aria-label="Select quick capture project"]') as HTMLButtonElement;
    expect(projectButton.textContent).toContain("Time Left To Live");

    close();
  });

  it("submits quickly with keyboard shortcut and closes when no add another", async () => {
    const onClose = vi.fn();
    const { container, close } = renderDialog({ projectId: projects[0].id, onClose });

    await flushMicrotasks();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    setTextareaValue(textarea, "Capture by shortcut");

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await flushMicrotasks();

    expect(runQuickCapture).toHaveBeenCalledWith({
      projectId: projects[0].id,
      text: "Capture by shortcut",
      classification: "idea",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runQuickCapture).toHaveBeenCalled();

    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");

    close();
  });

  it("supports save and add another", async () => {
    const { container, close } = renderDialog({ projectId: projects[0].id });

    await flushMicrotasks();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    setTextareaValue(textarea, "first quick thought");

    const addAnother = Array.from(container.querySelectorAll("input"))
      .find((input) => input.type === "checkbox") as HTMLInputElement;
    setCheckboxValue(addAnother, true);

    act(() => {
      window.dispatchEvent(new Event("developer-dashboard:quick-capture-save"));
    });

    await flushMicrotasks();

    expect(runQuickCapture).toHaveBeenCalledTimes(1);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");

    const raw = localStorage.getItem(QUICK_CAPTURE_PREFERENCES_KEY);
    expect(raw).toBeTruthy();
    const prefs = JSON.parse(raw || "{}");
    expect(prefs.lastProjectId).toBe(projects[0].id);
    expect(prefs.recentProjects.includes(projects[0].id)).toBe(true);

    close();
  });

  it("keeps entered text when save fails", async () => {
    runQuickCapture.mockImplementation(() => {
      throw new Error("capture failed");
    });

    const { container, close } = renderDialog({ projectId: projects[0].id });

    await flushMicrotasks();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    setTextareaValue(textarea, "preserve this text");
    await flushMicrotasks();

    act(() => {
      window.dispatchEvent(new Event("developer-dashboard:quick-capture-save"));
    });

    await flushMicrotasks();

    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("preserve this text");
    const status = container.querySelector("span[aria-live='polite']") as HTMLSpanElement;
    expect(status.textContent).toContain("Could not save capture");

    close();
  });

  it("warns when closing with unsaved text and preserves the draft", async () => {
    const onClose = vi.fn(() => undefined);
    const { container, close } = renderDialog({ projectId: projects[0].id, onClose });
    await flushMicrotasks();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    setTextareaValue(textarea, "do not discard this");
    await flushMicrotasks();

    window.confirm = vi.fn(() => false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    await flushMicrotasks();

    expect(onClose).not.toHaveBeenCalled();
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("do not discard this");
    close();
  });

  it("closes after user confirms draft discard", async () => {
    const onClose = vi.fn(() => undefined);
    const { container, close } = renderDialog({ projectId: projects[0].id, onClose });
    await flushMicrotasks();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    setTextareaValue(textarea, "throw this away");

    window.confirm = vi.fn(() => true);

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
    close();
  });
});
