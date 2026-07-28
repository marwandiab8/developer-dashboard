"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "../../lib/repositories/repositoryContext";
import type { Idea } from "../../lib/models";

export default function IdeasPage() {
  const { data, addIdea, updateIdea, archiveIdea, convertIdeaToTask } = useDashboard();
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");

  const filtered = useMemo(() => {
    return data.ideas.filter((idea) => {
      const matchesText = `${idea.text} ${idea.description}`.toLowerCase().includes(query.toLowerCase());
      const matchesProject = !projectId || idea.projectId === projectId;
      return matchesText && matchesProject;
    });
  }, [data.ideas, query, projectId]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const title = (form.elements.namedItem("ideaTitle") as HTMLInputElement)?.value?.trim();
    if (!title || !projectId) return;
    addIdea({
      projectId,
      text: title,
      description: (form.elements.namedItem("ideaDescription") as HTMLTextAreaElement)?.value || "",
      status: "inbox",
      priority: "medium",
      source: "other",
      tags: [],
    });
    form.reset();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Ideas Inbox</h1>

      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-3">
        <label className="sm:col-span-1">
          <span className="text-sm">Project</span>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-2"
          >
            <option value="">Select project</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm">Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-2"
            placeholder="Filter by text"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm">Idea title</span>
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-2" name="ideaTitle" required />
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm">Description</span>
          <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-2" name="ideaDescription" rows={2} />
        </label>
        <button className="sm:col-span-3 rounded bg-sky-600 px-3 py-2 text-white">Add idea</button>
      </form>

      <ul className="space-y-2">
        {filtered.map((idea: Idea) => {
          const project = data.projects.find((item) => item.id === idea.projectId);
          return (
            <li key={idea.id} className="rounded border border-slate-200 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link href={`/projects/${idea.projectId}?section=ideas`} className="text-sky-700">{project?.title || "Unknown project"}</Link>
                  <p className="font-medium">{idea.text}</p>
                  <p className="text-sm text-slate-600">{idea.description}</p>
                </div>
                <div className="flex gap-2">
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => convertIdeaToTask(idea.id)}>
                    Convert to task
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => archiveIdea(idea.id)}>
                    Archive
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => updateIdea(idea.id, { status: "reviewed" })}>
                    Mark reviewed
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
