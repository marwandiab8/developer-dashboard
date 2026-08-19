import type { DashboardData } from "./models";
import { generateAiContext } from "./markdown/generateAiContext";
import { generateProjectResume } from "./markdown/generateProjectResume";
import { calculateTaskActiveDuration } from "./workflow";

export const getTaskContext = (data: DashboardData, projectId: string, taskId: string) => {
  const project = data.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("Project not found.");
  const task = data.tasks.find((candidate) => candidate.id === taskId && candidate.projectId === projectId);
  if (!task) throw new Error("Task not found in this project.");
  const sourceIdea = task.sourceIdeaId
    ? data.ideas.find((idea) => idea.id === task.sourceIdeaId && idea.projectId === projectId) ?? null
    : null;
  const prompts = data.codexPrompts
    .filter((prompt) => prompt.projectId === projectId && prompt.relatedTaskId === taskId)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const sessions = data.developmentSessions
    .filter((session) => session.projectId === projectId && session.taskId === taskId)
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const decisions = data.architectureDecisions
    .filter((decision) => decision.projectId === projectId && decision.status === "accepted")
    .sort((left, right) => Date.parse(right.decidedAt) - Date.parse(left.decidedAt));
  const github = project.externalSources?.github;

  return {
    project: {
      id: project.id,
      name: project.title,
      purpose: project.purpose,
      currentObjective: project.currentObjective,
      currentBlocker: project.currentBlocker,
      recommendedNextStep: project.nextRecommendedTask,
      repository: github
        ? {
            githubRepositoryId: github.externalRepositoryId,
            githubFullName: github.repositoryFullName,
            repositoryUrl: github.repositoryUrl,
            defaultBranch: github.defaultBranch,
          }
        : null,
    },
    task,
    sourceIdea,
    previousPrompts: prompts,
    workSessions: sessions,
    decisions,
    unfinishedWork: [...new Set([
      ...prompts.flatMap((prompt) => prompt.unfinishedWork),
      ...sessions.flatMap((session) => session.unfinishedItems ?? []),
    ])],
    totalActiveDurationMs: calculateTaskActiveDuration(data.developmentSessions, taskId),
    projectResume: generateProjectResume(data, projectId),
    aiContext: generateAiContext(data, projectId),
  };
};
