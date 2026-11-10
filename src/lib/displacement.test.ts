import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { distinctiveTokens, knownVendor, peerDomain, peerGaps, weakSpots, type PeerStack } from "./displacement.js";

const NOW = new Date("2026-11-10T12:00:00Z");

describe("vendor weak spots", () => {
  it("keeps dated, classified news that names the vendor, newest first", () => {
    const got = weakSpots("HubSpot", [
      { title: "HubSpot raises prices for Sales Hub", url: "https://n/1", date: "Oct 1, 2026" },
      { title: "HubSpot outage hits marketers", url: "https://n/2", date: "2 months ago" },
      { title: "Salesforce raises prices", url: "https://n/3", date: "2026-10-02" },
      { title: "HubSpot lays off 7% of staff", url: "https://n/4", date: "Jan 3, 2023" },
      { title: "HubSpot opens Dublin office", url: "https://n/5", date: "2026-10-05" },
      { title: "HubSpot breach exposed customer data", url: "https://n/6" },
    ], NOW);
    assert.deepEqual(got.map((w) => [w.kind, w.title, w.date]), [
      ["price_increase", "HubSpot raises prices for Sales Hub", "2026-10-01"],
      ["outage", "HubSpot outage hits marketers", "2026-09-11"],
    ]);
  });

  it("at most two per kind, and one story per kind per day", () => {
    const res = [1, 2, 3].map((i) => ({ title: `Zendesk outage ${i}`, url: `https://n/${i}`, date: `2026-10-0${i}` }));
    assert.equal(weakSpots("Zendesk", res, NOW).length, 2);
    const same = [{ title: "HubSpot lays off 660", url: "https://a", date: "2026-10-11" }, { title: "HubSpot layoffs explained", url: "https://b", date: "2026-10-11" }];
    assert.equal(weakSpots("HubSpot", same, NOW).length, 1);
  });

  it("the vendor buying a company or an employee lawsuit isn't a weak spot; being bought or a class action is", () => {
    const got = weakSpots("Zendesk", [
      { title: "Zendesk acquires Forethought", url: "https://n/1", date: "2026-04-14" },
      { title: "Engineer sues Zendesk over firing", url: "https://n/2", date: "2026-05-01" },
      { title: "Zendesk to be acquired by private equity group", url: "https://n/3", date: "2026-06-01" },
      { title: "Zendesk faces class action over data handling", url: "https://n/4", date: "2026-07-01" },
    ], NOW);
    assert.deepEqual(got.map((w) => w.kind), ["lawsuit", "acquisition"]);
  });

  it("only vendors from the tech stack table can be looked up", () => {
    assert.equal(knownVendor("hubspot"), "HubSpot");
    assert.equal(knownVendor("Some Random Co"), undefined);
    assert.equal(knownVendor(42), undefined);
  });
});

describe("peer domains", () => {
  it("takes the first result whose domain carries a distinctive word of the name", () => {
    assert.equal(peerDomain("Sonepar", [
      { title: "Sonepar - LinkedIn", url: "https://www.linkedin.com/company/sonepar" },
      { title: "Sonepar", url: "https://www.sonepar.com/en" },
    ]), "sonepar.com");
  });

  it("never takes a namesake or directory", () => {
    assert.equal(peerDomain("Wesco", [{ title: "Wesco Aircraft", url: "https://www.bloomberg.com/profile/x" }]), undefined);
    assert.equal(peerDomain("Rexel", [{ title: "Rexel careers", url: "https://jobs.example.com/rexel" }]), undefined);
  });

  it("an all-generic name only matches its initials", () => {
    assert.deepEqual(distinctiveTokens("Consolidated Electrical Distributors"), []);
    assert.equal(peerDomain("Consolidated Electrical Distributors", [
      { title: "Electrical Distributors Inc", url: "https://electricaldistributors.com" },
      { title: "CED", url: "https://www.ced.com/" },
    ]), "ced.com");
  });
});

describe("peer urgency", () => {
  const peer = (name: string, vendors: [string, string][]): PeerStack => ({
    name, domain: `${name.toLowerCase()}.com`,
    items: vendors.map(([vendor, category]) => ({ vendor, category, sourceUrl: `https://dns/${name}/${vendor}`, evidence: `${vendor} record` })),
  });

  it("flags tools two or more peers use that the target doesn't", () => {
    const gaps = peerGaps(["HubSpot"], [
      peer("Wesco", [["Salesforce", "CRM"], ["HubSpot", "Marketing automation"], ["Amazon Route 53", "DNS"]]),
      peer("Sonepar", [["Salesforce", "CRM"], ["Zendesk", "Customer support"], ["Amazon Route 53", "DNS"]]),
      peer("Rexel", [["Salesforce", "CRM"], ["Zendesk", "Customer support"]]),
    ]);
    assert.deepEqual(gaps.map((g) => [g.vendor, g.peers.map((p) => p.name), g.of]), [
      ["Salesforce", ["Wesco", "Sonepar", "Rexel"], 3],
      ["Zendesk", ["Sonepar", "Rexel"], 3],
    ]);
    for (const g of gaps) for (const p of g.peers) assert.match(p.url, /^https:\/\//);
  });

  it("needs two peers with a readable stack", () => {
    assert.deepEqual(peerGaps([], [peer("Only", [["Salesforce", "CRM"]]), peer("Empty", [])]), []);
  });
});
