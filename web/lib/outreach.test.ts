import { test } from "node:test";
import assert from "node:assert/strict";
import { objections, openingLine, outreach, outreachLines, type WeakSpot } from "./outreach.js";
import type { SalesBundle, SellerOffer } from "./sales.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const USA = { url: "https://api.usaspending.gov/search", title: "USAspending", usedFor: ["federal-spending"] };

const OFFER: SellerOffer = { offering: "Cuts AP time", targetCustomers: "", competitors: ["HubSpot"], naicsCodes: [], keywords: [] };
const HUBSPOT = { vendor: "HubSpot", category: "Marketing automation", confidence: "confirmed", evidence: "SPF include: hubspotemail.net", sourceName: "Public DNS (TXT)", sourceUrl: "https://dns.example/txt" };
const SPOTS: Record<string, WeakSpot[]> = {
  HubSpot: [
    { kind: "outage", title: "HubSpot down for hours", url: "https://news.example/outage", date: "2026-09-01", outlet: "The Verge" },
    { kind: "price_increase", title: "HubSpot raises prices", url: "https://news.example/price", date: "2026-10-15" },
  ],
};

const FULL: SalesBundle = {
  company: { name: "Acme", website: "https://acme.com" },
  news: [
    { headline: "Acme opens Denver plant", date: "Oct 3, 2026", url: "https://news.example/plant", outlet: "Denver Post" },
    { headline: "Acme announces layoffs at Ohio site", date: "Aug 3, 2026", url: "https://news.example/layoffs" },
  ],
  funding: [{ round: "Series B", amount: "$40M", date: "2026-06-01", url: "https://news.example/fund" }],
  corporateActions: [{ kind: "Acquisition", name: "Bolt Co", date: "Sep 1, 2026", url: "https://news.example/acq" }],
  federalSpending: [{ awardingAgency: "Department of Energy", amount: "$1.2M", date: "2020-07-01", endDate: "2027-04-30", awardType: "" }],
  sources: [USA],
  techStack: { domain: "acme.com", items: [HUBSPOT] },
};

test("opening line: a competitor they run with bad news comes first, citing both findings", () => {
  const o = openingLine(FULL, OFFER, SPOTS, NOW)!;
  assert.equal(o.text, "I saw that you run HubSpot, and that HubSpot was in the news for a price increase (“HubSpot raises prices”, Oct 15, 2026).");
  assert.deepEqual(o.evidence.map((e) => e.url), ["https://dns.example/txt", "https://news.example/price"]);
});

test("opening line falls back in order: contract ending, funding, competitor, acquisition, news, award", () => {
  assert.equal(openingLine(FULL, OFFER, {}, NOW)!.text, "I saw that your $1.2M contract with Department of Energy ends in 5 months (Apr 30, 2027).");
  const noContract = { ...FULL, federalSpending: [] };
  assert.equal(openingLine(noContract, OFFER, {}, NOW)!.text, "Congratulations on the Series B, $40M (Jun 1, 2026).");
  const noFunding = { ...noContract, funding: [] };
  assert.equal(openingLine(noFunding, OFFER, {}, NOW)!.text, "I saw that you run HubSpot for marketing automation.");
  assert.equal(openingLine(noFunding, null, {}, NOW)!.text, "I saw the news about the Bolt Co acquisition (Sep 1, 2026).");
  const newsOnly = { ...noFunding, corporateActions: [] };
  assert.equal(openingLine(newsOnly, null, {}, NOW)!.text, "I saw the news: “Acme opens Denver plant” (Denver Post, Oct 3, 2026).");
});

test("no evidence, no line: nothing dated and sourced means no opener and no objection", () => {
  const bare: SalesBundle = {
    company: { name: "Acme" },
    news: [{ headline: "Undated", url: "https://news.example/x" }, { headline: "Unsourced", date: "Oct 1, 2026" }],
    techStack: { domain: "acme.com", items: [{ ...HUBSPOT, confidence: "likely" }] },
  };
  assert.deepEqual(outreach(bare, OFFER, SPOTS, NOW), { opener: undefined, objection: undefined });
  assert.deepEqual(outreachLines(outreach(bare, OFFER, SPOTS, NOW)), []);
});

test("every opener and objection rests on at least one sourced finding", () => {
  const variants: SalesBundle[] = [FULL, { ...FULL, federalSpending: [] }, { ...FULL, funding: [], techStack: undefined }, { ...FULL, news: [] }];
  for (const b of variants) {
    for (const spots of [{}, SPOTS]) {
      const o = outreach(b, OFFER, spots, NOW);
      if (o.opener) assert.ok(o.opener.evidence.length > 0 && o.opener.evidence.every((e) => e.url.startsWith("https://")), o.opener.text);
      for (const x of objections(b, OFFER, spots, NOW)) {
        assert.ok(x.evidence.length > 0 && x.evidence.every((e) => e.url.startsWith("https://")), x.objection);
      }
    }
  }
});

test("objections fire only on the finding that makes them likely, most likely first", () => {
  assert.deepEqual(objections(FULL, OFFER, {}, NOW).map((o) => o.objection), [
    "We already use HubSpot.",
    "We don't have the budget right now.",
    "We're in the middle of an integration, so not now.",
    "It's not a priority right now.",
  ]);
  const quiet: SalesBundle = { ...FULL, techStack: undefined, corporateActions: [], funding: [], news: [FULL.news![0]] };
  assert.deepEqual(objections(quiet, OFFER, {}, NOW).map((o) => o.objection), ["It's not a priority right now."]);
  assert.deepEqual(objections({ ...quiet, news: [] }, OFFER, {}, NOW), []);
});

test("the competitor objection's response cites the vendor's news once it's loaded", () => {
  const without = objections(FULL, OFFER, {}, NOW)[0];
  assert.equal(without.response, "Understood. Would a side-by-side with HubSpot be useful?");
  assert.deepEqual(without.responseEvidence, []);
  const withNews = objections(FULL, OFFER, SPOTS, NOW)[0];
  assert.match(withNews.response, /worth comparing before your next renewal: HubSpot was in the news for a price increase/);
  assert.deepEqual(withNews.responseEvidence.map((e) => e.url), ["https://news.example/price"]);
});

test("copy lines end with their links", () => {
  const lines = outreachLines(outreach(FULL, OFFER, SPOTS, NOW));
  assert.deepEqual(lines.filter((l) => l.endsWith(":")), ["Opening line:", "Likely objection:"]);
  for (const l of lines.filter((x) => x.startsWith("- "))) assert.match(l, /\(https?:\/\/[^)]+\)$/, l);
  assert.match(lines.at(-1)!, /^- "We already use HubSpot\." Suggested response: .*\(https:\/\/dns\.example\/txt, https:\/\/news\.example\/price\)$/);
});
