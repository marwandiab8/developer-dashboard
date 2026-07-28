import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useKeyboardShortcuts } from "../src/lib/hooks/useKeyboardShortcuts";

function TestHarness({
  openQuickCapture,
  openSearch,
  saveCurrent,
  closeActive,
  help,
  navigate,
}: {
  openQuickCapture: () => void;
  openSearch: () => void;
  saveCurrent: () => void;
  closeActive: () => void;
  help: () => void;
  navigate: (path: string) => void;
}) {
  useKeyboardShortcuts({
    handlers: {
      openQuickCapture,
      openSearch,
      saveCurrent,
      closeActive,
      help,
      navigate,
    },
  });
  return null;
}

describe("keyboard shortcut behavior", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    container.remove();
  });

  const dispatch = (target: EventTarget, event: KeyboardEventInit) => {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...event }));
    });
  };

  const mount = (handlers: {
    openQuickCapture: () => void;
    openSearch: () => void;
    saveCurrent: () => void;
    closeActive: () => void;
    help: () => void;
    navigate: (path: string) => void;
  }) => {
    const root = createRoot(container);
    act(() => {
      root.render(
        createElement(TestHarness, {
          openQuickCapture: handlers.openQuickCapture,
          openSearch: handlers.openSearch,
          saveCurrent: handlers.saveCurrent,
          closeActive: handlers.closeActive,
          help: handlers.help,
          navigate: handlers.navigate,
        }),
      );
    });
    return () => act(() => root.unmount());
  };

  it("opens quick capture with C when focus is outside editable fields", () => {
    const openQuickCapture = vi.fn();
    const openSearch = vi.fn();
    const saveCurrent = vi.fn();
    const closeActive = vi.fn();
    const help = vi.fn();
    const navigate = vi.fn();

    const unmount = mount({ openQuickCapture, openSearch, saveCurrent, closeActive, help, navigate });

    dispatch(window, { key: "c" });

    expect(openQuickCapture).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not open quick capture when editing text input fields", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();

    const openQuickCapture = vi.fn();
    const openSearch = vi.fn();
    const saveCurrent = vi.fn();
    const closeActive = vi.fn();
    const help = vi.fn();
    const navigate = vi.fn();

    const unmount = mount({ openQuickCapture, openSearch, saveCurrent, closeActive, help, navigate });

    dispatch(input, { key: "c" });

    expect(openQuickCapture).not.toHaveBeenCalled();
    unmount();
    input.remove();
  });

  it("does not open quick capture when typing in contenteditable markdown style editors", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.className = "markdown-editor";
    editor.tabIndex = 0;
    editor.textContent = "";
    document.body.appendChild(editor);
    editor.focus();

    const openQuickCapture = vi.fn();
    const openSearch = vi.fn();
    const saveCurrent = vi.fn();
    const closeActive = vi.fn();
    const help = vi.fn();
    const navigate = vi.fn();

    const unmount = mount({ openQuickCapture, openSearch, saveCurrent, closeActive, help, navigate });

    dispatch(editor, {
      key: "c",
      bubbles: true,
      cancelable: true,
    });

    expect(openQuickCapture).not.toHaveBeenCalled();
    unmount();
    editor.remove();
  });

  it("opens global search with Command/Ctrl+K and saves with Command/Ctrl+Enter", () => {
    const openQuickCapture = vi.fn();
    const openSearch = vi.fn();
    const saveCurrent = vi.fn();
    const closeActive = vi.fn();
    const help = vi.fn();
    const navigate = vi.fn();

    const unmount = mount({ openQuickCapture, openSearch, saveCurrent, closeActive, help, navigate });

    dispatch(window, { key: "k", metaKey: true });
    dispatch(window, { key: "Enter", metaKey: true });

    expect(openSearch).toHaveBeenCalledTimes(1);
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("supports chord shortcuts for navigation", () => {
    const openQuickCapture = vi.fn();
    const openSearch = vi.fn();
    const saveCurrent = vi.fn();
    const closeActive = vi.fn();
    const help = vi.fn();
    const navigate = vi.fn();

      const unmount = mount({ openQuickCapture, openSearch, saveCurrent, closeActive, help, navigate });

      dispatch(window, { key: "g" });
      dispatch(window, { key: "d" });
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith("/");

      unmount();
  });

  it("opens shortcut help with ? and closes actions with Escape", () => {
    const openQuickCapture = vi.fn();
    const openSearch = vi.fn();
    const saveCurrent = vi.fn();
    const closeActive = vi.fn();
    const help = vi.fn();
    const navigate = vi.fn();

    const unmount = mount({ openQuickCapture, openSearch, saveCurrent, closeActive, help, navigate });

    dispatch(window, { key: "?" });
    dispatch(window, { key: "Escape" });

    expect(help).toHaveBeenCalledTimes(1);
    expect(closeActive).toHaveBeenCalledTimes(1);
    unmount();
  });
});
