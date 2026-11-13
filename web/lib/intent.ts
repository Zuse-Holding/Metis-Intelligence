/**
 * Buyer intent v1, web side. Pure. The agent server stores each saved
 * account's buying signals (src/lib/buyer-intent.ts; the web app can't
 * import from src/, so the shape is repeated here); this works out
 * low / medium / high at read time, adds open SAM.gov solicitations from
 * the account when it's the posting agency, and matches solicitations to
 * the seller's NAICS codes and keywords for "Shopping now".
 *
 * Every reason carries its source link. The level is never shown alone.
 */
import { isCompetitor } from "./sales";

export interface IntentSignal {
  kind: "contract_ending" | "stated_plan" | "tech_change" | "hiring";
  title: string;
  url: string;
  date: string;
  /** For hiring: the tools the posting names. */
  tools?: string[];
}

/** What the seller sells, for matching open roles. */
export interface OfferMatch { keywords: string[]; competitors: string[] }

export interface Opportunity {
  noticeId: string;
  title: string;
  solicitationNumber: string | null;
  noticeType: string;
  /** "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP", top level first. */
  agencyPath: string;
  naicsCode: string | null;
  setAside: string | null;
  postedDate: string;
  responseDeadline: string | null;
  url: string;
}

export type IntentLevel = "high" | "medium" | "low";

export const INTENT_LABELS: Record<IntentLevel, string> = {
  high: "High intent",
  medium: "Medium intent",
  low: "Low intent",
};

export type IntentReasonKind = "rfp" | IntentSignal["kind"];

export const INTENT_REASON_LABELS: Record<IntentReasonKind, string> = {
  rfp: "Open solicitation",
  contract_ending: "Contract ending",
  stated_plan: "Stated plan",
  tech_change: "Tech stack change",
  hiring: "Hiring",
};

export interface IntentReason {
  kind: IntentReasonKind;
  text: string;
  url: string;
  /** ISO date: deadline, end date, publication or when seen. */
  date: string | null;
  sourceName: string;
}

export interface Intent { level: IntentLevel; reasons: IntentReason[] }

const DAY = 86_400_000;
export const HIGH_AT = 5;
export const MEDIUM_AT = 2;

function parseDay(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function monthsUntil(end: Date, now: Date): number {
  let m = (end.getUTCFullYear() - now.getUTCFullYear()) * 12 + (end.getUTCMonth() - now.getUTCMonth());
  if (end.getUTCDate() < now.getUTCDate()) m -= 1;
  return m;
}

const sourceFor: Record<IntentSignal["kind"], string> = {
  contract_ending: "USAspending.gov",
  stated_plan: "News",
  tech_change: "Public DNS",
  hiring: "Job posting",
};

/**
 * Points: an open solicitation from the account 3; a contract ending within
 * 6 months 3, within 12 months 2, later 1; each stated plan 2 (at most two
 * count); each DNS tech change 1 (at most two count); each open role that
 * matches what the seller sells 2 (at most two count). High at 5, medium
 * at 2. A contract that has already ended, or a deadline that has passed,
 * drops out. An open role that doesn't match (no keyword in its title, no
 * competitor named) isn't shown at all.
 */
export function scoreIntent(signals: IntentSignal[], rfps: Opportunity[], now = new Date(), offer?: OfferMatch): Intent {
  const reasons: (IntentReason & { points: number })[] = [];

  for (const o of rfps) {
    const due = parseDay(o.responseDeadline);
    if (due && due.getTime() < now.getTime()) continue;
    reasons.push({
      kind: "rfp",
      text: `${o.noticeType}: ${o.title}${due ? `, responses due ${due.toISOString().slice(0, 10)}` : ""}`,
      url: o.url,
      date: due ? due.toISOString().slice(0, 10) : o.postedDate,
      sourceName: "SAM.gov",
      points: 3,
    });
  }

  let plans = 0;
  let tech = 0;
  let roles = 0;
  for (const s of signals) {
    let points = 0;
    let text = s.title;
    if (s.kind === "hiring") {
      const hit = hiringMatch(s, offer);
      if (!hit) continue;
      points = roles++ < 2 ? 2 : 0;
      text = `Hiring: ${s.title}${hit.competitor ? `, names ${hit.competitor}, a competitor you replace` : ""}`;
    } else if (s.kind === "contract_ending") {
      const end = parseDay(s.date);
      if (!end || end.getTime() < now.getTime()) continue;
      const m = monthsUntil(end, now);
      points = m < 6 ? 3 : m < 12 ? 2 : 1;
      text = s.title.replace(/ ends \d{4}-\d{2}-\d{2}$/, "") + ` ends in ${m < 1 ? "under a month" : m === 1 ? "1 month" : `${m} months`}`;
    } else if (s.kind === "stated_plan") {
      points = plans++ < 2 ? 2 : 0;
    } else {
      points = tech++ < 2 ? 1 : 0;
    }
    reasons.push({ kind: s.kind, text, url: s.url, date: s.date, sourceName: sourceFor[s.kind], points });
  }

  const total = reasons.reduce((n, r) => n + r.points, 0);
  const level: IntentLevel = total >= HIGH_AT ? "high" : total >= MEDIUM_AT ? "medium" : "low";
  return {
    level,
    reasons: reasons
      .sort((a, b) => b.points - a.points || (a.date ?? "").localeCompare(b.date ?? ""))
      .map(({ points: _p, ...r }) => r),
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * An open role matches what the seller sells when a keyword is a whole
 * word in its title ("ERP Implementation Lead" for "ERP implementation"),
 * or the posting names a tool the seller replaces.
 */
export function hiringMatch(s: Pick<IntentSignal, "title" | "tools">, offer: OfferMatch | undefined): { competitor?: string } | null {
  if (!offer) return null;
  const competitor = (s.tools ?? []).find((t) => isCompetitor(t, offer.competitors));
  if (competitor) return { competitor };
  const title = words(s.title);
  return offer.keywords.some((k) => { const w = words(k); return w.trim().length > 0 && title.includes(w); }) ? {} : null;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** A shorter NAICS code covers every code under it; keywords match whole words in the title. */
export function matchesOffer(o: Pick<Opportunity, "title" | "naicsCode">, naicsCodes: string[], keywords: string[]): boolean {
  if (o.naicsCode && naicsCodes.some((c) => o.naicsCode!.startsWith(c))) return true;
  const title = words(o.title);
  return keywords.some((k) => {
    const w = words(k);
    return w.trim().length > 0 && title.includes(w);
  });
}

/** Agency names as SAM.gov spells them ("DEPT OF THE NAVY") and as people do ("Department of the Navy"). */
function agencyKey(s: string): string {
  return words(s)
    .replace(/ department /g, " dept ")
    .replace(/ and /g, " ")
    .replace(/ the /g, " ")
    .replace(/ us | u s | united states /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a saved account is the agency (or one of the offices) posting
 * the notice. Exact match on a level of the path, after normalising, so
 * "Navy" doesn't match every Navy office and a company never matches.
 */
export function isPostingAgency(company: string, agencyPath: string): boolean {
  const name = agencyKey(company.split("·")[0]);
  if (name.length < 3) return false;
  return agencyPath.split(".").some((level) => agencyKey(level) === name);
}

/** The levels of an agency path, for display: "Dept of Defense › Dept of the Navy › NAVSUP". */
export function agencyLevels(agencyPath: string): string[] {
  return agencyPath.split(".").map((s) => s.trim()).filter(Boolean);
}

/** The level a "Save as account" should use: the office's parent agency
 *  (second level) when there is one, else the top level. */
export function agencyToSave(agencyPath: string): string {
  const levels = agencyLevels(agencyPath);
  return levels[1] ?? levels[0] ?? agencyPath;
}
