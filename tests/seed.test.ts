import { describe, expect, it } from "vitest";
import { seedDashboardData } from "../src/lib/seed";

describe("seedDashboardData", () => {
  it("contains all baseline projects", () => {
    const data = seedDashboardData();
    const titles = data.projects.map((project) => project.title);
    expect(titles).toContain("GridlineAI");
    expect(titles).toContain("Time Left To Live");
    expect(titles).toContain("Developer Dashboard");
    expect(titles).toContain("Darts Tracker");
    expect(titles).toContain("Workout App");
  });

  it("contains a sample accepted Gridline idea", () => {
    const data = seedDashboardData();
    const gridline = data.projects.find((project) => project.title === "GridlineAI");
    const ideas = data.ideas.filter((idea) => idea.projectId === gridline?.id);
    expect(ideas.some((idea) => idea.text.includes("CarPlay arrival location matching"))).toBe(true);
  });
});
