/**
 * Job postings for the tech stack (ABM brief §2, phase 2): the best public
 * source for internal tools DNS can't see (ERP, accounting, construction
 * software, data warehouses).
 *
 * Only job boards built to be read, through their public, keyless APIs:
 *   Greenhouse  https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *   Lever       https://api.lever.co/v0/postings/{site}?mode=json
 *   Ashby       https://api.ashbyhq.com/posting-api/job-board/{name}
 * No LinkedIn, Indeed or other scraping.
 *
 * The board is taken only from a link on the company's own homepage or
 * careers page, never guessed from the name, so a namesake's board can't
 * be read as this company's. Large companies on Workday or iCIMS have no
 * public API, so their postings aren't read: coverage is mostly startups
 * and mid-market companies.
 *
 * A tool named in a posting is "likely", not confirmed: it says they hire
 * for it, which usually means they run it. Each item quotes the posting.
 */
import type { TechCategory } from "./vendors.js";

export type Ats = "Greenhouse" | "Lever" | "Ashby";

export interface JobBoard { ats: Ats; token: string; url: string }

export interface JobPosting {
  title: string;
  url: string;
  /** ISO date the posting was published or last updated, when the board says. */
  postedAt?: string;
  /** Plain text of the description, trimmed. */
  text: string;
  board: Ats;
}

/** Postings read per board, and characters of each kept. */
export const MAX_POSTINGS = 150;
const MAX_TEXT = 12_000;

// ── Finding the board on the company's own pages ─────────────────────────────

const TOKEN = "([A-Za-z0-9][A-Za-z0-9_.-]{1,60})";
const BOARD_PATTERNS: { ats: Ats; re: RegExp; url: (t: string) => string }[] = [
  { ats: "Greenhouse", re: new RegExp(`(?:job-)?boards(?:\\.eu)?\\.greenhouse\\.io/(?:embed/job_board(?:/js)?\\?for=)?${TOKEN}`, "gi"), url: (t) => `https://boards.greenhouse.io/${t}` },
  { ats: "Lever", re: new RegExp(`jobs(?:\\.eu)?\\.lever\\.co/${TOKEN}`, "gi"), url: (t) => `https://jobs.lever.co/${t}` },
  { ats: "Ashby", re: new RegExp(`jobs\\.ashbyhq\\.com/${TOKEN}`, "gi"), url: (t) => `https://jobs.ashbyhq.com/${t}` },
];
// Path words that follow the host but aren't a board name.
const NOT_TOKEN = /^(embed|js|api|v\d|jobs|job_board|static|assets|images|favicon\.ico|robots\.txt)$/i;

/** Job boards linked from a page's HTML, one per ATS (the first link wins). */
export function boardsFromHtml(html: string): JobBoard[] {
  const out: JobBoard[] = [];
  for (const p of BOARD_PATTERNS) {
    if (out.some((b) => b.ats === p.ats)) continue;
    for (const m of html.matchAll(p.re)) {
      const token = m[1].replace(/[.]+$/, "");
      if (NOT_TOKEN.test(token)) continue;
      out.push({ ats: p.ats, token, url: p.url(token) });
      break;
    }
  }
  return out;
}

/** Careers-page URLs worth reading for a board link when the homepage has none. */
export function careersUrls(homepage: string, html: string | undefined): string[] {
  let origin: string;
  try { origin = new URL(homepage).origin; } catch { return []; }
  const linked = [...(html ?? "").matchAll(/href=["']([^"'#]*(?:careers?|jobs|join-us|work-with-us)[^"'#]*)["']/gi)]
    .map((m) => { try { return new URL(m[1], homepage); } catch { return undefined; } })
    .filter((u): u is URL => !!u && u.origin === origin)
    .map((u) => u.toString());
  return [...new Set([...linked, `${origin}/careers`, `${origin}/jobs`])].slice(0, 3);
}

// ── Reading the boards ───────────────────────────────────────────────────────

const decodeEntities = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** HTML (Greenhouse sends it entity-encoded) to plain text with list items on their own lines. */
export function plainText(html: string): string {
  return decodeEntities(decodeEntities(html))
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_TEXT);
}

const isoOf = (v: unknown): string | undefined => {
  const d = typeof v === "number" ? new Date(v) : typeof v === "string" ? new Date(v) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isHttp = (u: string) => /^https?:\/\//i.test(u);

export function apiUrl(b: JobBoard): string {
  const t = encodeURIComponent(b.token);
  if (b.ats === "Greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`;
  if (b.ats === "Lever") return `https://api.lever.co/v0/postings/${t}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${t}`;
}

/** A board API's JSON to postings. Anything malformed is skipped. */
export function parsePostings(ats: Ats, data: unknown): JobPosting[] {
  const out: JobPosting[] = [];
  const push = (title: string, url: string, postedAt: string | undefined, text: string) => {
    if (title.trim() && isHttp(url)) out.push({ title: title.trim().slice(0, 200), url, postedAt, text: text.slice(0, MAX_TEXT), board: ats });
  };
  if (ats === "Greenhouse") {
    const jobs = (data as { jobs?: unknown[] })?.jobs;
    for (const j of Array.isArray(jobs) ? jobs : []) {
      const r = j as Record<string, unknown>;
      push(str(r.title), str(r.absolute_url), isoOf(r.first_published ?? r.updated_at), plainText(str(r.content)));
    }
  } else if (ats === "Lever") {
    for (const j of Array.isArray(data) ? data : []) {
      const r = j as Record<string, unknown>;
      const lists = Array.isArray(r.lists) ? (r.lists as Record<string, unknown>[]).map((l) => `${str(l.text)}\n${plainText(str(l.content))}`).join("\n") : "";
      push(str(r.text), str(r.hostedUrl), isoOf(r.createdAt), [str(r.descriptionPlain), lists, str(r.additionalPlain)].filter(Boolean).join("\n"));
    }
  } else {
    const jobs = (data as { jobs?: unknown[] })?.jobs;
    for (const j of Array.isArray(jobs) ? jobs : []) {
      const r = j as Record<string, unknown>;
      if (r.isListed === false) continue;
      push(str(r.title), str(r.jobUrl), isoOf(r.publishedAt ?? r.updatedAt), str(r.descriptionPlain) || plainText(str(r.descriptionHtml)));
    }
  }
  return out.slice(0, MAX_POSTINGS);
}

/** Reads one board. Null when it doesn't answer with postings. */
export async function readBoard(b: JobBoard, fetchImpl: typeof fetch = fetch): Promise<JobPosting[] | null> {
  try {
    const res = await fetchImpl(apiUrl(b), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return parsePostings(b.ats, await res.json());
  } catch {
    return null;
  }
}

// ── Tools named in postings ──────────────────────────────────────────────────

export interface JobTerm { vendor: string; category: TechCategory; re: RegExp }

/**
 * Internal tools postings name and DNS rarely shows. Patterns are whole
 * words, case-sensitive where the word is also common English ("Sage",
 * "Spectrum", "Vista"), so they only match the product's own spelling.
 */
export const JOB_TERMS: JobTerm[] = [
  // ERP and accounting
  { vendor: "NetSuite", category: "Accounting and ERP", re: /\bNet[Ss]uite\b/ },
  { vendor: "SAP", category: "Accounting and ERP", re: /\bSAP (S\/4 ?HANA|ECC|ERP|Business One|ByDesign|FICO|MM|SD|PP|Ariba|Concur|SuccessFactors)\b|\bS\/4 ?HANA\b/ },
  { vendor: "Oracle ERP", category: "Accounting and ERP", re: /\bOracle (E-Business Suite|EBS|Fusion|Cloud ERP|Financials)\b|\bPeopleSoft\b|\bJD ?Edwards\b|\bJDE\b/ },
  { vendor: "Microsoft Dynamics 365", category: "Accounting and ERP", re: /\b(Microsoft )?Dynamics (365|GP|NAV|AX|SL)\b|\bBusiness Central\b/ },
  { vendor: "Sage Intacct", category: "Accounting and ERP", re: /\bSage (Intacct|100|300|X3|50)\b|\bIntacct\b/ },
  { vendor: "QuickBooks", category: "Accounting and ERP", re: /\bQuick[Bb]ooks\b/ },
  { vendor: "Epicor", category: "Accounting and ERP", re: /\bEpicor\b/ },
  { vendor: "Infor", category: "Accounting and ERP", re: /\bInfor (CloudSuite|M3|LN|SyteLine|SXe|SX\.e)\b/ },
  { vendor: "Acumatica", category: "Accounting and ERP", re: /\bAcumatica\b/ },
  { vendor: "Workday Financials", category: "Accounting and ERP", re: /\bWorkday (Financials|Financial Management|Adaptive|Adaptive Planning)\b/ },
  { vendor: "Bill.com", category: "Accounting and ERP", re: /\bBill\.com\b/ },
  { vendor: "Coupa", category: "Accounting and ERP", re: /\bCoupa\b/ },
  // Construction
  { vendor: "Procore", category: "Construction management", re: /\bProcore\b/ },
  { vendor: "Viewpoint", category: "Construction management", re: /\bViewpoint (Vista|Spectrum|Team)\b|\bTrimble Viewpoint\b/ },
  { vendor: "Autodesk Construction Cloud", category: "Construction management", re: /\b(Autodesk Construction Cloud|BIM 360|Autodesk Build|PlanGrid)\b/ },
  { vendor: "Foundation Software", category: "Construction management", re: /\bFoundation Software\b/ },
  { vendor: "Sage 300 CRE", category: "Construction management", re: /\bSage 300 CRE\b|\bTimberline\b/ },
  // Data and BI
  { vendor: "Snowflake", category: "Business intelligence", re: /\bSnowflake\b/ },
  { vendor: "Databricks", category: "Business intelligence", re: /\bDatabricks\b/ },
  { vendor: "Google BigQuery", category: "Business intelligence", re: /\bBig[Qq]uery\b/ },
  { vendor: "Amazon Redshift", category: "Business intelligence", re: /\bRedshift\b/ },
  { vendor: "Tableau", category: "Business intelligence", re: /\bTableau\b/ },
  { vendor: "Power BI", category: "Business intelligence", re: /\bPower ?BI\b/ },
  { vendor: "Looker", category: "Business intelligence", re: /\bLooker\b/ },
  { vendor: "dbt", category: "Business intelligence", re: /\bdbt\b/ },
  // HR and payroll
  { vendor: "Workday HCM", category: "HR and payroll", re: /\bWorkday (HCM|HR|Payroll|Recruiting)\b/ },
  { vendor: "ADP", category: "HR and payroll", re: /\bADP (Workforce Now|Vantage|Run)\b/ },
  { vendor: "UKG", category: "HR and payroll", re: /\bUKG\b|\bUltiPro\b|\bKronos\b/ },
  { vendor: "Paylocity", category: "HR and payroll", re: /\bPaylocity\b/ },
  { vendor: "Rippling", category: "HR and payroll", re: /\bRippling\b/ },
  // CRM, support and IT
  { vendor: "Salesforce", category: "CRM", re: /\bSalesforce\b|\bSFDC\b/ },
  { vendor: "HubSpot", category: "Marketing automation", re: /\bHub[Ss]pot\b/ },
  { vendor: "Marketo", category: "Marketing automation", re: /\bMarketo\b/ },
  { vendor: "Zendesk", category: "Customer support", re: /\bZendesk\b/ },
  { vendor: "ServiceNow", category: "IT service management", re: /\bServiceNow\b/ },
  { vendor: "Jira", category: "Developer tools", re: /\bJira\b/ },
  { vendor: "Okta", category: "Identity and security", re: /\bOkta\b/ },
  { vendor: "CrowdStrike", category: "Identity and security", re: /\bCrowdStrike\b/ },
];

// "Experience with an ERP such as NetSuite, SAP or Oracle" names options, not what they run.
const OPTIONS = /\b(such as|e\.g\.|for example|or similar|or equivalent|or comparable|similar to|like)\b/i;

export interface PostingTool { vendor: string; category: TechCategory; posting: JobPosting; quote: string }

/** The sentence or list item around a match. */
function around(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(". ", index) + 1, 0);
  const endNl = text.indexOf("\n", index + length);
  const endDot = text.indexOf(". ", index + length);
  const ends = [endNl, endDot].filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start, end).replace(/^[\s\-•*]+/, "").replace(/\s+/g, " ").trim();
}

/**
 * Where one posting names a tool it uses, with the sentence: not inside a
 * parenthesised list ("CMMS data (SAP PM, Maximo, JD Edwards)": options,
 * often the customer's), and not in a sentence that offers several of these
 * tools "such as" or "or similar".
 */
function namedIn(p: JobPosting, t: JobTerm, terms: JobTerm[]): string | undefined {
  const text = `${p.title}\n${p.text}`;
  const m = t.re.exec(text);
  if (!m) return undefined;
  const open = text.lastIndexOf("(", m.index);
  const close = text.indexOf(")", m.index);
  if (open >= 0 && close > m.index && !text.slice(open, m.index).includes(")") && text.slice(open, close).includes(",")) return undefined;
  const quote = around(text, m.index, m[0].length);
  if (OPTIONS.test(quote) && terms.filter((x) => x.re.test(quote)).length >= 2) return undefined;
  return quote.length > 160 ? `${quote.slice(0, 159)}…` : quote;
}

/** Tools the postings name, one per vendor (the first posting that names it). */
export function toolsFromPostings(postings: JobPosting[], terms: JobTerm[] = JOB_TERMS): PostingTool[] {
  const out = new Map<string, PostingTool>();
  for (const p of postings) {
    for (const t of terms) {
      if (out.has(t.vendor)) continue;
      const quote = namedIn(p, t, terms);
      if (quote) out.set(t.vendor, { vendor: t.vendor, category: t.category, posting: p, quote });
    }
  }
  return [...out.values()];
}

/** The tools one posting names (for hiring signals and triggers). */
export function postingTools(p: JobPosting, terms: JobTerm[] = JOB_TERMS): string[] {
  return terms.filter((t) => namedIn(p, t, terms) !== undefined).map((t) => t.vendor);
}
