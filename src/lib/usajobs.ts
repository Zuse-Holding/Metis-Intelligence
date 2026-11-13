/**
 * Open roles at federal agencies from the official USAJobs API (job
 * postings, slice 2), for saved accounts that are agencies ("DEPT OF THE
 * NAVY", saved from Shopping now). Feeds the same hiring signal as company
 * job boards.
 *
 *   Agency codes  GET https://data.usajobs.gov/api/codelist/agencysubelements  (no key)
 *   Search        GET https://data.usajobs.gov/api/search?Organization={code}
 *                 headers Host, User-Agent (the email the key was issued to),
 *                 Authorization-Key
 *
 * Off unless USAJOBS_API_KEY and USAJOBS_EMAIL are both set. The email
 * lives only in the server environment, never in the repo or a log.
 *
 * An account matches an agency only when their names are the same after
 * normalising (Department/Dept, "the", "U.S."), and only one agency has
 * that name, so "Navy" doesn't pick up every Navy office.
 */
import { postingTools } from "../agents/tech-stack-agent/job-boards.js";

export interface UsaJobsConfig { key: string; email: string }

export function usaJobsConfig(env: Record<string, string | undefined> = process.env): UsaJobsConfig | undefined {
  const key = env.USAJOBS_API_KEY?.trim();
  const email = env.USAJOBS_EMAIL?.trim();
  return key && email ? { key, email } : undefined;
}

export interface Agency { code: string; name: string }

export interface HiringPosting { title: string; url: string; postedAt?: string; tools?: string[] }

const HOST = "data.usajobs.gov";
const CODELIST_URL = `https://${HOST}/api/codelist/agencysubelements`;
const MAX_RESULTS = 250;

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Agency names as SAM.gov spells them and as USAJobs does. Mirrors web/lib/intent.ts agencyKey. */
export function agencyKey(s: string): string {
  // SAM.gov writes some back to front: "VETERANS AFFAIRS, DEPARTMENT OF".
  const flipped = s.replace(/^\s*(.+?),\s*(department|dept\.?) of( the)?\s*$/i, "Department of $1");
  return words(flipped)
    .replace(/ department /g, " dept ")
    .replace(/ and /g, " ")
    .replace(/ the /g, " ")
    .replace(/ us | u s | united states /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAgencies(data: unknown): Agency[] {
  const lists = (data as { CodeList?: { ValidValue?: unknown[] }[] })?.CodeList ?? [];
  const out: Agency[] = [];
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const v of Array.isArray(list?.ValidValue) ? list.ValidValue : []) {
      const r = v as Record<string, unknown>;
      if (typeof r.Code !== "string" || typeof r.Value !== "string") continue;
      if (r.IsDisabled === "Yes" || r.IsDisabled === true) continue;
      out.push({ code: r.Code, name: r.Value });
    }
  }
  return out;
}

/** The one agency whose name is the account's, or none. */
export function matchAgency(company: string, agencies: Agency[]): Agency | undefined {
  const name = agencyKey(company.split("·")[0]);
  if (name.length < 3) return undefined;
  const hits = agencies.filter((a) => agencyKey(a.name) === name);
  return hits.length === 1 ? hits[0] : undefined;
}

/** A search response to postings, with the tools each names. */
export function parseSearch(data: unknown): HiringPosting[] {
  const items = (data as { SearchResult?: { SearchResultItems?: unknown[] } })?.SearchResult?.SearchResultItems;
  const out: HiringPosting[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    const d = (it as { MatchedObjectDescriptor?: Record<string, unknown> })?.MatchedObjectDescriptor;
    if (!d) continue;
    const title = typeof d.PositionTitle === "string" ? d.PositionTitle.trim() : "";
    const url = typeof d.PositionURI === "string" ? d.PositionURI : "";
    if (!title || !/^https:\/\/(www\.)?usajobs\.gov\//i.test(url)) continue;
    const details = (d.UserArea as { Details?: { JobSummary?: string } } | undefined)?.Details;
    const text = [details?.JobSummary, d.QualificationSummary].filter((x): x is string => typeof x === "string").join("\n");
    // USAJobs dates carry no time zone; read them as UTC so the day doesn't shift with the server's.
    const raw = typeof d.PublicationStartDate === "string" ? d.PublicationStartDate : undefined;
    const posted = raw ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`) : undefined;
    const tools = postingTools({ title, url, text, board: "Greenhouse" });
    out.push({ title: title.slice(0, 200), url, ...(posted && !Number.isNaN(posted.getTime()) ? { postedAt: posted.toISOString() } : {}), ...(tools.length ? { tools } : {}) });
  }
  return out;
}

let agencyCache: { at: number; agencies: Agency[] } | undefined;

async function agencies(fetchImpl: typeof fetch): Promise<Agency[]> {
  if (agencyCache && Date.now() - agencyCache.at < 86_400_000) return agencyCache.agencies;
  const res = await fetchImpl(CODELIST_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`agency codes returned ${res.status}`);
  const list = parseAgencies(await res.json());
  agencyCache = { at: Date.now(), agencies: list };
  return list;
}

/**
 * Open roles at the agency the account names. Undefined when USAJobs is
 * off or the account isn't an agency; null when USAJobs didn't answer.
 */
export async function agencyPostings(company: string, cfg: UsaJobsConfig | undefined, fetchImpl: typeof fetch = fetch): Promise<HiringPosting[] | null | undefined> {
  if (!cfg) return undefined;
  try {
    const agency = matchAgency(company, await agencies(fetchImpl));
    if (!agency) return undefined;
    const url = `https://${HOST}/api/search?Organization=${encodeURIComponent(agency.code)}&ResultsPerPage=${MAX_RESULTS}`;
    const res = await fetchImpl(url, {
      headers: { Host: HOST, "User-Agent": cfg.email, "Authorization-Key": cfg.key, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[usajobs] search for ${agency.code} returned ${res.status}`);
      return null;
    }
    return parseSearch(await res.json());
  } catch (err) {
    console.warn("[usajobs] lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
