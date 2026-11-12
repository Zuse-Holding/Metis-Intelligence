/**
 * What to say (ABM brief §1, minimum version): an opening line and the most
 * likely objection, with a suggested response, built only from findings the
 * report already has. Fixed templates, no generated text, so nothing can be
 * said about the account that a finding doesn't back.
 *
 * Rule: no evidence, no line. Every line carries the findings it rests on,
 * each with its source link; if no finding qualifies, the line is left out.
 *
 * Pure, so it's unit-tested directly. Weak spots arrive later (the Sales tab
 * loads them on request), so the result is recomputed when they do.
 */
import { isCompetitor, whyNow, type SalesBundle, type SellerOffer, type WhyNowItem } from "./sales";

export interface Evidence { label: string; url: string }

export interface Line {
  text: string;
  /** The findings the line rests on. Never empty. */
  evidence: Evidence[];
}

export interface Objection {
  /** In the buyer's words. */
  objection: string;
  /** Why we expect it: the findings behind the objection. Never empty. */
  evidence: Evidence[];
  response: string;
  /** Findings the response itself cites, if any. */
  responseEvidence: Evidence[];
}

export interface Outreach { opener?: Line; objection?: Objection }

/** A vendor's recent bad news, as /api/displacement/weak-spots returns it. */
export interface WeakSpot { kind: string; title: string; url: string; date: string; outlet?: string }

const WEAK_SPOT_PHRASES: Record<string, string> = {
  price_increase: "a price increase",
  outage: "an outage",
  layoffs: "layoffs",
  acquisition: "an acquisition",
  sunset: "retiring a product",
  security: "a security incident",
  lawsuit: "a lawsuit",
};

// Same patterns as src/lib/account-triggers.ts (the web app can't import from src/).
const BUDGET_RE = /\b(lay ?offs?|lays off|laid off|job cuts|cuts? \d[\d,]* jobs|cutting jobs|workforce reduction|reduction in force|hiring freeze|budget cuts?|cost[- ]cutting|spending freeze|cuts? spending|austerity)\b/i;
const EXPANSION_RE = /\b(opens|opening|expands?|expansion|new (office|plant|facility|headquarters|location|warehouse)|to hire|hiring \d|breaks ground)\b/i;

const isoToShort = (iso: string) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

const ev = (label: string, url: string | undefined): Evidence[] => (url && /^https?:\/\//.test(url) ? [{ label, url }] : []);
const fromEvent = (e: WhyNowItem): Evidence[] => ev(e.sourceName ? `${e.kind}, ${e.sourceName}` : e.kind, e.url);
const headline = (e: WhyNowItem) => `“${e.text}”${e.sourceName ? ` (${e.sourceName}, ${e.date})` : ` (${e.date})`}`;

/** Confirmed (not "likely") tools that are the seller's competitors. */
function competitorTools(b: SalesBundle, offer: SellerOffer | null) {
  if (!offer?.competitors.length) return [];
  return (b.techStack?.items ?? []).filter((i) => i.confidence !== "likely" && isCompetitor(i.vendor, offer.competitors) && /^https?:\/\//.test(i.sourceUrl));
}

/** The most recent weak spot for a vendor, if one was loaded. */
function latestSpot(vendor: string, weakSpots: Record<string, WeakSpot[]>): WeakSpot | undefined {
  return [...(weakSpots[vendor] ?? [])].filter((w) => /^https?:\/\//.test(w.url)).sort((a, b) => b.date.localeCompare(a.date))[0];
}

const spotEvidence = (vendor: string, w: WeakSpot) => ev(`${vendor} in the news${w.outlet ? `, ${w.outlet}` : ""}`, w.url);
const spotText = (vendor: string, w: WeakSpot) => `${vendor} was in the news for ${WEAK_SPOT_PHRASES[w.kind] ?? "trouble"} (“${w.title}”, ${isoToShort(w.date)})`;

/**
 * The opening line, from the strongest finding, in this order: a competitor
 * they run that's had bad news; a federal contract ending; a funding round;
 * a competitor they run; an acquisition; other news; a federal award.
 */
export function openingLine(b: SalesBundle, offer: SellerOffer | null, weakSpots: Record<string, WeakSpot[]> = {}, now = new Date()): Line | undefined {
  const events = whyNow(b, now);
  const first = (kind: WhyNowItem["kind"]) => events.find((e) => e.kind === kind);
  const tools = competitorTools(b, offer);

  for (const t of tools) {
    const w = latestSpot(t.vendor, weakSpots);
    if (w) return { text: `I saw that you run ${t.vendor}, and that ${spotText(t.vendor, w)}.`, evidence: [...ev(`Tech stack, ${t.sourceName}`, t.sourceUrl), ...spotEvidence(t.vendor, w)] };
  }
  const ending = first("Contract ending");
  if (ending) return { text: `I saw that your ${ending.text} (${ending.date}).`, evidence: fromEvent(ending) };
  const funding = first("Funding");
  if (funding) return { text: `Congratulations on the ${funding.text} (${funding.date}).`, evidence: fromEvent(funding) };
  const tool = tools[0];
  if (tool) return { text: `I saw that you run ${tool.vendor} for ${tool.category.toLowerCase()}.`, evidence: ev(`Tech stack, ${tool.sourceName}`, tool.sourceUrl) };
  const acq = first("Acquisition");
  if (acq) return { text: `I saw the news about the ${acq.text} acquisition (${acq.date}).`, evidence: fromEvent(acq) };
  const news = first("News");
  if (news) return { text: `I saw the news: ${headline(news)}.`, evidence: fromEvent(news) };
  const award = first("Federal award");
  if (award) return { text: `I saw the ${award.text} (${award.date}).`, evidence: fromEvent(award) };
  return undefined;
}

/**
 * Likely objections, most likely first. Each fires only on a finding that
 * makes it likely: a competitor they run ("we already use X"), budget or
 * layoff news ("no budget"), an acquisition ("we're integrating"), or a
 * funding round or expansion that makes the timing fair to raise ("not a
 * priority").
 */
export function objections(b: SalesBundle, offer: SellerOffer | null, weakSpots: Record<string, WeakSpot[]> = {}, now = new Date()): Objection[] {
  const events = whyNow(b, now);
  const out: Objection[] = [];

  const tool = competitorTools(b, offer)[0];
  if (tool) {
    const w = latestSpot(tool.vendor, weakSpots);
    out.push({
      objection: `We already use ${tool.vendor}.`,
      evidence: ev(`Tech stack, ${tool.sourceName}`, tool.sourceUrl),
      response: w
        ? `Understood. It may be worth comparing before your next renewal: ${spotText(tool.vendor, w)}.`
        : `Understood. Would a side-by-side with ${tool.vendor} be useful?`,
      responseEvidence: w ? spotEvidence(tool.vendor, w) : [],
    });
  }

  const tight = events.find((e) => e.kind === "News" && BUDGET_RE.test(e.text));
  if (tight) {
    out.push({
      objection: "We don't have the budget right now.",
      evidence: fromEvent(tight),
      response: `Understood, and I saw ${headline(tight)}. Would it help to look at the cost against what it would save you?`,
      responseEvidence: fromEvent(tight),
    });
  }

  const acq = events.find((e) => e.kind === "Acquisition");
  if (acq) {
    out.push({
      objection: "We're in the middle of an integration, so not now.",
      evidence: fromEvent(acq),
      response: `Makes sense with the ${acq.text} acquisition (${acq.date}). Could we talk once that integration settles, say next quarter?`,
      responseEvidence: fromEvent(acq),
    });
  }

  const moment = events.find((e) => e.kind === "Funding" || (e.kind === "News" && EXPANSION_RE.test(e.text)));
  if (moment) {
    const what = moment.kind === "News" ? headline(moment) : `the ${moment.text} (${moment.date})`;
    out.push({
      objection: "It's not a priority right now.",
      evidence: fromEvent(moment),
      response: `Understood. With ${what}, it seemed like a good moment to ask. Would next quarter be better?`,
      responseEvidence: fromEvent(moment),
    });
  }

  return out.filter((o) => o.evidence.length > 0);
}

/** The opening line and the top objection; either is absent without evidence. */
export function outreach(b: SalesBundle, offer: SellerOffer | null, weakSpots: Record<string, WeakSpot[]> = {}, now = new Date()): Outreach {
  const opener = openingLine(b, offer, weakSpots, now);
  return {
    opener: opener && opener.evidence.length > 0 ? opener : undefined,
    objection: objections(b, offer, weakSpots, now)[0],
  };
}

/** Plain-text lines for "Copy for outreach", each ending with its links. */
export function outreachLines(o: Outreach): string[] {
  const links = (e: Evidence[]) => `(${e.map((x) => x.url).join(", ")})`;
  const lines: string[] = [];
  if (o.opener) lines.push("", "Opening line:", `- ${o.opener.text} ${links(o.opener.evidence)}`);
  if (o.objection) {
    const all = [...o.objection.evidence, ...o.objection.responseEvidence.filter((r) => !o.objection!.evidence.some((e) => e.url === r.url))];
    lines.push("", "Likely objection:", `- "${o.objection.objection}" Suggested response: ${o.objection.response} ${links(all)}`);
  }
  return lines;
}
