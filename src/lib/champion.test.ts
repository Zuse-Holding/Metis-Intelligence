import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { championLeft } from "./account-triggers.js";
import type { ResearchBundle } from "../types/research.js";

const leaders = (...people: { name: string; title: string; carried?: boolean }[]) =>
  ({ company: { name: "Acme", website: "https://acme.com" }, leadership: people.map((p) => ({ ...p, sourceUrl: "https://acme.com/team" })) }) as unknown as ResearchBundle;

describe("champion left", () => {
  const prev = leaders({ name: "Dana Ruiz", title: "VP Operations" }, { name: "Sam Lee", title: "CEO" });

  it("fires, at risk and cited, when the named champion drops off a freshly read list", () => {
    const t = championLeft(prev, leaders({ name: "Sam Lee", title: "CEO" }), "dana ruiz")!;
    assert.equal(t.kind, "champion_left");
    assert.equal(t.atRisk, true);
    assert.equal(t.title, "Your champion Dana Ruiz (VP Operations) is no longer listed");
    assert.equal(t.url, "https://acme.com/team");
  });

  it("stays quiet when they're still listed, the list wasn't read, or they were never listed", () => {
    assert.equal(championLeft(prev, leaders({ name: "Dana Ruiz Jr.", title: "COO" }, { name: "Sam Lee", title: "CEO" }), "Dana Ruiz"), undefined);
    assert.equal(championLeft(prev, leaders({ name: "Sam Lee", title: "CEO", carried: true }), "Dana Ruiz"), undefined);
    assert.equal(championLeft(prev, leaders(), "Dana Ruiz"), undefined);
    assert.equal(championLeft(prev, leaders({ name: "Sam Lee", title: "CEO" }), "Pat Kim"), undefined);
  });

  it("needs a full name", () => {
    assert.equal(championLeft(prev, leaders({ name: "Sam Lee", title: "CEO" }), "Dana"), undefined);
    assert.equal(championLeft(prev, leaders({ name: "Sam Lee", title: "CEO" }), null), undefined);
  });
});
