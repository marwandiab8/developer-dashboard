import type { Project } from "../lib/models";

const formatLabel = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const syncLabel = (value: string) => {
  if (value === "success" || value === "succeeded") return "GitHub synced";
  if (value === "unavailable") return "GitHub unavailable";
  if (value === "failed") return "GitHub sync failed";
  return `GitHub ${formatLabel(value)}`;
};

export function GitHubProjectMetadata({
  project,
  compact = false,
}: {
  project: Project;
  compact?: boolean;
}) {
  const github = project.externalSources?.github;
  if (!github) return null;

  const visibility = String(github.visibility);
  const synchronizationStatus = String(github.synchronizationStatus);

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "mt-2" : "mt-3"}`} data-github-source>
      <span className="dd-badge border-slate-300 bg-slate-50 text-slate-700">GitHub</span>
      <span className={`dd-badge ${visibility === "private" ? "border-amber-200 bg-amber-50 text-amber-800" : ""}`}>
        {formatLabel(visibility)}
      </span>
      {github.isArchived ? <span className="dd-badge border-slate-300 bg-slate-100 text-slate-700">Archived</span> : null}
      {github.isFork ? <span className="dd-badge border-sky-200 bg-sky-50 text-sky-800">Fork</span> : null}
      <span
        className={`dd-badge ${synchronizationStatus === "failed" || synchronizationStatus === "unavailable" ? "border-rose-200 bg-rose-50 text-rose-800" : "dd-badge--active"}`}
      >
        {syncLabel(synchronizationStatus)}
      </span>
      <a
        href={github.repositoryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-medium text-sky-700 hover:underline"
        aria-label={`Open ${github.repositoryFullName} on GitHub`}
      >
        {compact ? "Repository" : github.repositoryFullName}
      </a>
    </div>
  );
}
