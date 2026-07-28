"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useDashboard } from "../../lib/repositories/repositoryContext";
import type { Task } from "../../lib/models";

export default function TasksPage() {
  const { data, addTask, startTask, blockTask, completeTask, updateTask } = useDashboard();
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Task["status"]>("all");

  const tasks = data.tasks.filter((task) => {
    const matchesProject = !projectId || task.projectId === projectId;
    const matchesStatus = status === "all" || task.status === status;
    const matchesQuery = `${task.title} ${task.details}`.toLowerCase().includes(query.toLowerCase());
    return matchesProject && matchesStatus && matchesQuery;
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const title = (form.elements.namedItem("taskTitle") as HTMLInputElement)?.value?.trim();
    const details = (form.elements.namedItem("taskDetails") as HTMLTextAreaElement)?.value || "";
    const type = (form.elements.namedItem("taskType") as HTMLSelectElement)?.value as Task["type"];
    if (!title || !projectId) return;
    addTask({
      projectId,
      title,
      details,
      type,
      status: "backlog",
      priority: "medium",
      blockedReason: "",
      sourceIdeaId: null,
      acceptanceCriteria: "",
      implementationNotes: "",
      startedAt: null,
      completedAt: null,
    });
    form.reset();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tasks</h1>

      <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-3">
        <label>
          <span className="text-sm">Project</span>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-2">
            <option value="">Select project</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm">Title</span>
          <input name="taskTitle" required className="mt-1 w-full rounded border border-slate-300 px-2 py-2" />
        </label>
        <label>
          <span className="text-sm">Type</span>
          <select name="taskType" defaultValue="feature" className="mt-1 w-full rounded border border-slate-300 px-2 py-2">
            {(["feature", "improvement", "bug", "research", "maintenance", "documentation"] as const).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-3">
          <span className="text-sm">Details</span>
          <textarea name="taskDetails" rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-2" />
        </label>
        <button className="rounded bg-sky-600 px-3 py-2 text-white sm:col-span-3">Add task</button>
      </form>

      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="rounded border border-slate-300 px-2 py-2" />
        <button className={`rounded border px-2 py-1 ${status === "all" ? "bg-slate-200" : ""}`} onClick={() => setStatus("all")}>All</button>
        {(["backlog", "ready", "in_progress", "blocked", "testing", "completed", "cancelled"] as const).map((item) => (
          <button key={item} className={`rounded border px-2 py-1 ${status === item ? "bg-slate-200" : ""}`} onClick={() => setStatus(item)}>{item}</button>
        ))}
      </div>

      <ul className="space-y-2">
        {tasks.map((task: Task) => (
          <li key={task.id} className="rounded border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{task.title}</p>
                <p className="text-sm text-slate-600">{task.type} • {task.status} • {task.priority}</p>
                <p className="text-xs">{task.details}</p>
                <Link className="text-sm text-sky-700" href={`/projects/${task.projectId}?section=tasks`}>Open in project</Link>
              </div>
              <div className="flex gap-1">
                <button className="rounded border px-2 py-1 text-xs" onClick={() => startTask(task.id)}>Start</button>
                <button className="rounded border px-2 py-1 text-xs" onClick={() => blockTask(task.id, "blocked")}>Block</button>
                <button className="rounded border px-2 py-1 text-xs" onClick={() => completeTask(task.id)}>Complete</button>
              </div>
            </div>
            <label className="mt-2 block">
              <span className="text-xs">Acceptance criteria</span>
              <textarea
                value={task.acceptanceCriteria}
                className="mt-1 w-full rounded border border-slate-200 p-2"
                onBlur={(event) => updateTask(task.id, { acceptanceCriteria: event.target.value })}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
