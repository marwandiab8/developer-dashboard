"use client";

import Link from "next/link";
import { useMemo } from "react";
import { GitHubProjectMetadata } from "../components/GitHubProjectMetadata";
import { useDashboard } from "../lib/repositories/repositoryContext";
import { toDisplayDate } from "../lib/utils/time";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 text-sm text-slate-700">{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  const { data } = useDashboard();

  const activeProjects = data.projects.filter((project) => project.status === "active");
  const recentlyUpdated = useMemo(
    () =>
      [...data.projects]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 6),
    [data.projects],
  );
  const unreviewedIdeas = data.ideas.filter((idea) => idea.status === "inbox" || idea.status === "reviewed");
  const currentTasks = useMemo(
    () => data.tasks.filter((task) => ["backlog", "ready", "in_progress"].includes(task.status)),
    [data.tasks],
  );
  const recentSessions = useMemo(
    () =>
      [...data.developmentSessions]
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, 6),
    [data.developmentSessions],
  );

  const continueWork = useMemo(() => {
    return data.projects
      .map((project) => {
        const inProgress = data.tasks.find((task) => task.projectId === project.id && task.status === "in_progress");
        const lastIdea = [...data.ideas]
          .filter((idea) => idea.projectId === project.id)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        const score = (inProgress ? 2 : 0) + (project.lastWorkedAt ? 1 : 0) + (lastIdea ? 1 : 0);
        return { project, score, inProgress, lastIdea };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [data.ideas, data.projects, data.tasks]);

  const highlighted = useMemo(() => continueWork.find((entry) => entry.project.status === "active") || continueWork[0], [continueWork]);
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-slate-900 p-4 text-white sm:p-6">
        <p className="text-sm uppercase tracking-wide text-slate-300">Current focus</p>
        {highlighted ? (
          <div className="mt-2">
            <p className="text-2xl font-semibold">{highlighted.project.title}</p>
            <p className="mt-1 text-sm text-slate-200">
              Objective: {highlighted.project.currentObjective || "Not set yet"}
            </p>
            <p className="text-sm text-slate-200">
              In-progress task: {highlighted.inProgress?.title || "No active task"}
            </p>
            <p className="text-sm text-slate-300">Last worked: {toDisplayDate(highlighted.project.lastWorkedAt)}</p>
          </div>
        ) : (
          <p className="mt-2 text-slate-200">No recent work yet. Capture a new idea to begin.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="?quickCapture=1"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          >
            Quick Capture
          </Link>
          <Link
            href="/projects"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/40 px-3 py-2 text-sm font-medium text-white"
          >
            Open Projects
          </Link>
          <Link
            href="/search"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/40 px-3 py-2 text-sm font-medium text-white"
          >
            Search
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Continue Where I Left Off</h2>
        {continueWork.length > 0 ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {continueWork.map(({ project, inProgress, lastIdea }) => (
              <article key={project.id} className="rounded-xl border border-slate-200 p-3">
                <h3 className="font-semibold">{project.title}</h3>
                <GitHubProjectMetadata project={project} compact />
                <p className="mt-1 text-sm text-slate-600">
                  Last worked: {toDisplayDate(project.lastWorkedAt)}
                </p>
                <p className="text-sm">Current objective: {project.currentObjective || "Not set"}</p>
                <p className="text-sm">Current task: {inProgress?.title || "No active task"}</p>
                <p className="text-sm">Last idea: {lastIdea?.text || "none"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" href={`/projects/${project.id}?section=workbench`}>
                    Open Workbench
                  </Link>
                  <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm" href={`/projects/${project.id}?quickCapture=1`}>
                    Quick Capture
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">No active resume data yet.</p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Quick capture status">
          <p>All projects: {data.projects.length}</p>
          <p>Unreviewed ideas: {unreviewedIdeas.length}</p>
          <p>Open tasks: {currentTasks.length}</p>
          <p>Recent sessions: {recentSessions.length}</p>
        </Section>

        <Section title="Recent ideas (preview)">
          <ul className="space-y-2">
            {unreviewedIdeas.slice(0, 8).map((idea) => (
              <li key={idea.id} className="rounded-lg border border-slate-200 p-2">
                <p className="font-medium">{idea.text}</p>
                <p className="text-xs text-slate-500">{idea.status} • {idea.priority}</p>
              </li>
            ))}
            {!unreviewedIdeas.length && <li className="text-slate-500">Capture a thought and ideas will appear here.</li>}
          </ul>
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Active projects">
          {activeProjects.length ? (
            <ul className="space-y-2">
              {activeProjects.map((project) => (
                <li key={project.id} className="flex justify-between gap-2">
                  <Link href={`/projects/${project.id}`} className="font-medium text-slate-900">
                    {project.title}
                  </Link>
                  <span className="text-xs text-slate-500">{project.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No active projects.</p>
          )}
        </Section>

        <Section title="Current sessions">
          {recentSessions.length ? (
            <ul className="space-y-2">
              {recentSessions.map((session) => (
                <li key={session.id} className="rounded-lg border border-slate-200 p-2">
                  <p className="font-medium">{session.objective}</p>
                  <p className="text-xs text-slate-500">
                    {session.status} • started {toDisplayDate(session.startedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No recent sessions.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Section title="Recently updated projects">
          <ul className="space-y-2">
            {recentlyUpdated.map((project) => (
              <li key={project.id} className="flex justify-between gap-2">
                <Link href={`/projects/${project.id}`} className="text-slate-900 hover:underline">
                  {project.title}
                </Link>
                <span className="text-xs text-slate-500">{toDisplayDate(project.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="All projects">
          <ul className="space-y-2">
            {data.projects.map((project) => (
              <li key={project.id} className="flex justify-between gap-2">
                <Link href={`/projects/${project.id}`} className="text-slate-900 hover:underline">
                  {project.title}
                </Link>
                <span className="text-xs uppercase text-slate-500">{project.status}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Current tasks">
          {currentTasks.length ? (
            <ul className="space-y-2">
              {currentTasks.slice(0, 8).map((task) => (
                <li key={task.id} className="rounded-lg border border-slate-200 p-2">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-xs text-slate-500">{task.status} • {task.type} • {task.priority}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No open tasks.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
