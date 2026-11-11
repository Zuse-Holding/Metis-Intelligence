import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchBundle } from "../types/research.js";
import { detectTriggers, matchesCompetitor } from "./account-triggers.js";

const base = (over: Partial<ResearchBundle> = {}): ResearchBundle => ({
  query: "Acme", generatedAt: "2026-11-01T00:00:00Z", company: { name: "Acme", website: "https://acme.com" },
  leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], ...over,
});

const item = (vendor: string, category: string, layer: "dns" | "website" = "dns") => ({
  vendor, category: category as never, confidence: "confirmed" as const, layer, evidence: "x", sourceName: "Public DNS", sourceUrl: `https://dns.example/${vendor}`,
});

describe("account triggers", () => {
  it("the first report raises nothing when nothing changed", () => {
    const b = base({ news: [{ headline: "Acme lays off 200", url: "https://n/1" }] });
    assert.deepEqual(detectTriggers(b, b), []);
  });

  it("classifies new news: layoffs, budget cuts and acquisitions are at risk; expansion isn't", () => {
    const prev = base();
    const next = base({ news: [
      { headline: "Acme lays off 200 workers", url: "https://n/1", date: "Nov 2, 2026" },
      { headline: "Acme announces hiring freeze", url: "https://n/2" },
      { headline: "Acme cost-cutting plan", url: "https://n/3" },
      { headline: "Bigco acquires Acme", url: "https://n/4" },
      { headline: "Acme opens new plant in Ohio", url: "https://n/5" },
      { headline: "Acme sponsors a 5k", url: "https://n/6" },
      { headline: "Law firm investigates Acme layoffs", url: "https://n/7", solicitation: true },
    ] });
    const got = detectTriggers(prev, next).map((t) => [t.kind, t.atRisk, t.title]);
    assert.deepEqual(got, [
      ["layoffs", true, "Acme lays off 200 workers"],
      ["layoffs", true, "Acme announces hiring freeze"],
      ["budget_cut", true, "Acme cost-cutting plan"],
      ["acquisition", true, "Bigco acquires Acme"],
      ["expansion", false, "Acme opens new plant in Ohio"],
    ]);
  });

  it("news already in the previous report isn't a trigger", () => {
    const n = [{ headline: "Acme lays off 200", url: "https://n/1" }];
    assert.deepEqual(detectTriggers(base({ news: n }), base({ news: n })), []);
  });

  it("a senior leader leaving is at risk; a new one isn't", () => {
    const prev = base({ leadership: [{ name: "Jane Doe", title: "CFO", sourceUrl: "https://acme.com/team" }, { name: "Sam Lee", title: "Office manager" }] });
    const next = base({ leadership: [{ name: "Ravi Patel", title: "Chief Financial Officer", sourceUrl: "https://acme.com/team" }] });
    assert.deepEqual(detectTriggers(prev, next).map((t) => [t.atRisk, t.title]), [
      [false, "New: Ravi Patel, Chief Financial Officer"],
      [true, "No longer listed: Jane Doe, CFO"],
    ]);
  });

  it("no departures when this report couldn't read the leadership list", () => {
    const prev = base({ leadership: [{ name: "Jane Doe", title: "CEO" }] });
    assert.deepEqual(detectTriggers(prev, base({ leadership: [] })), []);
    assert.deepEqual(detectTriggers(prev, base({ leadership: [{ name: "Old Carry", title: "CEO", carried: true }] })).filter((t) => t.atRisk), []);
  });

  it("new funding, acquisitions, lawsuits and federal awards", () => {
    const prev = base({ courtCases: [{ caption: "Old v. Acme", url: "https://c/old" }] });
    const next = base({
      funding: [{ round: "Series B", amount: "$40M", url: "https://n/fund", date: "2026-10-01" }],
      corporateActions: [{ kind: "Acquisition", name: "Bolt Co", url: "https://n/acq" }, { kind: "Subsidiary or brand", name: "Acme Labs", url: "https://n/brand" }],
      courtCases: [{ caption: "Old v. Acme", url: "https://c/old" }, { caption: "New v. Acme", url: "https://c/new", caseType: "Contract" }, { caption: "Routine", url: "https://c/r", routine: true }],
      federalSpending: [{ awardId: "A1", amount: "$1M", awardType: "Contract", awardingAgency: "DOE", date: "2026-09-01" }],
      sources: [{ url: "https://api.usaspending.gov/x", title: "USAspending", retrievedAt: "", usedFor: ["federal-spending"] }],
    });
    assert.deepEqual(detectTriggers(prev, next).map((t) => [t.kind, t.atRisk, t.title, t.url]), [
      ["funding", false, "Series B, $40M", "https://n/fund"],
      ["acquisition", true, "Acquisition: Bolt Co", "https://n/acq"],
      ["lawsuit", true, "New v. Acme (Contract)", "https://c/new"],
      ["federal_award", false, "$1M contract from DOE", "https://api.usaspending.gov/x"],
    ]);
  });

  it("tech stack: a competitor adopted is at risk; other adds and drops aren't", () => {
    const prev = base({ techStack: { domain: "acme.com", checkedAt: "", items: [item("HubSpot", "Marketing automation"), item("Zendesk", "Customer support")] } });
    const next = base({ techStack: { domain: "acme.com", checkedAt: "", items: [item("HubSpot", "Marketing automation"), item("Salesforce", "CRM"), item("Slack", "Collaboration")] } });
    assert.deepEqual(detectTriggers(prev, next, ["salesforce"]).map((t) => [t.kind, t.atRisk, t.title]), [
      ["competitor_adopted", true, "Started using Salesforce, a competitor you replace"],
      ["tech_added", false, "Started using Slack (Collaboration)"],
      ["tech_removed", false, "No longer shows Zendesk (Customer support)"],
    ]);
  });

  it("a blocked homepage doesn't read as dropped website tools", () => {
    const prev = base({ techStack: { domain: "a.com", checkedAt: "", items: [item("Google Tag Manager", "Tag management", "website"), item("Cloudflare", "CDN and security")] } });
    const next = base({ techStack: { domain: "a.com", checkedAt: "", websiteUnavailable: "HTTP 403", items: [item("Cloudflare", "CDN and security")] } });
    assert.deepEqual(detectTriggers(prev, next), []);
  });

  it("every trigger has a source and a bounded title", () => {
    const next = base({ news: [{ headline: "Acme lays off " + "x".repeat(400), url: "https://n/1" }, { headline: "Acme lays off staff" }] });
    const got = detectTriggers(base(), next);
    assert.equal(got.length, 1);
    assert.ok(got[0].title.length <= 300);
  });

  it("competitor matching is whole-word", () => {
    assert.equal(matchesCompetitor("Dropbox", ["Box"]), false);
    assert.equal(matchesCompetitor("Salesforce Marketing Cloud (Pardot)", ["Salesforce"]), true);
  });
});
