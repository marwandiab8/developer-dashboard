import { describe, expect, it } from "vitest";
import { dashboardDataSchema, quickCaptureSchema } from "../src/lib/validation";
import { seedDashboardData } from "../src/lib/seed";

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
