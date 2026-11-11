import { test } from "node:test";
import assert from "node:assert/strict";
import { contacts, isCompetitor, outreachBrief, parseSellerOffer, snapshot, whyNow, type SalesBundle } from "./sales.js";

const NOW = new Date("2026-11-10T12:00:00Z");

const BUNDLE: SalesBundle = {
  company: { name: "Acme", summary: "Acme makes widgets.", website: "https://acme.com", headquarters: "Denver, CO", industry: "Manufacturing", founded: "1999" },
  ownership: "Private, family-owned",
  leadership: [
    { name: "Jane Doe", title: "CEO", sourceUrl: "https://acme.com/team" },
    { name: "John Roe", title: "CFO" },
    { name: "Guess Person", title: "VP Sales", lowConfidence: true, sourceUrl: "https://x.com/y" },
    { name: "jane doe", title: "Chief Executive", sourceUrl: "https://acme.com/about" },
  ],
  news: [
    { headline: "Acme opens Denver plant", date: "Oct 3, 2026", url: "https://news.example/a", outlet: "Denver Post" },
    { headline: "Law firm investigates Acme", date: "Oct 20, 2026", url: "https://law.example/b", solicitation: true },
    { headline: "Old news", date: "Jan 5, 2025", url: "https://news.example/old" },
    { headline: "Undated item", url: "https://news.example/nodate" },
    { headline: "Unsourced item", date: "Nov 1, 2026" },
  ],
  funding: [{ round: "Series B", amount: "$40M", date: "2026-06-01", url: "https://news.example/fund", investors: ["Fund One", "Fund Two"] }],
  corporateActions: [{ kind: "Acquisition", name: "Bolt Co", date: "Sep 1, 2026", url: "https://news.example/acq" }],
  courtCases: [
    { caption: "Smith v. Acme", filed: "2026-08-15", url: "https://courtlistener.example/1", caseType: "Employment" },
    { caption: "Routine filing", filed: "2026-09-01", url: "https://courtlistener.example/2", routine: true },
  ],
  federalSpending: [{ awardingAgency: "Department of Energy", amount: "$1.2M", date: "2026-07-01", awardType: "Contract" }],
  sources: [{ url: "https://api.usaspending.gov/search", title: "USAspending", usedFor: ["federal-spending"] }],
  techStack: {
    domain: "acme.com",
    items: [
      { vendor: "HubSpot", category: "Marketing automation", confidence: "confirmed", evidence: "SPF include: hubspotemail.net", sourceName: "Public DNS (TXT)", sourceUrl: "https://dns.example/txt" },
      { vendor: "Dropbox", category: "Collaboration", confidence: "confirmed", evidence: "TXT: dropbox-domain-verification=…", sourceName: "Public DNS (TXT)", sourceUrl: "https://dns.example/txt" },
    ],
  },
};

test("why now keeps dated, sourced events from the last year, newest first", () => {
  const items = whyNow(BUNDLE, NOW);
  assert.deepEqual(items.map((i) => i.kind), ["News", "Acquisition", "Court case", "Federal award", "Funding"]);
  assert.equal(items[0].text, "Acme opens Denver plant");
  assert.equal(items[0].date, "Oct 3, 2026");
  for (const i of items) assert.ok(i.url.startsWith("https://"), i.text);
});

test("why now leaves out solicitations, old, undated, unsourced and routine items", () => {
  const texts = whyNow(BUNDLE, NOW).map((i) => i.text).join(" | ");
  for (const gone of ["Law firm", "Old news", "Undated", "Unsourced", "Routine filing"]) assert.ok(!texts.includes(gone), gone);
});

test("federal awards cite the report's USAspending source, and are dropped without one", () => {
  const award = whyNow(BUNDLE, NOW).find((i) => i.kind === "Federal award")!;
  assert.equal(award.url, "https://api.usaspending.gov/search");
  assert.equal(award.text, "$1.2M contract from Department of Energy");
  assert.equal(whyNow({ ...BUNDLE, sources: [] }, NOW).some((i) => i.kind === "Federal award"), false);
});

test("federal contracts ending in the next year are listed by end date; grants, past and far-off ends are not", () => {
  const b: SalesBundle = {
    ...BUNDLE,
    federalSpending: [
      { awardingAgency: "Department of Energy", amount: "$1.2M", date: "2020-07-01", endDate: "2027-04-30", awardType: "Contract" },
      { awardingAgency: "NSF", amount: "$300K", date: "2020-01-01", endDate: "2027-01-31", awardType: "Grant" },
      { awardingAgency: "Navy", amount: "$5M", date: "2020-01-01", endDate: "2026-10-01", awardType: "Contract" },
      { awardingAgency: "Army", amount: "$9M", date: "2020-01-01", endDate: "2029-01-01", awardType: "Contract" },
    ],
  };
  const ending = whyNow(b, NOW).filter((i) => i.kind === "Contract ending");
  assert.deepEqual(ending.map((i) => [i.date, i.text, i.url]), [
    ["Apr 30, 2027", "$1.2M contract with Department of Energy ends in 5 months", "https://api.usaspending.gov/search"],
  ]);
  assert.equal(whyNow({ ...b, sources: [] }, NOW).some((i) => i.kind === "Contract ending"), false);
});

test("funding names up to three investors", () => {
  assert.equal(whyNow(BUNDLE, NOW).find((i) => i.kind === "Funding")!.text, "Series B, $40M from Fund One, Fund Two");
});

test("contacts drop low-confidence and duplicate names; the company site is the fallback source", () => {
  assert.deepEqual(contacts(BUNDLE), [
    { name: "Jane Doe", title: "CEO", url: "https://acme.com/team" },
    { name: "John Roe", title: "CFO", url: "https://acme.com" },
  ]);
  assert.deepEqual(contacts({ leadership: [{ name: "No Source", title: "CEO" }] }), []);
});

test("snapshot lists only the basics the report has", () => {
  const s = snapshot(BUNDLE);
  assert.equal(s.summary, "Acme makes widgets.");
  assert.deepEqual(s.rows.map((r) => r.label), ["Industry", "Headquarters", "Founded", "Ownership", "Website"]);
  assert.deepEqual(snapshot({}).rows, []);
});

test("competitor matching is whole-word, either way round", () => {
  assert.equal(isCompetitor("HubSpot", ["hubspot"]), true);
  assert.equal(isCompetitor("Salesforce Marketing Cloud (Pardot)", ["Salesforce"]), true);
  assert.equal(isCompetitor("Salesforce", ["Salesforce Marketing Cloud"]), true);
  assert.equal(isCompetitor("Dropbox", ["Box"]), false);
  assert.equal(isCompetitor("Box", ["Dropbox"]), false);
  assert.equal(isCompetitor("HubSpot", []), false);
  assert.equal(isCompetitor("HubSpot", ["  "]), false);
});

test("seller offer: trims, dedupes competitors and enforces limits", () => {
  const ok = parseSellerOffer({ offering: "  Cuts AP time  ", targetCustomers: "Distributors", competitors: ["HubSpot", " hubspot ", "", "Salesforce"] });
  assert.deepEqual(ok, { ok: true, offer: { offering: "Cuts AP time", targetCustomers: "Distributors", competitors: ["HubSpot", "Salesforce"] } });
  assert.equal(parseSellerOffer(null).ok, false);
  assert.equal(parseSellerOffer({ offering: "", targetCustomers: "", competitors: [] }).ok, false);
  assert.equal(parseSellerOffer({ offering: "x".repeat(301), targetCustomers: "", competitors: [] }).ok, false);
  assert.equal(parseSellerOffer({ offering: "x", targetCustomers: "", competitors: [1] }).ok, false);
  assert.equal(parseSellerOffer({ offering: "x", targetCustomers: "", competitors: Array.from({ length: 21 }, (_, i) => `V${i}`) }).ok, false);
});

test("the outreach brief has every section with links and marks competitors first", () => {
  const text = outreachBrief("Acme · acme.com", BUNDLE, { offering: "Cuts AP time", competitors: ["Dropbox"], targetCustomers: "" }, NOW);
  assert.match(text, /^Acme · acme\.com — account brief \(Metis Intelligence, Nov 10, 2026\)/);
  assert.match(text, /Why now:\n- Oct 3, 2026: Acme opens Denver plant \(https:\/\/news\.example\/a\)/);
  assert.match(text, /Tech stack:\n- Dropbox \(Collaboration\) — a competitor you replace: /);
  assert.match(text, /Who to contact:\n- Jane Doe, CEO \(https:\/\/acme\.com\/team\)/);
  assert.match(text, /What we sell: Cuts AP time$/);
  for (const line of text.split("\n").filter((l) => l.startsWith("- "))) assert.match(line, /\(https?:\/\/[^)]+\)$/, line);
});
