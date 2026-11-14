/**
 * What to say (ABM brief §1): an opening email, call notes (three talking
 * points, two questions) and the likely objections with suggested
 * responses, built only from findings the report already has. Fixed templates, no generated text, so nothing can be
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

/** One sentence of the email. Facts about the account always carry evidence;
 *  the seller's own offer and the ask are about the seller, so carry none. */
export interface EmailSentence { text: string; evidence: Evidence[]; kind: "fact" | "offer" | "ask" }

export interface CallNotes { points: Line[]; questions: Line[] }

export interface Outreach {
  opener?: Line;
  /** The most likely objection (the first of `objections`). */
  objection?: Objection;
  /** 3 to 5 sentences, or absent when the report can't back that many. */
  email?: EmailSentence[];
  callNotes?: CallNotes;
  objections: Objection[];
}

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

  const ending = events.find((e) => e.kind === "Contract ending");
  if (ending) {
    out.push({
      objection: "We're locked into our current contract.",
      evidence: fromEvent(ending),
      response: `Understood. Your ${ending.text} (${ending.date}), so now is a good time to compare before it's renewed.`,
      responseEvidence: fromEvent(ending),
    });
  }

  return out.filter((o) => o.evidence.length > 0).slice(0, MAX_OBJECTIONS);
}

export const MAX_OBJECTIONS = 5;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A cited finding, worded for the email, a talking point and a question. */
interface Fact { key: string; email: string; point: string; question?: string; evidence: Evidence[] }

/** Every cited finding that can be said to the account, strongest first. */
function facts(b: SalesBundle, offer: SellerOffer | null, weakSpots: Record<string, WeakSpot[]>, now: Date): Fact[] {
  const out: Fact[] = [];
  const push = (f: Fact) => { if (f.evidence.length > 0 && !out.some((o) => o.key === f.key)) out.push(f); };

  for (const t of competitorTools(b, offer)) {
    const w = latestSpot(t.vendor, weakSpots);
    const stack = ev(`Tech stack, ${t.sourceName}`, t.sourceUrl);
    const what = t.category.toLowerCase();
    push({
      key: `tool:${t.vendor}`,
      email: w ? `I noticed you run ${t.vendor}, and ${spotText(t.vendor, w)}.` : `I noticed you run ${t.vendor} for ${what}.`,
      point: w ? `They run ${t.vendor} (${what}), a vendor you replace; ${spotText(t.vendor, w)}.` : `They run ${t.vendor} (${what}), a vendor you replace.`,
      question: `How is ${t.vendor} working for your ${what} today?`,
      evidence: w ? [...stack, ...spotEvidence(t.vendor, w)] : stack,
    });
  }
  for (const e of whyNow(b, now)) {
    const evidence = fromEvent(e);
    const key = `${e.kind}|${e.url}|${e.text}`;
    if (e.kind === "Contract ending") push({ key, email: `I also noticed your ${e.text} (${e.date}).`, point: `Their ${e.text} (${e.date}).`, question: "How are you approaching that contract's renewal?", evidence });
    else if (e.kind === "Funding") push({ key, email: `I also saw the ${e.text} (${e.date}).`, point: `Raised ${e.text} (${e.date}).`, question: "What are the priorities for the new funding?", evidence });
    else if (e.kind === "Acquisition") push({ key, email: `I also saw the ${e.text} acquisition (${e.date}).`, point: `Acquisition: ${e.text} (${e.date}).`, question: `How is the ${e.text} integration going?`, evidence });
    else if (e.kind === "News" && EXPANSION_RE.test(e.text)) push({ key, email: `I also saw ${headline(e)}.`, point: `Expanding: ${headline(e)}.`, question: "What does that expansion mean for your team?", evidence });
    else if (e.kind === "News") push({ key, email: `I also saw ${headline(e)}.`, point: `In the news: ${headline(e)}.`, evidence });
    else if (e.kind === "Federal award") push({ key, email: `I also saw the ${e.text} (${e.date}).`, point: `Federal award: ${e.text} (${e.date}).`, evidence });
  }
  // Open roles that name a vendor the seller replaces or one of their keywords.
  for (const board of b.techStack?.jobBoards ?? []) {
    for (const p of board.postings) {
      if (!/^https?:\/\//.test(p.url) || !p.title.trim()) continue;
      const tool = offer?.competitors.length ? (p.tools ?? []).find((t) => isCompetitor(t, offer.competitors)) : undefined;
      const keyword = offer?.keywords.find((k) => k.trim() && new RegExp(`\\b${escapeRe(k.trim())}\\b`, "i").test(p.title));
      if (!tool && !keyword) continue;
      push({
        key: `job:${p.url}`,
        email: `I saw you're hiring a ${p.title}.`,
        point: `Hiring: ${p.title}${tool ? `, a role that names ${tool}` : ""}.`,
        question: `What will the new ${p.title} take on first?`,
        evidence: ev(`Job posting, ${board.ats}`, p.url),
      });
    }
  }
  return out;
}

const shareSource = (a: Evidence[], b: Evidence[]) => a.some((x) => b.some((y) => y.url === x.url));

/**
 * The opening email: the opening line, a second finding, what the seller
 * does (their own words from "What you sell") and the ask. Left out unless
 * there's at least one sentence beyond the opener and the ask, so it's
 * always 3 to 4 sentences.
 */
export function openingEmail(b: SalesBundle, offer: SellerOffer | null, weakSpots: Record<string, WeakSpot[]> = {}, now = new Date()): EmailSentence[] | undefined {
  const opener = openingLine(b, offer, weakSpots, now);
  if (!opener || opener.evidence.length === 0) return undefined;
  const out: EmailSentence[] = [{ text: opener.text, evidence: opener.evidence, kind: "fact" }];
  const second = facts(b, offer, weakSpots, now).find((f) => !shareSource(f.evidence, opener.evidence));
  if (second) out.push({ text: second.email, evidence: second.evidence, kind: "fact" });
  const offering = offer?.offering.trim().replace(/[.\s]+$/, "");
  if (offering) out.push({ text: `What we do: ${offering}.`, evidence: [], kind: "offer" });
  if (out.length < 2) return undefined;
  const renewal = out.some((s) => s.kind === "fact" && /contract|you run/i.test(s.text));
  out.push({ text: renewal ? "Would 20 minutes to compare before your next renewal be useful?" : "Would a 20-minute call next week be useful?", evidence: [], kind: "ask" });
  return out;
}

/** Up to three talking points and two questions, each on a cited finding. */
export function callNotes(b: SalesBundle, offer: SellerOffer | null, weakSpots: Record<string, WeakSpot[]> = {}, now = new Date()): CallNotes | undefined {
  const all = facts(b, offer, weakSpots, now);
  const points = all.slice(0, 3).map((f) => ({ text: f.point, evidence: f.evidence }));
  const questions = all.filter((f) => f.question).slice(0, 2).map((f) => ({ text: f.question!, evidence: f.evidence }));
  return points.length || questions.length ? { points, questions } : undefined;
}

/** Everything to say; each part is absent without evidence. */
export function outreach(b: SalesBundle, offer: SellerOffer | null, weakSpots: Record<string, WeakSpot[]> = {}, now = new Date()): Outreach {
  const opener = openingLine(b, offer, weakSpots, now);
  const all = objections(b, offer, weakSpots, now);
  return {
    opener: opener && opener.evidence.length > 0 ? opener : undefined,
    objection: all[0],
    email: openingEmail(b, offer, weakSpots, now),
    callNotes: callNotes(b, offer, weakSpots, now),
    objections: all,
  };
}

/** Plain-text lines for "Copy for outreach", each ending with its links. */
export function outreachLines(o: Outreach): string[] {
  const links = (e: Evidence[]) => `(${e.map((x) => x.url).join(", ")})`;
  const cite = (text: string, e: Evidence[]) => (e.length ? `${text} ${links(e)}` : text);
  const lines: string[] = [];
  if (o.email) lines.push("", "Opening email:", ...o.email.map((s) => `- ${cite(s.text, s.evidence)}`));
  else if (o.opener) lines.push("", "Opening line:", `- ${o.opener.text} ${links(o.opener.evidence)}`);
  if (o.callNotes?.points.length) lines.push("", "Talking points:", ...o.callNotes.points.map((p) => `- ${p.text} ${links(p.evidence)}`));
  if (o.callNotes?.questions.length) lines.push("", "Questions to ask:", ...o.callNotes.questions.map((q) => `- ${q.text} ${links(q.evidence)}`));
  const objs = o.objections?.length ? o.objections : o.objection ? [o.objection] : [];
  if (objs.length) {
    lines.push("", objs.length === 1 ? "Likely objection:" : "Likely objections:");
    for (const x of objs) {
      const all = [...x.evidence, ...x.responseEvidence.filter((r) => !x.evidence.some((e) => e.url === r.url))];
      lines.push(`- "${x.objection}" Suggested response: ${x.response} ${links(all)}`);
    }
  }
  return lines;
}
