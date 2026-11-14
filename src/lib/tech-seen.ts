/**
 * When each tool was first seen on a domain (ABM brief §2: "when it was
 * first seen"; §3B: "adopted X this year"). Kept per domain in
 * company_profiles.tech_seen, for report subjects and the peers they're
 * compared with.
 *
 * "First seen" is when Metis first saw it, not when the company adopted it.
 * A tool only counts as adopted since a date when the domain was checked
 * earlier without it, and only for confirmed items (a record or tag names
 * the vendor): "likely" items come and go run to run.
 *
 * Pure; the callers load and save the record.
 */

export interface SeenVendor {
  vendor: string;
  /** YYYY-MM-DD */
  firstSeen: string;
  lastSeen: string;
  /** Seen at least once as confirmed (not "likely"). */
  confirmed: boolean;
}

export interface TechSeen {
  /** The day the domain's stack was first read. */
  checkedFirst: string;
  vendors: Record<string, SeenVendor>;
}

interface Item { vendor: string; confidence: string }

const day = (d: Date) => d.toISOString().slice(0, 10);
const key = (vendor: string) => vendor.trim().toLowerCase();

/** The saved record with this read's tools added. A tool no longer found keeps its dates. */
export function updateTechSeen(prior: TechSeen | null | undefined, items: Item[], now = new Date()): TechSeen {
  const today = day(now);
  const vendors: Record<string, SeenVendor> = {};
  for (const [k, v] of Object.entries(prior?.vendors ?? {})) vendors[k] = { ...v };
  for (const i of items) {
    const k = key(i.vendor);
    if (!k) continue;
    const confirmed = i.confidence !== "likely";
    const v = vendors[k];
    vendors[k] = v
      ? { ...v, lastSeen: today, confirmed: v.confirmed || confirmed }
      : { vendor: i.vendor, firstSeen: today, lastSeen: today, confirmed };
  }
  return { checkedFirst: prior?.checkedFirst ?? today, vendors };
}

/** Each item with the day it was first seen (today for a tool seen for the first time). */
export function withFirstSeen<T extends Item>(items: T[], seen: TechSeen | null | undefined, now = new Date()): (T & { firstSeen: string })[] {
  const today = day(now);
  return items.map((i) => ({ ...i, firstSeen: seen?.vendors[key(i.vendor)]?.firstSeen ?? today }));
}

/**
 * The day a confirmed tool first showed up, when the domain was checked
 * before that without it. Undefined when it was there from the first look.
 */
export function adoptedSince(seen: TechSeen | null | undefined, vendor: string): string | undefined {
  const v = seen?.vendors[key(vendor)];
  if (!seen || !v?.confirmed) return undefined;
  return v.firstSeen > seen.checkedFirst ? v.firstSeen : undefined;
}

/** Stored JSONB read back; anything malformed means no record. */
export function parseTechSeen(value: unknown): TechSeen | undefined {
  const v = value as TechSeen | null;
  if (!v || typeof v !== "object" || typeof v.checkedFirst !== "string" || !v.vendors || typeof v.vendors !== "object") return undefined;
  const vendors: Record<string, SeenVendor> = {};
  for (const [k, s] of Object.entries(v.vendors)) {
    if (s && typeof s.vendor === "string" && typeof s.firstSeen === "string" && typeof s.lastSeen === "string") {
      vendors[k] = { vendor: s.vendor, firstSeen: s.firstSeen, lastSeen: s.lastSeen, confirmed: s.confirmed === true };
    }
  }
  return { checkedFirst: v.checkedFirst, vendors };
}
