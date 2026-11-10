/**
 * The Sales tab (ABM brief, Nov 2026): a company report seen as a seller sees
 * it. Everything here reorders data the report already has; nothing is
 * generated, and every line keeps the source it came from. Items without a
 * date (for "why now") or without a source are left out, never shown bare.
 *
 * Pure functions over a subset of the report bundle, so they're unit-tested
 * directly. The bundle shape is src/types/research.ts's ResearchBundle.
 */

// ── The parts of the report bundle the tab reads ─────────────────────────────

export interface SalesBundle {
  company?: {
    name?: string;
    description?: string;
    summary?: string;
    website?: string;
    founded?: string;
    headquarters?: string;
    industry?: string;
    entityType?: string;
    stockListing?: string;
  };
  ownership?: string;
  leadership?: { name: string; title: string; sourceUrl?: string; lowConfidence?: boolean }[];
  news?: { headline: string; date?: string; url?: string; outlet?: string; solicitation?: boolean }[];
  funding?: { round?: string; amount?: string; date?: string; url?: string; investors?: string[] }[];
  corporateActions?: { kind: string; name: string; date?: string; url: string }[];
  courtCases?: { caption: string; filed?: string; url: string; routine?: boolean; caseType?: string }[];
  federalSpending?: { awardingAgency?: string; amount?: string; date?: string; awardType?: string; description?: string }[];
  sources?: { url: string; title?: string; usedFor: string[] }[];
  techStack?: {
    domain: string;
    items: { vendor: string; category: string; confidence: string; evidence: string; sourceName: string; sourceUrl: string }[];
    websiteUnavailable?: string;
  };
}

// ── What the user sells ──────────────────────────────────────────────────────

export interface SellerOffer {
  /** What you sell, as an outcome ("cuts AP processing time"). */
  offering: string;
  /** Vendors you replace, named as the tech stack names them. */
  competitors: string[];
  /** Who you sell to (industry, size, buyer role). */
  targetCustomers: string;
}

export const MAX_OFFERING = 300;
export const MAX_TARGET = 300;
export const MAX_COMPETITORS = 20;
export const MAX_COMPETITOR_NAME = 80;

const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** Validates a save from the browser. */
export function parseSellerOffer(body: unknown): { ok: true; offer: SellerOffer } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Nothing to save." };
  const b = body as Record<string, unknown>;
  if (typeof b.offering !== "string" || typeof b.targetCustomers !== "string" || !Array.isArray(b.competitors)) {
    return { ok: false, error: "Fill in what you sell, who you sell to and who you compete with." };
  }
  const offering = oneLine(b.offering);
  const targetCustomers = oneLine(b.targetCustomers);
  if (!offering) return { ok: false, error: "Say what you sell." };
  if (offering.length > MAX_OFFERING) return { ok: false, error: `What you sell can be at most ${MAX_OFFERING} characters.` };
  if (targetCustomers.length > MAX_TARGET) return { ok: false, error: `Who you sell to can be at most ${MAX_TARGET} characters.` };
  const competitors: string[] = [];
  for (const c of b.competitors) {
    if (typeof c !== "string") return { ok: false, error: "Competitors must be names." };
    const name = oneLine(c);
    if (!name) continue;
    if (name.length > MAX_COMPETITOR_NAME) return { ok: false, error: `A competitor name can be at most ${MAX_COMPETITOR_NAME} characters.` };
    if (!competitors.some((x) => x.toLowerCase() === name.toLowerCase())) competitors.push(name);
  }
  if (competitors.length > MAX_COMPETITORS) return { ok: false, error: `List at most ${MAX_COMPETITORS} competitors.` };
  return { ok: true, offer: { offering, competitors, targetCustomers } };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Whether a detected vendor is one of the user's competitors. Whole-word
 * match either way round, so "Salesforce" matches "Salesforce Marketing
 * Cloud (Pardot)" and "Microsoft 365" matches "Microsoft 365", but "Box"
 * doesn't match "Dropbox".
 */
export function isCompetitor(vendor: string, competitors: string[]): boolean {
  const v = ` ${norm(vendor)} `;
  return competitors.some((c) => {
    const n = norm(c);
    return n.length > 0 && (v.includes(` ${n} `) || ` ${n} `.includes(v));
  });
}

// ── Why now ──────────────────────────────────────────────────────────────────

export type WhyNowKind = "News" | "Funding" | "Acquisition" | "Subsidiary or brand" | "Court case" | "Federal award";

export interface WhyNowItem {
  kind: WhyNowKind;
  date: string;
  /** ISO date, for sorting. */
  at: string;
  text: string;
  url: string;
  sourceName?: string;
}

const DAY = 86_400_000;
export const WHY_NOW_WINDOW_DAYS = 365;
export const WHY_NOW_LIMIT = 12;

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Dated, sourced events from the last year, newest first: news (not law-firm
 * solicitations), funding, acquisitions, non-routine court cases and federal
 * awards. Federal awards cite the report's USAspending source.
 */
export function whyNow(b: SalesBundle, now = new Date()): WhyNowItem[] {
  const cutoff = now.getTime() - WHY_NOW_WINDOW_DAYS * DAY;
  const items: WhyNowItem[] = [];
  const add = (kind: WhyNowKind, date: string | undefined, text: string, url: string | undefined, sourceName?: string) => {
    const d = parseDate(date);
    if (!d || !url || !text.trim()) return;
    if (d.getTime() < cutoff || d.getTime() > now.getTime() + DAY) return;
    items.push({ kind, date: shortDate(d), at: d.toISOString(), text: text.trim(), url, sourceName });
  };

  for (const n of b.news ?? []) if (!n.solicitation) add("News", n.date, n.headline, n.url, n.outlet);
  for (const f of b.funding ?? []) {
    const what = [f.round, f.amount].filter(Boolean).join(", ") || "Funding round";
    add("Funding", f.date, f.investors?.length ? `${what} from ${f.investors.slice(0, 3).join(", ")}` : what, f.url);
  }
  for (const a of b.corporateActions ?? []) {
    add(a.kind === "Acquisition" ? "Acquisition" : "Subsidiary or brand", a.date, a.name, a.url);
  }
  for (const c of b.courtCases ?? []) if (!c.routine) add("Court case", c.filed, c.caseType ? `${c.caption} (${c.caseType})` : c.caption, c.url);
  const spending = (b.sources ?? []).find((s) => s.usedFor.includes("federal-spending"));
  for (const f of b.federalSpending ?? []) {
    const text = [f.amount, f.awardType?.toLowerCase(), f.awardingAgency ? `from ${f.awardingAgency}` : ""].filter(Boolean).join(" ");
    add("Federal award", f.date, text || "Federal award", spending?.url, "USAspending.gov");
  }

  const seen = new Set<string>();
  return items
    .filter((i) => { const k = `${i.kind}|${i.text.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b2) => b2.at.localeCompare(a.at))
    .slice(0, WHY_NOW_LIMIT);
}

// ── Who to contact ───────────────────────────────────────────────────────────

export interface Contact { name: string; title: string; url: string }

/** Leaders the report found, each with where it says so. Low-confidence
 *  entries and ones with nowhere to cite are left out. */
export function contacts(b: SalesBundle): Contact[] {
  const fallback = b.company?.website;
  const out: Contact[] = [];
  for (const l of b.leadership ?? []) {
    if (l.lowConfidence) continue;
    const url = l.sourceUrl ?? fallback;
    if (!url || !l.name.trim() || !l.title.trim()) continue;
    if (out.some((c) => c.name.toLowerCase() === l.name.toLowerCase())) continue;
    out.push({ name: l.name.trim(), title: l.title.trim(), url });
  }
  return out;
}

// ── Account snapshot ─────────────────────────────────────────────────────────

export interface SnapshotRow { label: string; value: string }

export function snapshot(b: SalesBundle): { summary?: string; rows: SnapshotRow[] } {
  const c = b.company ?? {};
  const rows: SnapshotRow[] = [];
  if (c.industry) rows.push({ label: "Industry", value: c.industry });
  if (c.headquarters) rows.push({ label: "Headquarters", value: c.headquarters });
  if (c.founded) rows.push({ label: "Founded", value: c.founded });
  if (b.ownership) rows.push({ label: "Ownership", value: b.ownership });
  else if (c.stockListing) rows.push({ label: "Listed", value: c.stockListing });
  if (c.website) rows.push({ label: "Website", value: c.website });
  return { summary: c.summary ?? c.description, rows };
}

// ── Copy for outreach ────────────────────────────────────────────────────────

/**
 * A plain-text brief to paste into an email tool or AI SDR: why now, the
 * tech stack (competitors marked) and who to contact, every line with its
 * source link.
 */
export function outreachBrief(subject: string, b: SalesBundle, offer: SellerOffer | null, now = new Date()): string {
  const lines: string[] = [`${subject} — account brief (Metis Intelligence, ${shortDate(now)})`];
  const events = whyNow(b, now);
  if (events.length) {
    lines.push("", "Why now:");
    for (const e of events) lines.push(`- ${e.date}: ${e.text} (${e.url})`);
  }
  const tools = b.techStack?.items ?? [];
  if (tools.length) {
    lines.push("", "Tech stack:");
    const comp = offer?.competitors ?? [];
    const sorted = [...tools].sort((x, y) => Number(isCompetitor(y.vendor, comp)) - Number(isCompetitor(x.vendor, comp)));
    for (const t of sorted) {
      lines.push(`- ${t.vendor} (${t.category})${isCompetitor(t.vendor, comp) ? " — a competitor you replace" : ""}: ${t.evidence} (${t.sourceUrl})`);
    }
  }
  const people = contacts(b);
  if (people.length) {
    lines.push("", "Who to contact:");
    for (const p of people) lines.push(`- ${p.name}, ${p.title} (${p.url})`);
  }
  if (offer) lines.push("", `What we sell: ${offer.offering}`);
  return lines.join("\n");
}
