import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpportunities, pullSamOpportunities, samDate } from "./sam-gov.js";

const NOTICE = {
  noticeId: "abc123",
  title: "Fleet telematics services",
  solicitationNumber: "N00189-27-R-0001",
  fullParentPathName: "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP",
  postedDate: "2026-11-10",
  type: "Solicitation",
  naicsCode: "541512",
  typeOfSetAsideDescription: "Total Small Business Set-Aside",
  responseDeadLine: "2026-12-15T17:00:00-05:00",
  active: "Yes",
  uiLink: "https://sam.gov/opp/abc123/view",
};

test("dates are MM/dd/yyyy", () => {
  assert.equal(samDate(new Date("2026-03-07T23:00:00Z")), "03/07/2026");
});

test("keeps active shopping-type notices, with a SAM.gov link", () => {
  const rows = parseOpportunities({
    opportunitiesData: [
      NOTICE,
      { ...NOTICE, noticeId: "award1", type: "Award Notice" },
      { ...NOTICE, noticeId: "inactive", active: "No" },
      { ...NOTICE, noticeId: "nolink", uiLink: "https://evil.example/x" },
      { ...NOTICE, noticeId: "bad id!" },
      { title: "missing fields" },
    ],
  });
  assert.deepEqual(rows.map((r) => r.notice_id), ["abc123", "nolink"]);
  assert.equal(rows[0].response_deadline, "2026-12-15T22:00:00.000Z");
  assert.equal(rows[0].agency_path, "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP");
  assert.equal(rows[1].url, "https://sam.gov/opp/nolink/view");
  assert.deepEqual(parseOpportunities({}), []);
});

/** Minimal Supabase stand-in: records calls, returns the given last pull. */
function fakeSupabase(lastFetchedAt: string | null) {
  const calls: { op: string; arg?: unknown }[] = [];
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "lt", "is", "eq"]) q[m] = () => q;
    (q as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return q;
  };
  return {
    calls,
    client: {
      from: () => ({
        select: () => chain({ data: lastFetchedAt ? [{ fetched_at: lastFetchedAt }] : [], error: null }),
        upsert: (rows: unknown) => { calls.push({ op: "upsert", arg: rows }); return Promise.resolve({ error: null }); },
        delete: () => { calls.push({ op: "delete" }); return chain({ count: 0, error: null }); },
      }),
    },
  };
}

const NOW = new Date("2026-11-11T12:00:00Z");

test("skips when the last pull is recent, without calling SAM.gov", async () => {
  const { client } = fakeSupabase("2026-11-11T02:00:00Z");
  let fetched = false;
  const r = await pullSamOpportunities(client as never, "key", NOW, (async () => { fetched = true; return new Response("{}"); }) as typeof fetch);
  assert.equal(r.skipped, "pulled recently");
  assert.equal(fetched, false);
});

test("pulls, saves shopping notices and stops at the last page", async () => {
  const { client, calls } = fakeSupabase(null);
  const urls: string[] = [];
  const fake = (async (url: URL) => {
    urls.push(url.toString());
    return new Response(JSON.stringify({ totalRecords: 2, opportunitiesData: [NOTICE, { ...NOTICE, noticeId: "x2", type: "Award Notice" }] }));
  }) as unknown as typeof fetch;
  const r = await pullSamOpportunities(client as never, "key", NOW, fake);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /postedFrom=10%2F28%2F2026/); // 14-day backfill on an empty table
  assert.deepEqual({ fetched: r.fetched, kept: r.kept }, { fetched: 2, kept: 1 });
  assert.equal((calls.find((c) => c.op === "upsert")!.arg as { notice_id: string }[])[0].notice_id, "abc123");
});

test("a failed first page throws without the key in the message", async () => {
  const { client } = fakeSupabase(null);
  const fake = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(pullSamOpportunities(client as never, "secret-key", NOW, fake), (err: Error) => /429/.test(err.message) && !err.message.includes("secret-key"));
});
