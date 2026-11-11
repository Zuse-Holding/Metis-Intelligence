import type { ResearchBundle } from "../types/research.js";

/**
 * Buyer intent v1: buying signals found in a saved account's reports, each
 * cited. Pure. The agent server stores them on the account when a report on
 * it finishes; the web app works out low / medium / high at read time
 * (web/lib/intent.ts), since "ends in 5 months" changes with the date and
 * SAM.gov solicitations are matched there.
 *
 *   contract_ending  a federal contract (not a grant) with an end date ahead
 *   stated_plan      news saying the company plans to buy, replace or modernize
 *   tech_change      a DNS-backed vendor added or dropped between two reports
 *                    (subdomain and "likely" items vary run to run, and the
 *                    homepage can be blocked, so neither counts)
 */

export type IntentSignalKind = "contract_ending" | "stated_plan" | "tech_change";

export interface IntentSignal {
  kind: IntentSignalKind;
  title: string;
  url: string;
  /** ISO date (YYYY-MM-DD where the source gives one): the end date for a
   *  contract, the publication date for news, when it was seen for tech. */
  date: string;
}

type Bundle = Partial<Pick<ResearchBundle, "news" | "federalSpending" | "sources" | "techStack">>;

const DAY = 86_400_000;
/** Contracts ending further out than this aren't stored. */
export const CONTRACT_HORIZON_DAYS = 548; // 18 months
/** News older than this isn't a current plan. */
export const PLAN_WINDOW_DAYS = 180;
/** Tech changes are kept this long across reports. */
export const TECH_WINDOW_DAYS = 90;
const MAX_SIGNALS = 30;

const GRANT = /grant|assistance|cooperative/i;

// A company saying it will buy, replace or modernize something. Headline
// and summary only; every match is shown with its article, so a false hit
// is visible and checkable.
export const PLAN_RE = new RegExp(
  "\\b(" + [
    "plans? to (buy|invest|spend|build|deploy|replace|upgrade|moderni[sz]e|migrate|adopt|overhaul|expand)",
    "planning to (buy|invest|spend|build|deploy|replace|upgrade|moderni[sz]e|migrate|adopt|overhaul|expand)",
    "will (invest|spend|deploy|replace|upgrade|moderni[sz]e|migrate|overhaul)",
    "to invest \\$",
    "moderni[sz](ation|ing|es) (its|their|of)",
    "digital transformation",
    "(migrat(e|es|ing|ion)|mov(e|es|ing)) to (the )?cloud",
    "replac(e|es|ing) (its|their) (legacy|existing|current|old)",
    "requests? for proposals?",
    "\\bRFP\\b",
    "issued an? (rfp|solicitation|tender|request for)",
    "seeking (a |an )?(new )?(vendor|partner|supplier|provider)s?",
    "evaluating (vendors|providers|suppliers|options)",
    "capital (improvement )?(plan|program|budget)",
  ].join("|") + ")",
  "i",
);

function parseDay(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const sameSignal = (a: IntentSignal, b: IntentSignal) => a.kind === b.kind && a.title === b.title;

/**
 * Signals in `next`, plus DNS tech changes since `prev` when there is one.
 * `kept` are the account's stored signals: tech changes younger than
 * TECH_WINDOW_DAYS carry over (a later report no longer sees the change);
 * everything else is re-read from the latest report.
 */
export function intentSignals(next: Bundle, prev: Bundle | undefined, kept: IntentSignal[] = [], now = new Date()): IntentSignal[] {
  const out: IntentSignal[] = [];
  const add = (s: IntentSignal) => {
    if (!s.url || !s.title.trim()) return;
    if (!out.some((o) => sameSignal(o, s))) out.push({ ...s, title: s.title.trim().slice(0, 300) });
  };

  // Federal contracts ending soon, cited to the report's USAspending source.
  const spendingUrl = (next.sources ?? []).find((s) => s.usedFor.includes("federal-spending"))?.url;
  if (spendingUrl) {
    for (const a of next.federalSpending ?? []) {
      if (GRANT.test(a.awardType ?? "")) continue;
      const end = parseDay(a.endDate);
      if (!end || end.getTime() < now.getTime() || end.getTime() > now.getTime() + CONTRACT_HORIZON_DAYS * DAY) continue;
      const what = [a.amount, "contract", a.awardingAgency ? `with ${a.awardingAgency}` : ""].filter(Boolean).join(" ");
      add({ kind: "contract_ending", title: `${what} ends ${isoDay(end)}`, url: spendingUrl, date: isoDay(end) });
    }
  }

  // Stated plans in recent news.
  for (const n of next.news ?? []) {
    if (n.solicitation || !n.url) continue;
    const when = parseDay(n.date);
    if (!when || now.getTime() - when.getTime() > PLAN_WINDOW_DAYS * DAY || when.getTime() > now.getTime() + DAY) continue;
    if (!PLAN_RE.test(`${n.headline} ${n.summary ?? ""}`)) continue;
    add({ kind: "stated_plan", title: n.headline, url: n.url, date: isoDay(when) });
  }

  // DNS-backed tech stack changes between the two reports.
  if (prev?.techStack && next.techStack) {
    const dns = (items: NonNullable<Bundle["techStack"]>["items"]) => items.filter((i) => i.layer === "dns" && i.confidence !== "likely");
    const before = dns(prev.techStack.items);
    const after = dns(next.techStack.items);
    const had = new Set(before.map((i) => i.vendor));
    const has = new Set(after.map((i) => i.vendor));
    for (const i of after) if (!had.has(i.vendor)) add({ kind: "tech_change", title: `Started using ${i.vendor} (${i.category})`, url: i.sourceUrl, date: isoDay(now) });
    for (const i of before) if (!has.has(i.vendor)) add({ kind: "tech_change", title: `No longer shows ${i.vendor} (${i.category})`, url: i.sourceUrl, date: isoDay(now) });
  }

  for (const s of kept) {
    if (s.kind !== "tech_change") continue;
    const seen = parseDay(s.date);
    if (!seen || now.getTime() - seen.getTime() > TECH_WINDOW_DAYS * DAY) continue;
    if (!out.some((o) => sameSignal(o, s))) out.push(s);
  }

  return out.slice(0, MAX_SIGNALS);
}

/** Stored signals as read back from JSONB; anything malformed is dropped. */
export function parseIntentSignals(value: unknown): IntentSignal[] {
  if (!Array.isArray(value)) return [];
  const kinds: IntentSignalKind[] = ["contract_ending", "stated_plan", "tech_change"];
  return value.filter((v): v is IntentSignal =>
    !!v && typeof v === "object"
    && kinds.includes((v as IntentSignal).kind)
    && typeof (v as IntentSignal).title === "string"
    && typeof (v as IntentSignal).url === "string"
    && typeof (v as IntentSignal).date === "string");
}
