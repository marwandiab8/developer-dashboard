"use client";

import { FormEvent } from "react";
import { useEffect, useRef } from "react";

type ShortcutRow = {
  keys: string;
  description: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUTS: ShortcutRow[] = [
  { keys: "C or N", description: "Open Quick Capture" },
  { keys: "⌘/Ctrl + K", description: "Open global search" },
  { keys: "⌘/Ctrl + Enter", description: "Save in open quick form" },
  { keys: "Escape", description: "Close an open dialog/menu when safe" },
  { keys: "G then D", description: "Go to Dashboard" },
  { keys: "G then P", description: "Go to Projects" },
  { keys: "G then I", description: "Go to Ideas" },
  { keys: "G then T", description: "Go to Tasks" },
  { keys: "G then S", description: "Go to Sessions" },
  { keys: "?", description: "Open keyboard shortcuts help" },
];

export function ShortcutHelpDialog({ open, onClose }: Props) {
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    onClose();
  };

  const dialogRef = useRef<HTMLFormElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
      previous?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-6">
      <form
        ref={dialogRef}
        className="max-h-[85vh] w-full rounded-t-3xl border border-slate-200 bg-white p-4 sm:max-w-lg sm:rounded-3xl"
        onSubmit={onSubmit}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            ref={closeButtonRef}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            aria-label="Close keyboard shortcuts help"
          >
            Close
          </button>
        </div>
        <div className="max-h-[66vh] space-y-2 overflow-auto pr-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2">
              <kbd className="min-w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold">
                {shortcut.keys}
              </kbd>
              <p className="text-slate-700">{shortcut.description}</p>
            </div>
          ))}
        </div>
      </form>
    </div>
  );
}
