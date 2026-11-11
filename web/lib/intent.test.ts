import { test } from "node:test";
import assert from "node:assert/strict";
import { agencyToSave, isPostingAgency, matchesOffer, scoreIntent, type IntentSignal, type Opportunity } from "./intent.js";

const NOW = new Date("2026-11-11T12:00:00Z");

const opp = (o: Partial<Opportunity> = {}): Opportunity => ({
  noticeId: "n1",
  title: "Fleet telematics services",
  solicitationNumber: null,
  noticeType: "Solicitation",
  agencyPath: "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP",
  naicsCode: "541512",
  setAside: null,
  postedDate: "2026-11-01",
  responseDeadline: "2026-12-15T22:00:00.000Z",
  url: "https://sam.gov/opp/n1/view",
  ...o,
});

const ending = (date: string): IntentSignal => ({ kind: "contract_ending", title: `$1.2M contract with DOE ends ${date}`, url: "https://usaspending.example", date });
const plan = (n: number): IntentSignal => ({ kind: "stated_plan", title: `Plan ${n}`, url: `https://news.example/${n}`, date: "2026-10-01" });
const techChange = (n: number): IntentSignal => ({ kind: "tech_change", title: `Started using V${n}`, url: `https://dns.example/${n}`, date: "2026-11-01" });

test("no signals is low, with no reasons to cite", () => {
  assert.deepEqual(scoreIntent([], [], NOW), { level: "low", reasons: [] });
});

test("a contract ending within 6 months plus a stated plan is high", () => {
  const r = scoreIntent([ending("2027-03-01"), plan(1)], [], NOW);
  assert.equal(r.level, "high");
  assert.deepEqual(r.reasons.map((x) => [x.kind, x.text, x.sourceName]), [
    ["contract_ending", "$1.2M contract with DOE ends in 3 months", "USAspending.gov"],
    ["stated_plan", "Plan 1", "News"],
  ]);
});

test("medium and low thresholds; ended contracts and passed deadlines drop out", () => {
  assert.equal(scoreIntent([plan(1)], [], NOW).level, "medium");
  assert.equal(scoreIntent([techChange(1)], [], NOW).level, "low");
  assert.equal(scoreIntent([ending("2026-10-01")], [], NOW).reasons.length, 0);
  assert.equal(scoreIntent([], [opp({ responseDeadline: "2026-11-01T00:00:00Z" })], NOW).reasons.length, 0);
});

test("only two plans and two tech changes count toward the level, but all are cited", () => {
  const r = scoreIntent([techChange(1), techChange(2), techChange(3), techChange(4)], [], NOW);
  assert.equal(r.level, "medium");
  assert.equal(r.reasons.length, 4);
  assert.equal(scoreIntent([plan(1), plan(2), plan(3)], [], NOW).level, "medium");
});

test("an open solicitation from the account is cited to SAM.gov", () => {
  const r = scoreIntent([plan(1)], [opp()], NOW);
  assert.equal(r.level, "high");
  assert.deepEqual(r.reasons[0], {
    kind: "rfp",
    text: "Solicitation: Fleet telematics services, responses due 2026-12-15",
    url: "https://sam.gov/opp/n1/view",
    date: "2026-12-15",
    sourceName: "SAM.gov",
  });
});

test("offers match by NAICS prefix or whole-word title keyword", () => {
  assert.equal(matchesOffer(opp(), ["5415"], []), true);
  assert.equal(matchesOffer(opp(), ["5416"], []), false);
  assert.equal(matchesOffer(opp(), [], ["telematics"]), true);
  assert.equal(matchesOffer(opp(), [], ["tele"]), false);
  assert.equal(matchesOffer(opp({ naicsCode: null }), ["5415"], ["fleet telematics"]), true);
});

test("an account is the posting agency only on an exact level match", () => {
  const path = "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP";
  assert.equal(isPostingAgency("Department of the Navy", path), true);
  assert.equal(isPostingAgency("U.S. Department of Defense", path), true);
  assert.equal(isPostingAgency("NAVSUP · navsup.navy.mil", path), true);
  assert.equal(isPostingAgency("Navy Federal Credit Union", path), false);
  assert.equal(isPostingAgency("Acme Corp", path), false);
  assert.equal(agencyToSave(path), "DEPT OF THE NAVY");
  assert.equal(agencyToSave("GENERAL SERVICES ADMINISTRATION"), "GENERAL SERVICES ADMINISTRATION");
});
