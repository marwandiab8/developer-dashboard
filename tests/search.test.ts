import { describe, expect, it } from "vitest";
import { searchDashboard } from "../src/lib/repositories/localAdapter";
import { seedDashboardData } from "../src/lib/seed";

describe("search indexing", () => {
  it("returns project and idea matches", () => {
    const data = seedDashboardData();
    const results = searchDashboard(data, "carplay");
    expect(results.length).toBeGreaterThan(0);
    const types = new Set(results.map((item) => item.entityType));
    expect(types.has("idea")).toBe(true);
  });
});
