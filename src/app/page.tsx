"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Project, Task } from "../lib/models";
import { useDashboard } from "../lib/repositories/repositoryContext";
import { toShortDisplayDate } from "../lib/utils/time";

function projectTimestamp(project: Project) {
  return new Date(project.lastWorkedAt || project.updatedAt).getTime();
}

function projectState(project: Project) {
  if (project.manualStatus === "paused" || project.status === "on_hold") {
    return { label: "Paused", className: "bg-amber-50 text-amber-700 ring-amber-200" };
  }
  if (project.currentBlocker && !/^(none|none\.)$/i.test(project.currentBlocker.trim())) {
    return { label: "Blocked", className: "bg-rose-50 text-rose-700 ring-rose-200" };
  }
  return { label: "Active", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
}

function nextLine(project: Project, task?: Task) {
  return task?.title
    || project.currentObjective
    || project.nextRecommendedTask
    || "No next step saved yet";
}

export default function DashboardPage() {
  const { data } = useDashboard();

  const openTasks = useMemo(
    () => data.tasks.filter((task) => ["ready", "in_progress", "blocked", "testing"].includes(task.status)),
    [data.tasks],
  );

  const visibleProjects = useMemo(
    () => [...data.projects]
      .filter((project) => project.status !== "archived")
      .sort((a, b) => projectTimestamp(b) - projectTimestamp(a)),
    [data.projects],
  );

  const focusProject = useMemo(() => {
    const withActiveTask = visibleProjects.find((project) =>
      openTasks.some((task) => task.projectId === project.id && task.status === "in_progress"),
    );
    return withActiveTask || visibleProjects.find((project) => project.status === "active") || visibleProjects[0];
  }, [openTasks, visibleProjects]);

  const focusTask = focusProject
    ? openTasks.find((task) => task.projectId === focusProject.id && task.status === "in_progress")
      || openTasks.find((task) => task.projectId === focusProject.id)
    : undefined;

  const inboxIdeas = data.ideas.filter((idea) => idea.status === "inbox" || idea.status === "reviewed");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">What are you working on?</h1>
      </header>

      {focusProject ? (
        <section className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-sm">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200">
                Continue here
              </span>
              <span className="text-sm text-slate-400">Last worked {toShortDisplayDate(focusProject.lastWorkedAt)}</span>
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight">{focusProject.title}</h2>
            <p className="mt-3 max-w-3xl text-lg leading-relaxed text-slate-200">
              {nextLine(focusProject, focusTask)}
            </p>
            {focusProject.currentBlocker && !/^(none|none\.)$/i.test(focusProject.currentBlocker.trim()) ? (
              <p className="mt-3 rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
                Blocker: {focusProject.currentBlocker}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href={`/projects/${focusProject.id}`}
                className="dd-btn bg-white font-semibold text-slate-950 hover:bg-slate-100"
              >
                Resume project
              </Link>
              <Link
                href={`/projects/${focusProject.id}?quickCapture=1&qcProject=${focusProject.id}`}
                className="dd-btn border border-white/25 text-white hover:bg-white/10"
              >
                Add a thought
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-xl font-semibold">Start with one project</h2>
          <p className="mt-2 text-slate-600">Add the project you most want to move forward.</p>
          <Link href="/projects" className="dd-btn dd-btn--primary mt-4">Add a project</Link>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-950">Your projects</h2>
            <p className="mt-1 text-sm text-slate-500">Open a project and see only what matters next.</p>
          </div>
          <Link href="/projects" className="text-sm font-semibold text-slate-700 hover:text-slate-950">
            View all
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {visibleProjects.slice(0, 6).map((project) => {
            const task = openTasks.find((item) => item.projectId === project.id && item.status === "in_progress")
              || openTasks.find((item) => item.projectId === project.id);
            const state = projectState(project);
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-bold text-slate-950 group-hover:text-emerald-700">{project.title}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${state.className}`}>
                    {state.label}
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-700">{nextLine(project, task)}</p>
                <p className="mt-4 text-xs text-slate-500">Last worked {toShortDisplayDate(project.lastWorkedAt)}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {inboxIdeas.length > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <p className="font-semibold text-amber-950">
              {inboxIdeas.length} {inboxIdeas.length === 1 ? "idea is" : "ideas are"} waiting for you
            </p>
            <p className="text-sm text-amber-800">Review them when you are ready—nothing else needs your attention here.</p>
          </div>
          <Link href="/ideas" className="dd-btn border border-amber-300 bg-white text-amber-950 hover:bg-amber-100">
            Review ideas
          </Link>
        </section>
      ) : null}
    </div>
  );
}
