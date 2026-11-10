import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountsToCsv,
  csvCell,
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
  assert.equal(lines[0], "Company,Domain,Stage,Owner,Notes,Latest report,Report link,Added,Updated");
  assert.equal(lines[1], "Stripe,stripe.com,Meeting,Nick,'=cmd,2026-11-10,https://www.metisanalytic.com/app?run=abc,2026-11-01,2026-11-09");
});
