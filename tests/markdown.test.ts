import { describe, expect, it } from "vitest";
import { generateAiContext } from "../src/lib/markdown/generateAiContext";
import { generateProjectResume } from "../src/lib/markdown/generateProjectResume";
import { seedDashboardData } from "../src/lib/seed";

describe("markdown generators", () => {
  it("generates a non-empty resume containing required sections", () => {
    const data = seedDashboardData();
    const projectId = data.projects[0].id;
    const output = generateProjectResume(data, projectId);

    expect(output).toContain("# PROJECT_RESUME.md");
    expect(output).toContain("## What this project is");
    expect(output).toContain("## Current status");
    expect(output).toContain("## Future ideas");
  });

  it("generates AI context with repository-inspection warning", () => {
    const data = seedDashboardData();
    const projectId = data.projects[0].id;
    const output = generateAiContext(data, projectId);

    expect(output).toContain("# AI_CONTEXT.md");
    expect(output).toContain("## Project");
    expect(output).toContain("> Warning: the AI agent must inspect the repository directly");
  });

  it("includes automatic Codex session continuity in resume and AI context", () => {
    const data = seedDashboardData();
    const projectId = data.projects[0].id;
    data.developmentSessions.unshift({
      id: "dddddddd-1111-4111-8111-111111111112",
      projectId,
      taskId: null,
      promptRecordId: null,
      startedAt: "2026-08-11T12:00:00.000Z",
      endedAt: "2026-08-11T13:00:00.000Z",
      objective: "Implement automatic Codex ingestion",
      summary: "Created an authenticated, idempotent session handoff.",
      source: "codex",
      externalSessionId: "codex-session-42",
      branch: "feature/codex-ingestion",
      completedItems: ["Created the ingestion endpoint"],
      unfinishedItems: ["Configure the helper in other repositories"],
      currentBlocker: "Waiting for per-repository setup",
      tasksWorkedOn: [],
      tasksCompleted: [],
      ideasAdded: [],
      problemsDiscovered: ["Retries can have ambiguous acknowledgements"],
      decisionsMade: ["Use a transactionally protected receipt"],
      promptsUsed: [],
      filesModified: ["functions/src/codex/ingest.ts"],
      commits: ["abc1234"],
      nextStartingPoint: "Add the reusable instruction to another project",
      status: "completed",
      notes: "The complete semantic handoff is stored on this session.",
      activeStartedAt: null,
      activeDurationMs: 60 * 60 * 1000,
      resumeFromNote: "",
      blocker: "Waiting for per-repository setup",
      nextStep: "Add the reusable instruction to another project",
      testResults: [],
      buildResults: [],
      deploymentStatus: "Not deployed",
    });

    const resume = generateProjectResume(data, projectId);
    const context = generateAiContext(data, projectId);

    for (const output of [resume, context]) {
      expect(output).toContain("Implement automatic Codex ingestion");
      expect(output).toContain("Created the ingestion endpoint");
      expect(output).toContain("Configure the helper in other repositories");
      expect(output).toContain("Retries can have ambiguous acknowledgements");
      expect(output).toContain("Use a transactionally protected receipt");
      expect(output).toContain("functions/src/codex/ingest.ts");
      expect(output).toContain("abc1234");
      expect(output).toContain("Add the reusable instruction to another project");
      expect(output).toContain("feature/codex-ingestion");
    }
  });
});
