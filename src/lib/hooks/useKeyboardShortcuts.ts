import { useEffect, useRef } from "react";
import { KEYBOARD_CHORD_TIMEOUT_MS } from "../constants";

export type ShortcutAction = () => void;

export interface KeyboardShortcutHandlers {
  openQuickCapture: (projectId?: string) => void;
  openSearch: ShortcutAction;
  saveCurrent: ShortcutAction;
  closeActive: ShortcutAction;
  help: ShortcutAction;
  navigate: (path: string) => void;
}

export interface KeyboardShortcutConfig {
  enabled?: boolean;
  handlers: KeyboardShortcutHandlers;
}

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;

  const tagName = target.tagName.toLowerCase();
  const editable = target.getAttribute("contenteditable");
  const role = target.getAttribute("role");
  const ariaEditable = target.getAttribute("aria-readonly");
  const hasShortcutBlock =
    target.closest("[data-shortcut-skip]") ||
    target.closest("[data-shortcut-ignore]") ||
    target.classList.contains("markdown-editor") ||
    target.closest("[data-markdown-editor]");

  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "option" ||
    Boolean(hasShortcutBlock) ||
    editable === "true" ||
    role === "textbox" ||
    ariaEditable === "true" ||
    (target as HTMLElement).isContentEditable
  );
};

export function useKeyboardShortcuts(config: KeyboardShortcutConfig) {
  const { handlers } = config;
  const enabled = config.enabled ?? true;
  const chordTimeout = useRef<number | null>(null);
  const awaitingChord = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const clearChord = () => {
      if (chordTimeout.current !== null) {
        window.clearTimeout(chordTimeout.current);
        chordTimeout.current = null;
      }
      awaitingChord.current = false;
    };

    const normalizeKey = (event: KeyboardEvent) => event.key.toLowerCase();

    const navigateTo = (path: string, event: KeyboardEvent) => {
      event.preventDefault();
      handlers.navigate(path);
      clearChord();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isEditableTarget(event.target)) return;
      if (awaitingChord.current) {
        const pressed = normalizeKey(event);
        awaitingChord.current = false;
        if (chordTimeout.current !== null) {
          window.clearTimeout(chordTimeout.current);
          chordTimeout.current = null;
        }

        if (pressed === "d") {
          navigateTo("/", event);
          return;
        }
        if (pressed === "p") {
          navigateTo("/projects", event);
          return;
        }
        if (pressed === "i") {
          navigateTo("/ideas", event);
          return;
        }
        if (pressed === "t") {
          navigateTo("/tasks", event);
          return;
        }
        if (pressed === "s") {
          navigateTo("/sessions", event);
          return;
        }

        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const key = normalizeKey(event);
        if (key === "k") {
          event.preventDefault();
          handlers.openSearch();
          return;
        }

        if (key === "enter") {
          event.preventDefault();
          handlers.saveCurrent();
          return;
        }
      }

      const key = normalizeKey(event);

      if (key === "?") {
        event.preventDefault();
        handlers.help();
        return;
      }

      if (key === "c" || key === "n") {
        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          handlers.openQuickCapture(undefined);
          return;
        }
      }

      if (key === "escape") {
        event.preventDefault();
        handlers.closeActive();
        return;
      }

      if (key === "g" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        awaitingChord.current = true;
        chordTimeout.current = window.setTimeout(() => {
          awaitingChord.current = false;
          chordTimeout.current = null;
        }, KEYBOARD_CHORD_TIMEOUT_MS);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearChord();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, handlers]);
}
