"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { GitHubSyncPanel } from "../../components/GitHubSyncPanel";
import { useDashboard } from "../../lib/repositories/repositoryContext";
import { toShortDisplayDate } from "../../lib/utils/time";

export default function ProjectsPage() {
  const { data, createProject } = useDashboard();
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");

  const projects = useMemo(
    () => [...data.projects].sort((a, b) =>
      new Date(b.lastWorkedAt || b.updatedAt).getTime()
      - new Date(a.lastWorkedAt || a.updatedAt).getTime()),
    [data.projects],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !purpose.trim()) return;
    await createProject(title.trim(), purpose.trim());
    setTitle("");
    setPurpose("");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm font-semibold text-slate-500 hover:text-slate-900">← Home</Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Projects</h1>
          <p className="mt-1 text-slate-600">Choose a project. The most recently worked projects are first.</p>
        </div>

        <details className="group relative">
          <summary className="dd-btn dd-btn--primary cursor-pointer list-none marker:content-none">
            + New project
          </summary>
          <form
            onSubmit={onSubmit}
            className="absolute right-0 z-20 mt-2 grid w-[min(28rem,calc(100vw-2rem))] gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
          >
            <h2 className="font-bold text-slate-950">Add a project</h2>
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="dd-input mt-1"
                placeholder="Example: Time Left To Live"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">What is it for?</span>
              <textarea
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                className="dd-input mt-1 min-h-24"
                placeholder="One clear sentence"
                required
              />
            </label>
            <button type="submit" className="dd-btn dd-btn--primary">Create project</button>
          </form>
        </details>
      </header>

      <section className="grid gap-3">
        {projects.map((project) => {
          const openTask = data.tasks.find((task) =>
            task.projectId === project.id && task.status === "in_progress",
          );
          const next = openTask?.title
            || project.currentObjective
            || project.nextRecommendedTask
            || "No next step saved yet";
          const blocked = project.currentBlocker && !/^(none|none\.)$/i.test(project.currentBlocker.trim());
          const paused = project.manualStatus === "paused" || project.status === "on_hold";

          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-950 group-hover:text-emerald-700">{project.title}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    paused
                      ? "bg-amber-50 text-amber-700"
                      : blocked
                      ? "bg-rose-50 text-rose-700"
                      : project.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                  }`}>
                    {paused ? "Paused" : blocked ? "Blocked" : project.status}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-800">{next}</p>
                {project.purpose ? <p className="mt-1 line-clamp-1 text-sm text-slate-500">{project.purpose}</p> : null}
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-500 sm:text-right">
                <span>Last worked<br className="hidden sm:block" /> {toShortDisplayDate(project.lastWorkedAt)}</span>
                <span className="text-xl text-slate-400" aria-hidden="true">→</span>
              </div>
            </Link>
          );
        })}
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-700 marker:content-none">
          GitHub sync and import settings
        </summary>
        <div className="border-t border-slate-200 p-4">
          <GitHubSyncPanel />
        </div>
      </details>
    </div>
  );
}
