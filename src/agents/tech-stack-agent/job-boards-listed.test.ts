import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardsFromHtml, MAX_DETAILS, parseSmartRecruitersPosting, parseWorkablePosting, parseWorkdayList, parseWorkdayPosting, readBoard, workdayBase } from "./job-boards.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("Workday, SmartRecruiters and Workable boards", () => {
  it("finds them from links on the company's own pages", () => {
    const boards = boardsFromHtml(`
      <a href="https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers/job/x">Jobs</a>
      <a href="https://careers.smartrecruiters.com/AcmeCo">More</a>
      <a href="https://apply.workable.com/acme-inc/j/ABC123/">Apply</a>`);
    assert.deepEqual(boards.map((b) => [b.ats, b.token, b.url]), [
      ["Workday", "acme.wd5/AcmeCareers", "https://acme.wd5.myworkdayjobs.com/AcmeCareers"],
      ["SmartRecruiters", "AcmeCo", "https://jobs.smartrecruiters.com/AcmeCo"],
      ["Workable", "acme-inc", "https://apply.workable.com/acme-inc/"],
    ]);
    assert.deepEqual(boardsFromHtml(`https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/x`), []);
  });

  it("builds the Workday API base only from a well-formed token", () => {
    assert.equal(workdayBase("acme.wd5/AcmeCareers"), "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/AcmeCareers");
    assert.equal(workdayBase("acme/AcmeCareers"), undefined);
    assert.equal(workdayBase("acme.wd5/../x"), undefined);
  });

  it("parses each posting with its own URL, date and text", () => {
    assert.deepEqual(parseWorkdayList({ jobPostings: [{ externalPath: "/job/Remote/ERP-Analyst_R1" }, { externalPath: "https://evil.example" }] }), ["/job/Remote/ERP-Analyst_R1"]);
    const wd = parseWorkdayPosting({ jobPostingInfo: { title: "ERP Analyst", externalUrl: "https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/Remote/ERP-Analyst_R1", startDate: "2026-11-01", jobDescription: "<p>Own our NetSuite rollout.</p>" } })!;
    assert.deepEqual([wd.title, wd.postedAt, wd.text, wd.board], ["ERP Analyst", "2026-11-01T00:00:00.000Z", "Own our NetSuite rollout.", "Workday"]);
    const sr = parseSmartRecruitersPosting({ name: "Controller", postingUrl: "https://jobs.smartrecruiters.com/AcmeCo/1-controller", releasedDate: "2026-10-01T00:00:00Z", jobAd: { sections: { qualifications: { text: "<ul><li>Sage Intacct</li></ul>" } } } })!;
    assert.match(sr.text, /Sage Intacct/);
    assert.equal(parseSmartRecruitersPosting({ name: "x", postingUrl: "https://evil.example/1" }), undefined);
    const wk = parseWorkablePosting("acme-inc", { shortcode: "ABC123", title: "Ops Lead", published: "2026-11-05T00:00:00.000Z", requirements: "<li>Procore</li>" })!;
    assert.equal(wk.url, "https://apply.workable.com/acme-inc/j/ABC123/");
  });

  it("reads at most MAX_DETAILS postings, skipping ones that fail or point off the tenant", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => ({ externalPath: `/job/Remote/Role_${i}` }));
    let detailCalls = 0;
    const fake = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/jobs")) { assert.equal(init?.method, "POST"); return json({ jobPostings: paths }); }
      detailCalls++;
      const i = Number(u.split("_").pop());
      if (i === 3) return new Response("down", { status: 500 });
      const host = i === 4 ? "https://evil.example/" : "https://acme.wd5.myworkdayjobs.com/AcmeCareers";
      return json({ jobPostingInfo: { title: `Role ${i}`, externalUrl: `${host}/job/Remote/Role_${i}`, jobDescription: "x" } });
    }) as typeof fetch;
    const got = await readBoard({ ats: "Workday", token: "acme.wd5/AcmeCareers", url: "" }, fake);
    assert.equal(detailCalls, MAX_DETAILS);
    assert.equal(got?.length, MAX_DETAILS - 2);
    const down = (async () => new Response("no", { status: 403 })) as typeof fetch;
    assert.equal(await readBoard({ ats: "SmartRecruiters", token: "AcmeCo", url: "" }, down), null);
  });
});
