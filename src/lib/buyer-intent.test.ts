import { test } from "node:test";
import assert from "node:assert/strict";
import { intentSignals, parseIntentSignals, PLAN_RE, type IntentSignal } from "./buyer-intent.js";
import type { ResearchBundle } from "../types/research.js";

const NOW = new Date("2026-11-11T12:00:00Z");
const SPENDING = { url: "https://www.usaspending.gov/search/?x", title: "USAspending", retrievedAt: "", usedFor: ["federal-spending"] };

type B = Parameters<typeof intentSignals>[0];
const tech = (items: { vendor: string; layer: string; confidence?: string }[]) => ({
  domain: "acme.com",
  items: items.map((i) => ({ vendor: i.vendor, category: "Email", confidence: i.confidence ?? "confirmed", layer: i.layer, evidence: "x", sourceName: "DNS", sourceUrl: `https://dns.example/${i.vendor}` })),
}) as unknown as ResearchBundle["techStack"];

test("contracts ending within 18 months are signals; grants, past and far-off ends aren't", () => {
  const b: B = {
    sources: [SPENDING],
    federalSpending: [
      { amount: "$1.2M", awardingAgency: "Department of Energy", endDate: "2027-04-30" },
      { amount: "$300K", awardingAgency: "NSF", endDate: "2027-01-31", awardType: "PROJECT GRANT (B)" },
      { amount: "$5M", awardingAgency: "Navy", endDate: "2026-10-01" },
      { amount: "$9M", awardingAgency: "Army", endDate: "2029-01-01" },
    ],
  };
  assert.deepEqual(intentSignals(b, undefined, [], NOW), [
    { kind: "contract_ending", title: "$1.2M contract with Department of Energy ends 2027-04-30", url: SPENDING.url, date: "2027-04-30" },
  ]);
  assert.deepEqual(intentSignals({ ...b, sources: [] }, undefined, [], NOW), []);
});

test("stated plans come from recent, sourced, non-solicitation news", () => {
  const b: B = {
    news: [
      { headline: "Acme plans to replace its legacy ERP", date: "2026-10-01", url: "https://news.example/a" },
      { headline: "Acme issued an RFP for fleet telematics", date: "Sep 20, 2026", url: "https://news.example/b" },
      { headline: "Acme plans to modernize billing", date: "2025-01-01", url: "https://news.example/old" },
      { headline: "Acme plans to upgrade its plant", date: "2026-10-01" },
      { headline: "Law firm: Acme plans to invest", date: "2026-10-01", url: "https://law.example", solicitation: true },
      { headline: "Acme wins award", date: "2026-10-01", url: "https://news.example/c" },
    ],
  };
  assert.deepEqual(intentSignals(b, undefined, [], NOW).map((s) => s.url), ["https://news.example/a", "https://news.example/b"]);
});

test("plan pattern skips ordinary headlines", () => {
  for (const h of ["Acme names new CFO", "Acme reports record quarter", "Acme opens Denver office"]) assert.equal(PLAN_RE.test(h), false, h);
  for (const h of ["City seeking a new vendor for payroll", "Acme to invest $40M in automation", "Acme's digital transformation"]) assert.equal(PLAN_RE.test(h), true, h);
});

test("tech changes are DNS-backed only, and need a previous report", () => {
  const prev: B = { techStack: tech([{ vendor: "Google Workspace", layer: "dns" }, { vendor: "HubSpot", layer: "website" }]) };
  const next: B = { techStack: tech([{ vendor: "Microsoft 365", layer: "dns" }, { vendor: "Shopify", layer: "subdomain" }, { vendor: "Zendesk", layer: "dns", confidence: "likely" }]) };
  assert.deepEqual(intentSignals(next, prev, [], NOW).map((s) => s.title), [
    "Started using Microsoft 365 (Email)",
    "No longer shows Google Workspace (Email)",
  ]);
  assert.deepEqual(intentSignals(next, undefined, [], NOW), []);
});

test("stored tech changes carry over for 90 days; other kinds are re-read", () => {
  const kept: IntentSignal[] = [
    { kind: "tech_change", title: "Started using Okta (Identity)", url: "https://dns.example/okta", date: "2026-10-01" },
    { kind: "tech_change", title: "Started using Box (Storage)", url: "https://dns.example/box", date: "2026-07-01" },
    { kind: "stated_plan", title: "Old plan", url: "https://news.example/x", date: "2026-10-01" },
  ];
  assert.deepEqual(intentSignals({}, undefined, kept, NOW).map((s) => s.title), ["Started using Okta (Identity)"]);
});

test("stored signals are validated when read back", () => {
  assert.deepEqual(parseIntentSignals(null), []);
  assert.deepEqual(parseIntentSignals([{ kind: "bogus", title: "x", url: "u", date: "d" }, { kind: "stated_plan", title: "t", url: "u", date: "2026-01-01" }, "x"]), [
    { kind: "stated_plan", title: "t", url: "u", date: "2026-01-01" },
  ]);
});
