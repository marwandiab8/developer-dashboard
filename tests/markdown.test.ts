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
});
