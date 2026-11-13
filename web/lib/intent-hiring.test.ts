import { test } from "node:test";
import assert from "node:assert/strict";
import { hiringMatch, scoreIntent, type IntentSignal } from "./intent.js";

const NOW = new Date("2026-11-13T12:00:00Z");
const OFFER = { keywords: ["ERP implementation", "fleet"], competitors: ["NetSuite"] };
const role = (title: string, tools?: string[]): IntentSignal => ({ kind: "hiring", title, url: `https://jobs.lever.co/acme/${encodeURIComponent(title)}`, date: "2026-11-01", ...(tools ? { tools } : {}) });

test("an open role matches on a whole-word keyword in its title or a competitor named in the posting", () => {
  assert.deepEqual(hiringMatch(role("ERP Implementation Lead"), OFFER), {});
  assert.deepEqual(hiringMatch(role("Fleet Manager"), OFFER), {});
  assert.deepEqual(hiringMatch(role("Controller", ["NetSuite", "Tableau"]), OFFER), { competitor: "NetSuite" });
  assert.equal(hiringMatch(role("Fleetwood Sales Rep"), OFFER), null);
  assert.equal(hiringMatch(role("Barista", ["Tableau"]), OFFER), null);
  assert.equal(hiringMatch(role("ERP Implementation Lead"), undefined), null);
});

test("matching roles score 2 each, at most two count; others aren't shown", () => {
  const signals = [role("ERP Implementation Lead"), role("Controller", ["NetSuite"]), role("Fleet Manager"), role("Barista")];
  const intent = scoreIntent(signals, [], NOW, OFFER);
  assert.equal(intent.level, "medium");
  assert.deepEqual(intent.reasons.map((r) => [r.kind, r.text, r.sourceName]), [
    ["hiring", "Hiring: ERP Implementation Lead", "Job posting"],
    ["hiring", "Hiring: Controller, names NetSuite, a competitor you replace", "Job posting"],
    ["hiring", "Hiring: Fleet Manager", "Job posting"],
  ]);
  for (const r of intent.reasons) assert.ok(r.url.startsWith("https://"));
});

test("without a seller offer, hiring adds nothing", () => {
  assert.deepEqual(scoreIntent([role("ERP Implementation Lead")], [], NOW), { level: "low", reasons: [] });
});
