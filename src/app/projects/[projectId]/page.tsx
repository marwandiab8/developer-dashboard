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
import { toDisplayDate } from "../../../lib/utils/time";

const sectionLabels: Record<string, string> = {
  workbench: "Workbench",
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
  activity: "Activity",
};

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

  const tabs = (
    <nav className="mb-4 flex flex-wrap gap-2">
      {PROJECT_SECTIONS.map((item) => {
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
            className={`rounded-full border px-3 py-1 text-xs ${
              active ? "bg-slate-900 text-white" : "border-slate-300"
            }`}
          >
            {sectionLabels[item]}
          </Link>
        );
      })}
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

    return (
      <section className="dd-workbench-layout">
        <section className="dd-shell-card px-5 py-5 sm:px-6">
          <p className="dd-subtitle">Project workbench</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{project.title}</h1>
          <GitHubProjectMetadata project={project} />

          <dl className="dd-kv-pair mt-3 text-sm">
            <dt className="font-medium text-slate-600">Status</dt>
            <dd>
              <span className="dd-badge dd-badge--active">{project.status}</span>
            </dd>
            <dt className="font-medium text-slate-600">Priority</dt>
            <dd className="text-slate-700">{project.status === "active" ? "High" : "Normal"}</dd>
            <dt className="font-medium text-slate-600">Current branch</dt>
            <dd className="text-slate-700">{project.currentBranch || "main"}</dd>
            <dt className="font-medium text-slate-600">Last worked</dt>
            <dd className="text-slate-700">{toDisplayDate(project.lastWorkedAt)}</dd>
            <dt className="font-medium text-slate-600">Current objective</dt>
            <dd className="text-slate-700">{project.currentObjective || "Not set"}</dd>
          </dl>

          <p className="mt-4 text-sm text-slate-600">{project.purpose || "No purpose set yet."}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/projects/${project.id}?section=tasks`}
              className="dd-btn dd-btn--primary"
            >
              Continue Current Task
            </Link>
            <Link
              href={`/projects/${project.id}?section=workbench&qcProject=${project.id}&quickCapture=1`}
              className="dd-btn dd-btn--secondary"
            >
              Quick Capture
            </Link>
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
                      nextStartingPoint: activeTasks[0]?.title || "Review last work",
                      notes: "",
                    })
              }
            >
              {activeSession ? "End Development Session" : "Start Development Session"}
            </button>
            <Link href={`/projects/${project.id}?section=resume`} className="dd-btn dd-btn--secondary">
              Generate Project Resume
            </Link>
            <Link href={`/projects/${project.id}?section=ai-context`} className="dd-btn dd-btn--secondary">
              Generate AI Context
            </Link>
          </div>
        </section>

        <section className="dd-panel">
          <h2 className="dd-section-title text-xl">Continue where I left off</h2>
          <div className="mt-3 grid gap-2 text-sm text-slate-700">
            <p>
              <span className="font-medium">Current objective:</span> {project.currentObjective || "Not set"}
            </p>
            <p>
              <span className="font-medium">In-progress task:</span>{" "}
              {activeTasks[0]?.title || "No active task"}
            </p>
            <p>
              <span className="font-medium">Next recommended task:</span>{" "}
              {project.nextRecommendedTask || "No recommendation yet"}
            </p>
            <p>
              <span className="font-medium">Current blocker:</span> {project.currentBlocker || "None"}
            </p>
            <p>
              <span className="font-medium">Last session starting point:</span>{" "}
              {continuitySession?.nextStartingPoint || "No prior session"}
            </p>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <article className="dd-panel">
            <h3 className="dd-section-title">Recent activity</h3>
            {projectActivity.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {projectActivity
                  .slice()
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .slice(0, 5)
                  .map((item) => (
                    <li key={item.id} className="text-sm">
                      <span className="text-slate-600">[{item.type}]</span> {item.summary}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="dd-empty mt-2">No activity yet.</p>
            )}
            <Link
              href={`/projects/${project.id}?section=activity`}
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
            >
              Open full activity
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Recent ideas</h3>
            {projectIdeas.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {projectIdeas.slice(0, 4).map((idea) => (
                  <li key={idea.id} className="text-sm">
                    {idea.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dd-empty mt-2">No ideas yet.</p>
            )}
            <Link
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
              href={`/projects/${project.id}?section=ideas`}
            >
              Open idea list
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Current tasks</h3>
            {activeTasks.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {activeTasks.slice(0, 4).map((task) => (
                  <li key={task.id} className="text-sm">
                    {task.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dd-empty mt-2">No active tasks.</p>
            )}
            <Link
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
              href={`/projects/${project.id}?section=tasks`}
            >
              Open task list
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Recently completed work</h3>
            {completedTasks.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {completedTasks.slice(0, 4).map((task) => (
                  <li key={task.id} className="text-sm">
                    {task.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dd-empty mt-2">No completed work yet.</p>
            )}
            <Link
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
              href={`/projects/${project.id}?section=tasks`}
            >
              Open completed work
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Architecture decisions</h3>
            <p className="dd-empty mt-2">
              {projectDecisions.length > 0 ? projectDecisions[0]?.title : "No decisions yet."}
            </p>
            <Link
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
              href={`/projects/${project.id}?section=architecture`}
            >
              Open architecture log
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Recent Codex prompt</h3>
            <p className="dd-empty mt-2">{projectPrompts[0]?.title || "No prompts yet."}</p>
            <Link
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
              href={`/projects/${project.id}?section=codex-prompts`}
            >
              Open prompts
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Recent session</h3>
            {projectSessions[0] ? (
              <div className="mt-2 space-y-1 text-sm">
                <p>{projectSessions[0].objective}</p>
                <p className="text-xs text-slate-500">
                  {projectSessions[0].status} • {toDisplayDate(projectSessions[0].startedAt)} —{" "}
                  {projectSessions[0].endedAt ? toDisplayDate(projectSessions[0].endedAt) : "in progress"}
                </p>
              </div>
            ) : (
              <p className="dd-empty mt-2">No sessions yet.</p>
            )}
            <Link
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
              href={`/projects/${project.id}?section=sessions`}
            >
              Open session history
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Important links</h3>
            {projectLinks.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {projectLinks.slice(0, 4).map((link: ImportantLink) => (
                  <li key={link.id} className="text-sm">
                    <a href={link.url} target="_blank" rel="noreferrer" className="underline">
                      {link.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dd-empty mt-2">No links yet.</p>
            )}
            <Link
              className="mt-2 inline-block text-sm text-sky-700 hover:underline"
              href={`/projects/${project.id}?section=links`}
            >
              Open links
            </Link>
          </article>

          <article className="dd-panel">
            <h3 className="dd-section-title">Project details</h3>
            <p className="text-sm text-slate-600">{project.purpose || "No purpose set."}</p>
            <p className="mt-2 text-xs text-slate-500">Branch: {project.currentBranch}</p>
            <p className="text-xs text-slate-500">Last updated: {toDisplayDate(project.updatedAt)}</p>
            <p className="text-xs text-slate-500">Total ideas: {projectIdeas.length}</p>
            <p className="text-xs text-slate-500">Active tasks: {activeTasks.length}</p>
          </article>
        </section>
      </section>
    );
  };

  return <div>{tabs}{sectionContent()}</div>;
}
