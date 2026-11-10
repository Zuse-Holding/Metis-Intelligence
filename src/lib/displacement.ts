import type { SearchResult } from "./providers.js";
import { mentionsCompany, newsDate } from "./news-noise.js";
import { VENDORS } from "../agents/tech-stack-agent/vendors.js";

/**
 * Competitive displacement and peer urgency (ABM brief §3). Pure pieces:
 *
 *   weakSpots      why a target might switch away from an incumbent vendor:
 *                  dated, cited news about that vendor (price increases,
 *                  outages, layoffs, acquisitions, product sunsets, security
 *                  incidents, lawsuits)
 *   peerDomain     a peer's own website from search results, or none: a
 *                  peer is only compared when its domain clearly is its own
 *   peerGaps       tools two or more of the target's peers use that the
 *                  target doesn't, each peer cited
 *
 * No model calls: headlines are classified by pattern, and nothing appears
 * without a source.
 */

export type WeakSpotKind = "price_increase" | "outage" | "layoffs" | "acquisition" | "sunset" | "security" | "lawsuit";

export const WEAK_SPOT_LABELS: Record<WeakSpotKind, string> = {
  price_increase: "Price increase",
  outage: "Outage",
  layoffs: "Layoffs",
  acquisition: "Acquisition",
  sunset: "Product retired",
  security: "Security incident",
  lawsuit: "Lawsuit",
};

const RULES: { kind: WeakSpotKind; re: RegExp }[] = [
  { kind: "price_increase", re: /\b(price (increase|hike|rise)s?|raises? (its )?prices|raising prices|pricing (change|overhaul)|more expensive|price jump)\b/i },
  { kind: "outage", re: /\b(outage|service disruption|went down|goes down|is down|downtime)\b/i },
  { kind: "security", re: /\b(breach|hacked|hack|ransomware|data leak|vulnerabilit(y|ies)|cyberattack)\b/i },
  { kind: "sunset", re: /\b(end[- ]of[- ]life|sunsets?|sunsetting|discontinu\w*|deprecat\w*|shutting down|shuts down|retir(es|ing) (its|the))\b/i },
  { kind: "layoffs", re: /\b(lay ?offs?|lays off|laid off|job cuts|cuts? \d[\d,]* (jobs|staff|employees)|workforce reduction)\b/i },
  // Customer-facing legal trouble only: an employee suing isn't a reason to switch.
  { kind: "lawsuit", re: /\b(class action|antitrust|FTC|fined|regulators?|customers? (sue|sued))\b/i },
  // The vendor being bought (ownership and roadmap risk), not it buying others.
  { kind: "acquisition", re: /\b(acquired by|to be acquired|agrees to be acquired|agrees to sell|sold to|taken private|go(es)? private|private equity (firm |group )?(buys|to buy|acquires))\b/i },
];

export interface WeakSpot {
  kind: WeakSpotKind;
  title: string;
  url: string;
  date: string;
  outlet?: string;
}

const DAY = 86_400_000;
export const WEAK_SPOT_WINDOW_DAYS = 730;

/** Only vendors the tech stack table knows, so the search can't be pointed anywhere. */
export function knownVendor(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const n = name.trim().toLowerCase();
  return VENDORS.find((v) => v.vendor.toLowerCase() === n)?.vendor;
}

/** News queries for a vendor's weak spots. */
export function weakSpotQueries(vendor: string): string[] {
  return [
    `"${vendor}" price increase OR outage OR layoffs OR acquisition`,
    `"${vendor}" lawsuit OR breach OR discontinued OR "end of life"`,
  ];
}

/**
 * Dated news about the vendor itself, classified, newest first: at most two
 * per kind and six in all. A headline that doesn't name the vendor, or with
 * no readable date in the last two years, is left out.
 */
export function weakSpots(vendor: string, results: SearchResult[], now = new Date()): WeakSpot[] {
  const brand = vendor.replace(/\s*\(.*\)$/, "");
  const out: WeakSpot[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.url || seen.has(r.url) || !mentionsCompany(r.title, brand)) continue;
    const normalized = newsDate(r.date, r.url, now);
    const at = normalized ? Date.parse(`${normalized} UTC`) : NaN;
    if (!Number.isFinite(at) || at > now.getTime() + DAY || now.getTime() - at > WEAK_SPOT_WINDOW_DAYS * DAY) continue;
    const text = `${r.title} ${r.snippet ?? ""}`;
    const rule = RULES.find((x) => x.re.test(r.title)) ?? RULES.find((x) => x.re.test(text));
    if (!rule) continue;
    seen.add(r.url);
    let outlet: string | undefined;
    try { outlet = new URL(r.url).hostname.replace(/^www\./, ""); } catch { /* keep none */ }
    out.push({ kind: rule.kind, title: r.title.trim(), url: r.url, date: new Date(at).toISOString().slice(0, 10), outlet });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  const perKind = new Map<WeakSpotKind, number>();
  // One story per kind per day: two outlets on the same layoff are one event.
  const events = new Set<string>();
  return out.filter((w) => {
    const event = `${w.kind}|${w.date}`;
    if (events.has(event)) return false;
    events.add(event);
    const n = perKind.get(w.kind) ?? 0;
    perKind.set(w.kind, n + 1);
    return n < 2;
  }).slice(0, 6);
}

// ── Peers' own websites ──────────────────────────────────────────────────────

// Words any firm in a field might have in its name: not evidence a domain is theirs.
const GENERIC = new Set([
  "the", "and", "inc", "llc", "corp", "corporation", "company", "group", "holdings", "international", "global", "usa", "america",
  "services", "service", "solutions", "systems", "technologies", "technology", "partners", "industries", "enterprises",
  "electric", "electrical", "supply", "supplies", "distribution", "distributors", "distributor", "products", "industrial",
  "national", "united", "american", "general", "consolidated", "associates", "management", "consulting",
]);

// Directories, profiles and news: never a company's own site.
const NOT_OWN_SITE = /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|wikipedia|bloomberg|reuters|forbes|crunchbase|zoominfo|dnb|glassdoor|indeed|yelp|bbb|mapquest|manta|owler|craft|cbinsights|pitchbook|google|apple|amazon|reddit|prnewswire|businesswire|globenewswire)\.[a-z.]+$/i;

const registrable = (host: string) => {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const twoLevel = parts.length > 2 && /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoLevel ? -3 : -2).join(".");
};

/** The distinctive words of a company name ("Consolidated Electrical Distributors" -> [], "Sonepar" -> ["sonepar"]). */
export function distinctiveTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
}

/**
 * The peer's own domain from "<name> official website" results: the first
 * result whose registered domain contains a distinctive word of its name.
 * A name with no distinctive word (all generic) isn't guessed at; its
 * initials are tried only when they're 3+ letters ("CED" for Consolidated
 * Electrical Distributors).
 */
export function peerDomain(name: string, results: SearchResult[]): string | undefined {
  const tokens = distinctiveTokens(name);
  const initials = name.split(/[^A-Za-z0-9]+/).filter((w) => w && !/^(the|and|of|inc|llc|co)$/i.test(w)).map((w) => w[0].toLowerCase()).join("");
  for (const r of results) {
    let host: string;
    try { host = new URL(r.url).hostname; } catch { continue; }
    if (NOT_OWN_SITE.test(host)) continue;
    const reg = registrable(host);
    const label = reg.split(".")[0];
    if (tokens.length > 0 ? tokens.some((t) => label.includes(t)) : initials.length >= 3 && label === initials) return reg;
  }
  return undefined;
}

// ── Peer urgency ─────────────────────────────────────────────────────────────

export interface PeerStack {
  name: string;
  domain: string;
  items: { vendor: string; category: string; sourceUrl: string; evidence: string }[];
}

export interface PeerGap {
  vendor: string;
  category: string;
  /** Peers using it, with the record or tag that shows it. */
  peers: { name: string; evidence: string; url: string }[];
  /** How many peers were compared. */
  of: number;
}

// Categories that say nothing about a company's choices.
const GAP_SKIP_CATEGORIES = new Set(["DNS", "Business identity", "Consent management"]);

/**
 * Tools at least two of the compared peers use that the target doesn't
 * show, most-used first. Needs two or more peers with a readable stack.
 */
export function peerGaps(targetVendors: string[], peers: PeerStack[]): PeerGap[] {
  const usable = peers.filter((p) => p.items.length > 0);
  if (usable.length < 2) return [];
  const has = new Set(targetVendors.map((v) => v.toLowerCase()));
  const byVendor = new Map<string, PeerGap>();
  for (const p of usable) {
    for (const i of p.items) {
      if (has.has(i.vendor.toLowerCase()) || GAP_SKIP_CATEGORIES.has(i.category)) continue;
      const gap = byVendor.get(i.vendor) ?? { vendor: i.vendor, category: i.category, peers: [], of: usable.length };
      if (!gap.peers.some((x) => x.name === p.name)) gap.peers.push({ name: p.name, evidence: i.evidence, url: i.sourceUrl });
      byVendor.set(i.vendor, gap);
    }
  }
  return [...byVendor.values()]
    .filter((g) => g.peers.length >= 2)
    .sort((a, b) => b.peers.length - a.peers.length || a.vendor.localeCompare(b.vendor))
    .slice(0, 8);
}
