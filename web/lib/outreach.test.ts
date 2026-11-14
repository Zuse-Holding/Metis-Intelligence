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
  assert.deepEqual(outreach(bare, OFFER, SPOTS, NOW), { opener: undefined, objection: undefined, email: undefined, callNotes: undefined, objections: [] });
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
    "We're locked into our current contract.",
  ]);
  const quiet: SalesBundle = { ...FULL, techStack: undefined, corporateActions: [], funding: [], federalSpending: [], news: [FULL.news![0]] };
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
  const o = outreach(FULL, OFFER, SPOTS, NOW);
  const lines = outreachLines(o);
  assert.deepEqual(lines.filter((l) => l.endsWith(":")), ["Opening email:", "Talking points:", "Questions to ask:", "Likely objections:"]);
  // Every line about the account ends with its links; only the seller's offer and the ask don't.
  const uncited = new Set(o.email!.filter((s) => s.kind !== "fact").map((s) => `- ${s.text}`));
  for (const l of lines.filter((x) => x.startsWith("- ") && !uncited.has(x))) assert.match(l, /\(https?:\/\/[^)]+\)$/, l);
  assert.ok(lines.some((l) => /^- "We already use HubSpot\." Suggested response: .*\(https:\/\/dns\.example\/txt, https:\/\/news\.example\/price\)$/.test(l)));
  // The short version (full outreach off) keeps the old headings.
  assert.deepEqual(outreachLines({ opener: o.opener, objection: o.objection, objections: [o.objection!] }).filter((l) => l.endsWith(":")), ["Opening line:", "Likely objection:"]);
});

test("opening email: opener, a second finding, the seller's offer and the ask; 3 to 5 sentences", () => {
  const email = outreach(FULL, OFFER, SPOTS, NOW).email!;
  assert.ok(email.length >= 3 && email.length <= 5);
  assert.deepEqual(email.map((s) => s.kind), ["fact", "fact", "offer", "ask"]);
  assert.match(email[0].text, /^I saw that you run HubSpot/);
  // The second finding never repeats the opener's source.
  assert.ok(!email[1].evidence.some((e) => email[0].evidence.some((x) => x.url === e.url)));
  assert.equal(email[2].text, "What we do: Cuts AP time.");
  assert.match(email[3].text, /renewal/);
  for (const s of email.filter((x) => x.kind === "fact")) assert.ok(s.evidence.length > 0, s.text);
});

test("opening email is left out when only the opener and the ask would be in it", () => {
  const onlyNews: SalesBundle = { company: { name: "Acme" }, news: [FULL.news![0]] };
  assert.equal(outreach(onlyNews, null, {}, NOW).email, undefined);
  assert.ok(outreach(onlyNews, null, {}, NOW).opener);
  const withOffer = outreach(onlyNews, { ...OFFER, competitors: [] }, {}, NOW).email!;
  assert.deepEqual(withOffer.map((s) => s.kind), ["fact", "offer", "ask"]);
  assert.equal(withOffer.at(-1)!.text, "Would a 20-minute call next week be useful?");
});

test("call notes: up to three cited talking points and two cited questions", () => {
  const notes = outreach(FULL, OFFER, SPOTS, NOW).callNotes!;
  assert.equal(notes.points.length, 3);
  assert.equal(notes.questions.length, 2);
  assert.equal(notes.questions[0].text, "How is HubSpot working for your marketing automation today?");
  for (const l of [...notes.points, ...notes.questions]) assert.ok(l.evidence.length > 0 && l.evidence.every((e) => e.url.startsWith("https://")), l.text);
});

test("an open role that names a vendor the seller replaces becomes a talking point and a question", () => {
  const hiring: SalesBundle = {
    company: { name: "Acme" },
    techStack: { domain: "acme.com", items: [], jobBoards: [{ ats: "Greenhouse", url: "https://boards.greenhouse.io/acme", postings: [
      { title: "Marketing Ops Manager", url: "https://boards.greenhouse.io/acme/jobs/1", tools: ["HubSpot"] },
      { title: "Line Cook", url: "https://boards.greenhouse.io/acme/jobs/2" },
    ] }] },
  };
  const notes = outreach(hiring, OFFER, {}, NOW).callNotes!;
  assert.deepEqual(notes.points.map((p) => p.text), ["Hiring: Marketing Ops Manager, a role that names HubSpot."]);
  assert.deepEqual(notes.questions.map((q) => q.text), ["What will the new Marketing Ops Manager take on first?"]);
  assert.deepEqual(notes.points[0].evidence.map((e) => e.url), ["https://boards.greenhouse.io/acme/jobs/1"]);
});
