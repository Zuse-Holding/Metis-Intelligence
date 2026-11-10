import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchBundle } from "../../types/research.js";
import { ReportAgent } from "../report-agent/index.js";
import { systemsInUse } from "../domain-posture-agent/index.js";
import { detectTechStack, pageAssets, parseCidr, providerFor, type TechSignals, type TechStack } from "./index.js";
import { CATEGORY_ORDER, VENDORS } from "./vendors.js";
import { TECH_SECTION_TITLE, techSummary } from "./render.js";

// Must match TECH_LINE in web/components/ReportViewer.tsx.
const TECH_LINE = /^\[(confirmed|likely)\] (.+?) \| (.+?) \| (.+?) \| \[(.+?)\]\((.+?)\)$/;

const vendorsOf = (s: TechSignals) => detectTechStack(s).map((i) => i.vendor);

const HOMEPAGE = `<!doctype html><html><head>
  <meta name="generator" content="WordPress 6.6.2">
  <script async src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>
  <script src="https://js.hs-scripts.com/1234567.js" id="hs-script-loader"></script>
  <link rel="stylesheet" href="/wp-content/themes/acme/style.css">
  <script>!function(f,b,e,v,n,t,s){n.src='https://connect.facebook.net/en_US/fbevents.js'}(window)</script>
</head><body>
  <p>We integrate with Salesforce, Shopify and Intercom.</p>
  <form action="https://webto.salesforce.com/servlet/servlet.WebToLead" method="post"></form>
</body></html>`;

const ACME: TechSignals = {
  domain: "acme.com",
  pageUrl: "https://www.acme.com/",
  mx: ["1 aspmx.l.google.com", "5 alt1.aspmx.l.google.com"],
  txt: [
    "v=spf1 include:_spf.google.com include:mail.zendesk.com include:_spf.salesforce.com ~all",
    "docusign=1b2c3d4e-aaaa-bbbb-cccc-1234567890ab",
    "atlassian-domain-verification=abcdefghijklmnopqrstuvwxyz",
    "google-site-verification=xyz",
  ],
  ns: ["lara.ns.cloudflare.com", "rick.ns.cloudflare.com"],
  cnames: [{ host: "www.acme.com", targets: ["acme.netlify.app"] }],
  ips: [{ host: "acme.com", ip: "75.2.60.5", provider: "aws" }],
  headers: { server: "Netlify", "x-nf-request-id": "01ABC" },
  html: HOMEPAGE,
};

describe("tech stack detection", () => {
  it("reads vendors from mail records, name servers, CNAMEs, IP ranges, headers and page tags", () => {
    const found = vendorsOf(ACME);
    for (const v of ["Google Workspace", "Zendesk", "Salesforce", "DocuSign", "Atlassian", "Cloudflare", "Netlify",
      "Amazon Web Services", "WordPress", "Google Tag Manager", "HubSpot", "Meta Pixel", "Google Search Console"]) {
      assert.ok(found.includes(v), `missing ${v}`);
    }
  });

  it("never counts a vendor only named in the page's visible text", () => {
    const found = vendorsOf({ domain: "acme.com", html: "<html><body><p>We work with Shopify, Intercom and Stripe.</p></body></html>" });
    assert.deepEqual(found, []);
  });

  it("each vendor appears once, from its strongest signal (DNS before the page)", () => {
    const items = detectTechStack(ACME);
    assert.equal(new Set(items.map((i) => i.vendor)).size, items.length);
    const sf = items.find((i) => i.vendor === "Salesforce")!;
    assert.equal(sf.layer, "dns");
    assert.equal(sf.evidence, "SPF include: _spf.salesforce.com");
    assert.equal(sf.sourceName, "Public DNS (TXT)");
    const netlify = items.find((i) => i.vendor === "Netlify")!;
    assert.equal(netlify.evidence, "CNAME: www.acme.com → acme.netlify.app");
  });

  it("every item is confirmed and cites a source; items follow the category order", () => {
    const items = detectTechStack(ACME);
    for (const i of items) {
      assert.equal(i.confidence, "confirmed");
      assert.ok(i.evidence && i.sourceName && /^https:\/\//.test(i.sourceUrl), i.vendor);
    }
    const ranks = items.map((i) => CATEGORY_ORDER.indexOf(i.category));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  });

  it("a Search Console token isn't read as Google Workspace", () => {
    assert.deepEqual(vendorsOf({ domain: "acme.com", txt: ["google-site-verification=abc"] }), ["Google Search Console"]);
  });

  it("a Dropbox token isn't read as Box", () => {
    assert.deepEqual(vendorsOf({ domain: "a.com", txt: ["dropbox-domain-verification=abc123"] }), ["Dropbox"]);
  });

  it("verification tokens are shortened in the evidence", () => {
    const docusign = detectTechStack(ACME).find((i) => i.vendor === "DocuSign")!;
    assert.ok(!docusign.evidence.includes("1234567890ab"), docusign.evidence);
  });

  it("a header signal needs its value to match when the row names one", () => {
    assert.deepEqual(vendorsOf({ domain: "a.com", headers: { server: "nginx" } }), []);
    assert.deepEqual(vendorsOf({ domain: "a.com", headers: { server: "cloudflare" } }), ["Cloudflare"]);
  });

  it("the vendor table has no duplicate vendors and every category is ordered", () => {
    const names = VENDORS.map((v) => v.vendor);
    assert.equal(new Set(names).size, names.length);
    for (const v of VENDORS) assert.ok(CATEGORY_ORDER.includes(v.category), v.vendor);
  });
});

describe("page assets", () => {
  it("collects tag URLs, form targets, the generator and inline scripts, not body text", () => {
    const assets = pageAssets(HOMEPAGE);
    assert.ok(assets.includes("https://js.hs-scripts.com/1234567.js"));
    assert.ok(assets.includes("https://webto.salesforce.com/servlet/servlet.WebToLead"));
    assert.ok(assets.includes("generator: WordPress 6.6.2"));
    assert.ok(assets.some((a) => a.includes("fbevents.js")));
    assert.ok(!assets.some((a) => a.includes("We integrate with")));
  });
});

describe("cloud IP ranges", () => {
  it("matches an address to the most specific published range", () => {
    const ranges = [parseCidr("13.32.0.0/12", "aws")!, parseCidr("13.32.0.0/15", "cloudfront")!, parseCidr("104.16.0.0/13", "cloudflare")!];
    assert.equal(providerFor("13.32.5.9", ranges), "cloudfront");
    assert.equal(providerFor("13.40.1.1", ranges), "aws");
    assert.equal(providerFor("104.18.2.3", ranges), "cloudflare");
    assert.equal(providerFor("8.8.8.8", ranges), undefined);
    assert.equal(providerFor("not an ip", ranges), undefined);
  });

  it("rejects malformed ranges", () => {
    for (const bad of ["1.2.3/24", "1.2.3.4/33", "300.1.1.1/8", "abc"]) assert.equal(parseCidr(bad, "aws"), undefined, bad);
    assert.ok(parseCidr("0.0.0.0/0", "aws"));
  });
});

describe("domain posture still reads mail vendors from the shared table", () => {
  it("keeps its existing results and order", () => {
    assert.deepEqual(systemsInUse(["mx0a-001.pphosted.com"], ["v=spf1 include:spf.protection.outlook.com -all"]), ["Microsoft 365", "Proofpoint"]);
    assert.deepEqual(systemsInUse(["10 aspmx.l.google.com"], ["v=spf1 include:_spf.google.com ~all"]), ["Google Workspace"]);
  });
});

describe("Tech Stack report section", () => {
  const stack: TechStack = { domain: "acme.com", checkedAt: "2026-11-10T12:00:00Z", items: detectTechStack(ACME) };
  const bundle: ResearchBundle = {
    query: "Acme", generatedAt: stack.checkedAt, company: { name: "Acme" },
    leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], techStack: stack,
  };

  it("writes one viewer-parseable line per tool under its own heading", () => {
    const md = new ReportAgent().generate(bundle);
    const start = md.indexOf(`## ${TECH_SECTION_TITLE}`);
    assert.ok(start >= 0);
    const body = md.slice(start, md.indexOf("\n## ", start + 1));
    const lines = body.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
    assert.equal(lines.length, stack.items.length);
    for (const l of lines) assert.match(l, TECH_LINE, l);
  });

  it("says when only DNS could be read, and that missing means not visible", () => {
    assert.match(techSummary({ ...stack, websiteUnavailable: "the site returned HTTP 403" }), /Public DNS only; the homepage couldn't be read \(the site returned HTTP 403\)/);
    assert.match(techSummary({ ...stack, items: [] }), /no tools visible in public records/);
    assert.match(techSummary(stack), /not visible, not not used/);
  });

  it("is left out entirely when the check didn't run", () => {
    const md = new ReportAgent().generate({ ...bundle, techStack: undefined });
    assert.ok(!md.includes(`## ${TECH_SECTION_TITLE}`));
  });
});
