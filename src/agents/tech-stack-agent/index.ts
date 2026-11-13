import type { Source } from "../../types/research.js";
import { dohUrl } from "../domain-posture-agent/index.js";
import { unsafeUrlReason } from "../../lib/public-url.js";
import { CATEGORY_ORDER, VENDORS, mailMatches, mailRecords, type IpProvider, type Signal, type TechCategory } from "./vendors.js";
import { boardsFromHtml, careersUrls, readBoard, toolsFromPostings, type Ats, type JobBoard, type JobPosting } from "./job-boards.js";

/**
 * Tech stack detection, phase 1 (ABM brief §2): which vendors a company
 * runs, from public DNS and its homepage only.
 *
 *   DNS       MX, SPF and verification TXT, name servers, CNAMEs for the
 *             site's hostname, and whose published IP ranges hold its address
 *   website   the homepage's response headers and its script, stylesheet,
 *             iframe, form and generator tags (never the visible text)
 *
 * One ordinary homepage request and a handful of DNS-over-HTTPS lookups;
 * nothing else touches the target. Every item says which record or tag it
 * came from. Tools used only internally usually leave no public trace, so
 * an empty category means "not visible", never "not used".
 */

export type Confidence = "confirmed" | "likely";
/** "subdomain": found through the company's subdomains in certificate logs,
 *  which depend on a log service answering (so triggers skip them when it didn't). */
export type Layer = "dns" | "website" | "subdomain" | "jobs";

export interface TechItem {
  vendor: string;
  category: TechCategory;
  /** "confirmed" when a record or tag names the vendor; "likely" when only
   *  a subdomain's name suggests it (jira.acme.com). */
  confidence: Confidence;
  layer: Layer;
  /** The record or tag it came from, e.g. "SPF include: _spf.salesforce.com". */
  evidence: string;
  sourceName: string;
  sourceUrl: string;
}

export interface TechStack {
  domain: string;
  checkedAt: string;
  items: TechItem[];
  /** Why the homepage couldn't be read, when it couldn't. DNS still counts. */
  websiteUnavailable?: string;
  /** True when certificate logs answered, so subdomain items are complete. */
  subdomainsChecked?: boolean;
  /** Job boards read for postings (FEATURE_JOB_POSTINGS), with their open
   *  roles' titles. Absent when postings weren't checked. */
  jobBoards?: { ats: Ats; url: string; postings: { title: string; url: string; postedAt?: string }[] }[];
}

/** Everything the detector reads. Each field undefined = not gathered. */
export interface TechSignals {
  domain: string;
  /** The homepage URL that was read (the final one, after redirects). */
  pageUrl?: string;
  mx?: string[];
  txt?: string[];
  ns?: string[];
  /** CNAME chains, e.g. { host: "www.acme.com", targets: ["acme.netlify.app"] }.
   *  `fromLogs` marks hosts found through certificate logs. */
  cnames?: { host: string; targets: string[]; fromLogs?: boolean }[];
  /** The company's own subdomains from certificate logs, and where they came from. */
  subdomains?: string[];
  subdomainSource?: { name: string; url: string };
  /** The site's addresses and which published cloud range holds each. */
  ips?: { host: string; ip: string; provider?: IpProvider }[];
  /** Response headers, names lower-cased. */
  headers?: Record<string, string>;
  html?: string;
}

const clip = (s: string, n = 120) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** The parts of a page that name the tools it loads: tag URLs, form
 *  targets, the generator meta tag and inline script bodies. Visible text
 *  is left out so "we integrate with Salesforce" doesn't count. */
export function pageAssets(html: string): string[] {
  const out: string[] = [];
  const page = html.slice(0, 1_000_000);
  for (const m of page.matchAll(/<(script|link|iframe|img|form|source)\b[^>]*?\s(?:src|href|action|data-src)\s*=\s*["']([^"']+)["']/gi)) {
    out.push(m[2]);
  }
  for (const m of page.matchAll(/<meta\b[^>]*name\s*=\s*["']generator["'][^>]*>/gi)) {
    const content = m[0].match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) out.push(`generator: ${content}`);
  }
  for (const m of page.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].trim()) out.push(m[1].slice(0, 20_000));
  }
  return out;
}

/** Labels a mail record for the evidence line: the MX host, the SPF
 *  mechanism that named the vendor, or the (shortened) TXT token. */
function describeMail(record: string, isMx: boolean, re: RegExp): string {
  if (isMx) return `MX: ${record.trim().split(/\s+/).pop()}`;
  if (/^v=spf1\b/i.test(record)) {
    const mech = record.trim().split(/\s+/).find((m) => re.test(m));
    return mech ? `SPF ${mech.replace(/^[+?~-]?(include|redirect|a|mx|exists):/i, "$1: ")}` : `SPF: ${clip(record, 100)}`;
  }
  // Verification tokens are public, but there's no need to repeat them in full.
  return `TXT: ${clip(record.replace(/=(.{12}).+$/, "=$1…"), 80)}`;
}

const PROVIDER_LABEL: Record<IpProvider, string> = {
  aws: "Amazon Web Services", cloudfront: "Amazon CloudFront", gcp: "Google Cloud", cloudflare: "Cloudflare",
};

/** One match: what was seen and where to check it. */
function firstMatch(signal: Signal, s: TechSignals): Omit<TechItem, "vendor" | "category" | "confidence"> | undefined {
  const page = s.pageUrl ?? `https://${s.domain}/`;
  switch (signal.kind) {
    case "mail": {
      const hit = mailRecords(s.mx, s.txt).find((r) => mailMatches(signal.re, r.record));
      if (!hit) return undefined;
      return { layer: "dns", evidence: describeMail(hit.record, hit.isMx, signal.re),
        sourceName: hit.isMx ? "Public DNS (MX)" : "Public DNS (TXT)", sourceUrl: dohUrl(s.domain, hit.isMx ? "MX" : "TXT") };
    }
    case "ns": {
      const hit = (s.ns ?? []).find((n) => signal.re.test(n));
      return hit ? { layer: "dns", evidence: `Name server: ${hit}`, sourceName: "Public DNS (NS)", sourceUrl: dohUrl(s.domain, "NS") } : undefined;
    }
    case "cname": {
      for (const c of s.cnames ?? []) {
        const hit = c.targets.find((t) => signal.re.test(t));
        if (hit) return { layer: c.fromLogs ? "subdomain" : "dns", evidence: `CNAME: ${c.host} → ${hit}`, sourceName: "Public DNS (CNAME)", sourceUrl: dohUrl(c.host, "CNAME") };
      }
      return undefined;
    }
    case "subdomain": {
      const hit = (s.subdomains ?? []).find((h) => subdomainWords(h, s.domain).some((w) => signal.re.test(w)));
      if (!hit || !s.subdomainSource) return undefined;
      return { layer: "subdomain", evidence: `Subdomain: ${hit} (certificate logs)`, sourceName: s.subdomainSource.name, sourceUrl: s.subdomainSource.url };
    }
    case "ip": {
      const hit = (s.ips ?? []).find((a) => a.provider === signal.provider);
      return hit ? { layer: "dns", evidence: `${hit.host} resolves to ${hit.ip}, in ${PROVIDER_LABEL[signal.provider]}'s published IP ranges`,
        sourceName: "Public DNS (A)", sourceUrl: dohUrl(hit.host, "A") } : undefined;
    }
    case "header": {
      const value = s.headers?.[signal.name];
      if (value === undefined || (signal.re && !signal.re.test(value))) return undefined;
      return { layer: "website", evidence: `Response header ${signal.name}${signal.re ? `: ${clip(value, 60)}` : ""}`,
        sourceName: "Homepage response headers", sourceUrl: page };
    }
    case "html": {
      if (!s.html) return undefined;
      const hit = pageAssets(s.html).find((a) => signal.re.test(a));
      if (!hit) return undefined;
      const shown = hit.startsWith("generator:") ? `Generator tag: ${hit.slice(10).trim()}`
        : /^(https?:)?\/\//i.test(hit) || hit.startsWith("/") ? `Tag: ${clip(hit, 100)}`
        : `Inline script: ${clip(hit.match(signal.re)?.[0] ?? hit, 80)}`;
      return { layer: "website", evidence: shown, sourceName: "Homepage source", sourceUrl: page };
    }
  }
}

/**
 * Every vendor the signals name, one item each (its first, most direct
 * signal), DNS before website, in the report's category order.
 */
export function detectTechStack(s: TechSignals): TechItem[] {
  const items: TechItem[] = [];
  // A subdomain that fronts a hosted service runs on that vendor's
  // infrastructure, not the company's: Patagonia's email images sit on
  // Salesforce's CloudFront, its B2B portal on a vendor's Cloudflare. So
  // hosting, CDN and DNS vendors don't count from those subdomains.
  const hostedElsewhere = new Set((s.cnames ?? []).filter((c) => c.fromLogs && (
    c.targets.some((t) => onSomeoneElsesCloudflare(t, s.domain))
    || VENDORS.some((v) => !INFRA.has(v.category) && v.signals.some((sig) => sig.kind === "cname" && c.targets.some((t) => sig.re.test(t))))
  )).map((c) => c.host));
  const infraView: TechSignals = { ...s, cnames: (s.cnames ?? []).filter((c) => !hostedElsewhere.has(c.host)) };
  for (const v of VENDORS) {
    const view = INFRA.has(v.category) ? infraView : s;
    // Strongest evidence first: records, then page tags, then a subdomain's name.
    const ordered = [...v.signals].sort((a, b) => signalRank(a) - signalRank(b));
    for (const signal of ordered) {
      const hit = firstMatch(signal, view);
      if (hit) {
        items.push({ vendor: v.vendor, category: v.category, confidence: signal.kind === "subdomain" ? "likely" : "confirmed", ...hit });
        break;
      }
    }
  }
  const rank = (c: TechCategory) => CATEGORY_ORDER.indexOf(c);
  return items.sort((a, b) => rank(a.category) - rank(b.category) || Number(a.confidence === "likely") - Number(b.confidence === "likely"));
}

const INFRA = new Set<TechCategory>(["Hosting", "CDN and security", "DNS"]);
/** "<name>.cdn.cloudflare.net" names the Cloudflare zone it belongs to:
 *  "www.acme.com.cdn.cloudflare.net" is the company's own, while
 *  "elasticsuite.com.cdn.cloudflare.net" is a vendor's (Cloudflare for SaaS). */
function onSomeoneElsesCloudflare(target: string, domain: string): boolean {
  const zone = target.toLowerCase().match(/^(.+)\.cdn\.cloudflare\.net$/)?.[1];
  if (!zone || !zone.includes(".")) return false;
  const d = domain.toLowerCase();
  return zone !== d && !zone.endsWith(`.${d}`);
}

const signalRank = (s: Signal) => (s.kind === "subdomain" ? 2 : s.kind === "header" || s.kind === "html" ? 1 : 0);

/** The words of a subdomain below the company's domain: "jira-qa.corp" -> ["jira", "qa", "corp"]. */
export function subdomainWords(host: string, domain: string): string[] {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  if (!h.endsWith(`.${d}`)) return [];
  return h.slice(0, -(d.length + 1)).split(/[.-]/).filter(Boolean);
}

// ── Certificate logs ─────────────────────────────────────────────────────────

/** Names a certificate covers that are the company's own subdomains (not
 *  the domain itself, not wildcards, not other companies on a shared
 *  certificate), deduped and capped. */
export function ownSubdomains(names: string[], domain: string, cap = 500): string[] {
  const d = domain.toLowerCase();
  const out = new Set<string>();
  for (const raw of names) {
    const n = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!n || n.startsWith("*") || n === d || !n.endsWith(`.${d}`) || !/^[a-z0-9.-]+$/.test(n)) continue;
    out.add(n);
    if (out.size >= cap) break;
  }
  return [...out].sort();
}

// First labels that commonly point at a hosted vendor (help.acme.com -> Zendesk).
const VENDOR_HOST_LABELS = /^(help|helpcenter|support|status|docs|developer|developers|go|info|pages|lp|landing|careers|jobs|shop|store|email|em|e|click|links|link|track|tracking|image|view|news|community|learn|academy|events|event|portal|sso|login|auth|id|identity|kb|knowledge|blog|www2|cdn|assets|survey|feedback|book|meet|apply|hr|crm|marketing|mail)\d*$/;

/**
 * Which subdomains to look up for CNAMEs, at most `cap`: ones whose first
 * label usually fronts a hosted service, then ones whose words match a
 * vendor's subdomain pattern, then the rest, shortest first.
 */
export function subdomainsToResolve(subdomains: string[], domain: string, cap = 40): string[] {
  const vendorWords = VENDORS.flatMap((v) => v.signals.filter((s) => s.kind === "subdomain").map((s) => (s as { re: RegExp }).re));
  const score = (h: string) => {
    const words = subdomainWords(h, domain);
    if (words.length && VENDOR_HOST_LABELS.test(words[0])) return 0;
    if (words.some((w) => vendorWords.some((re) => re.test(w)))) return 1;
    return 2;
  };
  return [...subdomains].sort((a, b) => score(a) - score(b) || a.length - b.length || a.localeCompare(b)).slice(0, cap);
}

const CERT_TIMEOUT_MS = 20_000;

/** The company's subdomains from crt.sh, then Cert Spotter if crt.sh fails. */
async function certificateSubdomains(domain: string): Promise<{ names: string[]; source: { name: string; url: string } } | undefined> {
  const crt = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired&deduplicate=Y`;
  try {
    const res = await fetch(crt, { signal: AbortSignal.timeout(CERT_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (res.ok) {
      const rows = (await res.json()) as { name_value?: string }[];
      const names = rows.flatMap((r) => (r.name_value ?? "").split("\n"));
      return { names: ownSubdomains(names, domain), source: { name: "Certificate logs (crt.sh)", url: `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}` } };
    }
  } catch { /* fall through to Cert Spotter */ }
  const spotter = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names`;
  try {
    const key = process.env.CERTSPOTTER_API_KEY;
    const res = await fetch(spotter, { signal: AbortSignal.timeout(CERT_TIMEOUT_MS), headers: key ? { authorization: `Bearer ${key}` } : {} });
    if (!res.ok) return undefined;
    const rows = (await res.json()) as { dns_names?: string[] }[];
    return { names: ownSubdomains(rows.flatMap((r) => r.dns_names ?? []), domain), source: { name: "Certificate logs (Cert Spotter)", url: `https://sslmate.com/certspotter/` } };
  } catch {
    return undefined;
  }
}

/** Runs `fn` over items with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// ── Published cloud IP ranges ────────────────────────────────────────────────

interface Range { base: number; mask: number; provider: IpProvider }

const ipv4 = (ip: string): number | undefined => {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
};

export function parseCidr(cidr: string, provider: IpProvider): Range | undefined {
  const [ip, bits] = cidr.trim().split("/");
  const base = ipv4(ip);
  const len = Number(bits);
  if (base === undefined || !Number.isInteger(len) || len < 0 || len > 32) return undefined;
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return { base: (base & mask) >>> 0, mask, provider };
}

/** The provider whose range holds the address; the most specific range wins,
 *  so a CloudFront address isn't reported as plain AWS. */
export function providerFor(ip: string, ranges: Range[]): IpProvider | undefined {
  const n = ipv4(ip);
  if (n === undefined) return undefined;
  let best: Range | undefined;
  for (const r of ranges) {
    if (((n & r.mask) >>> 0) === r.base && (!best || r.mask >>> 0 > best.mask >>> 0)) best = r;
  }
  return best?.provider;
}

const RANGE_TTL_MS = 24 * 3_600_000;
let rangeCache: { at: number; ranges: Promise<Range[]> } | undefined;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`);
  return (await res.json()) as T;
}

/** AWS, Google Cloud and Cloudflare publish their ranges; each list that
 *  fails to load is just left out. Cached for a day per process. */
export function cloudRanges(): Promise<Range[]> {
  if (rangeCache && Date.now() - rangeCache.at < RANGE_TTL_MS) return rangeCache.ranges;
  const load = async () => {
    const [aws, gcp, cf] = await Promise.allSettled([
      getJson<{ prefixes: { ip_prefix: string; service: string }[] }>("https://ip-ranges.amazonaws.com/ip-ranges.json"),
      getJson<{ prefixes: { ipv4Prefix?: string }[] }>("https://www.gstatic.com/ipranges/cloud.json"),
      fetch("https://www.cloudflare.com/ips-v4", { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`cloudflare ${r.status}`)))),
    ]);
    const out: Range[] = [];
    if (aws.status === "fulfilled") {
      for (const p of aws.value.prefixes) {
        const r = parseCidr(p.ip_prefix, p.service === "CLOUDFRONT" ? "cloudfront" : "aws");
        if (r) out.push(r);
      }
    }
    if (gcp.status === "fulfilled") {
      for (const p of gcp.value.prefixes) {
        const r = p.ipv4Prefix ? parseCidr(p.ipv4Prefix, "gcp") : undefined;
        if (r) out.push(r);
      }
    }
    if (cf.status === "fulfilled") {
      for (const line of cf.value.split(/\s+/)) {
        const r = line ? parseCidr(line, "cloudflare") : undefined;
        if (r) out.push(r);
      }
    }
    if (out.length === 0) rangeCache = undefined;
    return out;
  };
  rangeCache = { at: Date.now(), ranges: load().catch(() => { rangeCache = undefined; return []; }) };
  return rangeCache.ranges;
}

// ── Gathering ────────────────────────────────────────────────────────────────

interface DohAnswer { type: number; data: string }

async function doh(name: string, type: "A" | "MX" | "TXT" | "NS"): Promise<DohAnswer[]> {
  const res = await fetch(dohUrl(name, type), { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`DNS lookup returned ${res.status}`);
  const data = (await res.json()) as { Status: number; Answer?: DohAnswer[] };
  if (data.Status !== 0 && data.Status !== 3) throw new Error(`DNS lookup failed (status ${data.Status})`);
  return data.Answer ?? [];
}

const strip = (s: string) => s.replace(/\.$/, "");
const settle = <T>(p: Promise<T>) => p.then((v) => v, () => undefined);

const USER_AGENT = "Mozilla/5.0 (compatible; MetisResearch/1.0; +https://metisanalytic.com)";
const MAX_REDIRECTS = 5;
const MAX_BODY = 1_000_000;

/** The homepage's final URL, headers and HTML. Every hop is checked against
 *  private addresses (same rule as the main fetcher, red team S7). */
export async function fetchHomepage(url: string): Promise<{ url: string; headers: Record<string, string>; html?: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    let next = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const unsafe = await unsafeUrlReason(next);
      if (unsafe) return { error: unsafe };
      const res = await fetch(next, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.5" },
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (location) { next = new URL(location, next).toString(); continue; }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      // A refused or non-HTML response still has headers worth reading
      // (a CDN answers even when it blocks us).
      const isHtml = (res.headers.get("content-type") ?? "").includes("text/html");
      const body = res.ok && isHtml ? (await res.text()).slice(0, MAX_BODY) : undefined;
      return { url: next, headers, html: body };
    }
    return { error: "the site redirected too many times" };
  } catch (err) {
    return { error: err instanceof Error && err.name === "AbortError" ? "the site didn't respond in time" : "the site couldn't be reached" };
  } finally {
    clearTimeout(timer);
  }
}

// Interstitials stand in for the page: their tags are the CDN's, not the site's.
const BOT_CHECK = /<title>\s*(one moment, please|just a moment|attention required|security check|access denied)|sgcaptcha|cf-chl-/i;

export class TechStackAgent {
  async gather(domain: string, website?: string): Promise<TechSignals & { websiteUnavailable?: string }> {
    const hosts = [domain, `www.${domain}`];
    const [mx, txt, ns, aApex, aWww, ranges, page, certs] = await Promise.all([
      settle(doh(domain, "MX")),
      settle(doh(domain, "TXT")),
      settle(doh(domain, "NS")),
      settle(doh(hosts[0], "A")),
      settle(doh(hosts[1], "A")),
      cloudRanges(),
      fetchHomepage(website ?? `https://${domain}/`),
      certificateSubdomains(domain),
    ]);

    // Subdomains from certificate logs: where the likeliest ones point.
    const subdomains = (certs?.names ?? []).filter((h) => h !== hosts[1]);
    const logCnames = await mapLimit(subdomainsToResolve(subdomains, domain), 8, async (host) => {
      const answers = await settle(doh(host, "A"));
      return { host, targets: (answers ?? []).filter((a) => a.type === 5).map((a) => strip(a.data)), fromLogs: true };
    });

    const cnames: TechSignals["cnames"] = [];
    const ips: NonNullable<TechSignals["ips"]> = [];
    for (const [host, answers] of [[hosts[0], aApex], [hosts[1], aWww]] as const) {
      if (!answers) continue;
      const targets = answers.filter((a) => a.type === 5).map((a) => strip(a.data));
      if (targets.length) cnames.push({ host, targets });
      for (const a of answers.filter((x) => x.type === 1)) {
        if (!ips.some((i) => i.ip === a.data)) ips.push({ host, ip: a.data, provider: providerFor(a.data, ranges) });
      }
    }

    const signals: TechSignals & { websiteUnavailable?: string } = {
      domain,
      mx: mx?.filter((a) => a.type === 15).map((a) => strip(a.data)),
      txt: txt?.filter((a) => a.type === 16).map((a) => a.data.replace(/"\s*"/g, "").replace(/^"|"$/g, "")),
      ns: ns?.filter((a) => a.type === 2).map((a) => strip(a.data)),
      cnames: [...cnames, ...logCnames.filter((c) => c.targets.length > 0)],
      ips,
      subdomains: certs ? subdomains : undefined,
      subdomainSource: certs?.source,
    };
    if ("error" in page) {
      signals.websiteUnavailable = page.error;
    } else {
      signals.pageUrl = page.url;
      signals.headers = page.headers;
      if (page.html && !BOT_CHECK.test(page.html.slice(0, 4000))) signals.html = page.html;
      else signals.websiteUnavailable = page.html ? "the site showed a bot check instead of its page" : "the homepage didn't return a readable page";
    }
    return signals;
  }

  /**
   * Job boards linked from the homepage or, failing that, a careers page,
   * and their postings. Only the company's own pages are read for the
   * link, so a namesake's board is never used.
   */
  async jobPostings(homepageUrl: string | undefined, html: string | undefined): Promise<{ board: JobBoard; postings: JobPosting[] }[]> {
    let boards = boardsFromHtml(html ?? "");
    if (!boards.length && homepageUrl) {
      for (const url of careersUrls(homepageUrl, html)) {
        const page = await fetchHomepage(url);
        if ("error" in page || !page.html) continue;
        boards = boardsFromHtml(page.html);
        if (boards.length) break;
      }
    }
    const read = await Promise.all(boards.map(async (board) => ({ board, postings: await readBoard(board) })));
    return read.filter((r): r is { board: JobBoard; postings: JobPosting[] } => r.postings !== null);
  }

  async run(domain: string, website?: string, opts: { jobs?: boolean } = {}): Promise<{ stack?: TechStack; sources: Source[] }> {
    const signals = await this.gather(domain, website);
    const nothingGathered = signals.mx === undefined && signals.txt === undefined && signals.ns === undefined && !signals.headers;
    if (nothingGathered) return { sources: [] };
    const checkedAt = new Date().toISOString();
    const items = detectTechStack(signals);
    const stack: TechStack = { domain, checkedAt, items, websiteUnavailable: signals.websiteUnavailable, subdomainsChecked: signals.subdomains !== undefined };
    if (opts.jobs) {
      const boards = await this.jobPostings(signals.pageUrl ?? website ?? `https://${domain}/`, signals.html);
      stack.jobBoards = boards.map(({ board, postings }) => ({
        ats: board.ats, url: board.url,
        postings: postings.slice(0, 50).map((p) => ({ title: p.title, url: p.url, postedAt: p.postedAt })),
      }));
      const seen = new Set(items.map((i) => i.vendor.toLowerCase()));
      for (const t of toolsFromPostings(boards.flatMap((b) => b.postings))) {
        if (seen.has(t.vendor.toLowerCase())) continue;
        items.push({
          vendor: t.vendor, category: t.category, confidence: "likely", layer: "jobs",
          evidence: `Job posting "${t.posting.title}": "${t.quote}"`,
          sourceName: `Job posting (${t.posting.board})`, sourceUrl: t.posting.url,
        });
      }
      items.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
    }
    const sources: Source[] = [...new Map(items.map((i) => [i.sourceUrl, i])).values()]
      .map((i) => ({ url: i.sourceUrl, title: i.sourceName, retrievedAt: checkedAt, usedFor: ["techstack"] }));
    return { stack, sources };
  }
}
