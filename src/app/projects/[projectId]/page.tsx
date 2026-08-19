"use client";

import Link from "next/link";
import { useMemo, useState, FormEvent } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { GitHubProjectMetadata } from "../../../components/GitHubProjectMetadata";
import { PROJECT_SECTIONS } from "../../../lib/constants";
import { generateAiContext } from "../../../lib/markdown/generateAiContext";
import { generateProjectResume } from "../../../lib/markdown/generateProjectResume";
import {
  getCurrentTask,
  getMeaningfulActivities,
  getProjectDisplayStatus,
  hasActualBlocker,
} from "../../../lib/presentation";
import { useDashboard } from "../../../lib/repositories/repositoryContext";
import type { Idea, Task, BrainDump, DevelopmentSession, ArchitectureDecision, CodexPrompt, Note, ImportantLink } from "../../../lib/models";
import { toDisplayDate } from "../../../lib/utils/time";
import {
  buildProjectTimeline,
  buildTaskQueue,
  calculateProjectActiveDuration,
  calculateTaskActiveDuration,
  formatActiveDuration,
  groupTimelineByDate,
  normalizeIdeaStatus,
  normalizeTaskStatus,
} from "../../../lib/workflow";

const primarySections = [
  { id: "workbench", label: "Overview" },
  { id: "ideas", label: "Ideas" },
  { id: "tasks", label: "Tasks" },
  { id: "timeline", label: "Timeline" },
] as const;

const moreSections = [
  { id: "activity", label: "History" },
  { id: "sessions", label: "Sessions" },
  { id: "brain-dump", label: "Brain Dump" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "notes", label: "Notes" },
  { id: "links", label: "Important Links" },
  { id: "architecture", label: "Architecture" },
  { id: "codex-prompts", label: "Codex Prompts" },
  { id: "resume", label: "Project Resume" },
  { id: "ai-context", label: "AI Context" },
] as const;

function TruncatedText({
  text,
  limit = 180,
  className = "",
}: {
  text: string;
  limit?: number;
  className?: string;
}) {
  if (!text) return null;
  if (text.length <= limit) return <p className={className}>{text}</p>;

  const preview = `${text.slice(0, limit).trimEnd()}…`;
  return (
    <details className={`group ${className}`}>
      <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <span className="group-open:hidden">{preview}</span>
        <span className="ml-1 text-xs font-semibold text-blue-700 group-open:hidden">Read more</span>
        <span className="hidden text-xs font-semibold text-blue-700 group-open:inline">Hide full content</span>
      </summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{text}</p>
    </details>
  );
}

function copyToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(value).catch(() => undefined);
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
    setTaskStatus,
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
  const currentTask = getCurrentTask(projectTasks);
  const projectDisplayStatus = getProjectDisplayStatus(project, projectTasks);
  const meaningfulActivities = getMeaningfulActivities(projectActivity);
  const ideasWaiting = projectIdeas
    .filter((idea) => ["inbox", "ready_for_review"].includes(normalizeIdeaStatus(idea.status)))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const recentCompletedTasks = [...completedTasks]
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.updatedAt).getTime()
        - new Date(a.completedAt ?? a.updatedAt).getTime(),
    )
    .slice(0, 3);
  const recentCompletedSessions = projectSessions
    .filter((session) => session.status === "completed" && (session.summary || session.objective))
    .slice(0, 2);
  const recentIdeas = projectIdeas.filter((idea) =>
    `${idea.text} ${idea.description}`.toLowerCase().includes(searchIdea.toLowerCase()),
  );
  const projectTimeline = buildProjectTimeline(data, project.id);
  const timelineDays = groupTimelineByDate(projectTimeline);
  const totalProjectTime = calculateProjectActiveDuration(data.developmentSessions, project.id);

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
      status: "open",
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
      status: "prepared",
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

  const tabs = (
    <nav className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Project sections">
      {primarySections.map((item) => {
        const href = `${pathname}?section=${item.id}`;
        const active = section === item.id;
        return (
          <Link
            href={href}
            key={item.id}
            onClick={(event) => {
              event.preventDefault();
              router.replace(href);
            }}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center rounded-xl px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}

      <details className="group relative min-w-0">
        <summary
          className={`flex min-h-11 cursor-pointer list-none items-center justify-center rounded-xl px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            moreSections.some((item) => item.id === section)
              ? "bg-slate-950 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          More
          <span aria-hidden="true" className="ml-1 text-xs transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="absolute right-0 z-30 mt-2 grid w-[min(20rem,calc(100vw-2rem))] grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          {moreSections.map((item) => {
            const href = `${pathname}?section=${item.id}`;
            const active = section === item.id;
            return (
              <Link
                key={item.id}
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  router.replace(href);
                }}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  active ? "bg-slate-100 font-semibold text-slate-950" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </details>
    </nav>
  );

  const sectionContent = () => {
    if (section === "timeline") {
      return timelineDays.length > 0 ? (
        <section className="space-y-6" aria-labelledby="project-timeline-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="project-timeline-heading" className="text-2xl font-semibold text-slate-950">Project timeline</h2>
              <p className="mt-1 text-sm text-slate-500">Meaningful work grouped by the day it happened.</p>
            </div>
            <p className="text-sm font-semibold text-slate-700">Total project time: {formatActiveDuration(totalProjectTime)}</p>
          </div>
          {timelineDays.map((day) => (
            <article key={day.dateKey} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <h3 className="font-semibold text-slate-950">{day.label}</h3>
                {day.activeDurationMs > 0 ? <span className="text-sm font-medium text-slate-600">{formatActiveDuration(day.activeDurationMs)}</span> : null}
              </div>
              <ol className="mt-4 space-y-4">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-blue-500 pl-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold capitalize text-blue-700">{entry.actor}</span>
                      <span className="text-xs capitalize text-slate-500">{entry.kind}</span>
                      {entry.activeDurationMs > 0 ? <span className="text-xs text-slate-500">{formatActiveDuration(entry.activeDurationMs)}</span> : null}
                    </div>
                    <p className="mt-1 text-sm font-medium leading-6 text-slate-900">{entry.summary}</p>
                    {entry.detail ? <TruncatedText text={entry.detail} limit={240} className="mt-1 text-sm leading-6 text-slate-600" /> : null}
                    {entry.taskId ? <Link href={`/projects/${project.id}/tasks/${entry.taskId}`} className="mt-2 inline-block text-xs font-semibold text-blue-700 hover:underline">Open task</Link> : null}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      ) : null;
    }

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
                <option value="inbox">Inbox</option>
                <option value="ready_for_review">Ready for review</option>
                <option value="archived">Archived</option>
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
                    <TruncatedText text={idea.text} limit={140} className="font-medium break-words" />
                    <p className="text-xs capitalize text-slate-500">{normalizeIdeaStatus(idea.status).replaceAll("_", " ")} • {idea.priority}</p>
                    <TruncatedText
                      text={idea.description}
                      limit={220}
                      className="mt-1 text-sm text-slate-600"
                    />
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {normalizeIdeaStatus(idea.status) !== "converted" ? (
                      <button className="rounded border px-2 py-1 text-xs" onClick={() => convertIdeaToTask(idea.id)}>Convert to task</button>
                    ) : idea.linkedTaskId ? (
                      <Link className="rounded border px-2 py-1 text-xs" href={`/projects/${project.id}/tasks/${idea.linkedTaskId}`}>Open task</Link>
                    ) : null}
                    {normalizeIdeaStatus(idea.status) !== "archived" && normalizeIdeaStatus(idea.status) !== "converted" ? (
                      <button className="rounded border px-2 py-1 text-xs" onClick={() => archiveIdea(idea.id)}>Archive</button>
                    ) : null}
                  </div>
                </div>
                {normalizeIdeaStatus(idea.status) === "converted" ? null : (
                  <label className="mt-2 block">
                    <span className="text-xs">Quick edit description</span>
                    <textarea
                      value={idea.description}
                      onChange={(event) => updateIdea(idea.id, { description: event.target.value })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                      rows={2}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (section === "tasks") {
      const orderedTasks = buildTaskQueue(projectTasks);
      const filteredTasks = filterTaskStatus === "all"
        ? orderedTasks
        : orderedTasks.filter((task) => normalizeTaskStatus(task.status) === normalizeTaskStatus(filterTaskStatus));
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

          <div className="flex flex-wrap gap-2">
            <button className={`rounded border px-2 py-1 ${filterTaskStatus === "all" ? "bg-slate-200" : ""}`} onClick={() => setFilterTaskStatus("all")}>
              All
            </button>
            {(["open", "ready", "in_progress", "blocked", "completed", "cancelled"] as const).map((status) => (
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
                  <TruncatedText text={task.title} limit={140} className="font-medium break-words" />
                  <p className="text-xs capitalize text-slate-500">{normalizeTaskStatus(task.status).replaceAll("_", " ")} • {task.type} • {task.priority} • {formatActiveDuration(calculateTaskActiveDuration(data.developmentSessions, task.id))}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className="rounded border px-2 py-1 text-xs font-semibold text-blue-700" href={`/projects/${project.id}/tasks/${task.id}`}>Open</Link>
                  {normalizeTaskStatus(task.status) === "in_progress" ? null : (
                    <button className="rounded border px-2 py-1 text-xs" onClick={() => setTaskStatus(task.id, "in_progress")}>Start</button>
                  )}
                  {normalizeTaskStatus(task.status) === "blocked" ? null : (
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        const reason = window.prompt("Block reason") || "blocked";
                        setTaskStatus(task.id, "blocked", reason);
                      }}
                    >
                      Block
                    </button>
                  )}
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => {
                      if (window.confirm("Mark this task completed?")) setTaskStatus(task.id, "completed");
                    }}
                  >
                    Complete
                  </button>
                </div>
              </div>
              <TruncatedText text={task.details} limit={240} className="mt-1 text-sm text-slate-600" />
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
                    status: "prepared",
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
          <h2 className="text-xl font-semibold text-slate-950">History</h2>
          {meaningfulActivities.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {meaningfulActivities.map((item) => (
                <li key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm leading-6 text-slate-800">{item.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">{toDisplayDate(item.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No meaningful changes have been recorded yet.</p>
          )}
        </section>
      );
    }

    return (
      <section className="space-y-6">
        <section className="overflow-hidden rounded-3xl bg-slate-950 px-5 py-6 text-white shadow-lg shadow-slate-200 sm:px-8 sm:py-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-200">Next up</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current task</p>
              <p className="mt-1 text-lg font-semibold leading-7 text-white">
                {activeTasks[0]?.title
                  || currentTask?.title
                  || continuitySession?.nextStartingPoint
                  || project.nextRecommendedTask
                  || "Review the project and choose the next task."}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current goal</p>
              <p className="mt-1 text-lg leading-7 text-slate-100">
                {project.currentObjective || "Choose a clear outcome for the next work session."}
              </p>
            </div>
          </div>

          {hasActualBlocker(currentTask?.blockedReason || project.currentBlocker) ? (
            <div className="mt-5 rounded-2xl border border-rose-400/40 bg-rose-400/10 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-200">Current blocker</p>
              <p className="mt-1 text-sm leading-6 text-rose-50">{currentTask?.blockedReason || project.currentBlocker}</p>
            </div>
          ) : null}

          <p className="mt-5 text-sm text-slate-300">Total active project time: {formatActiveDuration(totalProjectTime)}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={currentTask ? `/projects/${project.id}/tasks/${currentTask.id}` : `${pathname}?section=tasks`} className="dd-btn bg-white text-slate-950 hover:bg-slate-100">
              {currentTask ? "Continue current task" : "Open tasks"}
            </Link>
            <Link
              href={`${pathname}?section=workbench&qcProject=${project.id}&quickCapture=1`}
              className="dd-btn border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              Add idea
            </Link>
            <button
              type="button"
              className="dd-btn border-white/30 bg-transparent text-white hover:bg-white/10"
              onClick={() => {
                copyToClipboard(contextText);
                setResumeCopyStatus("Context copied");
              }}
            >
              Copy context for Codex
            </button>
          </div>
          <p className="mt-3 min-h-5 text-xs text-slate-300" aria-live="polite">{resumeCopyStatus}</p>
        </section>

        {(recentCompletedTasks.length > 0 || recentCompletedSessions.length > 0) ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-semibold text-slate-950">Recent progress</h2>
            <div className="mt-4 space-y-4">
              {recentCompletedSessions.map((session) => (
                <article key={session.id} className="border-l-2 border-blue-500 pl-4">
                  <p className="font-semibold text-slate-900">{session.objective}</p>
                  <TruncatedText
                    text={session.summary}
                    limit={260}
                    className="mt-1 text-sm leading-6 text-slate-600"
                  />
                  <p className="mt-1 text-xs text-slate-500">{toDisplayDate(session.endedAt || session.startedAt)}</p>
                </article>
              ))}
              {recentCompletedTasks.map((task) => (
                <article key={task.id} className="border-l-2 border-emerald-500 pl-4">
                  <TruncatedText text={task.title} limit={150} className="font-semibold text-slate-900" />
                  <TruncatedText
                    text={task.details}
                    limit={220}
                    className="mt-1 text-sm leading-6 text-slate-600"
                  />
                  <p className="mt-1 text-xs text-slate-500">Completed {toDisplayDate(task.completedAt || task.updatedAt)}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {ideasWaiting.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-slate-950">Ideas waiting</h2>
                <Link href={`${pathname}?section=ideas`} className="text-sm font-semibold text-blue-700 hover:underline">
                  View all
                </Link>
              </div>
              <ul className="mt-4 space-y-4">
                {ideasWaiting.slice(0, 3).map((idea) => (
                  <li key={idea.id}>
                    <TruncatedText text={idea.text} limit={150} className="font-medium text-slate-900" />
                    <TruncatedText text={idea.description} limit={180} className="mt-1 text-sm leading-6 text-slate-600" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {meaningfulActivities.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-slate-950">Latest meaningful changes</h2>
                <Link href={`${pathname}?section=activity`} className="text-sm font-semibold text-blue-700 hover:underline">
                  History
                </Link>
              </div>
              <ul className="mt-4 space-y-4">
                {meaningfulActivities.slice(0, 4).map((item) => (
                  <li key={item.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm leading-6 text-slate-800">{item.summary}</p>
                    <p className="mt-1 text-xs text-slate-500">{toDisplayDate(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {projectLinks.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-slate-950">Useful links</h2>
                <Link href={`${pathname}?section=links`} className="text-sm font-semibold text-blue-700 hover:underline">
                  Manage
                </Link>
              </div>
              <ul className="mt-4 space-y-3">
                {projectLinks.slice(0, 5).map((link: ImportantLink) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      {link.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <details className="rounded-2xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            Project tools and technical details
          </summary>
          <div className="space-y-6 border-t border-slate-200 p-5">
            <div className="grid gap-5 text-sm sm:grid-cols-2">
              <div>
                <h3 className="font-semibold text-slate-950">Project details</h3>
                <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-slate-600">
                  <dt>Status</dt>
                  <dd className="font-medium text-slate-900">{projectDisplayStatus}</dd>
                  <dt>Branch</dt>
                  <dd className="break-all font-medium text-slate-900">{project.currentBranch || "main"}</dd>
                  <dt>Last worked</dt>
                  <dd className="font-medium text-slate-900">{toDisplayDate(project.lastWorkedAt || project.updatedAt)}</dd>
                  <dt>Ideas</dt>
                  <dd className="font-medium text-slate-900">{projectIdeas.length}</dd>
                  <dt>Open tasks</dt>
                  <dd className="font-medium text-slate-900">
                    {projectTasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length}
                  </dd>
                </dl>
                {project.purpose ? <p className="mt-4 leading-6 text-slate-600">{project.purpose}</p> : null}
              </div>

              {project.externalSources?.github ? (
                <div>
                  <h3 className="font-semibold text-slate-950">Repository</h3>
                  <GitHubProjectMetadata project={project} />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-5">
              <button
                type="button"
                className="dd-btn dd-btn--secondary"
                onClick={() =>
                  activeSession
                    ? endSession(activeSession.id, {
                        summary: `Manual session stop at ${toDisplayDate(new Date().toISOString())}`,
                        nextStartingPoint: "Resume from where I stopped",
                      })
                    : startSession({
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
                        nextStartingPoint: currentTask?.title || "Review last work",
                        notes: "",
                      })
                }
              >
                {activeSession ? "End development session" : "Start development session"}
              </button>
              <Link href={`${pathname}?section=sessions`} className="dd-btn dd-btn--secondary">Sessions</Link>
              <Link href={`${pathname}?section=architecture`} className="dd-btn dd-btn--secondary">Architecture</Link>
              <Link href={`${pathname}?section=resume`} className="dd-btn dd-btn--secondary">Project resume</Link>
              <Link href={`${pathname}?section=ai-context`} className="dd-btn dd-btn--secondary">AI context</Link>
            </div>
          </div>
        </details>
      </section>
    );
  };

  const statusTone = projectDisplayStatus === "Blocked"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : projectDisplayStatus === "Paused"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <div className="space-y-7">
      <header>
        <Link href="/projects" className="text-sm font-semibold text-blue-700 hover:underline">
          Projects
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight text-slate-950">
            {project.title}
          </h1>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
            {projectDisplayStatus}
          </span>
        </div>
      </header>
      {tabs}
      <div>{sectionContent()}</div>
    </div>
  );
}
