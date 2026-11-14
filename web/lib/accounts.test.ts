import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountsToCsv,
  csvCell,
  dealHealth,
  formatMoney,
  freshTriggerCount,
  parseStallDays,
  rankAccounts,
  stageTotals,
  type AccountTrigger,
  isAccountStage,
  newFindings,
  parseAccountPatch,
  parseCompany,
  splitSubject,
} from "./accounts.js";

test("only the six pipeline stages are accepted", () => {
  for (const s of ["researching", "contacted", "meeting", "proposal", "won", "lost"]) assert.equal(isAccountStage(s), true);
  for (const s of ["Won", "closed", "", null, 3]) assert.equal(isAccountStage(s), false);
});

test("a patch keeps stage, owner and notes and ignores everything else", () => {
  const r = parseAccountPatch({ stage: "meeting", owner: "  Kyle ", notes: "Call Tue", user_id: "someone-else", company: "x" });
  assert.deepEqual(r, { ok: true, patch: { stage: "meeting", owner: "Kyle", notes: "Call Tue" } });
});

test("empty owner and notes clear the field", () => {
  assert.deepEqual(parseAccountPatch({ owner: "   ", notes: "" }), { ok: true, patch: { owner: null, notes: null } });
  assert.deepEqual(parseAccountPatch({ owner: null }), { ok: true, patch: { owner: null } });
});

test("bad patches are refused", () => {
  assert.equal(parseAccountPatch(null).ok, false);
  assert.equal(parseAccountPatch({}).ok, false);
  assert.equal(parseAccountPatch({ user_id: "x" }).ok, false);
  assert.equal(parseAccountPatch({ stage: "closed" }).ok, false);
  assert.equal(parseAccountPatch({ owner: 5 }).ok, false);
  assert.equal(parseAccountPatch({ owner: "a".repeat(121) }).ok, false);
  assert.equal(parseAccountPatch({ notes: "a".repeat(5001) }).ok, false);
});

test("notes keep line breaks but lose other control characters", () => {
  const r = parseAccountPatch({ notes: "line one\nline\u0007 two\r\n" });
  assert.deepEqual(r, { ok: true, patch: { notes: "line one\nline two" } });
});

test("company names are trimmed and length-checked", () => {
  assert.equal(parseCompany("  Stripe · stripe.com "), "Stripe · stripe.com");
  assert.equal(parseCompany("Acme\u0000 Inc"), "Acme Inc");
  assert.equal(parseCompany(""), null);
  assert.equal(parseCompany("   "), null);
  assert.equal(parseCompany("a".repeat(201)), null);
  assert.equal(parseCompany(42), null);
});

test("the domain is split off a report subject only when it is a domain", () => {
  assert.deepEqual(splitSubject("Stripe · stripe.com"), { name: "Stripe", domain: "stripe.com" });
  assert.deepEqual(splitSubject("Patagonia · Ventura"), { name: "Patagonia · Ventura", domain: null });
  assert.deepEqual(splitSubject("Promise ABA"), { name: "Promise ABA", domain: null });
});

test("what changed lists only findings the newer report added", () => {
  const prev = [
    { section: "News", claim: "Raised a Series B" },
    { section: "Risks", claim: "Lawsuit filed in 2024" },
  ];
  const latest = [
    { section: "news", claim: "  raised a   series b " },
    { section: "Risks", claim: "Lawsuit filed in 2024" },
    { section: "News", claim: "Opened a Denver office", source_name: "Denver Post", source_url: "https://example.com/a" },
    { section: "News", claim: "Opened a Denver office" },
  ];
  assert.deepEqual(newFindings(prev, latest), [
    { section: "News", claim: "Opened a Denver office", sourceName: "Denver Post", sourceUrl: "https://example.com/a" },
  ]);
  assert.deepEqual(newFindings(latest, prev), []);
});

test("CSV cells are quoted and can't run as spreadsheet formulas", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  for (const bad of ["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(A1)", "\tx"]) {
    assert.ok(csvCell(bad).replace(/^"/, "").startsWith("'"), bad);
  }
});

test("the CSV has a header, one row per account and the domain split out", () => {
  const csv = accountsToCsv([
    {
      company: "Stripe · stripe.com",
      stage: "meeting",
      dealValue: 25000,
      nextStep: "Send proposal",
      health: "on_track",
      owner: "Nick",
      notes: "=cmd",
      latestReportAt: "2026-11-10T15:00:00Z",
      latestReportUrl: "https://www.metisanalytic.com/app?run=abc",
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-09T00:00:00Z",
    },
  ]);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "Company,Domain,Stage,Deal value,Health,Owner,Next step,Notes,Latest report,Report link,Added,Updated");
  assert.equal(lines[1], "Stripe,stripe.com,Meeting,25000.00,On track,Nick,Send proposal,'=cmd,2026-11-10,https://www.metisanalytic.com/app?run=abc,2026-11-01,2026-11-09");
});

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const trig = (atRisk: boolean, days: number, title = "x"): AccountTrigger => ({ kind: "layoffs", atRisk, title, url: "https://n/1", eventDate: null, detectedAt: daysAgo(days) });

test("deal value and next step are validated", () => {
  assert.deepEqual(parseAccountPatch({ dealValue: "$25,000.555", nextStep: "  Send proposal " }), { ok: true, patch: { dealValue: 25000.56, nextStep: "Send proposal" } });
  assert.deepEqual(parseAccountPatch({ dealValue: "", nextStep: "" }), { ok: true, patch: { dealValue: null, nextStep: null } });
  assert.equal(parseAccountPatch({ dealValue: -1 }).ok, false);
  assert.equal(parseAccountPatch({ dealValue: "lots" }).ok, false);
  assert.equal(parseAccountPatch({ nextStep: "a".repeat(301) }).ok, false);
});

test("health: at risk beats stalled; won and lost are closed", () => {
  const base = { stage: "proposal" as const, stageChangedAt: daysAgo(40), triggers: [] as AccountTrigger[] };
  assert.equal(dealHealth(base, 14, NOW).health, "stalled");
  assert.match(dealHealth(base, 14, NOW).reasons[0], /No stage change in 40 days/);
  assert.equal(dealHealth({ ...base, stageChangedAt: daysAgo(3) }, 14, NOW).health, "on_track");
  assert.deepEqual(dealHealth({ ...base, triggers: [trig(true, 5, "Acme lays off 200")] }, 14, NOW), { health: "at_risk", reasons: ["Acme lays off 200"] });
  assert.equal(dealHealth({ ...base, stageChangedAt: daysAgo(1), triggers: [trig(true, 45)] }, 14, NOW).health, "on_track");
  assert.equal(dealHealth({ ...base, triggers: [trig(false, 1)] , stageChangedAt: daysAgo(1) }, 14, NOW).health, "on_track");
  assert.equal(dealHealth({ ...base, stage: "won", triggers: [trig(true, 1)] }, 14, NOW).health, "closed");
});

test("fresh triggers are the last 14 days", () => {
  assert.equal(freshTriggerCount([trig(false, 1), trig(true, 13), trig(false, 20)], NOW), 2);
});

test("ranking: fresh triggers first, then at risk, then stalled", () => {
  const ranked = rankAccounts([
    { id: "quiet", health: "on_track" as const, freshTriggers: 0, updatedAt: daysAgo(1) },
    { id: "stalled", health: "stalled" as const, freshTriggers: 0, updatedAt: daysAgo(2) },
    { id: "busy", health: "on_track" as const, freshTriggers: 3, updatedAt: daysAgo(9) },
    { id: "risk", health: "at_risk" as const, freshTriggers: 0, updatedAt: daysAgo(3) },
  ]);
  assert.deepEqual(ranked.map((a) => a.id), ["busy", "risk", "stalled", "quiet"]);
});

test("stage totals add deal values per stage in pipeline order", () => {
  const totals = stageTotals([
    { stage: "meeting", dealValue: 10000 }, { stage: "meeting", dealValue: null }, { stage: "won", dealValue: 5000.5 },
  ]);
  assert.deepEqual(totals.map((t) => t.stage), ["researching", "contacted", "meeting", "proposal", "won", "lost"]);
  assert.deepEqual(totals.find((t) => t.stage === "meeting"), { stage: "meeting", count: 2, total: 10000 });
  assert.equal(totals.find((t) => t.stage === "won")!.total, 5000.5);
});

test("stall days and money formatting", () => {
  assert.equal(parseStallDays("21"), 21);
  for (const bad of [0, 366, 2.5, "x", null]) assert.equal(parseStallDays(bad), null);
  assert.equal(formatMoney(25000), "$25,000");
  assert.equal(formatMoney(null), "—");
});

test("champion on the account patch is trimmed, cleared when empty and length-capped", () => {
  assert.deepEqual(parseAccountPatch({ champion: "  Dana Ruiz " }), { ok: true, patch: { champion: "Dana Ruiz" } });
  assert.deepEqual(parseAccountPatch({ champion: "" }), { ok: true, patch: { champion: null } });
  assert.equal(parseAccountPatch({ champion: "x".repeat(121) }).ok, false);
  assert.equal(parseAccountPatch({ champion: 3 }).ok, false);
});