import { describe, expect, it } from "vitest";
import { generateProjectResume } from "../src/lib/markdown/generateProjectResume";
import { generateAiContext } from "../src/lib/markdown/generateAiContext";
import { seedDashboardData } from "../src/lib/seed";

describe("markdown generators", () => {
  it("generates project resume with required headings", () => {
    const data = seedDashboardData();
    const gridline = data.projects.find((project) => project.title === "GridlineAI");
    const text = generateProjectResume(data, gridline!.id);
    expect(text).toContain("# PROJECT_RESUME.md");
    expect(text).toContain("## What this project is");
    expect(text).toContain("## Current architecture");
    expect(text).toContain("## Future ideas");
  });

  it("generates AI context with repository-inspection warning", () => {
    const data = seedDashboardData();
    const gridline = data.projects.find((project) => project.title === "GridlineAI");
    const text = generateAiContext(data, gridline!.id);
    expect(text).toContain("# AI_CONTEXT.md");
    expect(text).toContain("Warning: the AI agent must inspect the repository");
  });
});
