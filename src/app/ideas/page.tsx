"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "../../lib/repositories/repositoryContext";
import type { Idea } from "../../lib/models";
import { normalizeIdeaStatus, type CanonicalIdeaStatus } from "../../lib/workflow";
import { toDisplayDate } from "../../lib/utils/time";

const ideaStatuses: CanonicalIdeaStatus[] = ["inbox", "ready_for_review", "converted", "archived"];

export default function IdeasPage() {
  const { data, addIdea, updateIdea, archiveIdea, convertIdeaToTask } = useDashboard();
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<"all" | CanonicalIdeaStatus>("all");

  const filtered = useMemo(() => data.ideas
    .filter((idea) => {
      const matchesText = `${idea.text} ${idea.description} ${idea.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase());
      return matchesText
        && (!projectId || idea.projectId === projectId)
        && (status === "all" || normalizeIdeaStatus(idea.status) === status);
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [data.ideas, projectId, query, status]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedProject = String(form.get("projectId") || "");
    const title = String(form.get("ideaTitle") || "").trim();
    if (!title || !selectedProject) return;
    addIdea({
      projectId: selectedProject,
      text: title,
      description: String(form.get("ideaDescription") || ""),
      status: "inbox",
      priority: String(form.get("priority") || "medium") as Idea["priority"],
      source: "other",
      tags: String(form.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    });
    event.currentTarget.reset();
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">Capture before deciding</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Idea Inbox</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Review ideas, then convert the useful ones into linked tasks.</p>
        </div>
        <details className="relative w-full sm:w-auto">
          <summary className="dd-btn dd-btn--primary w-full cursor-pointer list-none sm:w-auto">Add idea</summary>
          <form onSubmit={onSubmit} className="mt-3 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg sm:absolute sm:right-6 sm:z-20 sm:w-[32rem]">
            <label className="grid gap-1 text-sm font-medium">Project<select name="projectId" required defaultValue="" className="dd-input font-normal"><option value="" disabled>Select project</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
            <label className="grid gap-1 text-sm font-medium">Idea title<input name="ideaTitle" required maxLength={240} className="dd-input font-normal" /></label>
            <label className="grid gap-1 text-sm font-medium">Full description<textarea name="ideaDescription" rows={4} maxLength={12_000} className="dd-input font-normal" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">Priority<select name="priority" defaultValue="medium" className="dd-input font-normal">{(["low", "medium", "high", "critical"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-medium">Tags<input name="tags" placeholder="ui, workflow" className="dd-input font-normal" /></label>
            </div>
            <button className="dd-btn dd-btn--primary justify-self-start">Save idea</button>
          </form>
        </details>
      </header>

      <section aria-label="Idea filters" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="dd-input font-normal"><option value="">All projects</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="dd-input font-normal"><option value="all">All statuses</option>{ideaStatuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Search<input value={query} onChange={(event) => setQuery(event.target.value)} className="dd-input font-normal" placeholder="Title, description, or tag" /></label>
      </section>

      {filtered.length > 0 ? (
        <ul className="grid gap-4">
          {filtered.map((idea) => {
            const project = data.projects.find((item) => item.id === idea.projectId);
            const canonicalStatus = normalizeIdeaStatus(idea.status);
            return (
              <li key={idea.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${idea.projectId}?section=ideas`} className="text-xs font-semibold text-blue-700 hover:underline">{project?.title || "Unknown project"}</Link>
                    <h2 className="mt-1 break-words text-lg font-semibold text-slate-950">{idea.text}</h2>
                    <p className="mt-1 text-xs capitalize text-slate-500">{canonicalStatus.replaceAll("_", " ")} · {idea.priority} · Updated {toDisplayDate(idea.updatedAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canonicalStatus === "inbox" ? <button className="dd-btn dd-btn--secondary" onClick={() => updateIdea(idea.id, { status: "ready_for_review" })}>Ready for review</button> : null}
                    {!["converted", "archived"].includes(canonicalStatus) ? <button className="dd-btn dd-btn--primary" onClick={() => convertIdeaToTask(idea.id)}>Convert to task</button> : null}
                    {canonicalStatus === "converted" && idea.linkedTaskId ? <Link className="dd-btn dd-btn--primary" href={`/projects/${idea.projectId}/tasks/${idea.linkedTaskId}`}>Open task</Link> : null}
                    {!["converted", "archived"].includes(canonicalStatus) ? <button className="dd-btn dd-btn--secondary" onClick={() => archiveIdea(idea.id)}>Archive</button> : null}
                  </div>
                </div>
                {idea.description ? (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-semibold text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Read full idea</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{idea.description}</p>
                  </details>
                ) : null}
                {idea.tags.length > 0 ? <p className="mt-3 truncate text-xs text-slate-500">{idea.tags.join(" · ")}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
