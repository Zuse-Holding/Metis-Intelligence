import type { ResearchBundle } from "../types/research.js";

/**
 * Why-now triggers for saved accounts (ABM brief §4): what changed at a
 * company between its previous report and this one. Pure: both bundles in,
 * cited trigger candidates out. Only changes count, so the first report on
 * an account sets the baseline and raises nothing.
 *
 * "At risk" kinds are the ones that endanger an open deal: a leader leaving,
 * layoffs or a hiring freeze, a budget cut, an acquisition, a new lawsuit,
 * or the account adopting (or hiring for) a vendor the seller competes with.
 */

export type TriggerKind =
  | "leadership_change" | "layoffs" | "budget_cut" | "acquisition" | "lawsuit" | "competitor_adopted"
  | "funding" | "expansion" | "federal_award" | "tech_added" | "tech_removed" | "hiring_tool" | "champion_left";

export interface TriggerCandidate {
  kind: TriggerKind;
  atRisk: boolean;
  title: string;
  url: string;
  eventDate?: string;
}

type Bundle = Pick<ResearchBundle, "company" | "leadership" | "news" | "funding" | "corporateActions" | "courtCases" | "federalSpending" | "sources" | "techStack">;

const NEWS_RULES: { kind: TriggerKind; atRisk: boolean; re: RegExp }[] = [
  { kind: "layoffs", atRisk: true, re: /\b(lay ?offs?|lays off|laid off|job cuts|cuts? \d[\d,]* jobs|cutting jobs|workforce reduction|reduction in force|hiring freeze|WARN notice)\b/i },
  { kind: "budget_cut", atRisk: true, re: /\b(budget cuts?|cost[- ]cutting|spending freeze|cuts? spending|austerity)\b/i },
  { kind: "acquisition", atRisk: true, re: /\b(acquires?|acquired|acquisition|merger|merges with|to buy|buys|agrees to sell)\b/i },
  { kind: "expansion", atRisk: false, re: /\b(opens|opening|expands?|expansion|new (office|plant|facility|headquarters|location|warehouse)|to hire|hiring \d|breaks ground)\b/i },
];

// Leaders whose arrival or departure matters to a deal.
const SENIOR = /\b(chief|ceo|cfo|coo|cto|cio|ciso|cmo|cro|president|founder|owner|partner|vice president|vp|svp|evp|head of|director|general manager|gm)\b/i;

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const key = (s: string | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Whole-word vendor match, either way round. Mirrors web/lib/sales.ts
 *  isCompetitor (the web app can't import from src/). */
export function matchesCompetitor(vendor: string, competitors: string[]): boolean {
  const v = ` ${norm(vendor)} `;
  return competitors.some((c) => {
    const n = norm(c);
    return n.length > 0 && (v.includes(` ${n} `) || ` ${n} `.includes(v));
  });
}

/** "Martin Cabrera Jr." and "martin cabrera" are the same name; titles and suffixes don't count. */
const personKey = (s: string) => norm(s).replace(/\b(jr|sr|ii|iii|iv|dr|mr|ms|mrs|phd|md)\b/g, "").replace(/\s+/g, " ").trim();

/**
 * The account's champion (named by the user) was on the previous report's
 * leadership list and isn't on this one. Only when this report read the
 * list itself; a champion who was never listed can't be tracked, and the
 * Accounts page says so.
 */
export function championLeft(prev: Bundle, next: Bundle, champion: string | null | undefined): TriggerCandidate | undefined {
  const who = personKey(champion ?? "");
  if (who.split(" ").length < 2) return undefined; // a first name alone matches too much
  const was = (prev.leadership ?? []).find((l) => personKey(l.name) === who);
  if (!was) return undefined;
  const read = (next.leadership ?? []).filter((l) => !l.carried && !l.lowConfidence);
  if (read.length === 0) return undefined;
  if ((next.leadership ?? []).some((l) => personKey(l.name) === who)) return undefined;
  const url = read.find((l) => l.sourceUrl)?.sourceUrl ?? next.company?.website ?? "";
  if (!url) return undefined;
  return { kind: "champion_left", atRisk: true, title: clip(`Your champion ${was.name} (${was.title}) is no longer listed`), url };
}

export function detectTriggers(prev: Bundle, next: Bundle, competitors: string[] = []): TriggerCandidate[] {
  const out: TriggerCandidate[] = [];
  const add = (t: TriggerCandidate) => {
    if (!t.url || !t.title.trim()) return;
    const title = clip(t.title.trim());
    if (!out.some((o) => o.kind === t.kind && o.title === title)) out.push({ ...t, title });
  };
  const site = next.company?.website ?? prev.company?.website;

  // Leadership: senior people who appeared or disappeared. Departures only
  // when this report actually read a leadership list (an empty or carried-
  // over list is a read failure, not an exodus).
  const prevLeaders = (prev.leadership ?? []).filter((l) => SENIOR.test(l.title) && !l.lowConfidence);
  const nextLeaders = (next.leadership ?? []).filter((l) => SENIOR.test(l.title) && !l.lowConfidence);
  const prevNames = new Set(prevLeaders.map((l) => key(l.name)));
  const nextNames = new Set(nextLeaders.map((l) => key(l.name)));
  if (prevLeaders.length > 0) {
    for (const l of nextLeaders) {
      if (!prevNames.has(key(l.name)) && !l.carried) {
        add({ kind: "leadership_change", atRisk: false, title: `New: ${l.name}, ${l.title}`, url: l.sourceUrl ?? site ?? "" });
      }
    }
  }
  const freshlyRead = nextLeaders.some((l) => !l.carried);
  if (freshlyRead) {
    for (const l of prevLeaders) {
      if (!nextNames.has(key(l.name))) {
        add({ kind: "leadership_change", atRisk: true, title: `No longer listed: ${l.name}, ${l.title}`, url: nextLeaders.find((n) => !n.carried)?.sourceUrl ?? site ?? "" });
      }
    }
  }

  // News the previous report didn't have, classified by headline.
  const seenNews = new Set((prev.news ?? []).map((n) => n.url ?? key(n.headline)));
  for (const n of next.news ?? []) {
    if (n.solicitation || !n.url || seenNews.has(n.url) || seenNews.has(key(n.headline))) continue;
    const text = `${n.headline} ${n.summary ?? ""}`;
    const rule = NEWS_RULES.find((r) => r.re.test(text));
    if (rule) add({ kind: rule.kind, atRisk: rule.atRisk, title: n.headline, url: n.url, eventDate: n.date });
  }

  // New funding rounds.
  const seenFunding = new Set((prev.funding ?? []).map((f) => f.url ?? key(`${f.round} ${f.amount} ${f.date}`)));
  for (const f of next.funding ?? []) {
    const id = f.url ?? key(`${f.round} ${f.amount} ${f.date}`);
    if (seenFunding.has(id) || !f.url) continue;
    add({ kind: "funding", atRisk: false, title: [f.round, f.amount].filter(Boolean).join(", ") || "New funding", url: f.url, eventDate: f.date });
  }

  // New acquisitions (from the corporate-actions list).
  const seenActions = new Set((prev.corporateActions ?? []).map((a) => a.url));
  for (const a of next.corporateActions ?? []) {
    if (a.kind !== "Acquisition" || seenActions.has(a.url)) continue;
    add({ kind: "acquisition", atRisk: true, title: `Acquisition: ${a.name}`, url: a.url, eventDate: a.date });
  }

  // New, non-routine court cases.
  const seenCases = new Set((prev.courtCases ?? []).map((c) => c.url));
  for (const c of next.courtCases ?? []) {
    if (c.routine || seenCases.has(c.url)) continue;
    add({ kind: "lawsuit", atRisk: true, title: c.caseType ? `${c.caption} (${c.caseType})` : c.caption, url: c.url, eventDate: c.filed });
  }

  // New federal awards, cited to the report's USAspending source.
  const spendingUrl = (next.sources ?? []).find((s) => s.usedFor.includes("federal-spending"))?.url;
  const awardKey = (a: NonNullable<Bundle["federalSpending"]>[number]) => a.awardId ?? key(`${a.awardingAgency} ${a.amount} ${a.date}`);
  const seenAwards = new Set((prev.federalSpending ?? []).map(awardKey));
  for (const a of next.federalSpending ?? []) {
    if (seenAwards.has(awardKey(a)) || !spendingUrl) continue;
    const what = [a.amount, a.awardType?.toLowerCase(), a.awardingAgency ? `from ${a.awardingAgency}` : ""].filter(Boolean).join(" ");
    add({ kind: "federal_award", atRisk: false, title: what || "New federal award", url: spendingUrl, eventDate: a.date });
  }

  // Tech stack: vendors added or dropped. When either report couldn't read
  // the homepage, only DNS-backed items are compared, so a blocked page
  // doesn't read as "dropped Google Tag Manager".
  if (prev.techStack && next.techStack) {
    const dnsOnly = !!prev.techStack.websiteUnavailable || !!next.techStack.websiteUnavailable;
    // Subdomain finds never trigger: which subdomains the certificate logs
    // return, and which get looked up, varies from run to run (Patagonia's
    // Shopify store showed once, not the next time), so a change there
    // isn't a change at the company.
    const usable = (items: NonNullable<Bundle["techStack"]>["items"]) => items.filter((i) =>
      i.confidence !== "likely"
      && i.layer !== "subdomain"
      && (!dnsOnly || i.layer !== "website"));
    const before = usable(prev.techStack.items);
    const after = usable(next.techStack.items);
    const had = new Set(before.map((i) => i.vendor));
    const has = new Set(after.map((i) => i.vendor));
    for (const i of after) {
      if (had.has(i.vendor)) continue;
      const competitor = matchesCompetitor(i.vendor, competitors);
      add({
        kind: competitor ? "competitor_adopted" : "tech_added",
        atRisk: competitor,
        title: competitor ? `Started using ${i.vendor}, a competitor you replace` : `Started using ${i.vendor} (${i.category})`,
        url: i.sourceUrl,
      });
    }
    for (const i of before) {
      if (has.has(i.vendor)) continue;
      add({ kind: "tech_removed", atRisk: false, title: `No longer shows ${i.vendor} (${i.category})`, url: i.sourceUrl });
    }
  }

  // Hiring for a tool (FEATURE_JOB_POSTINGS): a posting names a tool that
  // neither the last report's postings nor its tech stack showed. Only when
  // both reports read the job board, so a first read isn't a change; a
  // closed posting never triggers (it says nothing about dropping a tool).
  if (prev.techStack?.jobBoards && next.techStack?.jobBoards) {
    const known = new Set([
      ...prev.techStack.items.map((i) => i.vendor.toLowerCase()),
      ...prev.techStack.jobBoards.flatMap((b) => b.postings.flatMap((p) => p.tools ?? [])).map((t) => t.toLowerCase()),
    ]);
    for (const b of next.techStack.jobBoards) {
      for (const p of b.postings) {
        for (const tool of p.tools ?? []) {
          if (known.has(tool.toLowerCase())) continue;
          known.add(tool.toLowerCase());
          const competitor = matchesCompetitor(tool, competitors);
          add({
            kind: "hiring_tool",
            atRisk: competitor,
            title: `Started hiring for ${tool}${competitor ? ", a competitor you replace" : ""} (${p.title})`,
            url: p.url,
            eventDate: p.postedAt?.slice(0, 10),
          });
        }
      }
    }
  }

  return out;
}
