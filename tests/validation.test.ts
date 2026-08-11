import { describe, expect, it } from "vitest";
import {
  activityEventSchema,
  dashboardDataSchema,
  externalProjectSourceGithubSchema,
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
