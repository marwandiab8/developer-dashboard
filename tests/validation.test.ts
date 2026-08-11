import { describe, expect, it } from "vitest";
import {
  activityEventSchema,
  codexPromptSchema,
  dashboardDataSchema,
  developmentSessionSchema,
  externalProjectSourceGithubSchema,
  ideaSchema,
  quickCaptureSchema,
} from "../src/lib/validation";
import { seedDashboardData } from "../src/lib/seed";

describe("externalProjectSourceGithubSchema", () => {
  it("accepts internal visibility and required GitHub activity attribution", () => {
    const parsed = externalProjectSourceGithubSchema.parse({
      sourceType: "github",
      externalRepositoryId: "12345",
      ownerLogin: "dashboard-owner",
      repositoryName: "internal-tools",
      repositoryFullName: "dashboard-owner/internal-tools",
      repositoryUrl: "https://github.com/dashboard-owner/internal-tools",
      defaultBranch: "main",
      visibility: "internal",
      isArchived: false,
      isFork: false,
      description: "Internal tools",
      primaryLanguage: "TypeScript",
      topics: ["firebase"],
      createdDate: "2026-01-01T00:00:00.000Z",
      updatedDate: "2026-08-01T00:00:00.000Z",
      pushedDate: "2026-07-31T00:00:00.000Z",
      latestKnownPersonalCommitDate: null,
      latestKnownPersonalCommitMessage: null,
      lastWorkedAt: "2026-08-01T00:00:00.000Z",
      lastWorkedAtSource: "repository_updated",
      openIssueCount: null,
      openPullRequestCount: null,
      synchronizationTimestamp: "2026-08-05T00:00:00.000Z",
      synchronizationStatus: "success",
      sourceError: null,
      firebaseAssociation: {
        status: "detected",
        evidence: "firebase.json",
        detectedAt: "2026-08-05T00:00:00.000Z",
      },
    });

    expect(parsed.visibility).toBe("internal");
    expect(parsed.lastWorkedAtSource).toBe("repository_updated");

    const withoutEvidence = externalProjectSourceGithubSchema.parse({
      ...parsed,
      firebaseAssociation: {
        status: "not_detected",
        evidence: "",
        detectedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    expect(withoutEvidence.firebaseAssociation.status).toBe("not_detected");

    const partial = externalProjectSourceGithubSchema.parse({
      ...parsed,
      sourceError: "firebase_config_partial",
      firebaseAssociation: {
        status: "unknown",
        evidence: "",
        detectedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    expect(partial.firebaseAssociation.status).toBe("unknown");
  });
});

describe("activityEventSchema", () => {
  const githubActivity = {
    id: "89c84c74-f28d-5e09-8dd1-c6e8f5ee1fd2",
    projectId: "33333333-3333-4333-8333-333333333333",
    type: "github_repository_updated" as const,
    summary: "Updated GitHub repository metadata",
    entityType: "project",
    entityId: "33333333-3333-4333-8333-333333333333",
    metadata: "github:12345",
    createdAt: "2026-08-07T12:00:00.000Z",
  };

  it("accepts a deterministic UUID-shaped GitHub activity", () => {
    expect(activityEventSchema.parse(githubActivity)).toEqual(githubActivity);
  });

  it("continues to read a legacy deterministic GitHub activity ID", () => {
    const legacy = {
      ...githubActivity,
      id: "github-0123456789abcdef0123456789abcdef",
    };

    expect(activityEventSchema.parse(legacy)).toEqual(legacy);
  });
});

describe("quickCaptureSchema", () => {
  it("requires non-empty project id and text", () => {
    expect(() => quickCaptureSchema.parse({ projectId: "", text: "" })).toThrow();
  });

  it("defaults classification via parser consumer", () => {
    const value = quickCaptureSchema.parse({
      projectId: "11111111-1111-4111-8111-111111111111",
      text: "test",
      classification: "idea",
    });
    expect(value.text).toBe("test");
    expect(value.classification).toBe("idea");
  });

  it("validates the seeded dashboard payload", () => {
    const seeded = seedDashboardData();
    expect(() => dashboardDataSchema.parse(seeded)).not.toThrow();
  });
});

describe("Codex-ingested domain metadata", () => {
  const projectId = "33333333-3333-4333-8333-333333333333";
  const sessionId = "aaaaaaaa-1111-4111-8111-111111111112";
  const externalSessionId = "codex:session/2026-08-11_01";

  it("accepts backward-compatible source metadata and semantic session fields", () => {
    const session = developmentSessionSchema.parse({
      id: sessionId,
      projectId,
      startedAt: "2026-08-11T12:00:00.000Z",
      endedAt: "2026-08-11T13:00:00.000Z",
      objective: "Implement automatic ingestion",
      summary: "The endpoint and helper were completed.",
      source: "codex",
      externalSessionId,
      branch: "feature/codex-ingestion",
      completedItems: ["Added an authenticated endpoint"],
      unfinishedItems: ["Configure the helper elsewhere"],
      currentBlocker: "None",
      tasksWorkedOn: [],
      tasksCompleted: [],
      ideasAdded: [],
      problemsDiscovered: ["Retries need a receipt"],
      decisionsMade: ["Use deterministic IDs"],
      promptsUsed: [],
      filesModified: ["functions/src/index.ts"],
      commits: ["abc123"],
      nextStartingPoint: "Configure another project",
      status: "completed",
      notes: "Preserve the complete session context.",
    });

    const prompt = codexPromptSchema.parse({
      id: "bbbbbbbb-1111-4111-8111-111111111112",
      projectId,
      title: "Automatic ingestion",
      purpose: session.objective,
      prompt: "  Preserve this complete prompt.\n",
      resultSummary: session.summary,
      status: "used",
      relatedTaskId: null,
      relatedSessionId: session.id,
      source: "codex",
      externalSessionId,
      createdAt: session.startedAt,
      updatedAt: session.endedAt,
      lastUsedAt: session.endedAt,
    });

    const idea = ideaSchema.parse({
      id: "cccccccc-1111-4111-8111-111111111112",
      projectId,
      text: "Reuse the helper from other repositories",
      description: "Keep credentials outside Git.",
      status: "inbox",
      priority: "medium",
      source: "Codex",
      externalSessionId,
      tags: [],
      linkedTaskId: null,
      createdAt: session.endedAt,
      updatedAt: session.endedAt,
    });

    expect(session.completedItems).toEqual(["Added an authenticated endpoint"]);
    expect(prompt.prompt).toBe("  Preserve this complete prompt.\n");
    expect(prompt.relatedSessionId).toBe(session.id);
    expect(idea.source).toBe("Codex");
  });

  it("rejects unsafe external session IDs and unbounded semantic arrays", () => {
    const seeded = seedDashboardData().developmentSessions[0];
    expect(() => developmentSessionSchema.parse({
      ...seeded,
      source: "codex",
      externalSessionId: "contains\na newline",
    })).toThrow("Invalid external session ID");
    expect(() => developmentSessionSchema.parse({
      ...seeded,
      completedItems: Array.from({ length: 101 }, (_, index) => `item-${index}`),
    })).toThrow();
  });
});
