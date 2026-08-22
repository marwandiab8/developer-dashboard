import { act, createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData } from "../src/lib/models";
import { seedDashboardData } from "../src/lib/seed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const navigationFixture = vi.hoisted(() => ({
  useParams: vi.fn(),
  pathname: "/projects/unknown",
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const dashboardFixture = vi.hoisted<{ current: unknown }>(() => ({
  current: null,
}));

const generatorFixture = vi.hoisted(() => ({
  generateProjectResume: vi.fn(),
  generateAiContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: navigationFixture.useParams,
  usePathname: () => navigationFixture.pathname,
  useSearchParams: () => navigationFixture.searchParams,
  useRouter: () => ({
    replace: navigationFixture.replace,
    push: navigationFixture.push,
  }),
}));

vi.mock("../src/lib/repositories/repositoryContext", () => ({
  useDashboard: () => dashboardFixture.current,
}));

vi.mock("../src/lib/markdown/generateProjectResume", () => ({
  generateProjectResume: generatorFixture.generateProjectResume,
}));

vi.mock("../src/lib/markdown/generateAiContext", () => ({
  generateAiContext: generatorFixture.generateAiContext,
}));

vi.mock("../src/components/GitHubSyncPanel", () => ({
  GitHubSyncPanel: () => null,
}));

import DashboardPage from "../src/app/page";
import ProjectWorkbenchPage from "../src/app/projects/[projectId]/page";
import ProjectsPage from "../src/app/projects/page";
import SessionsPage from "../src/app/sessions/page";

function makeDashboardFixture(data: DashboardData) {
  return {
    data,
    createProject: vi.fn(),
    addIdea: vi.fn(),
    updateIdea: vi.fn(),
    archiveIdea: vi.fn(),
    convertIdeaToTask: vi.fn(),
    addTask: vi.fn(),
    startTask: vi.fn(),
    blockTask: vi.fn(),
    completeTask: vi.fn(),
    addBrainDump: vi.fn(),
    convertBrainDumpToIdea: vi.fn(),
    convertBrainDumpToTask: vi.fn(),
    deleteBrainDump: vi.fn(),
    updateBrainDump: vi.fn(),
    updateScratchpad: vi.fn(),
    getProjectScratchpad: vi.fn(() => null),
    upsertDecision: vi.fn(),
    updateDecisionStatus: vi.fn(),
    upsertPrompt: vi.fn(),
    markPromptUsed: vi.fn(),
    addNote: vi.fn(),
    updateNote: vi.fn(),
    addLink: vi.fn(),
    startSession: vi.fn(),
    endSession: vi.fn(),
    appendSessionNote: vi.fn(),
  };
}

function mount(component: ComponentType) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(component));
  });

  return {
    container,
    close: () => act(() => root.unmount()),
  };
}

function dataWithOnlyProject(data: DashboardData, projectId: string): DashboardData {
  return {
    ...data,
    projects: data.projects.filter((project) => project.id === projectId),
    ideas: data.ideas.filter((idea) => idea.projectId === projectId),
    tasks: data.tasks.filter((task) => task.projectId === projectId),
    brainDumps: data.brainDumps.filter((entry) => entry.projectId === projectId),
    scratchpads: data.scratchpads.filter((entry) => entry.projectId === projectId),
    architectureDecisions: data.architectureDecisions.filter((entry) => entry.projectId === projectId),
    codexPrompts: data.codexPrompts.filter((entry) => entry.projectId === projectId),
    developmentSessions: data.developmentSessions.filter((entry) => entry.projectId === projectId),
    activities: data.activities.filter((entry) => entry.projectId === projectId),
    notes: data.notes.filter((entry) => entry.projectId === projectId),
    importantLinks: data.importantLinks.filter((entry) => entry.projectId === projectId),
  };
}

describe("project workbench route resolution", () => {
  beforeEach(() => {
    const data = seedDashboardData();
    const projectId = data.projects[0].id;

    dashboardFixture.current = makeDashboardFixture(data);
    navigationFixture.useParams.mockReset();
    navigationFixture.useParams.mockReturnValue({ projectId });
    navigationFixture.pathname = `/projects/${projectId}`;
    navigationFixture.searchParams = new URLSearchParams();
    navigationFixture.replace.mockReset();
    navigationFixture.push.mockReset();
    generatorFixture.generateProjectResume.mockReset();
    generatorFixture.generateProjectResume.mockReturnValue("# PROJECT_RESUME.md");
    generatorFixture.generateAiContext.mockReset();
    generatorFixture.generateAiContext.mockReturnValue("# AI_CONTEXT.md");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves the project ID with useParams and renders the simplified overview", () => {
    const data = seedDashboardData();
    const project = data.projects[2];
    dashboardFixture.current = makeDashboardFixture(data);
    navigationFixture.useParams.mockReturnValue({ projectId: project.id });
    navigationFixture.pathname = `/projects/${project.id}`;

    const view = mount(ProjectWorkbenchPage);
    try {
      expect(navigationFixture.useParams).toHaveBeenCalled();
      expect(view.container.textContent).toContain("Next up");
      expect(view.container.querySelector("h1")?.textContent).toBe(project.title);
      expect(view.container.textContent).toContain(project.currentObjective);
      expect(generatorFixture.generateProjectResume).toHaveBeenCalledWith(data, project.id);
      expect(generatorFixture.generateAiContext).toHaveBeenCalledWith(data, project.id);
    } finally {
      view.close();
    }
  });

  it("renders Project not found without invoking generators for an unknown route ID", () => {
    const missingProjectId = "99999999-9999-4999-8999-999999999999";
    navigationFixture.useParams.mockReturnValue({ projectId: missingProjectId });
    navigationFixture.pathname = `/projects/${missingProjectId}`;

    const view = mount(ProjectWorkbenchPage);
    try {
      expect(view.container.textContent).toBe("Project not found.");
      expect(generatorFixture.generateProjectResume).not.toHaveBeenCalled();
      expect(generatorFixture.generateAiContext).not.toHaveBeenCalled();
      expect(
        (dashboardFixture.current as ReturnType<typeof makeDashboardFixture>).getProjectScratchpad,
      ).not.toHaveBeenCalled();
    } finally {
      view.close();
    }
  });

  it("targets the dynamic project route from the projects list and home focus", () => {
    const seeded = seedDashboardData();
    const project = seeded.projects[2];
    const data = dataWithOnlyProject(seeded, project.id);
    dashboardFixture.current = makeDashboardFixture(data);

    const projectsView = mount(ProjectsPage);
    try {
      const projectLinks = Array.from(projectsView.container.querySelectorAll("h2"))
        .filter((heading) => heading.textContent === project.title)
        .map((heading) => heading.closest("a"))
        .filter((link): link is HTMLAnchorElement => Boolean(link));
      expect(projectLinks.length).toBeGreaterThan(0);
      expect(projectLinks.every((link) => link.getAttribute("href") === `/projects/${project.id}`)).toBe(true);
    } finally {
      projectsView.close();
    }

    const dashboardView = mount(DashboardPage);
    try {
      const resumeProjectLink = Array.from(dashboardView.container.querySelectorAll("a"))
        .find((link) => link.textContent === "Resume project");
      expect(resumeProjectLink?.getAttribute("href"))
        .toBe(`/projects/${project.id}`);
    } finally {
      dashboardView.close();
    }
  });

  it("sorts automatic sessions and prompts and uses the latest completed session for continuity", () => {
    const data = seedDashboardData();
    const project = data.projects[0];
    const ingestedSession = {
      ...data.developmentSessions[0],
      id: "dddddddd-1111-4111-8111-111111111112",
      startedAt: "2026-08-11T12:00:00.000Z",
      endedAt: "2026-08-11T13:00:00.000Z",
      objective: "Automatic Codex handoff",
      summary: "Stored the semantic session context.",
      source: "codex" as const,
      externalSessionId: "codex-session-42",
      branch: "feature/codex-ingestion",
      commits: ["abc1234"],
      nextStartingPoint: "Configure the helper in another repository",
    };
    const ingestedPrompt = {
      ...data.codexPrompts[0],
      id: "eeeeeeee-1111-4111-8111-111111111112",
      title: "Latest automatic prompt",
      source: "codex" as const,
      externalSessionId: "codex-session-42",
      relatedSessionId: ingestedSession.id,
      updatedAt: "2026-08-11T13:00:00.000Z",
      lastUsedAt: "2026-08-11T13:00:00.000Z",
    };
    data.developmentSessions = [data.developmentSessions[0], ingestedSession];
    data.codexPrompts = [data.codexPrompts[0], ingestedPrompt];
    dashboardFixture.current = makeDashboardFixture(data);
    navigationFixture.useParams.mockReturnValue({ projectId: project.id });
    navigationFixture.pathname = `/projects/${project.id}`;

    const workbenchView = mount(ProjectWorkbenchPage);
    try {
      expect(workbenchView.container.textContent).toContain(
        "Configure the helper in another repository",
      );
      expect(workbenchView.container.textContent).toContain("Stored the semantic session context.");
    } finally {
      workbenchView.close();
    }

    navigationFixture.searchParams = new URLSearchParams("section=sessions");
    const sessionView = mount(ProjectWorkbenchPage);
    try {
      expect(sessionView.container.textContent).toContain("Source: Codex");
      expect(sessionView.container.textContent).toContain("codex-session-42");
      expect(sessionView.container.textContent).toContain("feature/codex-ingestion");
      expect(sessionView.container.textContent).toContain("abc1234");
    } finally {
      sessionView.close();
    }

    navigationFixture.searchParams = new URLSearchParams("section=codex-prompts");
    const promptView = mount(ProjectWorkbenchPage);
    try {
      expect(promptView.container.textContent).toContain("Latest automatic prompt");
      expect(promptView.container.textContent).toContain("Source: Codex");
      expect(promptView.container.textContent).toContain("codex-session-42");
    } finally {
      promptView.close();
    }

    const sessionsPageView = mount(SessionsPage);
    try {
      expect(sessionsPageView.container.textContent).toContain("Source: Codex");
      expect(sessionsPageView.container.textContent).toContain("codex-session-42");
      expect(sessionsPageView.container.textContent).toContain("abc1234");
    } finally {
      sessionsPageView.close();
    }
  });
});
