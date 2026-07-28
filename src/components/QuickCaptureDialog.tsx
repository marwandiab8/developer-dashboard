"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QUICK_CAPTURE_PREFERENCES_KEY, QUICK_CAPTURE_RECENT_LIMIT } from "../lib/constants";
import { useDashboard } from "../lib/repositories/repositoryContext";
import type { CaptureClassification } from "../lib/models";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId?: string;
};

type QuickCapturePrefs = {
  lastProjectId: string | null;
  recentProjects: string[];
};

const quickCaptureDefault: QuickCapturePrefs = {
  lastProjectId: null,
  recentProjects: [],
};

function readPrefs(): QuickCapturePrefs {
  if (typeof window === "undefined") return quickCaptureDefault;
  try {
    const raw = window.localStorage.getItem(QUICK_CAPTURE_PREFERENCES_KEY);
    if (!raw) return quickCaptureDefault;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return quickCaptureDefault;
    return {
      lastProjectId:
        typeof parsed.lastProjectId === "string" && parsed.lastProjectId ? parsed.lastProjectId : null,
      recentProjects: Array.isArray(parsed.recentProjects)
        ? parsed.recentProjects.filter((item: unknown): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return quickCaptureDefault;
  }
}

function writePrefs(next: QuickCapturePrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUICK_CAPTURE_PREFERENCES_KEY, JSON.stringify(next));
}

function mergeRecentProjectIds(projectId: string, previous: QuickCapturePrefs["recentProjects"]) {
  const entries = [projectId, ...previous.filter((entry) => entry !== projectId)];
  return entries.slice(0, QUICK_CAPTURE_RECENT_LIMIT);
}

const classificationOptions: CaptureClassification[] = ["idea", "brain_dump", "task", "bug", "note", "scratchpad"];

export function QuickCaptureDialog({ open, onClose, projectId: requestedProjectId }: Props) {
  const { data, runQuickCapture } = useDashboard();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [projectId, setProjectId] = useState(() => {
    const fallbackPrefs = readPrefs();
    return requestedProjectId || fallbackPrefs.lastProjectId || "";
  });
  const [text, setText] = useState("");
  const [classification, setClassification] = useState<CaptureClassification>("idea");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveAndAddAnother, setSaveAndAddAnother] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [prefs, setPrefs] = useState<QuickCapturePrefs>(readPrefs);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef("");

  const projects = data.projects;
  const currentProject = data.projects.find((item) => item.id === requestedProjectId) ?? null;

  const projectCandidates = useMemo(() => {
    const current = currentProject ? [currentProject] : [];
    const recent = prefs.recentProjects
      .map((id: string) => projects.find((entry) => entry.id === id))
      .filter((entry): entry is (typeof projects)[number] => entry !== undefined && entry.id !== currentProject?.id);

    const seen = new Set(current.map((entry) => entry.id));
    recent.forEach((entry) => {
      seen.add(entry.id);
    });

    const rest = projects
      .filter((entry) => !seen.has(entry.id))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

    return [...current, ...recent, ...rest];
  }, [currentProject, prefs.recentProjects, projects]);

  const showProjectSearch = projectCandidates.length > 6;

  const filteredCandidates = useMemo(() => {
    if (!showProjectSearch || !projectSearch.trim()) return projectCandidates;

    const query = projectSearch.toLowerCase();
    return projectCandidates.filter((project) => project.title.toLowerCase().includes(query));
  }, [projectCandidates, projectSearch, showProjectSearch]);

  const canSubmit = Boolean(projectId) && text.trim().length > 0 && !isSaving;

  const hasUnsavedText = useCallback(
    () => {
      const current = textRef.current || textareaRef.current?.value || dialogRef.current?.querySelector("textarea")?.value || "";
      return Boolean((current || "").trim());
    },
    [],
  );

  const getDraftText = useCallback(() => {
    return (textRef.current || textareaRef.current?.value || "").trim();
  }, []);


  const applyPrefs = useCallback(() => {
    const nextPrefs = readPrefs();
    setPrefs(nextPrefs);
    setProjectId((current) => current || requestedProjectId || nextPrefs.lastProjectId || data.projects[0]?.id || current);
  }, [data.projects, requestedProjectId]);

  const setProjectAndClosePicker = useCallback((nextProjectId: string) => {
    setProjectId(nextProjectId);
    setProjectPickerOpen(false);
    setProjectSearch("");
  }, []);

  const performSubmit = useCallback(() => {
    const draftText = getDraftText();
    if (!Boolean(projectId) || !draftText || isSaving) return;

    setIsSaving(true);
    setStatus("");

    try {
      runQuickCapture({
        projectId,
        text: draftText,
        classification,
      });
      setStatus(saveAndAddAnother ? "Saved. Add another." : "Saved.");

      writePrefs({
        lastProjectId: projectId,
        recentProjects: mergeRecentProjectIds(projectId, prefs.recentProjects),
      });

      if (saveAndAddAnother) {
        setText("");
        setSaveAndAddAnother(false);
      } else {
        setText("");
        setClassification("idea");
        onClose();
      }
    } catch {
      setStatus("Could not save capture. Try again.");
    } finally {
      setIsSaving(false);
      setPrefs(readPrefs());
    }
  }, [classification, getDraftText, isSaving, onClose, prefs.recentProjects, projectId, runQuickCapture, saveAndAddAnother]);

  const closeRequest = useCallback(() => {
    if (hasUnsavedText() && !window.confirm("Discard unsaved capture text?")) {
      return;
    }

    setStatus("");
    setText("");
    onClose();
  }, [hasUnsavedText, onClose]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    performSubmit();
  };

  const onProjectSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setProjectSearch(event.target.value);
  };

  const onClassificationChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setClassification(event.target.value as CaptureClassification);
  };

  const onProjectIdChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setProjectId(event.target.value);
  };

  const onTextInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const next = event.currentTarget.value;
    textRef.current = next;
    setText(next);
  };

  const onTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onTextInput(event);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    queueMicrotask(() => {
      applyPrefs();
      textRef.current = "";
      setText("");
      setProjectSearch("");
      setProjectPickerOpen(false);
      setSaveAndAddAnother(false);
      setAdvancedOpen(false);
      setClassification("idea");
      setStatus("");
      textareaRef.current?.focus();
    });

    const focusables = () =>
      dialogRef.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ??
      [];

    const handleTrap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const items = focusables();
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleTrap);
    return () => {
      window.removeEventListener("keydown", handleTrap);
    };
  }, [applyPrefs, open, requestedProjectId]);

  useEffect(() => {
    if (!open) return;

    const onSave = () => {
      performSubmit();
    };

    const onCloseEvent = () => {
      closeRequest();
    };

    const onEscape = (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (hasUnsavedText()) {
          const shouldClose = window.confirm("Discard unsaved capture text?");
          if (!shouldClose) {
            setStatus("Press Close to keep text, or empty it first.");
            return;
          }
          setStatus("");
        }
        closeRequest();
      }
      };

    window.addEventListener("developer-dashboard:quick-capture-save", onSave);
    window.addEventListener("developer-dashboard:quick-capture-close", onCloseEvent);
    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("developer-dashboard:quick-capture-save", onSave);
      window.removeEventListener("developer-dashboard:quick-capture-close", onCloseEvent);
      window.removeEventListener("keydown", onEscape);
    };
  }, [closeRequest, hasUnsavedText, open, performSubmit]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeRequest();
        }
      }}
      ref={dialogRef}
    >
      <section
        className="max-h-[95vh] w-full overflow-hidden rounded-t-3xl border border-slate-200 bg-white sm:max-w-3xl sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-capture-title"
      >
        <form className="flex h-full flex-col" onSubmit={onSubmit}>
          <header className="border-b border-slate-200 px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="quick-capture-title" className="text-lg font-semibold leading-tight">
                  Quick Capture
                </h2>
                <p className="mt-1 text-sm text-slate-500">Project + idea first. Save fast.</p>
              </div>
              <button
                type="button"
                className="dd-btn dd-btn--secondary px-3 py-2"
                onClick={closeRequest}
                aria-label="Close quick capture"
              >
                Close
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-auto px-4 py-3 sm:px-6">
            <label className="block">
              <span className="text-sm font-medium">Project</span>
              {projectCandidates.length > 1 ? (
                <div className="mt-1">
                  <button
                    type="button"
                    className="dd-btn dd-btn--secondary min-h-[44px] w-full justify-start"
                    onClick={() => setProjectPickerOpen((current) => !current)}
                    aria-expanded={projectPickerOpen}
                    aria-controls="project-picker-list"
                    aria-label="Select quick capture project"
                  >
                    {projectCandidates.find((item) => item.id === projectId)?.title || "Choose project"}
                  </button>

                  {projectPickerOpen ? (
                    <div className="dd-section mt-2">
                      {showProjectSearch ? (
                        <input
                          type="search"
                          value={projectSearch}
                          onChange={onProjectSearchChange}
                          className="dd-input min-h-[42px] text-sm"
                          placeholder="Filter projects"
                          autoComplete="off"
                          inputMode="search"
                        />
                      ) : null}

                      <div id="project-picker-list" className="mt-2 max-h-48 space-y-1 overflow-auto rounded-lg border border-slate-200 p-1">
                        {filteredCandidates.length > 0 ? (
                          filteredCandidates.map((project, index) => (
                            <button
                              type="button"
                              key={project.id}
                              onClick={() => setProjectAndClosePicker(project.id)}
                              className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                                project.id === projectId ? "bg-slate-100 font-medium" : "hover:bg-slate-50"
                              }`}
                            >
                              {index === 0 && requestedProjectId === project.id
                                ? `${project.title} (current)`
                                : prefs.recentProjects.includes(project.id)
                                  ? `${project.title} (recent)`
                                  : project.title}
                            </button>
                          ))
                        ) : (
                          <p className="px-2 py-2 text-sm text-slate-500">No projects match</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <select
                  value={projectId}
                  onChange={onProjectIdChange}
                  className="dd-input mt-1 min-h-[44px] text-sm"
                >
                  {projectCandidates.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <label className="block">
              <span className="text-sm font-medium">Capture text</span>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={onTextChange}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    performSubmit();
                  }
                }}
                onInput={onTextInput}
                className="mt-1 min-h-44 w-full rounded-lg border border-slate-300 px-3 py-2 text-base leading-relaxed"
                placeholder="Capture a thought, requirement, bug, or task..."
                required
              />
            </label>

            <button
              type="button"
              className="text-sm font-medium text-slate-700 underline underline-offset-4"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              {advancedOpen ? "Hide optional fields" : "More options"}
            </button>

            {advancedOpen ? (
              <label className="block">
                <span className="text-sm font-medium">Classification</span>
                <select
                  value={classification}
                  onChange={onClassificationChange}
                  className="dd-input mt-1 min-h-[44px] text-sm"
                >
                  {classificationOptions.map((item) => (
                    <option key={item} value={item}>
                      {item === "brain_dump" ? "Brain Dump" : item.charAt(0).toUpperCase() + item.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={saveAndAddAnother}
                onChange={(event) => setSaveAndAddAnother(event.target.checked)}
              />
              <span className="text-sm">Save and add another</span>
            </label>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
            <span className="text-xs text-slate-600" aria-live="polite">
              {status || "Ready"}
            </span>
            <button
              type="submit"
              className="dd-btn dd-btn--primary min-h-[44px] px-4 py-2"
              disabled={!canSubmit}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
