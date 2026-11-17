import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trialEnds, upgradeTarget, usageRows } from "./usage";

const trial = { used: 45, limit: 50, resetsAt: "2026-11-23T12:00:00Z", period: "trial" as const };
const month = { used: 5, limit: 300, resetsAt: "2026-12-03T12:00:00Z" };

describe("signup-trial usage", () => {
  it("shows trial totals as trial rows that end, not monthly rows that reset", () => {
    const [row] = usageRows({ monthlyUsage: trial, monthlyDeepDiveUsage: null, windowUsage: null });
    assert.equal(row.periodTag, "trial");
    assert.equal(row.periodPhrase, "in your free trial");
    assert.equal(row.resets, null);
    assert.ok(row.ends);
    assert.equal(row.status, "warn");
  });

  it("leaves monthly caps as they were", () => {
    const [row] = usageRows({ monthlyUsage: month, monthlyDeepDiveUsage: null, windowUsage: null });
    assert.equal(row.key, "month-research");
    assert.equal(row.periodTag, "month");
    assert.ok(row.resets);
    assert.equal(row.ends, undefined);
  });

  it("offers a plan to a signup trial, and nothing to a hand-assigned one", () => {
    const ends = trialEnds({ monthlyUsage: trial, monthlyDeepDiveUsage: null });
    assert.ok(ends);
    assert.equal(upgradeTarget("trial", ends)?.href, "/pricing");
    assert.equal(upgradeTarget("trial", trialEnds({ monthlyUsage: month, monthlyDeepDiveUsage: null })), null);
  });
});
