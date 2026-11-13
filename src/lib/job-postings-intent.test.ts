import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intentSignals, parseIntentSignals, MAX_HIRING } from "./buyer-intent.js";
import { detectTriggers } from "./account-triggers.js";
import { postingTools } from "../agents/tech-stack-agent/job-boards.js";
import type { TechStack } from "../agents/tech-stack-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

const NOW = new Date("2026-11-13T12:00:00Z");

const stack = (postings: { title: string; url: string; postedAt?: string; tools?: string[] }[], items: TechStack["items"] = []): TechStack => ({
  domain: "acme.com", checkedAt: NOW.toISOString(), items,
  jobBoards: [{ ats: "Greenhouse", url: "https://boards.greenhouse.io/acme", postings }],
});

const bundle = (techStack?: TechStack) => ({ company: { name: "Acme" }, leadership: [], news: [], funding: [], sources: [], techStack }) as unknown as ResearchBundle;

describe("hiring signals (server)", () => {
  it("stores each open role with the tools its posting names, dated by the posting", () => {
    const s = intentSignals({ techStack: stack([
      { title: "NetSuite Administrator", url: "https://boards.greenhouse.io/acme/jobs/1", postedAt: "2026-10-30T00:00:00Z", tools: ["NetSuite"] },
      { title: "Barista", url: "https://boards.greenhouse.io/acme/jobs/2" },
      { title: "Bad link", url: "javascript:alert(1)" },
    ]) }, undefined, [], NOW);
    assert.deepEqual(s, [
      { kind: "hiring", title: "NetSuite Administrator", url: "https://boards.greenhouse.io/acme/jobs/1", date: "2026-10-30", tools: ["NetSuite"] },
      { kind: "hiring", title: "Barista", url: "https://boards.greenhouse.io/acme/jobs/2", date: "2026-11-13" },
    ]);
  });

  it("caps open roles and never carries a closed one over", () => {
    const many = Array.from({ length: MAX_HIRING + 10 }, (_, i) => ({ title: `Role ${i}`, url: `https://jobs.lever.co/acme/${i}` }));
    assert.equal(intentSignals({ techStack: stack(many) }, undefined, [], NOW).length, MAX_HIRING);
    const kept = [{ kind: "hiring" as const, title: "Old role", url: "https://x/1", date: "2026-11-01" }];
    assert.deepEqual(intentSignals({ techStack: stack([]) }, undefined, kept, NOW), []);
  });

  it("reads stored hiring signals back, with or without tools", () => {
    const back = parseIntentSignals([
      { kind: "hiring", title: "A", url: "https://x", date: "2026-11-01", tools: ["NetSuite"] },
      { kind: "hiring", title: "B", url: "https://x", date: "2026-11-01" },
      { kind: "hiring", title: "C", url: "https://x", date: "2026-11-01", tools: [1] },
    ]);
    assert.deepEqual(back.map((s) => s.title), ["A", "B"]);
  });
});

describe("hiring-for-tool trigger", () => {
  const prev = bundle(stack([{ title: "Accountant", url: "https://boards.greenhouse.io/acme/jobs/1", tools: ["QuickBooks"] }], [
    { vendor: "Salesforce", category: "CRM", confidence: "confirmed", layer: "dns", evidence: "x", sourceName: "x", sourceUrl: "https://dns.example" },
  ]));

  it("fires for a tool no earlier posting or tech stack showed, flagged when it's a competitor", () => {
    const next = bundle(stack([
      { title: "Accountant", url: "https://boards.greenhouse.io/acme/jobs/1", tools: ["QuickBooks"] },
      { title: "Project Engineer", url: "https://boards.greenhouse.io/acme/jobs/3", postedAt: "2026-11-02T00:00:00Z", tools: ["Procore", "Salesforce"] },
      { title: "Controller", url: "https://boards.greenhouse.io/acme/jobs/4", tools: ["NetSuite"] },
    ]));
    const t = detectTriggers(prev, next, ["NetSuite"]).filter((x) => x.kind === "hiring_tool");
    assert.deepEqual(t, [
      { kind: "hiring_tool", atRisk: false, title: "Started hiring for Procore (Project Engineer)", url: "https://boards.greenhouse.io/acme/jobs/3", eventDate: "2026-11-02" },
      { kind: "hiring_tool", atRisk: true, title: "Started hiring for NetSuite, a competitor you replace (Controller)", url: "https://boards.greenhouse.io/acme/jobs/4", eventDate: undefined },
    ]);
  });

  it("needs both reports to have read the job board, and a closed posting never fires", () => {
    const next = bundle(stack([{ title: "Project Engineer", url: "https://boards.greenhouse.io/acme/jobs/3", tools: ["Procore"] }]));
    assert.equal(detectTriggers(bundle(undefined), next).some((x) => x.kind === "hiring_tool"), false);
    assert.equal(detectTriggers(prev, bundle(stack([]))).some((x) => x.kind === "hiring_tool"), false);
  });
});

describe("tools per posting", () => {
  it("lists every tool one posting names, skipping lists of options", () => {
    const p = { title: "Controller", url: "https://x", board: "Greenhouse" as const, text: "Own the close in NetSuite.\nBuild dashboards in Tableau.\nNice to have: an ERP such as SAP S/4HANA or Sage Intacct." };
    assert.deepEqual(postingTools(p), ["NetSuite", "Tableau"]);
  });
});
