import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onSignupTrial } from "./signup-trial.js";

const now = new Date("2026-11-16T12:00:00Z");
const future = "2026-11-20T12:00:00Z";
const past = "2026-11-10T12:00:00Z";

describe("onSignupTrial", () => {
  it("applies to a new account (no tier yet) inside its 7 days", () => {
    assert.equal(onSignupTrial(null, future, now), true);
    assert.equal(onSignupTrial("free", future, now), true);
  });

  it("ends at the expiry time and the account falls back to Free", () => {
    assert.equal(onSignupTrial("free", past, now), false);
    assert.equal(onSignupTrial("free", now.toISOString(), now), false);
  });

  it("never overrides a paid, hand-assigned or internal tier", () => {
    for (const tier of ["basic", "pro", "team", "trial", "internal"]) {
      assert.equal(onSignupTrial(tier, future, now), false, tier);
    }
  });

  it("does nothing for accounts with no trial date or a bad one", () => {
    assert.equal(onSignupTrial("free", null, now), false);
    assert.equal(onSignupTrial(null, undefined, now), false);
    assert.equal(onSignupTrial("free", "not a date", now), false);
  });
});
