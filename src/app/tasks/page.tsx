"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "../../lib/repositories/repositoryContext";
import type { Task } from "../../lib/models";
import {
  buildTaskQueue,
  calculateTaskActiveDuration,
  formatActiveDuration,
  normalizeTaskStatus,
  type CanonicalTaskStatus,
} from "../../lib/workflow";
import { toDisplayDate } from "../../lib/utils/time";

const statuses: CanonicalTaskStatus[] = ["open", "ready", "in_progress", "blocked", "completed", "cancelled"];

export default function TasksPage() {
  const { data, addTask, setTaskStatus } = useDashboard();
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CanonicalTaskStatus>("all");
  const [priority, setPriority] = useState<"all" | Task["priority"]>("all");
  const [workedSince, setWorkedSince] = useState("");

  const tasks = useMemo(() => buildTaskQueue(data.tasks, {
    projectId: projectId || undefined,
    status: status === "all" ? undefined : status,
    priority: priority === "all" ? undefined : priority,
    workedSince: workedSince || undefined,
  }).filter((task) => `${task.title} ${task.details} ${task.recommendedNextStep}`.toLowerCase().includes(query.toLowerCase())), [data.tasks, priority, projectId, query, status, workedSince]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedProject = String(form.get("projectId") || "");
    const title = String(form.get("taskTitle") || "").trim();
    if (!title || !selectedProject) return;
    addTask({
      projectId: selectedProject,
      title,
      details: String(form.get("taskDetails") || ""),
      type: String(form.get("taskType") || "feature") as Task["type"],
      status: "open",
      priority: String(form.get("priority") || "medium") as Task["priority"],
      blockedReason: "",
      sourceIdeaId: null,
      acceptanceCriteria: String(form.get("acceptanceCriteria") || ""),
      implementationNotes: "",
      startedAt: null,
      completedAt: null,
    });
    event.currentTarget.reset();
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">What to work on next</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Task queue</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">In progress first, then blocked, ready, and open.</p>
        </div>
        <details className="relative w-full sm:w-auto">
          <summary className="dd-btn dd-btn--secondary w-full cursor-pointer list-none sm:w-auto">Create task</summary>
          <form onSubmit={onSubmit} className="mt-3 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg sm:absolute sm:right-0 sm:z-20 sm:w-[34rem]">
            <label className="grid gap-1 text-sm font-medium">Project<select name="projectId" required defaultValue="" className="dd-input font-normal"><option value="" disabled>Select project</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
            <label className="grid gap-1 text-sm font-medium">Task title<input name="taskTitle" required maxLength={240} className="dd-input font-normal" /></label>
            <label className="grid gap-1 text-sm font-medium">Complete requested change<textarea name="taskDetails" rows={4} maxLength={12_000} className="dd-input font-normal" /></label>
            <label className="grid gap-1 text-sm font-medium">Acceptance criteria<textarea name="acceptanceCriteria" rows={3} maxLength={8_000} className="dd-input font-normal" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">Type<select name="taskType" defaultValue="feature" className="dd-input font-normal">{(["feature", "improvement", "bug", "research", "maintenance", "documentation"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-medium">Priority<select name="priority" defaultValue="medium" className="dd-input font-normal">{(["low", "medium", "high", "critical"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
            </div>
            <button className="dd-btn dd-btn--primary justify-self-start">Save task</button>
          </form>
        </details>
      </header>

      <section aria-label="Task queue filters" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="grid gap-1 text-sm font-medium">Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="dd-input font-normal"><option value="">All projects</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="dd-input font-normal"><option value="all">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} className="dd-input font-normal"><option value="all">All priorities</option>{(["critical", "high", "medium", "low"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Worked since<input type="date" value={workedSince} onChange={(event) => setWorkedSince(event.target.value)} className="dd-input font-normal" /></label>
        <label className="grid gap-1 text-sm font-medium">Search<input value={query} onChange={(event) => setQuery(event.target.value)} className="dd-input font-normal" /></label>
      </section>

      {tasks.length > 0 ? (
        <ol className="grid gap-4">
          {tasks.map((task) => {
            const project = data.projects.find((candidate) => candidate.id === task.projectId);
            const taskStatus = normalizeTaskStatus(task.status);
            return (
              <li key={task.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${task.projectId}`} className="text-xs font-semibold text-blue-700 hover:underline">{project?.title || "Unknown project"}</Link>
                    <h2 className="mt-1 break-words text-lg font-semibold text-slate-950">{task.title}</h2>
                    <p className="mt-1 text-xs capitalize text-slate-500">{taskStatus.replaceAll("_", " ")} · {task.priority} · {formatActiveDuration(calculateTaskActiveDuration(data.developmentSessions, task.id))} · Last worked {toDisplayDate(task.lastWorkedAt || task.updatedAt)}</p>
                    {task.recommendedNextStep ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-700">Next: {task.recommendedNextStep}</p> : null}
                    {task.blockedReason ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-rose-700">Blocked: {task.blockedReason}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link className="dd-btn dd-btn--primary" href={`/projects/${task.projectId}/tasks/${task.id}`}>{taskStatus === "in_progress" ? "Continue" : "Open task"}</Link>
                    <label>
                      <span className="sr-only">Change status for {task.title}</span>
                      <select value={taskStatus} onChange={(event) => {
                        const next = event.target.value as Task["status"];
                        if (next === "blocked") {
                          const blocker = window.prompt("What is blocking this task?");
                          if (!blocker?.trim()) return;
                          setTaskStatus(task.id, next, blocker.trim());
                          return;
                        }
                        if (next === "completed" && !window.confirm("Mark this task completed?")) return;
                        setTaskStatus(task.id, next);
                      }} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
                    </label>
                  </div>
                </div>
                {task.details ? <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Read requested change</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{task.details}</p></details> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
