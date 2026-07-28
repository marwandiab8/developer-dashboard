"use client";

import { useDashboard } from "../../lib/repositories/repositoryContext";
import { toDisplayDate } from "../../lib/utils/time";

export default function SessionsPage() {
  const { data } = useDashboard();
  const sessions = [...data.developmentSessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Development Sessions</h1>
      <div className="space-y-2">
        {sessions.map((session) => {
          const project = data.projects.find((item) => item.id === session.projectId);
          return (
            <div key={session.id} className="rounded border border-slate-200 p-3">
              <p className="font-semibold">{project?.title || "Unknown"}</p>
              <p className="text-sm">{session.objective}</p>
              <p className="text-xs text-slate-500">
                {session.status} • {toDisplayDate(session.startedAt)} - {session.endedAt ? toDisplayDate(session.endedAt) : "in progress"}
              </p>
              <p className="text-sm">Completed tasks: {session.tasksCompleted.length} • Ideas added: {session.ideasAdded.length}</p>
              <p className="text-sm">Next: {session.nextStartingPoint || "not set"}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
