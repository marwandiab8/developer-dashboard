"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { GitHubProjectMetadata } from "../../components/GitHubProjectMetadata";
import { GitHubSyncPanel } from "../../components/GitHubSyncPanel";
import { useDashboard } from "../../lib/repositories/repositoryContext";

export default function ProjectsPage() {
  const { data, createProject } = useDashboard();
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !purpose.trim()) return;
    await createProject(title.trim(), purpose.trim());
    setTitle("");
    setPurpose("");
  };

  const activeProjects = data.projects.filter((item) => item.status === "active");

  return (
    <div className="space-y-4">
      <GitHubSyncPanel />

      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-3">
        <h1 className="sm:col-span-3 text-xl font-semibold">Projects</h1>
        <label className="block sm:col-span-1">
          <span className="text-sm">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            required
          />
        </label>
        <label className="block sm:col-span-1">
          <span className="text-sm">Purpose</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            required
          />
        </label>
        <button
          type="submit"
          className="mt-5 w-full rounded-lg bg-sky-600 px-3 py-2 text-white sm:mt-7 sm:h-fit"
        >
          Add Project
        </button>
      </form>

      <section className="rounded-lg border border-slate-200 p-4">
        <h2 className="font-semibold">Active projects ({activeProjects.length})</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {activeProjects.map((project) => (
            <div key={project.id} className="rounded border border-slate-200 p-3">
              <Link href={`/projects/${project.id}`} className="text-lg font-semibold text-sky-700 hover:underline">
                {project.title}
              </Link>
              <p className="text-sm text-slate-600">{project.purpose}</p>
              <GitHubProjectMetadata project={project} compact />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <h2 className="font-semibold">All projects</h2>
        <ul className="mt-3 space-y-2">
          {data.projects.map((project) => (
            <li key={project.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/projects/${project.id}`} className="text-sky-700 hover:underline">
                {project.title}
              </Link>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <GitHubProjectMetadata project={project} compact />
                <span className="text-xs uppercase text-slate-500">{project.status}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
