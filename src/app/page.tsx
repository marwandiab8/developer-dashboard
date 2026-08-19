"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Task } from "../lib/models";
import {
  getMeaningfulActivities,
  getProjectDisplayStatus,
  getProjectFocus,
  hasActualBlocker,
  sortProjectsByRecency,
  type ProjectDisplayStatus,
} from "../lib/presentation";
import { useDashboard } from "../lib/repositories/repositoryContext";
import { toDisplayDate } from "../lib/utils/time";
import {
  buildTaskQueue,
  calculateTaskActiveDuration,
  formatActiveDuration,
  normalizeIdeaStatus,
  normalizeTaskStatus,
} from "../lib/workflow";

function ProjectStatus({ status }: { status: ProjectDisplayStatus }) {
  const tone = status === "Blocked"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : status === "Paused"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{status}</span>;
}

function TaskStatus({ task }: { task: Task }) {
  const status = normalizeTaskStatus(task.status);
  const label = status.replace("_", " ");
  const tone = status === "blocked"
    ? "bg-rose-100 text-rose-800"
    : status === "in_progress"
      ? "bg-blue-100 text-blue-800"
      : status === "ready"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${tone}`}>{label}</span>;
}

export default function DashboardPage() {
  const { data } = useDashboard();
  const projects = useMemo(() => sortProjectsByRecency(data.projects), [data.projects]);
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const tasksByProject = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    data.tasks.forEach((task) => grouped.set(task.projectId, [...(grouped.get(task.projectId) ?? []), task]));
    return grouped;
  }, [data.tasks]);
  const queue = useMemo(
    () => buildTaskQueue(data.tasks).filter((task) => !["completed", "cancelled"].includes(normalizeTaskStatus(task.status))),
    [data.tasks],
  );
  const currentTask = queue[0];
  const currentProject = currentTask ? projectsById.get(currentTask.projectId) : projects[0];
  const pendingIdeas = useMemo(
    () => data.ideas.filter((idea) => ["inbox", "ready_for_review"].includes(normalizeIdeaStatus(idea.status))),
    [data.ideas],
  );
  const recentProgress = useMemo(
    () => getMeaningfulActivities(data.activities)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 5),
    [data.activities],
  );
  const currentHref = currentTask && currentProject
    ? `/projects/${currentProject.id}/tasks/${currentTask.id}`
    : currentProject
      ? `/projects/${currentProject.id}`
      : "/projects";
  const currentBlocker = currentTask?.blockedReason || currentProject?.currentBlocker || "";

  return (
    <div className="space-y-10">
      <header>
        <p className="text-sm font-semibold text-blue-700">Your development workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          What are you working on?
        </h1>
      </header>

      {currentProject ? (
        <section aria-labelledby="continue-current-task" className="overflow-hidden rounded-3xl bg-slate-950 px-5 py-6 text-white shadow-lg shadow-slate-200 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-200">Continue current task</p>
            {currentTask ? <TaskStatus task={currentTask} /> : <ProjectStatus status={getProjectDisplayStatus(currentProject, tasksByProject.get(currentProject.id) ?? [])} />}
          </div>
          <p className="mt-4 text-sm font-medium text-slate-300">{currentProject.title}</p>
          <h2 id="continue-current-task" className="mt-1 max-w-3xl text-2xl font-semibold leading-tight sm:text-3xl">
            {currentTask?.title || currentProject.currentObjective || currentProject.nextRecommendedTask || "Choose the next useful task"}
          </h2>
          {currentTask?.recommendedNextStep ? (
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-200">Next: {currentTask.recommendedNextStep}</p>
          ) : null}
          {hasActualBlocker(currentBlocker) ? (
            <div className="mt-5 rounded-2xl border border-rose-400/40 bg-rose-400/10 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-200">Blocker</p>
              <p className="mt-1 text-sm leading-6 text-rose-50">{currentBlocker}</p>
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-300">
            <span>Last worked {toDisplayDate(currentTask?.lastWorkedAt || currentProject.lastWorkedAt || currentProject.updatedAt)}</span>
            {currentTask ? <span>{formatActiveDuration(calculateTaskActiveDuration(data.developmentSessions, currentTask.id))} active time</span> : null}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={currentHref} className="dd-btn bg-white text-slate-950 hover:bg-slate-100">Continue current task</Link>
            <Link href={`/?quickCapture=1&qcProject=${currentProject.id}`} className="dd-btn border-white/30 bg-transparent text-white hover:bg-white/10">Add a thought</Link>
          </div>
        </section>
      ) : null}

      {queue.length > 0 ? (
        <section aria-labelledby="task-queue-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="task-queue-heading" className="text-2xl font-semibold tracking-tight text-slate-950">Task queue</h2>
              <p className="mt-1 text-sm text-slate-500">In progress first, then blocked, ready, and open.</p>
            </div>
            <Link href="/tasks" className="text-sm font-semibold text-blue-700 hover:underline">View queue</Link>
          </div>
          <div className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {queue.slice(0, 5).map((task) => {
              const project = projectsById.get(task.projectId);
              return (
                <Link key={task.id} href={`/projects/${task.projectId}/tasks/${task.id}`} className="flex min-w-0 items-start justify-between gap-4 p-4 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-500">{project?.title || "Project"}</p>
                    <h3 className="mt-1 truncate font-semibold text-slate-950">{task.title}</h3>
                    {task.recommendedNextStep ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{task.recommendedNextStep}</p> : null}
                  </div>
                  <TaskStatus task={task} />
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {pendingIdeas.length > 0 ? (
        <aside className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-blue-950">Ideas waiting for review</h2>
            <p className="mt-1 text-sm text-blue-800">{pendingIdeas.length} {pendingIdeas.length === 1 ? "idea is" : "ideas are"} ready for your decision.</p>
          </div>
          <Link href="/ideas" className="text-sm font-semibold text-blue-800 hover:underline">Review ideas</Link>
        </aside>
      ) : null}

      {projects.length > 0 ? (
        <section aria-labelledby="recent-projects-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="recent-projects-heading" className="text-2xl font-semibold tracking-tight text-slate-950">Recently worked projects</h2>
              <p className="mt-1 text-sm text-slate-500">Your most recent project context.</p>
            </div>
            <Link href="/projects" className="text-sm font-semibold text-blue-700 hover:underline">View all</Link>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {projects.slice(0, 4).map((project) => {
              const tasks = tasksByProject.get(project.id) ?? [];
              return (
                <Link key={project.id} href={`/projects/${project.id}`} className="group min-w-0 rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 truncate text-lg font-semibold text-slate-950 group-hover:text-blue-700">{project.title}</h3>
                    <ProjectStatus status={getProjectDisplayStatus(project, tasks)} />
                  </div>
                  <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-700">{getProjectFocus(project, tasks)}</p>
                  <p className="mt-4 text-xs font-medium text-slate-500">Last worked {toDisplayDate(project.lastWorkedAt || project.updatedAt)}</p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {recentProgress.length > 0 ? (
        <section aria-labelledby="recent-progress-heading" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 id="recent-progress-heading" className="text-xl font-semibold text-slate-950">Recent meaningful progress</h2>
          <ul className="mt-4 space-y-4">
            {recentProgress.map((event) => (
              <li key={event.id} className="border-l-2 border-blue-500 pl-4">
                <p className="line-clamp-3 text-sm leading-6 text-slate-800">{event.summary}</p>
                <p className="mt-1 text-xs text-slate-500">{toDisplayDate(event.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
