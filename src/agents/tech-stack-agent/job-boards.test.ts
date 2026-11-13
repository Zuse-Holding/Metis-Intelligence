import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apiUrl, boardsFromHtml, careersUrls, parsePostings, plainText, readBoard, toolsFromPostings, type JobPosting } from "./job-boards.js";
import { techSummary } from "./render.js";

const posting = (title: string, text: string, url = "https://boards.greenhouse.io/acme/jobs/1"): JobPosting => ({ title, url, text, board: "Greenhouse" });

describe("finding the job board on the company's own pages", () => {
  it("reads Greenhouse, Lever and Ashby links, including Greenhouse embeds", () => {
    const html = `<a href="https://boards.greenhouse.io/geckorobotics">Jobs</a>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=other"></script>
      <a href="https://jobs.lever.co/acme-co/abc">Apply</a>
      <a href="https://jobs.ashbyhq.com/Acme.io">Careers</a>`;
    assert.deepEqual(boardsFromHtml(html), [
      { ats: "Greenhouse", token: "geckorobotics", url: "https://boards.greenhouse.io/geckorobotics" },
      { ats: "Lever", token: "acme-co", url: "https://jobs.lever.co/acme-co" },
      { ats: "Ashby", token: "Acme.io", url: "https://jobs.ashbyhq.com/Acme.io" },
    ]);
    assert.deepEqual(boardsFromHtml(`<script src="https://boards.greenhouse.io/embed/job_board/js?for=gecko"></script>`).map((b) => b.token), ["gecko"]);
    assert.deepEqual(boardsFromHtml(`<a href="https://job-boards.greenhouse.io/acme/jobs/123">x</a>`).map((b) => b.token), ["acme"]);
    assert.deepEqual(boardsFromHtml("<p>We use LinkedIn</p>"), []);
  });

  it("only tries careers pages on the company's own site", () => {
    const urls = careersUrls("https://acme.com/", `<a href="/careers/open-roles">x</a><a href="https://other.com/jobs">y</a>`);
    assert.deepEqual(urls, ["https://acme.com/careers/open-roles", "https://acme.com/careers", "https://acme.com/jobs"]);
  });
});

describe("reading the boards", () => {
  it("builds each ATS's public API URL", () => {
    assert.equal(apiUrl({ ats: "Greenhouse", token: "acme", url: "" }), "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    assert.equal(apiUrl({ ats: "Lever", token: "acme", url: "" }), "https://api.lever.co/v0/postings/acme?mode=json");
    assert.equal(apiUrl({ ats: "Ashby", token: "acme", url: "" }), "https://api.ashbyhq.com/posting-api/job-board/acme");
  });

  it("parses each API's shape and skips malformed postings", () => {
    const gh = parsePostings("Greenhouse", { jobs: [
      { title: "Senior Accountant", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", first_published: "2026-10-01T00:00:00Z", content: "&lt;p&gt;Own the close in &lt;strong&gt;NetSuite&lt;/strong&gt;.&lt;/p&gt;" },
      { title: "", absolute_url: "https://x" },
      { title: "No link" },
    ] });
    assert.deepEqual(gh, [{ title: "Senior Accountant", url: "https://boards.greenhouse.io/acme/jobs/1", postedAt: "2026-10-01T00:00:00.000Z", text: "Own the close in NetSuite .", board: "Greenhouse" }]);
    const lv = parsePostings("Lever", [{ text: "Data Engineer", hostedUrl: "https://jobs.lever.co/acme/2", createdAt: 1793836800000, descriptionPlain: "Build pipelines.", lists: [{ text: "Requirements", content: "<li>Snowflake and dbt</li>" }] }]);
    assert.equal(lv[0].title, "Data Engineer");
    assert.match(lv[0].text, /Requirements\n- Snowflake and dbt/);
    const ab = parsePostings("Ashby", { jobs: [
      { title: "Project Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/3", publishedAt: "2026-11-01", descriptionPlain: "Manage RFIs in Procore." },
      { title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/4", isListed: false, descriptionPlain: "x" },
    ] });
    assert.deepEqual(ab.map((p) => p.title), ["Project Engineer"]);
    assert.deepEqual(parsePostings("Ashby", "not json"), []);
  });

  it("a board that doesn't answer with JSON reads as nothing, not an error", async () => {
    const html = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
    assert.equal(await readBoard({ ats: "Lever", token: "acme", url: "" }, html), null);
    const ok = (async () => new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } })) as typeof fetch;
    assert.deepEqual(await readBoard({ ats: "Lever", token: "acme", url: "" }, ok), []);
  });

  it("decodes Greenhouse's double-encoded HTML", () => {
    assert.equal(plainText("&amp;lt;li&amp;gt;SAP S/4HANA&amp;lt;/li&amp;gt;"), "- SAP S/4HANA");
  });
});

describe("tools named in postings", () => {
  it("finds internal tools with the sentence that names them", () => {
    const tools = toolsFromPostings([
      posting("Senior Accountant", "Responsibilities\n- Own the month-end close in NetSuite\n- Build reports in Tableau"),
      posting("Project Engineer", "You will manage submittals in Procore.", "https://boards.greenhouse.io/acme/jobs/2"),
    ]);
    assert.deepEqual(tools.map((t) => [t.vendor, t.category, t.quote]), [
      ["NetSuite", "Accounting and ERP", "Own the month-end close in NetSuite"],
      ["Tableau", "Business intelligence", "Build reports in Tableau"],
      ["Procore", "Construction management", "You will manage submittals in Procore."],
    ]);
    assert.equal(tools[2].posting.url, "https://boards.greenhouse.io/acme/jobs/2");
  });

  it("a list of options doesn't count, but a later posting naming one outright does", () => {
    const options = posting("Controller", "Experience with an ERP such as NetSuite, SAP S/4HANA or Sage Intacct.");
    assert.deepEqual(toolsFromPostings([options]), []);
    const plain = posting("AP Specialist", "Process invoices in NetSuite daily.", "https://boards.greenhouse.io/acme/jobs/9");
    assert.deepEqual(toolsFromPostings([options, plain]).map((t) => [t.vendor, t.posting.title]), [["NetSuite", "AP Specialist"]]);
  });

  it("a parenthesised list doesn't count (Gecko: customers' plant systems)", () => {
    const p = posting("Solutions Engineer", "Experience with CMMS or EAM master data (SAP PM, Maximo, JD Edwards) at customer sites.");
    assert.deepEqual(toolsFromPostings([p]), []);
    assert.deepEqual(toolsFromPostings([posting("Analyst", "Reporting (in Tableau) for the ops team.")]).map((t) => t.vendor), ["Tableau"]);
  });

  it("common words don't match: sage advice, a vista, plain SAP-less text", () => {
    assert.deepEqual(toolsFromPostings([posting("Analyst", "Offer sage advice with a broad vista. Comfortable in a fast-paced spectrum of work.")]), []);
  });
});

describe("the section's summary line", () => {
  it("says which job boards were read and that likely items may come from postings", () => {
    const line = techSummary({
      domain: "acme.com", checkedAt: "", subdomainsChecked: false,
      items: [{ vendor: "NetSuite", category: "Accounting and ERP", confidence: "likely", layer: "jobs", evidence: "x", sourceName: "Job posting (Greenhouse)", sourceUrl: "https://x" }],
      jobBoards: [{ ats: "Greenhouse", url: "https://boards.greenhouse.io/acme", postings: [] }],
    });
    assert.match(line, /1 tool found \(1 likely, from subdomain names or job postings\)\. From public DNS, the homepage and job postings on Greenhouse\./);
  });
});
