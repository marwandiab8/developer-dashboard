"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { GitHubSyncPanel } from "../../components/GitHubSyncPanel";
import type { Task } from "../../lib/models";
import {
  getProjectDisplayStatus,
  getProjectFocus,
  sortProjectsByRecency,
  type ProjectDisplayStatus,
} from "../../lib/presentation";
import { useDashboard } from "../../lib/repositories/repositoryContext";
import { toDisplayDate } from "../../lib/utils/time";

function StatusBadge({ status }: { status: ProjectDisplayStatus }) {
  const tone = status === "Blocked"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : status === "Paused"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{status}</span>;
}

export default function ProjectsPage() {
  const { data, createProject } = useDashboard();
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const projects = useMemo(() => sortProjectsByRecency(data.projects), [data.projects]);
  const tasksByProject = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of data.tasks) {
      const tasks = grouped.get(task.projectId) ?? [];
      tasks.push(task);
      grouped.set(task.projectId, tasks);
    }
    return grouped;
  }, [data.tasks]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !purpose.trim()) return;
    await createProject(title.trim(), purpose.trim());
    setTitle("");
    setPurpose("");
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">Project library</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Projects</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Pick up the most important work without losing the context behind it.
          </p>
        </div>

        <details className="group relative w-full sm:w-auto">
          <summary className="dd-btn dd-btn--primary w-full cursor-pointer list-none sm:w-auto">
            Create project
          </summary>
          <form
            onSubmit={onSubmit}
            className="mt-3 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg sm:absolute sm:right-0 sm:z-20 sm:w-[32rem]"
          >
            <h2 className="text-lg font-semibold text-slate-950">Create a project</h2>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="dd-input mt-1"
                autoComplete="off"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Short purpose</span>
              <textarea
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                className="dd-input mt-1 min-h-24"
                required
              />
            </label>
            <button type="submit" className="dd-btn dd-btn--primary justify-self-start">
              Save project
            </button>
          </form>
        </details>
      </header>

      {projects.length > 0 ? (
        <section aria-label="Project list" className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => {
            const tasks = tasksByProject.get(project.id) ?? [];
            const status = getProjectDisplayStatus(project, tasks);

            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-semibold text-slate-950 group-hover:text-blue-700">
                    {project.title}
                  </h2>
                  <StatusBadge status={status} />
                </div>
                <p className="mt-4 line-clamp-2 text-sm font-medium leading-6 text-slate-800">
                  {getProjectFocus(project, tasks)}
                </p>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{project.purpose}</p>
                <p className="mt-5 text-xs font-medium text-slate-500">
                  Last worked {toDisplayDate(project.lastWorkedAt || project.updatedAt)}
                </p>
              </Link>
            );
          })}
        </section>
      ) : null}

      <details className="rounded-2xl border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          Advanced options
        </summary>
        <div className="border-t border-slate-200 p-4 sm:p-5">
          <GitHubSyncPanel />
        </div>
      </details>
    </div>
  );
}
