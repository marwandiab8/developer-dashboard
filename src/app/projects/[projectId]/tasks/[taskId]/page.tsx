"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { generateTaskPrompt } from "../../../../../lib/markdown/generateTaskPrompt";
import type { Task } from "../../../../../lib/models";
import { useDashboard } from "../../../../../lib/repositories/repositoryContext";
import { toDisplayDate } from "../../../../../lib/utils/time";
import {
  buildTaskTimeline,
  calculateSessionActiveDuration,
  calculateTaskActiveDuration,
  formatActiveDuration,
  groupTimelineByDate,
  normalizeTaskStatus,
} from "../../../../../lib/workflow";

const taskStatuses = ["open", "ready", "in_progress", "blocked", "completed", "cancelled"] as const;

function LongContent({ title, value }: { title: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {title}
        <span aria-hidden="true" className="float-right text-slate-400">+</span>
      </summary>
      <p className="border-t border-slate-100 px-4 py-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{value}</p>
    </details>
  );
}

function statusLabel(status: Task["status"]) {
  return normalizeTaskStatus(status).replaceAll("_", " ");
}

export default function TaskDetailPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const {
    data,
    updateTask,
    setTaskStatus,
    createTaskPromptRecord,
    startTaskWorkSession,
    pauseTaskWorkSession,
    resumeTaskWorkSession,
    finishTaskWorkSession,
  } = useDashboard();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const task = data.tasks.find((candidate) => candidate.id === taskId && candidate.projectId === projectId);
  const sourceIdea = task?.sourceIdeaId
    ? data.ideas.find((idea) => idea.id === task.sourceIdeaId && idea.projectId === projectId)
    : null;
  const prompts = useMemo(
    () => data.codexPrompts
      .filter((prompt) => prompt.projectId === projectId && prompt.relatedTaskId === taskId)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber),
    [data.codexPrompts, projectId, taskId],
  );
  const sessions = useMemo(
    () => data.developmentSessions
      .filter((session) => session.projectId === projectId && session.taskId === taskId)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)),
    [data.developmentSessions, projectId, taskId],
  );
  const activeSession = sessions.find((session) => session.status === "active");
  const pausedSession = sessions.find((session) => session.status === "paused");
  const timelineDays = useMemo(
    () => [...groupTimelineByDate(buildTaskTimeline(data, taskId))].reverse(),
    [data, taskId],
  );
  const [summary, setSummary] = useState("");
  const [requestedChange, setRequestedChange] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  if (!project || !task) {
    return (
      <div className="space-y-4">
        <p>Task not found in this project.</p>
        <Link href={`/projects/${projectId}?section=tasks`} className="text-sm font-semibold text-blue-700 hover:underline">Back to tasks</Link>
      </div>
    );
  }

  const totalTime = calculateTaskActiveDuration(data.developmentSessions, task.id);
  const latestPrompt = prompts.at(-1);

  const preparePrompt = (event: FormEvent) => {
    event.preventDefault();
    if (!summary.trim()) return;
    const prompt = generateTaskPrompt(data, project.id, task.id, summary, requestedChange);
    const record = createTaskPromptRecord({
      taskId: task.id,
      summary: summary.trim(),
      requestedChange: requestedChange.trim() || task.details,
      prompt,
      source: "chatgpt",
      workSessionId: activeSession?.id ?? pausedSession?.id ?? null,
    });
    if (!record) return;
    setGeneratedPrompt(prompt);
    setCopyStatus(`Prompt ${record.sequenceNumber} saved before Codex work begins.`);
    setSummary("");
    setRequestedChange("");
  };

  const copyPrompt = () => {
    if (!generatedPrompt || !navigator.clipboard) return;
    void navigator.clipboard.writeText(generatedPrompt).then(
      () => setCopyStatus("Prompt copied."),
      () => setCopyStatus("Copy failed. Select the prompt text manually."),
    );
  };

  const continueWork = () => {
    if (activeSession) {
      pauseTaskWorkSession(activeSession.id, task.recommendedNextStep);
      return;
    }
    if (pausedSession) {
      resumeTaskWorkSession(pausedSession.id, pausedSession.nextStep || task.recommendedNextStep);
      return;
    }
    startTaskWorkSession({
      taskId: task.id,
      promptRecordId: latestPrompt?.id ?? null,
      source: "manual",
      resumeFromNote: task.recommendedNextStep,
    });
  };

  return (
    <div className="space-y-8">
      <header>
        <Link href={`/projects/${project.id}?section=tasks`} className="text-sm font-semibold text-blue-700 hover:underline">{project.title} tasks</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-3xl font-semibold tracking-tight text-slate-950">{task.title}</h1>
            <p className="mt-2 text-sm text-slate-500">Task ID: <span className="font-mono">{task.id}</span></p>
          </div>
          <label className="block">
            <span className="sr-only">Task status</span>
            <select
              value={normalizeTaskStatus(task.status)}
              onChange={(event) => {
                const status = event.target.value as Task["status"];
                if (status === "blocked") {
                  const blocker = window.prompt("What is blocking this task?");
                  if (!blocker?.trim()) return;
                  setTaskStatus(task.id, status, blocker.trim());
                  return;
                }
                if (status === "completed" && !window.confirm("Mark this task completed?")) return;
                setTaskStatus(task.id, status);
              }}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {taskStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
            </select>
          </label>
        </div>
      </header>

      <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-lg sm:p-7">
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Next recommended step</p>
            <p className="mt-2 text-xl font-semibold leading-8">{task.recommendedNextStep || task.details || "Review the task and choose the next action."}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total active time</p>
            <p className="mt-2 text-2xl font-semibold">{formatActiveDuration(totalTime)}</p>
          </div>
        </div>
        {task.blockedReason ? (
          <div className="mt-5 rounded-2xl border border-rose-400/40 bg-rose-400/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-200">Current blocker</p>
            <p className="mt-1 text-sm leading-6 text-rose-50">{task.blockedReason}</p>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={continueWork} className="dd-btn bg-white text-slate-950 hover:bg-slate-100">
            {activeSession ? "Pause work" : pausedSession ? "Continue work" : "Start work"}
          </button>
          {normalizeTaskStatus(task.status) !== "completed" ? (
            <button type="button" onClick={() => {
              if (window.confirm("Mark this task completed?")) setTaskStatus(task.id, "completed");
            }} className="dd-btn border-white/30 bg-transparent text-white hover:bg-white/10">Mark completed</button>
          ) : (
            <button type="button" onClick={() => setTaskStatus(task.id, "ready")} className="dd-btn border-white/30 bg-transparent text-white hover:bg-white/10">Return to Ready</button>
          )}
        </div>
      </section>

      <section className="grid gap-3">
        <LongContent title="Original idea" value={sourceIdea ? `${sourceIdea.text}\n\n${sourceIdea.description}` : ""} />
        <LongContent title="Requested change" value={task.details} />
        <LongContent title="Acceptance criteria" value={task.acceptanceCriteria} />
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-5 py-4 text-lg font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Edit task details</summary>
        <form className="grid gap-4 border-t border-slate-100 p-5" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          updateTask(task.id, {
            details: String(form.get("details") || ""),
            acceptanceCriteria: String(form.get("acceptanceCriteria") || ""),
            recommendedNextStep: String(form.get("nextStep") || ""),
          });
        }}>
          <label className="grid gap-1 text-sm font-medium">Requested change<textarea name="details" defaultValue={task.details} rows={4} className="rounded-xl border border-slate-300 p-3 font-normal" /></label>
          <label className="grid gap-1 text-sm font-medium">Acceptance criteria<textarea name="acceptanceCriteria" defaultValue={task.acceptanceCriteria} rows={4} className="rounded-xl border border-slate-300 p-3 font-normal" /></label>
          <label className="grid gap-1 text-sm font-medium">Next recommended step<textarea name="nextStep" defaultValue={task.recommendedNextStep} rows={2} className="rounded-xl border border-slate-300 p-3 font-normal" /></label>
          <button type="submit" className="dd-btn dd-btn--primary justify-self-start">Save task</button>
        </form>
      </details>

      <section aria-labelledby="prompt-history-heading" className="space-y-4">
        <div>
          <h2 id="prompt-history-heading" className="text-2xl font-semibold text-slate-950">Prompt history</h2>
          <p className="mt-1 text-sm text-slate-500">Each prompt remains linked to this task in sequence.</p>
        </div>
        <details className="rounded-2xl border border-blue-200 bg-blue-50" open={prompts.length === 0}>
          <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-blue-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Prepare a Codex prompt</summary>
          <form onSubmit={preparePrompt} className="grid gap-4 border-t border-blue-200 p-5">
            <label className="grid gap-1 text-sm font-medium text-blue-950">Dashboard change summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} required maxLength={2000} rows={3} className="rounded-xl border border-blue-200 bg-white p-3 font-normal text-slate-900" placeholder="Plain-language summary of what this prompt asks Codex to change." /></label>
            <label className="grid gap-1 text-sm font-medium text-blue-950">Requested change override (optional)<textarea value={requestedChange} onChange={(event) => setRequestedChange(event.target.value)} maxLength={12_000} rows={4} className="rounded-xl border border-blue-200 bg-white p-3 font-normal text-slate-900" placeholder="Leave blank to use the task's requested change." /></label>
            <button type="submit" className="dd-btn dd-btn--primary justify-self-start">Save and prepare prompt</button>
          </form>
        </details>
        {generatedPrompt ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-950">Prepared prompt</h3>
              <button type="button" onClick={copyPrompt} className="dd-btn dd-btn--secondary">Copy prompt</button>
            </div>
            <textarea readOnly value={generatedPrompt} rows={10} className="mt-4 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs leading-5" />
          </div>
        ) : null}
        <p className="min-h-5 text-sm text-slate-600" aria-live="polite">{copyStatus}</p>
        {prompts.map((prompt) => (
          <details key={prompt.id} className="rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <span className="font-semibold text-slate-950">Prompt {prompt.sequenceNumber}: {prompt.promptSummary || prompt.title}</span>
              <span className="ml-2 text-xs capitalize text-slate-500">{prompt.status}</span>
            </summary>
            <div className="space-y-3 border-t border-slate-100 p-5 text-sm text-slate-700">
              <p className="whitespace-pre-wrap break-words">{prompt.requestedChange || prompt.purpose}</p>
              {prompt.resultSummary ? <p><span className="font-semibold">Result:</span> {prompt.resultSummary}</p> : null}
              {prompt.blocker ? <p className="text-rose-700"><span className="font-semibold">Blocker:</span> {prompt.blocker}</p> : null}
              <p className="text-xs text-slate-500">Prepared by {prompt.createdBy} on {toDisplayDate(prompt.createdAt)} · {formatActiveDuration(prompt.activeDurationMs)}</p>
            </div>
          </details>
        ))}
      </section>

      {sessions.length > 0 ? (
        <section aria-labelledby="work-sessions-heading" className="space-y-4">
          <h2 id="work-sessions-heading" className="text-2xl font-semibold text-slate-950">Work sessions</h2>
          {sessions.map((session) => (
            <article key={session.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">{session.objective}</h3>
                  <p className="mt-1 text-xs capitalize text-slate-500">{session.source} · {session.status} · {toDisplayDate(session.startedAt)}</p>
                </div>
                <span className="text-sm font-semibold text-slate-700">{formatActiveDuration(calculateSessionActiveDuration(session))}</span>
              </div>
              {session.summary ? <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{session.summary}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {session.status === "active" ? <button type="button" onClick={() => pauseTaskWorkSession(session.id, task.recommendedNextStep)} className="dd-btn dd-btn--secondary">Pause</button> : null}
                {session.status === "paused" ? <button type="button" onClick={() => resumeTaskWorkSession(session.id, session.nextStep)} className="dd-btn dd-btn--secondary">Resume</button> : null}
                {["active", "paused"].includes(session.status) ? <button type="button" onClick={() => finishTaskWorkSession(session.id, { nextStep: task.recommendedNextStep })} className="dd-btn dd-btn--secondary">Finish session</button> : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {timelineDays.length > 0 ? (
        <section aria-labelledby="task-timeline-heading" className="space-y-5">
          <div>
            <h2 id="task-timeline-heading" className="text-2xl font-semibold text-slate-950">Task timeline</h2>
            <p className="mt-1 text-sm text-slate-500">Oldest event first, grouped by work date.</p>
          </div>
          {timelineDays.map((day) => (
            <article key={day.dateKey} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <h3 className="font-semibold text-slate-950">{day.label}</h3>
                {day.activeDurationMs > 0 ? <span className="text-sm text-slate-600">{formatActiveDuration(day.activeDurationMs)}</span> : null}
              </div>
              <ol className="mt-4 space-y-4">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-blue-500 pl-4">
                    <p className="text-xs font-semibold capitalize text-blue-700">{entry.actor} · {entry.kind}</p>
                    <p className="mt-1 text-sm font-medium leading-6 text-slate-900">{entry.summary}</p>
                    {entry.detail ? <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{entry.detail}</p> : null}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      ) : null}

      <footer className="text-sm text-slate-500">Status: <span className="capitalize">{statusLabel(task.status)}</span> · Last worked {toDisplayDate(task.lastWorkedAt || task.updatedAt)}</footer>
    </div>
  );
}
