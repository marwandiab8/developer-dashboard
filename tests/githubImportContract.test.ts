import { beforeEach, describe, expect, it } from "vitest";
import { seedDashboardData } from "../src/lib/seed";
import type { DashboardData, ExternalProjectSourceGithub } from "../src/lib/models";
import {
  applyGithubRepositoryImport,
  applyGithubRepositoryImportBatch,
  githubImportProtectedPolicy,
  inferExternalActivityStatus,
  type GithubRepositoryImport,
} from "../src/lib/repositories/githubImportContract";

const FIXED_NOW = "2026-08-05T00:00:00.000Z";

const makeGithubImport = (
  overrides: Partial<GithubRepositoryImport> = {},
): GithubRepositoryImport => ({
  sourceType: "github",
  externalRepositoryId: "1000001",
  ownerLogin: "acme-org",
  repositoryName: "dashboard-core",
  repositoryFullName: "acme-org/dashboard-core",
  repositoryUrl: "https://github.com/acme-org/dashboard-core",
  defaultBranch: "main",
  visibility: "public",
  isArchived: false,
  isFork: false,
  description: "Dashboard shell for development workflow.",
  primaryLanguage: "TypeScript",
  topics: ["typescript", "nextjs"],
  createdDate: "2026-06-01T00:00:00.000Z",
  updatedDate: "2026-07-01T00:00:00.000Z",
  pushedDate: "2026-08-01T00:00:00.000Z",
  latestKnownPersonalCommitDate: "2026-08-01T00:00:00.000Z",
  latestKnownPersonalCommitMessage: "feat: initial dashboard shell",
  lastWorkedAt: "2026-08-01T00:00:00.000Z",
  lastWorkedAtSource: "personal_commit",
  openIssueCount: 5,
  openPullRequestCount: 1,
  synchronizationTimestamp: FIXED_NOW,
  synchronizationStatus: "success",
  sourceError: null,
  ...overrides,
});

const makeManualDashboardWithProject = (): {
  data: DashboardData;
  projectId: string;
  externalId: string;
} => {
  const data = seedDashboardData();
  const projectId = data.projects[0].id;
  const externalId = "1000001";

  const source: ExternalProjectSourceGithub = {
    sourceType: "github",
    externalRepositoryId: externalId,
    ownerLogin: "acme-org",
    repositoryName: "dashboard-core",
    repositoryFullName: "acme-org/dashboard-core",
    repositoryUrl: "https://github.com/acme-org/dashboard-core",
    defaultBranch: "main",
    visibility: "public",
    isArchived: false,
    isFork: false,
    description: "Dashboard shell for development workflow.",
    primaryLanguage: "TypeScript",
    topics: ["typescript", "nextjs"],
    createdDate: "2026-06-01T00:00:00.000Z",
    updatedDate: "2026-07-01T00:00:00.000Z",
    pushedDate: "2026-08-01T00:00:00.000Z",
    latestKnownPersonalCommitDate: "2026-08-01T00:00:00.000Z",
    latestKnownPersonalCommitMessage: "feat: initial dashboard shell",
    lastWorkedAt: "2026-08-01T00:00:00.000Z",
    lastWorkedAtSource: "personal_commit",
    openIssueCount: 5,
    openPullRequestCount: 1,
    synchronizationTimestamp: "2026-08-02T00:00:00.000Z",
    synchronizationStatus: "success",
    sourceError: null,
    firebaseAssociation: {
      status: "detected",
      evidence: "seed source detection",
      detectedAt: "2026-06-01T00:00:00.000Z",
    },
  };

  data.projects = [
    {
      ...data.projects[0],
      title: "Manual Dashboard Title",
      purpose: "Manual dashboard description",
      manualStatus: "planning",
      currentBranch: "manual/release-candidate",
      currentObjective: "Preserve manual objective.",
      currentBlocker: "Manual blocker note.",
      nextRecommendedTask: "Manual next task.",
      lastWorkedAt: "2026-07-30T12:00:00.000Z",
      externalSources: {
        github: source,
      },
      externalActivityStatus: "quiet",
      externalActivityUpdatedAt: "2026-08-02T00:00:00.000Z",
    },
    ...data.projects.slice(1),
  ];

  data.ideas = data.ideas.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
          text: "Existing manual idea",
        }
      : item,
  );
  data.tasks = data.tasks.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
        }
      : item,
  );
  data.notes = data.notes.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
          title: "Manual note",
        }
      : item,
  );
  data.importantLinks = data.importantLinks.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
          title: "Manual link",
        }
      : item,
  );
  data.developmentSessions = data.developmentSessions.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
        }
      : item,
  );
  data.architectureDecisions = data.architectureDecisions.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
          title: "Manual decision",
        }
      : item,
  );
  data.codexPrompts = data.codexPrompts.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
          title: "Manual prompt",
        }
      : item,
  );
  data.brainDumps = data.brainDumps.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
          text: "Manual draft",
        }
      : item,
  );
  data.activities = data.activities.map((item, index) =>
    index === 0
      ? {
          ...item,
          projectId,
        }
      : item,
  );
  data.scratchpads = [
    ...data.scratchpads,
    {
      projectId,
      markdown: "# Scratchpad",
      updatedAt: "2026-07-30T12:00:00.000Z",
    },
  ];

  return { data, projectId, externalId };
};

describe("github import contract", () => {
  beforeEach(() => {
    const seenPolicy = [
      ...githubImportProtectedPolicy.manualProjectFields,
      ...githubImportProtectedPolicy.manualEntityCollections,
      ...githubImportProtectedPolicy.localProgressFields,
    ];
    expect(Array.isArray(seenPolicy)).toBe(true);
  });

  it("creates a new project shell from GitHub metadata", () => {
    const source = seedDashboardData();
    const { data, report } = applyGithubRepositoryImport(source, makeGithubImport(), {
      now: "2026-08-05T00:00:00.000Z",
      generateProjectId: () => "90000000-0000-4000-8000-000000000001",
    });

    expect(report.outcome).toBe("created");
    expect(report.changed).toBe(true);
    expect(report.projectId).toBeTruthy();
    expect(data.projects).toHaveLength(source.projects.length + 1);

    const created = data.projects.find((item) => item.id === report.projectId);
    expect(created?.title).toBe("dashboard-core");
    expect(created?.externalSources?.github?.externalRepositoryId).toBe("1000001");
    expect(created?.status).toBe("active");
    expect(created?.manualStatus).toBe("active");
    expect(created?.externalActivityStatus).toBe("active_recently");
    expect(created?.externalSources?.github?.firebaseAssociation.status).toBe("not_detected");
  });

  it("reimports identical repository metadata as unchanged while advancing sync bookkeeping", () => {
    const source = seedDashboardData();
    const payload = makeGithubImport();
    const options = {
      now: FIXED_NOW,
      generateProjectId: () => "22222222-2222-4222-8222-222222222222",
    };

    const created = applyGithubRepositoryImport(source, payload, options);
    const second = applyGithubRepositoryImportBatch(
      created.data,
      [makeGithubImport({ synchronizationTimestamp: "2026-08-06T00:00:00.000Z" })],
      { ...options, now: "2026-08-06T00:00:00.000Z" },
    );

    expect(created.report.outcome).toBe("created");
    expect(second.reports[0]?.outcome).toBe("unchanged");
    expect(second.reports[0]?.changed).toBe(false);
    expect(second.data.projects).toHaveLength(created.data.projects.length);
    expect(second.data.projects.at(-1)?.externalSources?.github?.synchronizationTimestamp).toBe(
      "2026-08-06T00:00:00.000Z",
    );
    expect(second.data.projects.at(-1)?.externalActivityUpdatedAt).toBe("2026-08-06T00:00:00.000Z");
  });

  it("reports an actual GitHub metadata change as updated", () => {
    const created = applyGithubRepositoryImport(
      seedDashboardData(),
      makeGithubImport({ externalRepositoryId: "1000009" }),
      {
        now: FIXED_NOW,
        generateProjectId: () => "90000000-0000-4000-8000-000000000009",
      },
    );
    const updated = applyGithubRepositoryImport(
      created.data,
      makeGithubImport({
        externalRepositoryId: "1000009",
        description: "A semantically changed GitHub description.",
        synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
      }),
      { now: "2026-08-06T00:00:00.000Z" },
    );

    expect(updated.report.outcome).toBe("updated");
    expect(updated.report.changed).toBe(true);
    expect(updated.data.projects.at(-1)?.externalSources?.github?.description).toBe(
      "A semantically changed GitHub description.",
    );
  });

  it("updates GitHub identity on rename without duplicate project creation", () => {
    const source = seedDashboardData();
    const initial = applyGithubRepositoryImport(
      source,
      makeGithubImport({ externalRepositoryId: "1000002", repositoryName: "dashboard-core", repositoryFullName: "acme-org/dashboard-core" }),
      { now: FIXED_NOW, generateProjectId: () => "90000000-0000-4000-8000-000000000002" },
    );

    const renamed = applyGithubRepositoryImport(
      initial.data,
      makeGithubImport({
        externalRepositoryId: "1000002",
        repositoryName: "dashboard-cli",
        repositoryFullName: "acme-org/dashboard-cli",
        repositoryUrl: "https://github.com/acme-org/dashboard-cli",
      }),
      { now: "2026-08-06T00:00:00.000Z" },
    );

    const project = renamed.data.projects.find((item) => item.id === initial.report.projectId);
    const sourceData = project?.externalSources?.github;

    expect(project?.title).toBe("dashboard-core");
    expect(sourceData?.repositoryName).toBe("dashboard-cli");
    expect(sourceData?.repositoryFullName).toBe("acme-org/dashboard-cli");
    expect(renamed.report.outcome).toBe("updated");
    expect(renamed.data.projects.filter((item) => item.externalSources?.github?.externalRepositoryId === "1000002")).toHaveLength(1);
  });

  it("preserves manual project fields during sync", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const before = structuredClone(data);
    const renamedImport = makeGithubImport({
      externalRepositoryId: externalId,
      repositoryName: "renamed-shell",
      repositoryFullName: "acme-org/renamed-shell",
      description: "This should not replace manual fields.",
      latestKnownPersonalCommitDate: "2026-08-05T00:00:00.000Z",
      synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
      openIssueCount: 2,
      openPullRequestCount: 4,
      sourceError: "temp",
      defaultBranch: "github-default-changed",
    });
    const updated = applyGithubRepositoryImport(data, renamedImport, { now: "2026-08-06T00:00:00.000Z" });

    const current = updated.data.projects.find((item) => item.id === projectId);
    expect(current).toBeDefined();

    expect(current?.title).toBe(before.projects[0].title);
    expect(current?.purpose).toBe(before.projects[0].purpose);
    expect(current?.manualStatus).toBe(before.projects[0].manualStatus);
    expect(current?.currentBranch).toBe(before.projects[0].currentBranch);
    expect(current?.currentObjective).toBe(before.projects[0].currentObjective);
    expect(current?.nextRecommendedTask).toBe(before.projects[0].nextRecommendedTask);
    expect(current?.currentBlocker).toBe(before.projects[0].currentBlocker);
    expect(current?.lastWorkedAt).toBe(before.projects[0].lastWorkedAt);
  });

  it("never overwrites currentBranch on an existing manually managed project", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const updated = applyGithubRepositoryImport(
      data,
      makeGithubImport({
        externalRepositoryId: externalId,
        defaultBranch: "github-default-changed",
        synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
      }),
      { now: "2026-08-06T00:00:00.000Z" },
    );

    const current = updated.data.projects.find((item) => item.id === projectId);
    expect(current?.currentBranch).toBe("manual/release-candidate");
    expect(current?.externalSources?.github?.defaultBranch).toBe("github-default-changed");
  });

  it("preserves ideas, tasks, notes, sessions, and decisions while updating GitHub metadata", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const ideaIds = data.ideas.map((item) => item.id);
    const taskIds = data.tasks.map((item) => item.id);
    const noteIds = data.notes.map((item) => item.id);
    const sessionIds = data.developmentSessions.map((item) => item.id);
    const decisionIds = data.architectureDecisions.map((item) => item.id);
    const linkIds = data.importantLinks.map((item) => item.id);
    const updated = applyGithubRepositoryImport(data, makeGithubImport({
      externalRepositoryId: externalId,
      description: "Updated description from sync",
      latestKnownPersonalCommitDate: "2026-08-05T00:00:00.000Z",
      synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
    }));

    expect(updated.data.ideas.map((item) => item.id).sort()).toEqual(ideaIds.sort());
    expect(updated.data.tasks.map((item) => item.id).sort()).toEqual(taskIds.sort());
    expect(updated.data.notes.map((item) => item.id).sort()).toEqual(noteIds.sort());
    expect(updated.data.developmentSessions.map((item) => item.id).sort()).toEqual(sessionIds.sort());
    expect(updated.data.architectureDecisions.map((item) => item.id).sort()).toEqual(decisionIds.sort());
    expect(updated.data.importantLinks.map((item) => item.id).sort()).toEqual(linkIds.sort());
    expect(updated.report.outcome).toBe("updated");

    const project = updated.data.projects.find((item) => item.id === projectId);
    expect(project?.externalSources?.github?.description).toBe("Updated description from sync");
    expect(project?.externalSources?.github?.externalRepositoryId).toBe(externalId);
  });

    it("updates external activity status while keeping manual status untouched", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const updated = applyGithubRepositoryImport(
      data,
      makeGithubImport({
        externalRepositoryId: externalId,
        latestKnownPersonalCommitDate: "2026-08-05T00:00:00.000Z",
        synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
      }),
      { now: "2026-08-06T00:00:00.000Z" },
    );

    const project = updated.data.projects.find((item) => item.id === projectId);
    expect(project?.manualStatus).toBe("planning");
      expect(project?.externalActivityStatus).toBe("active_recently");
    });

    it("accepts internal repositories and preserves labelled repository activity fallbacks", () => {
      const result = applyGithubRepositoryImportBatch(
        seedDashboardData(),
        [
          makeGithubImport({
            externalRepositoryId: "3000001",
            repositoryName: "internal-dashboard",
            repositoryFullName: "acme-org/internal-dashboard",
            repositoryUrl: "https://github.com/acme-org/internal-dashboard",
            visibility: "internal",
            latestKnownPersonalCommitDate: null,
            latestKnownPersonalCommitMessage: null,
            lastWorkedAt: "2026-08-04T00:00:00.000Z",
            lastWorkedAtSource: "repository_pushed",
          }),
          makeGithubImport({
            externalRepositoryId: "3000002",
            repositoryName: "metadata-only",
            repositoryFullName: "acme-org/metadata-only",
            repositoryUrl: "https://github.com/acme-org/metadata-only",
            latestKnownPersonalCommitDate: null,
            latestKnownPersonalCommitMessage: null,
            lastWorkedAt: "2026-06-01T00:00:00.000Z",
            lastWorkedAtSource: "repository_updated",
          }),
        ],
        { now: FIXED_NOW },
      );

      const pushedFallback = result.data.projects.find(
        (project) => project.externalSources?.github?.externalRepositoryId === "3000001",
      );
      const updatedFallback = result.data.projects.find(
        (project) => project.externalSources?.github?.externalRepositoryId === "3000002",
      );

      expect(pushedFallback?.externalSources?.github?.visibility).toBe("internal");
      expect(pushedFallback?.externalSources?.github?.lastWorkedAt).toBe("2026-08-04T00:00:00.000Z");
      expect(pushedFallback?.externalSources?.github?.lastWorkedAtSource).toBe("repository_pushed");
      expect(pushedFallback?.externalActivityStatus).toBe("active_recently");
      expect(pushedFallback?.lastWorkedAt).toBeUndefined();
      expect(updatedFallback?.externalSources?.github?.lastWorkedAtSource).toBe("repository_updated");
      expect(updatedFallback?.externalActivityStatus).toBe("stale");
      expect(updatedFallback?.lastWorkedAt).toBeUndefined();
    });

    it("sets archived metadata without changing manual status", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const updated = applyGithubRepositoryImport(data, makeGithubImport({
      externalRepositoryId: externalId,
      isArchived: true,
      synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
    }));
    const project = updated.data.projects.find((item) => item.id === projectId);
    expect(project?.externalSources?.github?.isArchived).toBe(true);
    expect(project?.manualStatus).toBe("planning");
  });

  it("marks missing repositories unavailable without deleting project", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const updated = applyGithubRepositoryImport(data, makeGithubImport({
      externalRepositoryId: externalId,
      synchronizationStatus: "unavailable",
      synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
      sourceError: "Repository unavailable",
    }));

    expect(updated.report.outcome).toBe("unavailable");
    expect(updated.data.projects).toHaveLength(data.projects.length);
    const project = updated.data.projects.find((item) => item.id === projectId);
    expect(project?.externalSources?.github?.synchronizationStatus).toBe("unavailable");
    expect(project?.id).toBe(projectId);
  });

  it("preserves previous GitHub metadata on failed sync", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const failed = applyGithubRepositoryImport(data, makeGithubImport({
      externalRepositoryId: externalId,
      synchronizationStatus: "failed",
      synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
      sourceError: "rate limit",
      description: "Failed metadata should not overwrite",
      repositoryName: "wrong-name-should-not-overwrite",
      openIssueCount: 99,
    }));

    const project = failed.data.projects.find((item) => item.id === projectId);
    expect(project?.externalSources?.github?.description).toBe("Dashboard shell for development workflow.");
    expect(project?.externalSources?.github?.synchronizationStatus).toBe("failed");
    expect(project?.externalSources?.github?.sourceError).toBe("rate limit");
    expect(project?.externalActivityStatus).toBe("quiet");
    expect(failed.report.outcome).toBe("failed");
  });

  it("uses explicit not-detected, unknown, and detected Firebase association states", () => {
    const noEvidence = applyGithubRepositoryImport(
      { ...seedDashboardData(), projects: [] },
      makeGithubImport({ externalRepositoryId: "6000001" }),
      {
        now: FIXED_NOW,
        generateProjectId: () => "60000000-0000-4000-8000-000000000001",
      },
    );
    const detected = applyGithubRepositoryImport(
      { ...seedDashboardData(), projects: [] },
      makeGithubImport({
        externalRepositoryId: "6000002",
        associationStatus: "detected",
        associationEvidence: "firebase.json",
      }),
      {
        now: FIXED_NOW,
        generateProjectId: () => "60000000-0000-4000-8000-000000000002",
      },
    );
    const partial = applyGithubRepositoryImport(
      { ...seedDashboardData(), projects: [] },
      makeGithubImport({
        externalRepositoryId: "6000004",
        associationStatus: "unknown",
        sourceError: "firebase_config_partial",
      }),
      {
        now: FIXED_NOW,
        generateProjectId: () => "60000000-0000-4000-8000-000000000004",
      },
    );

    expect(noEvidence.data.projects[0]?.externalSources?.github?.firebaseAssociation).toMatchObject({
      status: "not_detected",
      evidence: "",
    });
    expect(detected.data.projects[0]?.externalSources?.github?.firebaseAssociation).toMatchObject({
      status: "detected",
      evidence: "firebase.json",
    });
    expect(partial.data.projects[0]?.externalSources?.github).toMatchObject({
      sourceError: "firebase_config_partial",
      firebaseAssociation: {
        status: "unknown",
        evidence: "",
      },
    });
  });

  it("preserves prior detected Firebase evidence when a later sync has no evidence", () => {
    const projectId = "60000000-0000-4000-8000-000000000003";
    const detected = applyGithubRepositoryImport(
      { ...seedDashboardData(), projects: [] },
      makeGithubImport({
        externalRepositoryId: "6000003",
        associationStatus: "detected",
        associationEvidence: "firebase.json",
      }),
      { now: FIXED_NOW, generateProjectId: () => projectId },
    );
    const withoutEvidence = applyGithubRepositoryImport(
      detected.data,
      makeGithubImport({
        externalRepositoryId: "6000003",
        synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
      }),
      { now: "2026-08-06T00:00:00.000Z" },
    );
    const partial = applyGithubRepositoryImport(
      withoutEvidence.data,
      makeGithubImport({
        externalRepositoryId: "6000003",
        associationStatus: "unknown",
        sourceError: "firebase_config_partial",
        synchronizationTimestamp: "2026-08-07T00:00:00.000Z",
      }),
      { now: "2026-08-07T00:00:00.000Z" },
    );

    expect(withoutEvidence.report.outcome).toBe("unchanged");
    expect(withoutEvidence.report.changed).toBe(false);
    expect(
      partial.data.projects.find((project) => project.id === projectId)
        ?.externalSources?.github?.firebaseAssociation,
    ).toMatchObject({ status: "detected", evidence: "firebase.json" });
  });

  it("preserves a manually confirmed Firebase association against weaker or absent automated evidence", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();

    const confirmed = applyGithubRepositoryImport(data, makeGithubImport({
      externalRepositoryId: externalId,
      associationStatus: "confirmed",
      associationEvidence: "Repo marker in README",
    }));
    const confirmedProject = confirmed.data.projects.find((item) => item.id === projectId);
    expect(confirmedProject?.externalSources?.github?.firebaseAssociation.status).toBe("confirmed");
    expect(confirmedProject?.externalSources?.github?.firebaseAssociation.evidence).toBe("Repo marker in README");
    expect(confirmedProject?.externalSources?.github?.firebaseAssociation.confirmedAt).toBeTruthy();

    const confirmedAt = confirmedProject?.externalSources?.github?.firebaseAssociation.confirmedAt;
    const weaker = applyGithubRepositoryImport(confirmed.data, makeGithubImport({
      externalRepositoryId: externalId,
      associationStatus: "detected",
      associationEvidence: "package.json dependency only",
      synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
    }), { now: "2026-08-06T00:00:00.000Z" });
    const withoutEvidence = applyGithubRepositoryImport(weaker.data, makeGithubImport({
      externalRepositoryId: externalId,
      synchronizationTimestamp: "2026-08-07T00:00:00.000Z",
    }), { now: "2026-08-07T00:00:00.000Z" });
    const partial = applyGithubRepositoryImport(withoutEvidence.data, makeGithubImport({
      externalRepositoryId: externalId,
      associationStatus: "unknown",
      sourceError: "firebase_config_partial",
      synchronizationTimestamp: "2026-08-08T00:00:00.000Z",
    }), { now: "2026-08-08T00:00:00.000Z" });
    const preserved = partial.data.projects.find((item) => item.id === projectId);

    expect(weaker.data.projects.find((item) => item.id === projectId)?.externalSources?.github?.firebaseAssociation.status).toBe("confirmed");
    expect(preserved?.externalSources?.github?.firebaseAssociation).toMatchObject({
      status: "confirmed",
      evidence: "Repo marker in README",
      confirmedAt,
    });
  });

  it("supports an explicit manual removal after a confirmed Firebase association", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const confirmed = applyGithubRepositoryImport(data, makeGithubImport({
      externalRepositoryId: externalId,
      associationStatus: "confirmed",
      associationEvidence: "Repo marker in README",
    }));
    const removed = applyGithubRepositoryImport(confirmed.data, makeGithubImport({
      externalRepositoryId: externalId,
      associationStatus: "removed",
      associationEvidence: "No evidence",
    }));
    const removedProject = removed.data.projects.find((item) => item.id === projectId);
    expect(removedProject?.externalSources?.github?.firebaseAssociation.status).toBe("removed");
    expect(removedProject?.externalSources?.github?.firebaseAssociation.evidence).toBe("No evidence");
  });

  it("creates a valid project purpose for a repository without a GitHub description", () => {
    const { data } = makeManualDashboardWithProject();
    const externalRepositoryId = "987654321";
    const imported = applyGithubRepositoryImport(
      { ...data, projects: [] },
      makeGithubImport({
        externalRepositoryId,
        repositoryName: "timelefttolive",
        repositoryFullName: "dashboard-owner/timelefttolive",
        description: "",
      }),
      {
        now: "2026-08-06T12:00:00.000Z",
        generateProjectId: () => "90000000-0000-4000-8000-000000000091",
      },
    );

    const project = imported.data.projects[0];
    expect(project.purpose).toBe("GitHub repository dashboard-owner/timelefttolive.");
    expect(project.externalSources?.github?.description).toBe("");

    const manuallyEdited = {
      ...imported.data,
      projects: imported.data.projects.map((item) => ({ ...item, purpose: "Manual dashboard purpose" })),
    };
    const refreshed = applyGithubRepositoryImport(
      manuallyEdited,
      makeGithubImport({
        externalRepositoryId,
        repositoryName: "timelefttolive",
        repositoryFullName: "dashboard-owner/timelefttolive",
        description: "GitHub description added later",
      }),
      { now: "2026-08-07T12:00:00.000Z" },
    );

    expect(refreshed.data.projects[0].purpose).toBe("Manual dashboard purpose");
    expect(refreshed.data.projects[0].externalSources?.github?.description).toBe("GitHub description added later");
  });

  it("persists unknown issue and pull-request counts without changing protected fields and later refreshes them", () => {
    const { data, projectId, externalId } = makeManualDashboardWithProject();
    const before = data.projects.find((project) => project.id === projectId);
    const unknown = applyGithubRepositoryImport(data, makeGithubImport({
      externalRepositoryId: externalId,
      openIssueCount: null,
      openPullRequestCount: null,
      sourceError: "pull_request_count_unavailable",
      synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
    }));
    const withUnknownCount = unknown.data.projects.find((project) => project.id === projectId);

    expect(withUnknownCount?.externalSources?.github?.openIssueCount).toBeNull();
    expect(withUnknownCount?.externalSources?.github?.openPullRequestCount).toBeNull();
    expect(withUnknownCount?.externalSources?.github?.sourceError).toBe("pull_request_count_unavailable");
    expect({
      title: withUnknownCount?.title,
      purpose: withUnknownCount?.purpose,
      status: withUnknownCount?.status,
      manualStatus: withUnknownCount?.manualStatus,
      currentObjective: withUnknownCount?.currentObjective,
      currentBlocker: withUnknownCount?.currentBlocker,
      nextRecommendedTask: withUnknownCount?.nextRecommendedTask,
      lastWorkedAt: withUnknownCount?.lastWorkedAt,
    }).toEqual({
      title: before?.title,
      purpose: before?.purpose,
      status: before?.status,
      manualStatus: before?.manualStatus,
      currentObjective: before?.currentObjective,
      currentBlocker: before?.currentBlocker,
      nextRecommendedTask: before?.nextRecommendedTask,
      lastWorkedAt: before?.lastWorkedAt,
    });

    const refreshed = applyGithubRepositoryImport(unknown.data, makeGithubImport({
      externalRepositoryId: externalId,
      openIssueCount: 2,
      openPullRequestCount: 4,
      sourceError: null,
      synchronizationTimestamp: "2026-08-07T00:00:00.000Z",
    }));
    const withKnownCount = refreshed.data.projects.find((project) => project.id === projectId);
    expect(withKnownCount?.externalSources?.github?.openIssueCount).toBe(2);
    expect(withKnownCount?.externalSources?.github?.openPullRequestCount).toBe(4);
    expect(withKnownCount?.externalSources?.github?.sourceError).toBeNull();
    expect(withKnownCount?.title).toBe(before?.title);
    expect(withKnownCount?.currentObjective).toBe(before?.currentObjective);
  });

  it("rejects invalid external repository import payloads", () => {
    expect(() =>
      applyGithubRepositoryImport(
        seedDashboardData(),
        makeGithubImport({ externalRepositoryId: "not-a-number", openIssueCount: -1 }),
      ),
    ).toThrow();
  });

  it("ensures stable external id duplicate prevention in batch imports", () => {
    const source = seedDashboardData();
    const batch = [
      makeGithubImport({ externalRepositoryId: "4000001", repositoryName: "dashboard", repositoryFullName: "acme-org/dashboard" }),
      makeGithubImport({
        externalRepositoryId: "4000001",
        repositoryName: "dashboard-renamed",
        repositoryFullName: "acme-org/dashboard-renamed",
        synchronizationTimestamp: "2026-08-06T00:00:00.000Z",
        latestKnownPersonalCommitDate: "2026-08-05T00:00:00.000Z",
      }),
    ];

    const result = applyGithubRepositoryImportBatch(source, batch, {
      now: FIXED_NOW,
      generateProjectId: () => "99999999-9999-4999-8999-999999999999",
    });
    const matches = result.data.projects.filter((project) => project.externalSources?.github?.externalRepositoryId === "4000001");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe("dashboard");
    const project = matches[0];
    expect(project?.externalSources?.github?.repositoryName).toBe("dashboard-renamed");
    expect(result.reports[1]?.outcome).toBe("updated");
    expect(result.reports[0]?.outcome).toBe("created");
    expect(result.reports.some((report) => report.changed)).toBe(true);
  });

  it("classifies external activity state from commit age", () => {
    const recent = inferExternalActivityStatus(
        makeGithubImport({
          latestKnownPersonalCommitDate: "2026-08-04T00:00:00.000Z",
          lastWorkedAt: "2026-08-04T00:00:00.000Z",
          lastWorkedAtSource: "personal_commit",
        }),
      "2026-08-05T00:00:00.000Z",
    );
    const stale = inferExternalActivityStatus(
        makeGithubImport({
          latestKnownPersonalCommitDate: "2026-06-01T00:00:00.000Z",
          lastWorkedAt: "2026-06-01T00:00:00.000Z",
          lastWorkedAtSource: "personal_commit",
        }),
      "2026-08-05T00:00:00.000Z",
    );
    expect(recent).toBe("active_recently");
    expect(stale).toBe("stale");
  });
});
