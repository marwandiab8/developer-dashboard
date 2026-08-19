import type { DashboardData } from "../models";
import { getTaskContext } from "../taskContext";

const bullets = (values: string[]) => values.length > 0
  ? values.map((value) => `- ${value}`).join("\n")
  : "- None recorded";

export const generateTaskPrompt = (
  data: DashboardData,
  projectId: string,
  taskId: string,
  dashboardChangeSummary: string,
  requestedChangeOverride?: string,
): string => {
  const context = getTaskContext(data, projectId, taskId);
  const { project, task, sourceIdea } = context;
  const repository = project.repository?.githubFullName
    ?? project.repository?.repositoryUrl
    ?? "No repository identity is recorded; verify the local repository before editing.";
  const requestedChange = requestedChangeOverride?.trim() || task.details;
  const previousWork = [
    ...context.previousPrompts.map((prompt) =>
      `Prompt ${prompt.sequenceNumber}: ${prompt.promptSummary} (${prompt.status})`),
    ...context.workSessions.map((session) =>
      `${session.source}: ${session.summary || session.objective}${session.nextStep ? `; next: ${session.nextStep}` : ""}`),
  ];

  return [
    "# Codex implementation task",
    "",
    "## 1. Project and repository",
    `Project: ${project.name} (${project.id})`,
    `Purpose: ${project.purpose}`,
    `Repository: ${repository}`,
    `Branch context: ${task.githubBranch || project.repository?.defaultBranch || "Verify the current branch locally."}`,
    "",
    "## 2. Task identity",
    `Task ID: ${task.id}`,
    `Project ID: ${task.projectId}`,
    `Status: ${task.status}`,
    sourceIdea ? `Source idea ID: ${sourceIdea.id}` : "Source idea: none",
    "",
    "## 3. Objective",
    task.title,
    "",
    "## 4. Requested change",
    requestedChange || "No additional requested-change text was recorded.",
    "",
    "## 5. Background and reason for the change",
    sourceIdea?.description || sourceIdea?.text || project.currentObjective || project.purpose,
    "",
    "## 6. Existing behavior",
    task.implementationNotes || "Inspect the current implementation and document the behavior before changing it.",
    "",
    "## 7. Required behavior",
    requestedChange || task.recommendedNextStep || project.recommendedNextStep,
    "",
    "## 8. Acceptance criteria",
    task.acceptanceCriteria || "Confirm the requested behavior with focused regression coverage.",
    "",
    "## 9. Previous work and decisions",
    bullets([
      ...previousWork,
      ...context.decisions.map((decision) => `${decision.title}: ${decision.decision}`),
      ...context.unfinishedWork.map((item) => `Unfinished: ${item}`),
    ]),
    "",
    "## 10. Security and data-preservation requirements",
    "- Preserve existing user data, stable IDs, authentication, Firebase ownership rules, and GitHub synchronization boundaries.",
    "- Never expose or store credentials, tokens, authorization headers, private keys, service-account data, or .env contents.",
    "- Treat GitHub data as additive context; it must not overwrite Dashboard-owned workflow history.",
    "",
    "## 11. Testing and visual-verification requirements",
    "- Run the repository lint, TypeScript, complete tests, rules tests, Functions tests, and production build relevant to the change.",
    "- Verify affected desktop and mobile flows in a browser and report console or accessibility issues.",
    "",
    "## 12. Deployment restrictions",
    "- Do not commit, push, deploy, migrate production data, create secrets, or change the live Firebase environment without explicit approval.",
    "",
    "## 13. Required completion report",
    "Report the summary, completed and unfinished work, problems, decisions, modified files, commits, branch, blocker, next task, timestamps, active duration, tests, build, and deployment status. Use the exact project, task, prompt-record, work-session, and external Codex session IDs supplied by the dashboard.",
    "",
    "## Dashboard change summary",
    dashboardChangeSummary.trim(),
    "",
  ].join("\n");
};
