import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agencyPostings, matchAgency, parseAgencies, parseSearch, usaJobsConfig } from "./usajobs.js";
import { intentSignals } from "./buyer-intent.js";

const CODES = { CodeList: [{ ValidValue: [
  { Code: "NV", Value: "Department of the Navy", ParentCode: "DD", IsDisabled: "No" },
  { Code: "NV18", Value: "Naval Supply Systems Command", ParentCode: "NV", IsDisabled: "No" },
  { Code: "AR", Value: "Department of the Army", ParentCode: "DD", IsDisabled: "No" },
  { Code: "XX", Value: "Department of the Old", IsDisabled: "Yes" },
] }] };

const SEARCH = { SearchResult: { SearchResultItems: [
  { MatchedObjectDescriptor: {
    PositionTitle: "IT Specialist (SYSADMIN)", PositionURI: "https://www.usajobs.gov/job/812345600",
    PublicationStartDate: "2026-11-03T00:00:00.0000", QualificationSummary: "Administer ServiceNow workflows for the fleet.",
    UserArea: { Details: { JobSummary: "Supports Navy IT operations." } },
  } },
  { MatchedObjectDescriptor: { PositionTitle: "Off-site", PositionURI: "https://evil.example/job/1" } },
  { MatchedObjectDescriptor: { PositionURI: "https://www.usajobs.gov/job/2" } },
] } };

describe("USAJobs", () => {
  it("is off without both the key and the contact email", () => {
    assert.equal(usaJobsConfig({}), undefined);
    assert.equal(usaJobsConfig({ USAJOBS_API_KEY: "k" }), undefined);
    assert.deepEqual(usaJobsConfig({ USAJOBS_API_KEY: "k", USAJOBS_EMAIL: "ops@example.com" }), { key: "k", email: "ops@example.com" });
  });

  it("matches an account to exactly one agency by normalised name", () => {
    const agencies = parseAgencies(CODES);
    assert.deepEqual(agencies.map((a) => a.code), ["NV", "NV18", "AR"]);
    assert.equal(matchAgency("DEPT OF THE NAVY", agencies)?.code, "NV");
    assert.equal(matchAgency("Department of the Army", agencies)?.code, "AR");
    assert.equal(matchAgency("NAVY, DEPARTMENT OF THE", agencies)?.code, "NV");
    assert.equal(matchAgency("Navy", agencies), undefined);
    assert.equal(matchAgency("Gecko Robotics", agencies), undefined);
    assert.equal(matchAgency("Department of the Old", agencies), undefined);
  });

  it("keeps only usajobs.gov postings, with the tools they name", () => {
    assert.deepEqual(parseSearch(SEARCH), [
      { title: "IT Specialist (SYSADMIN)", url: "https://www.usajobs.gov/job/812345600", postedAt: "2026-11-03T00:00:00.000Z", tools: ["ServiceNow"] },
    ]);
    assert.deepEqual(parseSearch(null), []);
  });

  it("sends the required headers and feeds the hiring signal", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      const body = String(url).includes("codelist") ? CODES : SEARCH;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const roles = await agencyPostings("DEPT OF THE NAVY", { key: "k", email: "ops@example.com" }, fake);
    assert.equal(roles?.length, 1);
    const search = calls.find((c) => c.url.includes("/api/search"))!;
    assert.match(search.url, /Organization=NV&/);
    assert.deepEqual([search.headers.Host, search.headers["User-Agent"], search.headers["Authorization-Key"]], ["data.usajobs.gov", "ops@example.com", "k"]);
    assert.equal(await agencyPostings("DEPT OF THE NAVY", undefined, fake), undefined);
    const signals = intentSignals({}, undefined, [], new Date("2026-11-13T00:00:00Z"), roles!);
    assert.deepEqual(signals.map((s) => [s.kind, s.title, s.date, s.tools]), [["hiring", "IT Specialist (SYSADMIN)", "2026-11-03", ["ServiceNow"]]]);
  });
});
