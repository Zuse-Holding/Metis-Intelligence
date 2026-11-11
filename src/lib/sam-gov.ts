import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SAM.gov Get Opportunities API (public, needs an api.data.gov key):
 * https://open.gsa.gov/api/get-opportunities-public-api/
 *
 * Once a day the agent server pulls the notices posted in the last couple
 * of days into sam_opportunities, keeping only notice types that mean an
 * agency is shopping, and drops ones whose response deadline has passed.
 * One shared pull for every user, matched against each seller's NAICS codes
 * and keywords in the web app, so the API's daily request cap (as low as 10
 * for a key without a SAM.gov role) is never spent per user.
 */

export const SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
const PAGE_SIZE = 1000;
/** Per daily pull; well under the lowest daily cap. */
export const MAX_PAGES = 6;
/** Days of postings in a regular pull; overlaps so a missed day isn't lost. */
const PULL_DAYS = 2;
/** Days of postings in the first pull, when the table is empty. */
const BACKFILL_DAYS = 14;
/** How long before a pull is due again. */
export const PULL_INTERVAL_HOURS = 20;

/** Notice types that mean an agency is buying or about to. */
export const SHOPPING_TYPES = new Set([
  "Solicitation",
  "Combined Synopsis/Solicitation",
  "Presolicitation",
  "Sources Sought",
  "Special Notice",
]);

export interface SamOpportunity {
  notice_id: string;
  title: string;
  solicitation_number: string | null;
  notice_type: string;
  /** "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP", top level first. */
  agency_path: string;
  naics_code: string | null;
  set_aside: string | null;
  posted_date: string;
  response_deadline: string | null;
  url: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** MM/dd/yyyy, as the API wants dates. */
export function samDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

/** Rows worth keeping from one page of results: active, shopping-type, cited. */
export function parseOpportunities(body: unknown): SamOpportunity[] {
  const data = (body as { opportunitiesData?: unknown })?.opportunitiesData;
  if (!Array.isArray(data)) return [];
  const out: SamOpportunity[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.noticeId);
    const title = str(r.title);
    const type = str(r.type);
    const agency = str(r.fullParentPathName);
    const posted = str(r.postedDate);
    if (!id || !title || !type || !agency || !posted || !SHOPPING_TYPES.has(type)) continue;
    if (str(r.active)?.toLowerCase() === "no") continue;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
    const deadline = str(r.responseDeadLine);
    const deadlineOk = deadline && !Number.isNaN(Date.parse(deadline)) ? new Date(deadline).toISOString() : null;
    const ui = str(r.uiLink);
    out.push({
      notice_id: id,
      title: title.slice(0, 500),
      solicitation_number: str(r.solicitationNumber),
      notice_type: type,
      agency_path: agency,
      naics_code: str(r.naicsCode)?.match(/^\d{2,6}$/)?.[0] ?? null,
      set_aside: str(r.typeOfSetAsideDescription),
      posted_date: posted.slice(0, 10),
      response_deadline: deadlineOk,
      url: ui && ui.startsWith("https://sam.gov/") ? ui : `https://sam.gov/opp/${id}/view`,
    });
  }
  return out;
}

export interface PullResult { fetched: number; kept: number; removed: number; skipped?: string }

/**
 * The daily pull. Skips when the last one is under PULL_INTERVAL_HOURS old
 * (the newest fetched_at), so restarts and several servers don't spend the
 * daily cap twice.
 */
export async function pullSamOpportunities(
  supabase: SupabaseClient,
  apiKey: string,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<PullResult> {
  const { data: last, error: lastErr } = await supabase
    .from("sam_opportunities")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1);
  if (lastErr) throw new Error(`sam_opportunities read: ${lastErr.message}`);
  const lastAt = last?.[0]?.fetched_at ? Date.parse(last[0].fetched_at as string) : NaN;
  if (Number.isFinite(lastAt) && now.getTime() - lastAt < PULL_INTERVAL_HOURS * 3_600_000) {
    return { fetched: 0, kept: 0, removed: 0, skipped: "pulled recently" };
  }

  const days = Number.isFinite(lastAt) ? PULL_DAYS : BACKFILL_DAYS;
  const from = new Date(now.getTime() - days * 86_400_000);
  let fetched = 0;
  const rows = new Map<string, SamOpportunity>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(SAM_SEARCH_URL);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("postedFrom", samDate(from));
    url.searchParams.set("postedTo", samDate(now));
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(page * PAGE_SIZE));
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      // Never log the URL: it carries the key.
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      if (page === 0) throw new Error(`SAM.gov returned ${res.status}: ${snippet}`);
      console.warn(`[sam-gov] page ${page + 1} returned ${res.status}; keeping what was fetched`);
      break;
    }
    const body = await res.json();
    const batch = Array.isArray((body as { opportunitiesData?: unknown[] }).opportunitiesData) ? (body as { opportunitiesData: unknown[] }).opportunitiesData.length : 0;
    fetched += batch;
    for (const r of parseOpportunities(body)) rows.set(r.notice_id, r);
    const total = Number((body as { totalRecords?: unknown }).totalRecords);
    if (batch < PAGE_SIZE || (Number.isFinite(total) && (page + 1) * PAGE_SIZE >= total)) break;
  }

  const fetchedAt = now.toISOString();
  const list = [...rows.values()].map((r) => ({ ...r, fetched_at: fetchedAt }));
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await supabase.from("sam_opportunities").upsert(list.slice(i, i + 500), { onConflict: "notice_id" });
    if (error) throw new Error(`sam_opportunities save: ${error.message}`);
  }
  // Nothing saved means no fetched_at to read next time; the server's own
  // timer (startSamPull) still waits PULL_INTERVAL_HOURS before trying again.
  if (list.length === 0) console.warn("[sam-gov] pull returned no shopping-type notices");

  // Past their deadline, or with no deadline and posted over 60 days ago.
  const { count: removedPast, error: delErr } = await supabase
    .from("sam_opportunities")
    .delete({ count: "exact" })
    .lt("response_deadline", fetchedAt);
  if (delErr) throw new Error(`sam_opportunities cleanup: ${delErr.message}`);
  const stale = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
  const { count: removedOld, error: oldErr } = await supabase
    .from("sam_opportunities")
    .delete({ count: "exact" })
    .is("response_deadline", null)
    .lt("posted_date", stale);
  if (oldErr) throw new Error(`sam_opportunities cleanup: ${oldErr.message}`);

  return { fetched, kept: list.length, removed: (removedPast ?? 0) + (removedOld ?? 0) };
}
