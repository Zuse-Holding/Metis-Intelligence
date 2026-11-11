import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectTechStack, ownSubdomains, subdomainWords, subdomainsToResolve, type TechSignals } from "./index.js";

const SRC = { name: "Certificate logs (crt.sh)", url: "https://crt.sh/?q=%25.acme.com" };

describe("certificate-log subdomains", () => {
  it("keeps only the company's own subdomains: no wildcards, apex or other companies", () => {
    assert.deepEqual(ownSubdomains([
      "*.acme.com", "acme.com", "jira.corp.acme.com", "JIRA.corp.acme.com.", "help.acme.com",
      "image.e.zurich.co.uk", "notacme.com", "bad_name.acme.com",
    ], "acme.com"), ["help.acme.com", "jira.corp.acme.com"]);
  });

  it("splits a subdomain into its words below the domain", () => {
    assert.deepEqual(subdomainWords("fioridev.sap-gw.acme.com", "acme.com"), ["fioridev", "sap", "gw"]);
    assert.deepEqual(subdomainWords("acme.com.evil.net", "acme.com"), []);
  });

  it("looks up hosted-service names first, then vendor-named ones, capped", () => {
    const order = subdomainsToResolve(["zz-app.acme.com", "jira.acme.com", "help.acme.com", "a.acme.com"], "acme.com", 3);
    assert.deepEqual(order, ["help.acme.com", "jira.acme.com", "a.acme.com"]);
  });
});

describe("tech stack from subdomains", () => {
  const base: TechSignals = { domain: "acme.com", subdomainSource: SRC };

  it("a subdomain pointing at a vendor is confirmed; a name alone is likely", () => {
    const items = detectTechStack({
      ...base,
      subdomains: ["help.acme.com", "jira.corp.acme.com", "fioriqa.acme.com", "vpn.acme.com", "asap.acme.com"],
      cnames: [{ host: "help.acme.com", targets: ["acme.zendesk.com"], fromLogs: true }],
    });
    const byVendor = Object.fromEntries(items.map((i) => [i.vendor, [i.confidence, i.layer, i.evidence]]));
    assert.deepEqual(byVendor.Zendesk, ["confirmed", "subdomain", "CNAME: help.acme.com → acme.zendesk.com"]);
    assert.deepEqual(byVendor.Atlassian, ["likely", "subdomain", "Subdomain: jira.corp.acme.com (certificate logs)"]);
    assert.deepEqual(byVendor.SAP?.[0], "likely");
    // "vpn" names no vendor; "asap" isn't "sap".
    assert.equal(items.length, 3);
  });

  it("a confirmed record beats a subdomain name for the same vendor", () => {
    const items = detectTechStack({ ...base, txt: ["atlassian-domain-verification=abc"], subdomains: ["jira.acme.com"] });
    const a = items.find((i) => i.vendor === "Atlassian")!;
    assert.equal(a.confidence, "confirmed");
    assert.equal(a.layer, "dns");
  });

  it("a hosted service's own infrastructure isn't credited to the company", () => {
    const items = detectTechStack({
      ...base,
      subdomains: ["image.email.acme.com", "b2b.acme.com", "app.acme.com"],
      cnames: [
        { host: "image.email.acme.com", targets: ["x.image-sap.sfmc-content.com", "d33.cloudfront.net"], fromLogs: true },
        { host: "b2b.acme.com", targets: ["elasticsuite.com.cdn.cloudflare.net"], fromLogs: true },
        { host: "app.acme.com", targets: ["acme-app.azurewebsites.net"], fromLogs: true },
      ],
    });
    assert.deepEqual(items.map((i) => i.vendor).sort(), ["Microsoft Azure", "Salesforce Marketing Cloud Engagement"]);
  });

  it("the company's own Cloudflare zone still counts", () => {
    const items = detectTechStack({ ...base, subdomains: ["shop.acme.com"], cnames: [{ host: "shop.acme.com", targets: ["shop.acme.com.cdn.cloudflare.net"], fromLogs: true }] });
    assert.deepEqual(items.map((i) => i.vendor), ["Cloudflare"]);
  });

  it("no certificate source: subdomain names are ignored", () => {
    assert.deepEqual(detectTechStack({ domain: "acme.com", subdomains: ["jira.acme.com"] }), []);
  });
});
