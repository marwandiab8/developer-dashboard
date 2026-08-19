import {
  ArchitectureDecision,
  DashboardData,
  Idea,
  IdeaPriority,
  IdeaSource,
  ProjectStatus,
  Task,
  BrainDump,
  CodexPrompt,
  DevelopmentSession,
  ActivityEvent,
  Note,
  ImportantLink,
} from "../models";
// Seed timestamps are content, not runtime state. Keeping them stable makes an
// untouched seed semantically identical across page loads and app releases.
const now = "2026-07-28T00:00:00.000Z";

export const seedDashboardData = (): DashboardData => {
  const projectIds = {
    gridline: "11111111-1111-4111-8111-111111111111",
    timeLeft: "22222222-2222-4222-8222-222222222222",
    developer: "33333333-3333-4333-8333-333333333333",
    darts: "44444444-4444-4444-8444-444444444444",
    workout: "55555555-5555-4555-8555-555555555555",
  };

  const projects: Array<{
    id: string;
    title: string;
    slug: string;
    purpose: string;
    status: ProjectStatus;
    currentBranch: string;
    currentObjective: string;
    currentBlocker: string;
    nextRecommendedTask: string;
    lastWorkedAt: string;
    createdAt: string;
    updatedAt: string;
  }> = [
    {
      id: projectIds.gridline,
      title: "GridlineAI",
      slug: "gridlineai",
      purpose: "Build AI assistance workflows around construction reporting and daily operations.",
      status: "active" as ProjectStatus,
      currentBranch: "main",
      currentObjective: "Finish CarPlay arrival logic and close the architecture thread.",
      currentBlocker: "Pending validation of arrival webhook dedupe approach.",
      nextRecommendedTask: "Validate CarPlay location matching idempotency across providers.",
      lastWorkedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: projectIds.timeLeft,
      title: "Time Left To Live",
      slug: "time-left-to-live",
      purpose: "Track and recover developer life events in a single canonical workflow.",
      status: "active" as ProjectStatus,
      currentBranch: "main",
      currentObjective: "Improve resume and continuation artifacts.",
      currentBlocker: "None.",
      nextRecommendedTask: "Standardize context handoff fields for new sources.",
      lastWorkedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: projectIds.developer,
      title: "Developer Dashboard",
      slug: "developer-dashboard",
      purpose: "Personal development brain for projects, ideas, prompts, and resumed work.",
      status: "active" as ProjectStatus,
      currentBranch: "main",
      currentObjective: "Finish local-first Phase 1A feature rollout.",
      currentBlocker: "None.",
      nextRecommendedTask: "Refine mobile touch targets and search ranking.",
      lastWorkedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: projectIds.darts,
      title: "Darts Tracker",
      slug: "darts-tracker",
      purpose: "Track darts sessions and score workflows quickly.",
      status: "on_hold" as ProjectStatus,
      currentBranch: "main",
      currentObjective: "Finalize UX for quick session entry.",
      currentBlocker: "No data model finalized yet.",
      nextRecommendedTask: "Define scoring summary schema.",
      lastWorkedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: projectIds.workout,
      title: "Workout App",
      slug: "workout-app",
      purpose: "Capture workouts, sets, and progress for a consistent fitness archive.",
      status: "on_hold" as ProjectStatus,
      currentBranch: "main",
      currentObjective: "Reconcile set schema with weekly summaries.",
      currentBlocker: "No active coding window selected.",
      nextRecommendedTask: "Create import and review for set history exports.",
      lastWorkedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const ideas: Idea[] = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId: projectIds.gridline,
      text: "CarPlay arrival location matching",
      description:
        "Receive CarPlay disconnect location webhooks, compare GPS coordinates against saved locations using a configurable radius, automatically label known locations, prompt for labels on unknown locations, skip calendar events without locations, and prevent duplicate arrival events using idempotency.",
      status: "converted" as const,
      priority: "high" as IdeaPriority,
      source: "desktop" as IdeaSource,
      tags: ["location", "carplay", "webhook", "idempotency"],
      linkedTaskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      convertedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: projectIds.gridline,
      text: "Surface CarPlay location confidence score in UI",
      description: "Show confidence for each geocode hit and manual correction flow.",
      status: "inbox" as const,
      priority: "medium" as IdeaPriority,
      source: "other" as IdeaSource,
      tags: ["ui", "map"],
      linkedTaskId: null,
      convertedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const tasks: Task[] = [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectId: projectIds.gridline,
      title: "Implement CarPlay location matching service",
      details: "Build idempotency-first service for arrival events and location label suggestions.",
      type: "feature",
      status: "ready",
      priority: "critical",
      blockedReason: "",
      sourceIdeaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      acceptanceCriteria:
        "Idempotency prevents duplicate arrival events for same session and webhook payload; location labels are persisted.",
      implementationNotes: "Implement after webhook parser normalization.",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      readyAt: now,
      lastWorkedAt: null,
      totalActiveDurationMs: 0,
      promptRecordIds: ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
      workSessionIds: ["aaaaaaaa-1111-4111-8111-111111111112"],
      recommendedNextStep: "Implement the matching service from the normalized webhook input.",
      githubBranch: "",
      githubCommit: "",
      githubPullRequest: "",
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccd",
      projectId: projectIds.gridline,
      title: "Skip calendar events with missing coordinates",
      details: "Ignore events without locations to avoid false positives.",
      type: "bug",
      status: "completed",
      priority: "medium",
      blockedReason: "",
      sourceIdeaId: null,
      acceptanceCriteria: "No sessions created when location missing.",
      implementationNotes: "Added guard near webhook mapping.",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: now,
      readyAt: now,
      lastWorkedAt: now,
      totalActiveDurationMs: 0,
      promptRecordIds: [],
      workSessionIds: ["aaaaaaaa-1111-4111-8111-111111111112"],
      recommendedNextStep: "",
      githubBranch: "",
      githubCommit: "seed-completed-session",
      githubPullRequest: "",
    },
  ];

  const brainDumps: BrainDump[] = [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      projectId: projectIds.gridline,
      text: "Need quick lookup for nearby saved locations before creating new location record.",
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
      convertedEntityType: null,
      convertedEntityId: null,
    },
  ];

  const architectureDecisions: ArchitectureDecision[] = [
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      projectId: projectIds.gridline,
      title: "Use radius matching before manual confirmation",
      context: "Webhook events can include close GPS readings from same venue.",
      decision: "Always attempt nearest-neighbor radius match first, then manual fallback.",
      alternatives: "Require manual location each arrival event.",
      consequences: "Faster UX with reduced manual input and consistent naming.",
      status: "accepted",
      decidedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const codexPrompts: CodexPrompt[] = [
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      projectId: projectIds.gridline,
      title: "Generate CarPlay webhook test cases",
      purpose: "Validate arrival event dedupe and location matching.",
      prompt: "Design robust test scenarios for webhook-driven arrival events and location duplicate prevention.",
      resultSummary: "Generated table with 12 scenarios and expected event IDs.",
      status: "prepared",
      relatedTaskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      relatedSessionId: "aaaaaaaa-1111-4111-8111-111111111112",
      source: "manual",
      sequenceNumber: 1,
      promptSummary: "Generate test cases for CarPlay webhook dedupe and location matching.",
      requestedChange: "Design the webhook test scenarios needed before implementation.",
      createdBy: "marwan",
      completedWork: [],
      unfinishedWork: [],
      problemsDiscovered: [],
      decisionsMade: [],
      filesModified: [],
      commits: [],
      branch: "",
      blocker: "",
      recommendedNextStep: "Use the scenarios while implementing the matching service.",
      activeDurationMs: 0,
      testResults: [],
      buildResults: [],
      deploymentStatus: "Not deployed",
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    },
  ];

  const developmentSessions: DevelopmentSession[] = [
    {
      id: "aaaaaaaa-1111-4111-8111-111111111112",
      projectId: projectIds.gridline,
      startedAt: now,
      endedAt: now,
      objective: "Finalize CarPlay idea-to-task path.",
      summary: "Completed location skip guard and aligned schema.",
      taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccd",
      promptRecordId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      source: "manual",
      tasksWorkedOn: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "cccccccc-cccc-4ccc-8ccc-cccccccccccd"],
      tasksCompleted: ["cccccccc-cccc-4ccc-8ccc-cccccccccccd"],
      ideasAdded: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      problemsDiscovered: ["Webhook dedupe edge cases when IDs rotate.", "Clock skew for duplicate suppression.",],
      decisionsMade: ["Use timestamp+source+sourceId composite key.",],
      promptsUsed: ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
      filesModified: ["functions/src/carplay/arrival.ts"],
      commits: ["seed-completed-session"],
      nextStartingPoint: "Implement nearest-neighbor radius tuning and cache by project.",
      status: "completed",
      notes: "Session completed with notes above.",
      activeStartedAt: null,
      activeDurationMs: 0,
      resumeFromNote: "Continue from the webhook mapping guard.",
      blocker: "",
      nextStep: "Implement nearest-neighbor radius tuning and cache by project.",
      testResults: [],
      buildResults: [],
      deploymentStatus: "Not deployed",
    },
  ];

  const activities: ActivityEvent[] = [
    {
      id: "44444444-4444-4a44-8a44-444444444441",
      projectId: projectIds.gridline,
      type: "project_created",
      summary: "Seeded GridlineAI project and baseline idea/task flow.",
      entityType: "project",
      entityId: projectIds.gridline,
      metadata: "bootstrap",
      createdAt: now,
    },
  ];

  const notes: Note[] = [
    {
      id: "22222222-2222-4a22-8a22-222222222221",
      projectId: projectIds.gridline,
      title: "Phase 1A setup",
      section: "notes",
      tags: ["brain", "seed"],
      markdown: "Project starts with focused local-only capture and context tools.",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const links: ImportantLink[] = [
    {
      id: "33333333-3333-4a33-8a33-333333333331",
      projectId: projectIds.gridline,
      title: "GridlineAI Repo",
      url: "https://github.com/example/gridlineai",
      notes: "Primary workspace for arrivals and location routing.",
      section: "infrastructure",
      tags: ["repo", "primary"],
      updatedAt: now,
      createdAt: now,
    },
  ];

  return {
    schemaVersion: 2,
    projects,
    ideas,
    tasks,
    brainDumps,
    scratchpads: [],
    architectureDecisions,
    codexPrompts,
    notes,
    importantLinks: links,
    developmentSessions,
    activities,
  };
};
