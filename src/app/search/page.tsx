"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useDashboard } from "../../lib/repositories/repositoryContext";

export default function SearchPage() {
  const { data, search } = useDashboard();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReturnType<typeof search>>([]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setResults(search(query));
  };

  const entityLink = (item: (typeof results)[number]) => {
    const base = `/projects/${item.projectId}`;
    if (item.entityType === "idea") return `${base}?section=ideas`;
    if (item.entityType === "task") return `${base}?section=tasks`;
    if (item.entityType === "session") return `${base}?section=sessions`;
    if (item.entityType === "architecture_decision") return `${base}?section=architecture`;
    if (item.entityType === "codex_prompt") return `${base}?section=codex-prompts`;
    if (item.entityType === "note") return `${base}?section=notes`;
    if (item.entityType === "brain_dump") return `${base}?section=brain-dump`;
    if (item.entityType === "link") return `${base}?section=links`;
    return `${base}?section=workbench`;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Search</h1>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2"
          placeholder="Search projects, ideas, tasks, notes..."
        />
        <button type="submit" className="rounded bg-sky-600 px-3 py-2 text-white">Search</button>
      </form>

      <p className="text-sm text-slate-500">Projects: {data.projects.length}</p>

      <ul className="space-y-2">
        {results.map((result) => {
          const project = data.projects.find((item) => item.id === result.projectId);
          return (
            <li key={`${result.entityType}-${result.entityId}`} className="rounded border border-slate-200 p-2">
              <p className="text-sm text-slate-500">{project?.title}</p>
              <p className="font-medium">{result.text}</p>
              <p className="text-xs">{result.entityType} • {result.meta || ""}</p>
              <Link href={entityLink(result)} className="text-sky-700 text-sm">Open</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
