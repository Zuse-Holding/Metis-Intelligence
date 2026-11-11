import { test } from "node:test";
import assert from "node:assert/strict";
import { contractEndPhrase, monthsUntil } from "./contract-end.js";

const NOW = new Date("2026-11-10T12:00:00Z");

test("months are whole calendar months, rounded down", () => {
  assert.equal(monthsUntil(new Date("2027-04-30T00:00:00Z"), NOW), 5);
  assert.equal(monthsUntil(new Date("2027-04-09T00:00:00Z"), NOW), 4);
  assert.equal(monthsUntil(new Date("2026-12-10T00:00:00Z"), NOW), 1);
});

test("end phrase covers future, near, past and missing dates", () => {
  assert.equal(contractEndPhrase("2027-04-30", NOW), "ends in 5 months (2027-04-30)");
  assert.equal(contractEndPhrase("2026-12-10", NOW), "ends in 1 month (2026-12-10)");
  assert.equal(contractEndPhrase("2026-11-30", NOW), "ends in under a month (2026-11-30)");
  assert.equal(contractEndPhrase("2024-03-31", NOW), "ended 2024-03-31");
  assert.equal(contractEndPhrase(undefined, NOW), undefined);
  assert.equal(contractEndPhrase("not a date", NOW), undefined);
});
