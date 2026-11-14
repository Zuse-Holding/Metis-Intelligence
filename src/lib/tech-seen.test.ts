import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adoptedSince, parseTechSeen, updateTechSeen, withFirstSeen } from "./tech-seen.js";
import { peerGaps } from "./displacement.js";
import { applyProfile, profileFrom } from "./profile-cache.js";
import type { ResearchBundle } from "../types/research.js";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("tech first seen", () => {
  it("keeps the first day a tool was seen and when the domain was first checked", () => {
    const first = updateTechSeen(undefined, [{ vendor: "HubSpot", confidence: "confirmed" }], d("2026-09-01"));
    const later = updateTechSeen(first, [{ vendor: "HubSpot", confidence: "confirmed" }, { vendor: "Salesforce", confidence: "confirmed" }], d("2026-11-01"));
    assert.equal(later.checkedFirst, "2026-09-01");
    assert.equal(later.vendors.hubspot.firstSeen, "2026-09-01");
    assert.equal(later.vendors.hubspot.lastSeen, "2026-11-01");
    assert.equal(later.vendors.salesforce.firstSeen, "2026-11-01");
    // A tool no longer found keeps its dates.
    const gone = updateTechSeen(later, [], d("2026-12-01"));
    assert.equal(gone.vendors.salesforce.lastSeen, "2026-11-01");
  });

  it("calls a tool adopted only when it's confirmed and the domain was checked before without it", () => {
    const first = updateTechSeen(undefined, [{ vendor: "HubSpot", confidence: "confirmed" }], d("2026-09-01"));
    const later = updateTechSeen(first, [
      { vendor: "HubSpot", confidence: "confirmed" },
      { vendor: "Salesforce", confidence: "confirmed" },
      { vendor: "Jira", confidence: "likely" },
    ], d("2026-11-01"));
    assert.equal(adoptedSince(later, "HubSpot"), undefined);
    assert.equal(adoptedSince(later, "Salesforce"), "2026-11-01");
    assert.equal(adoptedSince(later, "Jira"), undefined);
    assert.equal(adoptedSince(undefined, "Salesforce"), undefined);
  });

  it("dates each item, today for one never seen before", () => {
    const seen = updateTechSeen(undefined, [{ vendor: "HubSpot", confidence: "confirmed" }], d("2026-09-01"));
    const items = withFirstSeen([{ vendor: "HubSpot", confidence: "confirmed" }, { vendor: "Okta", confidence: "confirmed" }], seen, d("2026-11-13"));
    assert.deepEqual(items.map((i) => i.firstSeen), ["2026-09-01", "2026-11-13"]);
  });

  it("drops a malformed stored record", () => {
    assert.equal(parseTechSeen(null), undefined);
    assert.equal(parseTechSeen({ vendors: {} }), undefined);
    assert.deepEqual(parseTechSeen({ checkedFirst: "2026-09-01", vendors: { x: { vendor: 1 }, hubspot: { vendor: "HubSpot", firstSeen: "2026-09-01", lastSeen: "2026-09-01" } } }),
      { checkedFirst: "2026-09-01", vendors: { hubspot: { vendor: "HubSpot", firstSeen: "2026-09-01", lastSeen: "2026-09-01", confirmed: false } } });
  });

  it("is saved with the profile and applied from it", () => {
    const bundle = { company: { name: "Acme" }, competitors: [], sources: [], techStack: { domain: "acme.com", checkedAt: "", items: [{ vendor: "HubSpot", category: "Marketing automation", confidence: "confirmed", layer: "dns", evidence: "SPF", sourceName: "DNS", sourceUrl: "https://dns.example" }] } } as unknown as ResearchBundle;
    const rec = profileFrom(bundle, "acme.com", undefined, { techSeen: true })!;
    assert.equal(profileFrom(bundle, "acme.com")?.tech_seen, undefined);
    assert.ok(rec.tech_seen?.vendors.hubspot);
    const next = { ...bundle, techStack: { ...bundle.techStack!, items: [...bundle.techStack!.items] } } as ResearchBundle;
    applyProfile(next, { domain: "acme.com", tech_seen: { checkedFirst: "2026-09-01", vendors: { hubspot: { vendor: "HubSpot", firstSeen: "2026-09-01", lastSeen: "2026-09-01", confirmed: true } } } });
    assert.equal(next.techStack!.items[0].firstSeen, "2026-09-01");
  });
});

describe("peer gaps with adoption dates", () => {
  it("carries since when a peer started showing the tool", () => {
    const item = (vendor: string, since?: string) => ({ vendor, category: "CRM", sourceUrl: `https://${vendor}.example`, evidence: "TXT", ...(since ? { since } : {}) });
    const gaps = peerGaps([], [
      { name: "Wesco", domain: "wesco.com", items: [item("Salesforce", "2026-10-02")] },
      { name: "Rexel", domain: "rexel.com", items: [item("Salesforce")] },
    ]);
    assert.deepEqual(gaps[0].peers.map((p) => [p.name, p.since]), [["Wesco", "2026-10-02"], ["Rexel", undefined]]);
  });
});
