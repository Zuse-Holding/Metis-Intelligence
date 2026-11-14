import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTriggerAlerts, triggerAlertEmail, type AlertTrigger } from "./trigger-alerts.js";

const t = (over: Partial<AlertTrigger>): AlertTrigger => ({
  id: "t1", accountId: "a1", company: "Gecko Robotics", runId: "r1", kind: "funding", atRisk: false,
  title: "Series D, $125M", url: "https://news.example/gecko", eventDate: "2026-11-10", ...over,
});

describe("trigger alert email", () => {
  it("cites every line, puts at-risk first and links the Sales tab of the latest report", () => {
    const email = triggerAlertEmail([
      t({}),
      t({ id: "t2", kind: "layoffs", atRisk: true, title: "Gecko cuts 40 jobs", url: "https://news.example/cuts" }),
      t({ id: "t3", title: "No source", url: "" }),
    ], "Nick", "https://metis.test/unsubscribe?t=x", "https://metis.test")!;
    assert.equal(email.subject, "What changed at Gecko Robotics");
    const body = email.text;
    assert.ok(body.indexOf("At risk. Layoffs: Gecko cuts 40 jobs") < body.indexOf("Funding: Series D"));
    assert.match(body, /Source: https:\/\/news\.example\/cuts/);
    assert.match(body, /https:\/\/metis\.test\/app\?run=r1&tab=sales/);
    assert.doesNotMatch(body, /No source/);
    assert.match(body, /Unsubscribe: https:\/\/metis\.test\/unsubscribe\?t=x/);
  });

  it("sends nothing without a cited trigger", () => {
    assert.equal(triggerAlertEmail([t({ url: "" })], "", "u"), null);
  });

  it("names the account count when there are several", () => {
    const email = triggerAlertEmail([t({}), t({ id: "t2", accountId: "a2", company: "Graybar" })], "", "u")!;
    assert.equal(email.subject, "What changed at 2 of your accounts");
  });
});

/** Just enough of the Supabase query builder for sendTriggerAlerts. */
function fakeSupabase(rows: Record<string, unknown>[], profile: Record<string, unknown> | null) {
  const updates: string[] = [];
  const builder = (table: string) => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | undefined;
    const q: Record<string, unknown> = {};
    const run = () => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) { for (const r of hit) Object.assign(r, patch); updates.push(`${table}:${hit.length}`); }
      return hit.map((r) => ({ ...r, accounts: { company: r.company } }));
    };
    Object.assign(q, {
      select: () => q,
      update: (p: Record<string, unknown>) => { patch = p; return q; },
      is: (col: string, v: unknown) => { filters.push((r) => (r[col] ?? null) === v); return q; },
      eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return q; },
      lt: (col: string, v: string) => { filters.push((r) => String(r[col]) < v); return q; },
      limit: () => q,
      maybeSingle: async () => ({ data: profile }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "profiles" ? profile : run(), error: null }).then(res),
    });
    return q;
  };
  return {
    client: { from: builder, auth: { admin: { getUserById: async () => ({ data: { user: { email: "rep@example.com" } } }) } } } as unknown as SupabaseClient,
    updates,
  };
}

describe("sending trigger alerts", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const row = (over: Record<string, unknown>) => ({
    id: "t1", user_id: "u1", account_id: "a1", run_id: "r1", kind: "funding", at_risk: false, company: "Gecko Robotics",
    title: "Series D", url: "https://news.example/gecko", event_date: null, detected_at: "2026-11-13T10:00:00Z", alerted_at: null, ...over,
  });
  const unsubscribe = () => ({ url: "https://metis.test/unsubscribe", headers: { "List-Unsubscribe": "<x>" } });

  it("sends once per user, marks rows, and skips old ones", async () => {
    const rows = [row({}), row({ id: "t2", title: "Old news", detected_at: "2026-11-01T00:00:00Z" })];
    const { client } = fakeSupabase(rows, { display_name: "Nick O" });
    const sent: string[] = [];
    const n = await sendTriggerAlerts({ supabase: client, now, unsubscribe, send: async (e) => { sent.push(e.text); return true; } });
    assert.equal(n, 1);
    assert.match(sent[0], /Series D/);
    assert.doesNotMatch(sent[0], /Old news/);
    assert.ok(rows.every((r) => r.alerted_at));
    const again = await sendTriggerAlerts({ supabase: client, now, unsubscribe, send: async () => true });
    assert.equal(again, 0);
  });

  it("never emails a user who unsubscribed", async () => {
    const { client } = fakeSupabase([row({})], { email_opt_out_at: "2026-11-01T00:00:00Z" });
    let calls = 0;
    await sendTriggerAlerts({ supabase: client, now, unsubscribe, send: async () => { calls++; return true; } });
    assert.equal(calls, 0);
  });
});
