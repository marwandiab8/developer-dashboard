"use client";

import Link from "next/link";
import { useMemo, useState, FormEvent } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { GitHubProjectMetadata } from "../../../components/GitHubProjectMetadata";
import { PROJECT_SECTIONS } from "../../../lib/constants";
import { generateAiContext } from "../../../lib/markdown/generateAiContext";
import { generateProjectResume } from "../../../lib/markdown/generateProjectResume";
import { useDashboard } from "../../../lib/repositories/repositoryContext";
import type { Idea, Task, BrainDump, DevelopmentSession, ArchitectureDecision, CodexPrompt, Note, ImportantLink } from "../../../lib/models";
import { toDisplayDate, toShortDisplayDate } from "../../../lib/utils/time";

const sectionLabels: Record<string, string> = {
  workbench: "Overview",
  ideas: "Ideas",
  tasks: "Tasks",
  "brain-dump": "Brain Dump",
  scratchpad: "Scratchpad",
  sessions: "Sessions",
  architecture: "Architecture",
  "codex-prompts": "Codex Prompts",
  notes: "Notes",
  links: "Important Links",
  resume: "Project Resume",
  "ai-context": "AI Context",
  activity: "History",
};

const primarySections = ["workbench", "tasks", "ideas"] as const;
const moreSections = [
  "activity",
  "sessions",
  "brain-dump",
  "scratchpad",
  "notes",
  "links",
  "architecture",
  "codex-prompts",
  "resume",
  "ai-context",
] as const;

function copyToClipboard(value: string) {
  if (typeof navigator !== "undefined") {
    void navigator.clipboard.writeText(value);
  }
}

function downloadTextFile(filename: string, content: string) {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sectionFromSearch(section: string | null) {
  if (section && PROJECT_SECTIONS.includes(section as (typeof PROJECT_SECTIONS)[number])) {
    return section;
  }
  return "workbench";
}

export default function ProjectWorkbenchPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const section = sectionFromSearch(searchParams.get("section"));
  const {
    data,
    addIdea,
    updateIdea,
    archiveIdea,
    convertIdeaToTask,
    addTask,
    startTask,
    blockTask,
    completeTask,
    addBrainDump,
    convertBrainDumpToIdea,
    convertBrainDumpToTask,
    deleteBrainDump,
    updateBrainDump,
    updateScratchpad,
    getProjectScratchpad,
    upsertDecision,
    updateDecisionStatus,
    upsertPrompt,
    markPromptUsed,
    addNote,
    updateNote,
    addLink,
    startSession,
    endSession,
    appendSessionNote,
  } = useDashboard();

  const project = data.projects.find((item) => item.id === projectId);
  const projectIdeas = data.ideas.filter((item) => item.projectId === projectId);
  const projectTasks = data.tasks.filter((item) => item.projectId === projectId);
  const projectBrainDumps = data.brainDumps.filter((item) => item.projectId === projectId);
  const projectSessions = data.developmentSessions
    .filter((item) => item.projectId === projectId)
    .sort(
      (a, b) =>
        new Date(b.endedAt ?? b.startedAt).getTime()
        - new Date(a.endedAt ?? a.startedAt).getTime(),
    );
  const projectDecisions = data.architectureDecisions.filter((item) => item.projectId === projectId);
  const projectPrompts = data.codexPrompts
    .filter((item) => item.projectId === projectId)
    .sort(
      (a, b) =>
        new Date(b.lastUsedAt ?? b.updatedAt).getTime()
        - new Date(a.lastUsedAt ?? a.updatedAt).getTime(),
    );
  const projectNotes = data.notes.filter((item) => item.projectId === projectId);
  const projectLinks = data.importantLinks.filter((item) => item.projectId === projectId);
  const projectActivity = data.activities.filter((item) => item.projectId === projectId);
  const activeSession = projectSessions.find((session) => session.status === "active");
  const latestSession = projectSessions[0];
  const continuitySession = activeSession ?? latestSession;

  const scratchpadText = project ? getProjectScratchpad(projectId)?.markdown || "" : "";
  const resumeText = useMemo(
    () => (project ? generateProjectResume(data, projectId) : ""),
    [data, project, projectId],
  );
  const contextText = useMemo(
    () => (project ? generateAiContext(data, projectId) : ""),
    [data, project, projectId],
  );

  const [ideaText, setIdeaText] = useState("");
  const [ideaDescription, setIdeaDescription] = useState("");
  const [ideaStatus, setIdeaStatus] = useState<Idea["status"]>("inbox");
  const [ideaPriority, setIdeaPriority] = useState<Idea["priority"]>("medium");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskType, setTaskType] = useState<Task["type"]>("feature");
  const [taskPriority, setTaskPriority] = useState<Task["priority"]>("medium");

  const [brainText, setBrainText] = useState("");
  const [scratchpadDraft, setScratchpadDraft] = useState(scratchpadText);

  const [searchIdea, setSearchIdea] = useState("");

  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionContext, setDecisionContext] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [decisionCons, setDecisionCons] = useState("");
  const [decisionAlt, setDecisionAlt] = useState("");

  const [promptTitle, setPromptTitle] = useState("");
  const [promptPurpose, setPromptPurpose] = useState("");
  const [promptBody, setPromptBody] = useState("");
  const [promptResult, setPromptResult] = useState("");

  const [noteTitle, setNoteTitle] = useState("");
  const [noteSection, setNoteSection] = useState("notes");
  const [noteMarkdown, setNoteMarkdown] = useState("");

  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const [sessionObjective, setSessionObjective] = useState("");
  const [sessionSummary, setSessionSummary] = useState("");
  const [sessionNext, setSessionNext] = useState("");
  const [sessionCompletedItems, setSessionCompletedItems] = useState("");
  const [sessionProblems, setSessionProblems] = useState("");
  const [sessionNextStart, setSessionNextStart] = useState("");

  const [resumeCopyStatus, setResumeCopyStatus] = useState("");

  const [filterTaskStatus, setFilterTaskStatus] = useState<"all" | Task["status"]>("all");

  if (!project) {
    return <p>Project not found.</p>;
  }

  const activeTasks = projectTasks.filter((task) => task.status === "in_progress");
  const completedTasks = projectTasks.filter((task) => task.status === "completed");
  const recentIdeas = projectIdeas.filter((idea) =>
    `${idea.text} ${idea.description}`.toLowerCase().includes(searchIdea.toLowerCase()),
  );

  const onSubmitIdea = (event: FormEvent) => {
    event.preventDefault();
    if (!ideaText.trim()) return;
    addIdea({
      projectId: project.id,
      text: ideaText,
      description: ideaDescription,
      status: ideaStatus,
      priority: ideaPriority,
      source: "other",
      tags: [],
    });
    setIdeaText("");
    setIdeaDescription("");
  };

  const onSubmitTask = (event: FormEvent) => {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    addTask({
      projectId: project.id,
      title: taskTitle,
      details: taskDetails,
      type: taskType,
      status: "backlog",
      priority: taskPriority,
      blockedReason: "",
      sourceIdeaId: null,
      acceptanceCriteria: "",
      implementationNotes: "",
      startedAt: null,
      completedAt: null,
    });
    setTaskTitle("");
    setTaskDetails("");
  };

  const onSubmitBrain = (event: FormEvent) => {
    event.preventDefault();
    if (!brainText.trim()) return;
    addBrainDump({
      projectId: project.id,
      text: brainText,
    });
    setBrainText("");
  };

  const onSubmitScratchpad = (event: FormEvent) => {
    event.preventDefault();
    updateScratchpad(project.id, scratchpadDraft);
  };

  const onSubmitDecision = (event: FormEvent) => {
    event.preventDefault();
    if (!decisionTitle.trim() || !decisionContext.trim() || !decisionText.trim()) return;
    upsertDecision({
      projectId: project.id,
      title: decisionTitle,
      context: decisionContext,
      decision: decisionText,
      alternatives: decisionAlt,
      consequences: decisionCons,
      status: "proposed",
      decidedAt: new Date().toISOString(),
    });
    setDecisionTitle("");
    setDecisionContext("");
    setDecisionText("");
    setDecisionAlt("");
    setDecisionCons("");
  };

  const onSubmitPrompt = (event: FormEvent) => {
    event.preventDefault();
    if (!promptTitle.trim() || !promptBody.trim()) return;
    upsertPrompt({
      projectId: project.id,
      title: promptTitle,
      purpose: promptPurpose,
      prompt: promptBody,
      resultSummary: promptResult,
      status: "draft",
      relatedTaskId: null,
    });
    setPromptTitle("");
    setPromptPurpose("");
    setPromptBody("");
    setPromptResult("");
  };

  const onSubmitNote = (event: FormEvent) => {
    event.preventDefault();
    if (!noteTitle.trim() || !noteMarkdown.trim()) return;
    addNote({
      projectId: project.id,
      title: noteTitle,
      section: noteSection,
      tags: [],
      markdown: noteMarkdown,
    });
    setNoteTitle("");
    setNoteMarkdown("");
  };

  const onSubmitLink = (event: FormEvent) => {
    event.preventDefault();
    if (!linkTitle.trim() || !linkUrl.trim()) return;
    addLink({
      projectId: project.id,
      title: linkTitle,
      url: linkUrl,
      notes: "",
      section: "General",
      tags: [],
    });
    setLinkTitle("");
    setLinkUrl("");
  };

  const onSubmitSession = (event: FormEvent) => {
    event.preventDefault();
    if (!sessionObjective.trim()) return;
    if (activeSession) {
      endSession(activeSession.id, {
        objective: sessionObjective,
        summary: sessionSummary || sessionCompletedItems || sessionObjective,
        problemsDiscovered: sessionProblems.split(",").map((item) => item.trim()).filter(Boolean),
        nextStartingPoint: sessionNext,
        tasksCompleted: sessionCompletedItems.split(",").map((item) => item.trim()).filter(Boolean),
      });
      setSessionObjective("");
      setSessionSummary("");
      setSessionCompletedItems("");
      setSessionProblems("");
      setSessionNextStart("");
      setSessionNext("");
    } else {
      startSession({
        projectId: project.id,
        objective: sessionObjective,
        summary: "",
        tasksWorkedOn: [],
        tasksCompleted: [],
        ideasAdded: [],
        problemsDiscovered: [],
        decisionsMade: [],
        promptsUsed: [],
        filesModified: [],
        commits: [],
        nextStartingPoint: sessionNextStart,
        notes: "",
      });
      setSessionObjective("");
      setSessionSummary("");
      setSessionNext("");
      setSessionCompletedItems("");
      setSessionProblems("");
      setSessionNextStart("");
    }
  };

  const advancedSectionOpen = moreSections.includes(section as (typeof moreSections)[number]);
  const tabs = (
    <nav className="relative mb-6 flex flex-wrap items-center gap-2" aria-label="Project sections">
      {primarySections.map((item) => {
        const href = `${pathname}?section=${item}`;
        const active = section === item;
        return (
          <Link
            href={href}
            key={item}
            onClick={(event) => {
              event.preventDefault();
              router.replace(href);
            }}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${
              active ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {sectionLabels[item]}
          </Link>
        );
      })}

      <details className="group relative" open={advancedSectionOpen}>
        <summary className={`inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg border px-4 text-sm font-semibold marker:content-none ${
          advancedSectionOpen
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}>
          {advancedSectionOpen ? sectionLabels[section] : "More"}
          <span className="ml-2 text-xs" aria-hidden="true">▾</span>
        </summary>
        <div className="absolute left-0 z-20 mt-2 grid w-64 grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {moreSections.map((item) => {
            const href = `${pathname}?section=${item}`;
            return (
              <Link
                href={href}
                key={item}
                onClick={(event) => {
                  event.preventDefault();
                  router.replace(href);
                }}
                className={`rounded-lg px-3 py-2 text-sm ${
                  section === item ? "bg-slate-100 font-semibold text-slate-950" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {sectionLabels[item]}
              </Link>
            );
          })}
        </div>
      </details>
    </nav>
  );

  const sectionContent = () => {
    if (section === "ideas") {
      return (
        <section className="space-y-4">
          <form className="grid gap-3 rounded border p-3 sm:grid-cols-4" onSubmit={onSubmitIdea}>
            <h3 className="font-semibold sm:col-span-4">Idea Inbox</h3>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Text</span>
              <input
                value={ideaText}
                onChange={(event) => setIdeaText(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                required
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Description</span>
              <input
                value={ideaDescription}
                onChange={(event) => setIdeaDescription(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="sm:col-span-1 block">
              <span className="text-sm">Status</span>
              <select
                value={ideaStatus}
                onChange={(event) => setIdeaStatus(event.target.value as Idea["status"]) }
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              >
                {(["inbox", "reviewed", "accepted", "rejected", "converted", "archived"] as const).map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-1 block">
              <span className="text-sm">Priority</span>
              <select
                value={ideaPriority}
                onChange={(event) => setIdeaPriority(event.target.value as Idea["priority"]) }
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              >
                {(["low", "medium", "high", "critical"] as const).map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded bg-sky-600 px-3 py-2 text-white sm:col-span-4">Add idea</button>
            <label className="sm:col-span-4 block">
              <span className="text-sm">Search</span>
              <input
                value={searchIdea}
                onChange={(event) => setSearchIdea(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                placeholder="Filter ideas"
              />
            </label>
          </form>

          <div className="space-y-2">
            {recentIdeas.map((idea: Idea) => (
              <div key={idea.id} className="rounded border border-slate-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{idea.text}</p>
                    <p className="text-xs text-slate-500">{idea.status} • {idea.priority}</p>
                    <p className="text-sm text-slate-600">{idea.description}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => convertIdeaToTask(idea.id)}
                    >
                      Convert to task
                    </button>
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => archiveIdea(idea.id)}
                    >
                      Archive
                    </button>
                  </div>
                </div>
                <label className="mt-2 block">
                  <span className="text-xs">Quick edit description</span>
                  <textarea
                    value={idea.description}
                    onChange={(event) =>
                      updateIdea(idea.id, {
                        description: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                    rows={2}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (section === "tasks") {
      const filteredTasks = filterTaskStatus === "all" ? projectTasks : projectTasks.filter((task) => task.status === filterTaskStatus);
      return (
        <section className="space-y-4">
          <form className="grid gap-3 rounded border p-3 sm:grid-cols-4" onSubmit={onSubmitTask}>
            <h3 className="font-semibold sm:col-span-4">Tasks</h3>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Title</span>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                required
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Details</span>
              <textarea
                value={taskDetails}
                onChange={(event) => setTaskDetails(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                rows={2}
              />
            </label>
            <label className="block">
              <span className="text-sm">Type</span>
              <select
                value={taskType}
                onChange={(event) => setTaskType(event.target.value as Task["type"]) }
                className="mt-1 rounded border border-slate-300 px-2 py-1"
              >
                {(["feature", "improvement", "bug", "research", "maintenance", "documentation"] as const).map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm">Priority</span>
              <select
                value={taskPriority}
                onChange={(event) => setTaskPriority(event.target.value as Task["priority"]) }
                className="mt-1 rounded border border-slate-300 px-2 py-1"
              >
                {(["low", "medium", "high", "critical"] as const).map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded bg-sky-600 px-3 py-2 text-white sm:col-span-4">Add task</button>
          </form>

          <div className="flex gap-2">
            <button className={`rounded border px-2 py-1 ${filterTaskStatus === "all" ? "bg-slate-200" : ""}`} onClick={() => setFilterTaskStatus("all")}>
              All
            </button>
            {(["backlog", "ready", "in_progress", "blocked", "testing", "completed", "cancelled"] as const).map((status) => (
              <button
                key={status}
                className={`rounded border px-2 py-1 ${filterTaskStatus === status ? "bg-slate-200" : ""}`}
                onClick={() => setFilterTaskStatus(status)}
              >
                {status}
              </button>
            ))}
          </div>

          {filteredTasks.map((task: Task) => (
            <div key={task.id} className="rounded border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{task.title}</p>
                  <p className="text-xs text-slate-500">{task.status} • {task.type} • {task.priority}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {task.status === "in_progress" ? null : (
                    <button className="rounded border px-2 py-1 text-xs" onClick={() => startTask(task.id)}>
                      Start
                    </button>
                  )}
                  {task.status === "blocked" ? null : (
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        const reason = window.prompt("Block reason") || "blocked";
                        blockTask(task.id, reason);
                      }}
                    >
                      Block
                    </button>
                  )}
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => completeTask(task.id)}
                  >
                    Complete
                  </button>
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-600">{task.details}</p>
            </div>
          ))}
        </section>
      );
    }

    if (section === "brain-dump") {
      return (
        <section className="space-y-4">
          <form className="grid gap-3 rounded border p-3" onSubmit={onSubmitBrain}>
            <h3 className="font-semibold">Brain Dump</h3>
            <textarea
              value={brainText}
              onChange={(event) => setBrainText(event.target.value)}
              className="min-h-24 rounded border border-slate-300 px-3 py-2"
              placeholder="Unstructured ideas..."
              required
            />
            <button type="submit" className="self-start rounded bg-sky-600 px-3 py-2 text-white">
              Save dump
            </button>
          </form>

          <div className="space-y-2">
            {projectBrainDumps.map((entry: BrainDump) => (
              <div key={entry.id} className="rounded border p-2">
                <p className="text-sm">{entry.text}</p>
                <p className="text-xs text-slate-500">{entry.status}</p>
                <div className="mt-2 flex gap-2">
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => convertBrainDumpToIdea(entry.id)}>
                    Convert idea
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => convertBrainDumpToTask(entry.id)}>
                    Convert task
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => {
                    if (window.confirm("Delete this entry")) {
                      deleteBrainDump(entry.id);
                    }
                  }}>
                    Delete
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => updateBrainDump(entry.id, { status: "archived" })}>
                    Archive
                  </button>
                </div>
                <textarea
                  value={entry.text}
                  onChange={(event) => updateBrainDump(entry.id, { text: event.target.value })}
                  className="mt-2 min-h-20 w-full rounded border border-slate-200 px-2 py-1"
                />
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (section === "scratchpad") {
      return (
        <section className="space-y-3">
          <form onSubmit={onSubmitScratchpad} className="rounded border border-slate-200 p-3">
            <h3 className="font-semibold">Scratchpad</h3>
            <p className="text-xs text-slate-500">Per-project markdown-capable notes for rough thinking.</p>
            <textarea
              value={scratchpadDraft}
              onChange={(event) => setScratchpadDraft(event.target.value)}
              className="mt-2 min-h-56 w-full rounded border border-slate-300 px-3 py-2 font-mono"
            />
            <button type="submit" className="mt-2 rounded bg-sky-600 px-3 py-2 text-white">
              Save
            </button>
                    <p className="mt-2 text-xs text-slate-500">Last saved: {toDisplayDate(getProjectScratchpad(project.id)?.updatedAt)}</p>
          </form>
        </section>
      );
    }

    if (section === "sessions") {
      return (
        <section className="space-y-3">
          <form className="grid gap-3 rounded border p-3 sm:grid-cols-2" onSubmit={onSubmitSession}>
            <h3 className="sm:col-span-2 font-semibold">Development Sessions</h3>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Session objective</span>
              <input
                value={sessionObjective}
                onChange={(event) => setSessionObjective(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                required
                placeholder={activeSession ? "Completion summary" : "Start objective"}
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">What was completed?</span>
              <input
                value={sessionCompletedItems}
                onChange={(event) => setSessionCompletedItems(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                placeholder="Comma-separated items"
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">What was summarized as completion notes?</span>
              <input
                value={sessionSummary}
                onChange={(event) => setSessionSummary(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                placeholder="Brief summary for the session"
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">What remains unfinished?</span>
              <input
                value={sessionNext}
                onChange={(event) => setSessionNext(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                placeholder="Remaining items after this session"
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">What blocker / problem was discovered?</span>
              <input
                value={sessionProblems}
                onChange={(event) => setSessionProblems(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                placeholder="Comma-separated problems"
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">What should I do first next time?</span>
              <input
                value={sessionNextStart}
                onChange={(event) => setSessionNextStart(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                placeholder="Next starting point"
              />
            </label>
            <button type="submit" className="rounded bg-sky-600 px-3 py-2 text-white sm:col-span-2">
              {activeSession ? "End session" : "Start session"}
            </button>
          </form>

          <p className="text-sm">Active session: {activeSession ? `Yes (${activeSession.objective})` : "No"}</p>

          <div className="space-y-2">
            {projectSessions.map((session: DevelopmentSession) => (
              <div key={session.id} className="rounded border border-slate-200 p-2">
                <p className="font-medium">{session.objective}</p>
                <p className="text-xs text-slate-500">
                  {session.status} • started {toDisplayDate(session.startedAt)} • completed {toDisplayDate(session.endedAt || undefined)}
                </p>
                {session.source === "codex" ? (
                  <p className="text-xs text-sky-700">
                    Source: Codex{session.externalSessionId ? ` • ${session.externalSessionId}` : ""}
                  </p>
                ) : null}
                {session.summary ? <p className="mt-1 text-sm text-slate-700">{session.summary}</p> : null}
                {session.branch ? (
                  <p className="text-xs text-slate-500">Branch: {session.branch}</p>
                ) : null}
                {session.commits.length > 0 ? (
                  <p className="text-xs text-slate-500">Commits: {session.commits.join(", ")}</p>
                ) : null}
                <textarea
                  defaultValue={session.notes}
                  onBlur={(event) => appendSessionNote(session.id, event.target.value)}
                  className="mt-2 min-h-20 w-full rounded border border-slate-200 p-2"
                />
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (section === "architecture") {
      return (
        <section className="space-y-3">
          <form className="grid gap-3 rounded border p-3 sm:grid-cols-2" onSubmit={onSubmitDecision}>
            <h3 className="font-semibold sm:col-span-2">Architecture Decisions</h3>
            <label className="block">
              <span className="text-sm">Title</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={decisionTitle} onChange={(event) => setDecisionTitle(event.target.value)} required />
            </label>
            <label className="block">
              <span className="text-sm">Context</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={decisionContext} onChange={(event) => setDecisionContext(event.target.value)} required />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Decision</span>
              <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={decisionText} onChange={(event) => setDecisionText(event.target.value)} required />
            </label>
            <label className="block">
              <span className="text-sm">Alternatives</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={decisionAlt} onChange={(event) => setDecisionAlt(event.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm">Consequences</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={decisionCons} onChange={(event) => setDecisionCons(event.target.value)} />
            </label>
            <button className="rounded bg-sky-600 px-3 py-2 text-white sm:col-span-2" type="submit">Save decision</button>
          </form>

          {projectDecisions.map((decision: ArchitectureDecision) => (
            <div key={decision.id} className="rounded border border-slate-200 p-2">
              <div className="flex justify-between">
                <p className="font-medium">{decision.title}</p>
                <select
                  defaultValue={decision.status}
                  onChange={(event) => updateDecisionStatus(decision.id, event.target.value as ArchitectureDecision["status"]) }
                  className="rounded border px-2 py-1"
                >
                  <option value="proposed">proposed</option>
                  <option value="accepted">accepted</option>
                  <option value="replaced">replaced</option>
                  <option value="deferred">deferred</option>
                  <option value="rejected">rejected</option>
                </select>
              </div>
              <p className="text-sm text-slate-600">{decision.decision}</p>
            </div>
          ))}
        </section>
      );
    }

    if (section === "codex-prompts") {
      return (
        <section className="space-y-3">
          <form className="grid gap-3 rounded border p-3 sm:grid-cols-2" onSubmit={onSubmitPrompt}>
            <h3 className="font-semibold sm:col-span-2">Codex Prompts</h3>
            <label className="block">
              <span className="text-sm">Title</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={promptTitle} onChange={(event) => setPromptTitle(event.target.value)} required />
            </label>
            <label className="block">
              <span className="text-sm">Purpose</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={promptPurpose} onChange={(event) => setPromptPurpose(event.target.value)} />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Prompt</span>
              <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-1" rows={3} value={promptBody} onChange={(event) => setPromptBody(event.target.value)} required />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Result summary</span>
              <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-1" rows={2} value={promptResult} onChange={(event) => setPromptResult(event.target.value)} />
            </label>
            <button className="rounded bg-sky-600 px-3 py-2 text-white sm:col-span-2" type="submit">Save prompt</button>
          </form>

          {projectPrompts.map((prompt: CodexPrompt) => (
            <div key={prompt.id} className="rounded border border-slate-200 p-2">
              <div className="flex justify-between">
                <p className="font-medium">{prompt.title}</p>
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => {
                    copyToClipboard(prompt.prompt);
                    setResumeCopyStatus("copied prompt");
                  }}
                >
                  Copy
                </button>
              </div>
              <p className="text-sm text-slate-600">{prompt.purpose}</p>
              <p className="mt-1 text-sm whitespace-pre-line">{prompt.prompt}</p>
              <p className="text-xs text-slate-500">
                Status {prompt.status}
                {prompt.source === "codex" ? " • Source: Codex" : ""}
                {prompt.externalSessionId ? ` • ${prompt.externalSessionId}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <button className="rounded border px-2 py-1 text-xs" onClick={() => markPromptUsed(prompt.id, prompt.resultSummary || "Used from UI")}>Mark used</button>
                <button className="rounded border px-2 py-1 text-xs" onClick={() => {
                  const clone = `${prompt.title} copy`;
                  upsertPrompt({
                    projectId: project.id,
                    title: clone,
                    purpose: prompt.purpose,
                    prompt: prompt.prompt,
                    resultSummary: prompt.resultSummary,
                    status: "draft",
                    relatedTaskId: prompt.relatedTaskId,
                  });
                }}>
                  Duplicate
                </button>
              </div>
            </div>
          ))}
        </section>
      );
    }

    if (section === "notes") {
      return (
        <section className="space-y-3">
          <form className="grid gap-3 rounded border p-3 sm:grid-cols-2" onSubmit={onSubmitNote}>
            <h3 className="font-semibold sm:col-span-2">Notes</h3>
            <label className="block">
              <span className="text-sm">Title</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} required />
            </label>
            <label className="block">
              <span className="text-sm">Section</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={noteSection} onChange={(event) => setNoteSection(event.target.value)} />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm">Markdown</span>
              <textarea value={noteMarkdown} onChange={(event) => setNoteMarkdown(event.target.value)} className="mt-1 min-h-40 w-full rounded border border-slate-300 px-2 py-1" />
            </label>
            <button className="sm:col-span-2 rounded bg-sky-600 px-3 py-2 text-white" type="submit">Save note</button>
          </form>

          <div className="space-y-2">
            {projectNotes.map((note: Note) => (
              <div key={note.id} className="rounded border border-slate-200 p-2">
                <p className="font-medium">{note.title}</p>
                <p className="text-xs text-slate-500">Section: {note.section}</p>
                <textarea
                  value={note.markdown}
                  onChange={(event) => updateNote(note.id, { markdown: event.target.value })}
                  className="mt-2 min-h-32 w-full rounded border border-slate-200 p-2"
                  rows={4}
                />
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (section === "links") {
      return (
        <section className="space-y-3">
          <form className="grid gap-3 rounded border p-3 sm:grid-cols-2" onSubmit={onSubmitLink}>
            <h3 className="font-semibold sm:col-span-2">Important Links</h3>
            <label className="block">
              <span className="text-sm">Title</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} required />
            </label>
            <label className="block">
              <span className="text-sm">URL</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} required />
            </label>
            <button className="rounded bg-sky-600 px-3 py-2 text-white sm:col-span-2" type="submit">Add link</button>
          </form>
          <div className="space-y-2">
            {projectLinks.map((link: ImportantLink) => (
              <div key={link.id} className="rounded border border-slate-200 p-2">
                <a href={link.url} target="_blank" rel="noreferrer" className="text-sky-700 underline">
                  {link.title}
                </a>
                <p className="text-sm">{link.section}</p>
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (section === "resume") {
      return (
        <section className="space-y-3">
          <h3 className="font-semibold">PROJECT_RESUME.md</h3>
          <div className="flex gap-2">
            <button
              className="rounded border px-3 py-2"
              onClick={() => {
                copyToClipboard(resumeText);
                setResumeCopyStatus("Resume copied");
              }}
            >
              Copy
            </button>
            <button
              className="rounded border px-3 py-2"
              onClick={() => downloadTextFile("PROJECT_RESUME.md", resumeText)}
            >
              Download
            </button>
          </div>
          <textarea className="min-h-80 w-full rounded border border-slate-300 p-3" value={resumeText} readOnly />
          <p className="text-xs text-slate-500">{resumeCopyStatus}</p>
        </section>
      );
    }

    if (section === "ai-context") {
      return (
        <section className="space-y-3">
          <h3 className="font-semibold">AI_CONTEXT.md</h3>
          <div className="flex gap-2">
            <button
              className="rounded border px-3 py-2"
              onClick={() => {
                copyToClipboard(contextText);
                setResumeCopyStatus("AI context copied");
              }}
            >
              Copy
            </button>
            <button
              className="rounded border px-3 py-2"
              onClick={() => downloadTextFile("AI_CONTEXT.md", contextText)}
            >
              Download
            </button>
          </div>
          <textarea className="min-h-80 w-full rounded border border-slate-300 p-3" value={contextText} readOnly />
          <p className="text-xs text-slate-500">{resumeCopyStatus}</p>
        </section>
      );
    }

    if (section === "activity") {
      return (
        <section>
          <h3 className="font-semibold">Activity</h3>
          <ul className="mt-3 space-y-2">
            {projectActivity.map((item) => (
              <li key={item.id} className="rounded border border-slate-200 p-2">
                <p className="text-sm">{item.summary}</p>
                <p className="text-xs text-slate-500">{toDisplayDate(item.createdAt)} • {item.type}</p>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    const nextTask = activeTasks[0]
      || projectTasks.find((task) => ["ready", "blocked", "testing"].includes(task.status));
    const nextStep = nextTask?.title
      || project.currentObjective
      || project.nextRecommendedTask
      || continuitySession?.nextStartingPoint
      || "No next step is saved yet.";
    const hasBlocker = Boolean(
      project.currentBlocker && !/^(none|none\.)$/i.test(project.currentBlocker.trim()),
    );
    const isPaused = project.manualStatus === "paused" || project.status === "on_hold";
    const ideasWaiting = projectIdeas
      .filter((idea) => idea.status === "inbox" || idea.status === "reviewed")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3);
    const latestCompletedSession = projectSessions.find((session) => session.status === "completed");
    const recentCompletedTasks = completedTasks
      .slice()
      .sort((a, b) => new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime())
      .slice(0, 3);
    const meaningfulActivity = projectActivity
      .filter((item) => !["github_repository_imported", "github_repository_updated"].includes(item.type))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((item, index, all) => all.findIndex((candidate) => candidate.summary === item.summary) === index)
      .slice(0, 3);

    const toggleDevelopmentSession = () => {
      if (activeSession) {
        endSession(activeSession.id, {
          summary: `Manual session stop at ${toDisplayDate(new Date().toISOString())}`,
          nextStartingPoint: "Resume from where I stopped",
        });
        return;
      }

      startSession({
        projectId: project.id,
        objective: project.currentObjective || "Resume project",
        summary: "",
        tasksWorkedOn: activeTasks.map((item) => item.id),
        tasksCompleted: completedTasks.map((item) => item.id),
        ideasAdded: [],
        problemsDiscovered: [],
        decisionsMade: [],
        promptsUsed: [],
        filesModified: [],
        commits: [],
        nextStartingPoint: nextStep,
        notes: "",
      });
    };

    return (
      <section className="space-y-6">
        <header>
          <Link href="/projects" className="text-sm font-semibold text-slate-500 hover:text-slate-950">
            ← All projects
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">{project.title}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              isPaused
                ? "bg-amber-50 text-amber-700"
                : hasBlocker
                ? "bg-rose-50 text-rose-700"
                : project.status === "active"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
            }`}>
              {isPaused ? "Paused" : hasBlocker ? "Blocked" : project.status}
            </span>
          </div>
          {project.purpose ? <p className="mt-2 max-w-3xl text-slate-600">{project.purpose}</p> : null}
          <p className="mt-2 text-xs text-slate-500">Last worked {toShortDisplayDate(project.lastWorkedAt)}</p>
        </header>

        <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Next up</p>
          <h2 className="mt-3 max-w-4xl text-2xl font-bold leading-tight sm:text-3xl">{nextStep}</h2>
          {project.currentObjective && project.currentObjective !== nextStep ? (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">
              Goal: {project.currentObjective}
            </p>
          ) : null}
          {hasBlocker ? (
            <p className="mt-4 rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
              Blocker: {project.currentBlocker}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={`/projects/${project.id}?section=tasks`} className="dd-btn bg-white font-semibold text-slate-950 hover:bg-slate-100">
              {nextTask ? "Open tasks" : "Add next task"}
            </Link>
            <Link
              href={`/projects/${project.id}?section=workbench&qcProject=${project.id}&quickCapture=1`}
              className="dd-btn border border-white/25 text-white hover:bg-white/10"
            >
              + Add idea
            </Link>
            <button
              type="button"
              className="dd-btn border border-white/25 text-white hover:bg-white/10"
              onClick={() => {
                copyToClipboard(contextText);
                setResumeCopyStatus("Project context copied");
              }}
            >
              Copy context for Codex
            </button>
          </div>
          {resumeCopyStatus ? <p className="mt-3 text-xs text-emerald-200">{resumeCopyStatus}</p> : null}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {(latestCompletedSession || recentCompletedTasks.length > 0) ? (
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Recent progress</h2>
              {latestCompletedSession ? (
                <div className="mt-3">
                  <p className="text-sm leading-relaxed text-slate-700">
                    {latestCompletedSession.summary || latestCompletedSession.objective}
                  </p>
                  {latestCompletedSession.nextStartingPoint ? (
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-semibold text-slate-950">Resume from:</span>{" "}
                      {latestCompletedSession.nextStartingPoint}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">{toShortDisplayDate(latestCompletedSession.endedAt || latestCompletedSession.startedAt)}</p>
                </div>
              ) : null}
              {recentCompletedTasks.length > 0 ? (
                <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {recentCompletedTasks.map((task) => (
                    <li key={task.id} className="flex gap-2 text-sm text-slate-700">
                      <span className="text-emerald-600" aria-hidden="true">✓</span>
                      <span>{task.title}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ) : null}

          {ideasWaiting.length > 0 ? (
            <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-amber-950">Ideas waiting</h2>
                <Link href={`/projects/${project.id}?section=ideas`} className="text-sm font-semibold text-amber-800 hover:underline">
                  View all
                </Link>
              </div>
              <ul className="mt-3 space-y-2">
                {ideasWaiting.map((idea) => (
                  <li key={idea.id} className="rounded-xl bg-white/80 px-3 py-2 text-sm text-amber-950">{idea.text}</li>
                ))}
              </ul>
            </article>
          ) : null}

          {meaningfulActivity.length > 0 ? (
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-950">Latest changes</h2>
                <Link href={`/projects/${project.id}?section=activity`} className="text-sm font-semibold text-slate-600 hover:underline">
                  History
                </Link>
              </div>
              <ul className="mt-3 space-y-3">
                {meaningfulActivity.map((item) => (
                  <li key={item.id} className="text-sm text-slate-700">
                    <p>{item.summary}</p>
                    <p className="mt-1 text-xs text-slate-500">{toShortDisplayDate(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {projectLinks.length > 0 ? (
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-950">Useful links</h2>
                <Link href={`/projects/${project.id}?section=links`} className="text-sm font-semibold text-slate-600 hover:underline">Manage</Link>
              </div>
              <ul className="mt-3 space-y-2">
                {projectLinks.slice(0, 4).map((link: ImportantLink) => (
                  <li key={link.id}>
                    <a href={link.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-emerald-700 hover:underline">
                      {link.title} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>

        <details className="rounded-2xl border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-700 marker:content-none">
            Project tools and technical details
          </summary>
          <div className="border-t border-slate-200 p-5">
            <GitHubProjectMetadata project={project} />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="dd-btn dd-btn--secondary" onClick={toggleDevelopmentSession}>
                {activeSession ? "End development session" : "Start development session"}
              </button>
              <Link href={`/projects/${project.id}?section=resume`} className="dd-btn dd-btn--secondary">Project resume</Link>
              <Link href={`/projects/${project.id}?section=ai-context`} className="dd-btn dd-btn--secondary">AI context</Link>
              <Link href={`/projects/${project.id}?section=notes`} className="dd-btn dd-btn--secondary">Notes</Link>
            </div>
            <dl className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <div><dt className="font-medium text-slate-900">Branch</dt><dd>{project.currentBranch || "main"}</dd></div>
              <div><dt className="font-medium text-slate-900">Last updated</dt><dd>{toShortDisplayDate(project.updatedAt)}</dd></div>
            </dl>
          </div>
        </details>
      </section>
    );
  };

  return <div>{tabs}{sectionContent()}</div>;
}
