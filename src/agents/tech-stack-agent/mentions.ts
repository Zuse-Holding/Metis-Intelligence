/**
 * Public mentions for the tech stack (ABM brief §2, layer 5): a vendor's
 * own customer story or case study that names the company. One web search
 * per report; a result counts only when it is
 *   - on the vendor's own site (MENTION_VENDORS hosts),
 *   - under a customer-story path there, and
 *   - about this company: its full name in the title, or its name in the
 *     page's address. A one-word name ("Patagonia") needs both, so a
 *     namesake or a passing mention isn't read as a customer.
 *
 * "Likely", not confirmed: a story can be years old and the company may
 * have moved on. Each item quotes the story's title and links it.
 */
import type { TechCategory } from "./vendors.js";

export interface MentionVendor { vendor: string; category: TechCategory; hosts: string[]; path: RegExp }

export const MENTION_VENDORS: MentionVendor[] = [
  { vendor: "Salesforce", category: "CRM", hosts: ["salesforce.com"], path: /\/customer-(stories|success)\// },
  { vendor: "HubSpot", category: "Marketing automation", hosts: ["hubspot.com"], path: /\/case-studies\// },
  { vendor: "Microsoft Dynamics 365", category: "Accounting and ERP", hosts: ["customers.microsoft.com", "microsoft.com"], path: /\/(story|customers)\// },
  { vendor: "NetSuite", category: "Accounting and ERP", hosts: ["netsuite.com"], path: /\/customer-stories?\// },
  { vendor: "Sage Intacct", category: "Accounting and ERP", hosts: ["sage.com", "sageintacct.com"], path: /\/(case-stud(y|ies)|customer-stories|customers)\// },
  { vendor: "Workday", category: "HR and payroll", hosts: ["workday.com"], path: /\/customer-stories\// },
  { vendor: "UKG", category: "HR and payroll", hosts: ["ukg.com"], path: /\/customer-stories\// },
  { vendor: "ServiceNow", category: "IT service management", hosts: ["servicenow.com"], path: /\/customers\// },
  { vendor: "Zendesk", category: "Customer support", hosts: ["zendesk.com"], path: /\/customer\// },
  { vendor: "Okta", category: "Identity and security", hosts: ["okta.com"], path: /\/customers\// },
  { vendor: "Atlassian", category: "Collaboration", hosts: ["atlassian.com"], path: /\/customers\// },
  { vendor: "Slack", category: "Collaboration", hosts: ["slack.com"], path: /\/customer-stories\// },
  { vendor: "DocuSign", category: "E-signature", hosts: ["docusign.com"], path: /\/customer-stories\// },
  { vendor: "Snowflake", category: "Business intelligence", hosts: ["snowflake.com"], path: /\/customers\// },
  { vendor: "Databricks", category: "Business intelligence", hosts: ["databricks.com"], path: /\/customers\// },
  { vendor: "Tableau", category: "Business intelligence", hosts: ["tableau.com"], path: /\/solutions\/customer\// },
  { vendor: "AWS", category: "Hosting", hosts: ["aws.amazon.com"], path: /\/(solutions\/case-studies|case-studies)\// },
  { vendor: "Google Cloud", category: "Hosting", hosts: ["cloud.google.com"], path: /\/customers\// },
  { vendor: "Procore", category: "Construction management", hosts: ["procore.com"], path: /\/(customers|case-studies|customer-stories)\// },
  { vendor: "Autodesk Construction Cloud", category: "Construction management", hosts: ["construction.autodesk.com"], path: /\/customers\// },
  { vendor: "Shopify", category: "E-commerce", hosts: ["shopify.com"], path: /\/(case-studies|plus\/customers)\// },
  { vendor: "Stripe", category: "Payments", hosts: ["stripe.com"], path: /\/customers\// },
  { vendor: "Twilio", category: "Developer tools", hosts: ["customers.twilio.com"], path: /^\/(en-us\/)?[a-z0-9-]{3,}/ },
  { vendor: "Gong", category: "Sales intelligence", hosts: ["gong.io"], path: /\/case-studies\// },
  { vendor: "Outreach", category: "Sales intelligence", hosts: ["outreach.io"], path: /\/customers\// },
];

export interface Mention { vendor: string; category: TechCategory; title: string; url: string }

interface Result { title: string; url: string }

const LEGAL = new Set(["inc", "llc", "ltd", "co", "corp", "corporation", "company", "the", "group", "holdings", "plc", "lp", "llp"]);
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** The search to run for a company's customer stories. */
export function mentionQuery(company: string): string {
  return `"${company.trim()}" ("customer story" OR "case study")`;
}

// Sites that collect other companies' case studies, video and social sites,
// and document hosts: not the vendor's own page.
const NOT_A_VENDOR = /(^|\.)(casestudies\.com|featuredcustomers\.com|g2\.com|capterra\.com|trustradius\.com|gartner\.com|youtube\.com|linkedin\.com|facebook\.com|x\.com|twitter\.com|instagram\.com|medium\.com|scribd\.com|slideshare\.net|issuu\.com|wikipedia\.org|crunchbase\.com|zoominfo\.com|pitchbook\.com|prnewswire\.com|businesswire\.com|globenewswire\.com)$/;
// Schools, nonprofits, governments and free site builders write case studies
// about companies, not for them as customers.
const NOT_COMMERCIAL = /(\.(edu|org|gov|mil|int)|\.ac\.[a-z]{2}|\.edu\.[a-z]{2})$|^(sites|docs)\.google\.com$/;
// A story page on any vendor's site, and the stronger kind: its customer list.
const STORY_PATH = /(case[-_]?stud|customer[-_]?(stor|success)|customers?\/|success[-_]?stor|client[-_]?stor)/;
const CUSTOMER_PATH = /(\/customers?\/|customer[-_]?(stor|success)|client[-_]?stor)/;

const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** A vendor's name from its page: the brand after the last "|" or " - " in the title, else the site name. */
function vendorName(title: string, host: string, core: string[]): string | undefined {
  const parts = title.split(/\s+[|–—-]\s+/).map((p) => p.trim()).filter(Boolean);
  const brand = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (brand && brand.length <= 30 && !core.some((w) => norm(brand).split(" ").includes(w)) && !/case stud|customer|story/i.test(brand)) return brand;
  const label = host.split(".").slice(-2, -1)[0];
  if (!label || !LABEL_RE.test(label) || core.includes(label)) return undefined;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Customer stories in the search results that are about this company. Pure.
 * A known vendor (MENTION_VENDORS) keeps its category; any other vendor's own
 * customer-story page counts too, under "Other vendors". `ownDomain` is the
 * company's own site, whose case studies are about its customers instead.
 */
export function mentionsFrom(results: Result[], company: string, ownDomain?: string): Mention[] {
  const core = norm(company).split(" ").filter((w) => w && !LEGAL.has(w));
  if (core.length === 0) return [];
  const slug = core.join("-");
  const own = ownDomain?.toLowerCase().replace(/^www\./, "");
  const out: Mention[] = [];
  for (const r of results) {
    let u: URL;
    try { u = new URL(r.url); } catch { continue; }
    if (u.protocol !== "https:") continue;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (own && (host === own || host.endsWith(`.${own}`))) continue;
    const path = u.pathname.toLowerCase();
    const known = MENTION_VENDORS.find((m) => m.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    let v: { vendor: string; category: TechCategory } | undefined;
    if (known) v = known.path.test(path) ? known : undefined;
    else if (!NOT_A_VENDOR.test(host) && !NOT_COMMERCIAL.test(host) && STORY_PATH.test(path)) {
      // An article "case study" about a famous company isn't a vendor's
      // story: the page has to be on the site's customer list, or name the
      // site itself beside the company ("...with Facilio", "MSUITE-Limbach").
      const label = host.split(".").slice(-2, -1)[0] ?? "";
      const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const body = r.title.split(/\s+[|–—]\s+/)[0];
      const namesSelf = label.length >= 4 && (squash(body).includes(label.replace(/-/g, "")) || path.split("/").some((seg) => seg.includes(slug) && squash(seg).includes(label.replace(/-/g, ""))));
      const name = CUSTOMER_PATH.test(path) || namesSelf ? vendorName(r.title, host, core) : undefined;
      v = name ? { vendor: name, category: "Other vendors" } : undefined;
    }
    if (!v) continue;
    // The company being researched is the vendor itself.
    if (norm(v.vendor).split(" ").every((w) => core.includes(w))) continue;
    const title = ` ${norm(r.title)} `;
    const inTitle = title.includes(` ${core.join(" ")} `);
    const inPath = new RegExp(`(^|[/_-])${slug}([/_.-]|$)`).test(path);
    if (core.length === 1 ? !(inTitle && inPath) : !(inTitle || inPath)) continue;
    if (out.some((o) => o.vendor === v.vendor)) continue;
    out.push({ vendor: v.vendor, category: v.category, title: r.title.trim().slice(0, 200), url: u.toString() });
  }
  return out;
}
