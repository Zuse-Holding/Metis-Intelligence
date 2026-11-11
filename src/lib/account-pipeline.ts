import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchBundle } from "../types/research.js";
import { detectTriggers } from "./account-triggers.js";

/**
 * Agent-server side of the account pipeline (ABM brief §4):
 *   - recordAccountTriggers: after a company report finishes, compare it with
 *     the previous report on the same subject and save what changed against
 *     every saved account with that subject.
 *   - Weekly refresh: pick saved accounts whose latest report is a week old
 *     and claim them, so the server can re-run them off the plan limits.
 * Service-role client only: users can read account_triggers but not write it.
 */

const lower = (s: string) => s.trim().toLowerCase();

/** Escape LIKE wildcards so ilike works as a case-insensitive equals. */
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function recordAccountTriggers(
  supabase: SupabaseClient,
  args: { userId: string; runId: string; subject: string; bundle: ResearchBundle },
): Promise<number> {
  const { userId, runId, subject, bundle } = args;
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, company")
    .eq("user_id", userId)
    .ilike("company", likeExact(subject));
  if (error) throw new Error(`accounts lookup: ${error.message}`);
  const matching = (accounts ?? []).filter((a) => lower(a.company as string) === lower(subject));
  if (matching.length === 0) return 0;

  // The report before this one on the same subject.
  const { data: prevRuns, error: prevErr } = await supabase
    .from("research_runs")
    .select("id, subject, bundle")
    .eq("user_id", userId)
    .eq("type", "company")
    .eq("status", "completed")
    .is("deleted_at", null)
    .neq("id", runId)
    .ilike("subject", likeExact(subject))
    .order("generated_at", { ascending: false })
    .limit(1);
  if (prevErr) throw new Error(`previous run lookup: ${prevErr.message}`);
  const prev = prevRuns?.[0];
  if (!prev?.bundle) return 0; // First report on this account: the baseline.

  const { data: offer } = await supabase.from("seller_offers").select("competitors").eq("user_id", userId).maybeSingle();
  const competitors = ((offer?.competitors as string[] | undefined) ?? []);
  const triggers = detectTriggers(prev.bundle as ResearchBundle, bundle, competitors);
  if (triggers.length === 0) return 0;

  const rows = matching.flatMap((a) => triggers.map((t) => ({
    account_id: a.id as string,
    user_id: userId,
    run_id: runId,
    kind: t.kind,
    at_risk: t.atRisk,
    title: t.title,
    url: t.url,
    event_date: t.eventDate ?? null,
  })));
  // Idempotent: a trigger already recorded for the account is left as is.
  const { error: insErr } = await supabase.from("account_triggers").upsert(rows, { onConflict: "account_id,kind,title", ignoreDuplicates: true });
  if (insErr) throw new Error(`saving triggers: ${insErr.message}`);
  return rows.length;
}

export const REFRESH_INTERVAL_DAYS = 7;
const ACTIVE_STAGES = ["researching", "contacted", "meeting", "proposal"];

export interface DueAccount { id: string; userId: string; company: string }

/**
 * The next saved account due for its weekly refresh, claimed so no other
 * server picks it up. Won and lost deals aren't refreshed. An account whose
 * latest report is newer than a week (say the user re-ran it) isn't run;
 * its claim is moved to that report's date so it comes due a week after it.
 * `allowed` decides per user (the caller checks the user's plan).
 */
export async function claimDueAccount(
  supabase: SupabaseClient,
  allowed: (userId: string) => Promise<boolean>,
  now = new Date(),
): Promise<DueAccount | null> {
  const cutoff = new Date(now.getTime() - REFRESH_INTERVAL_DAYS * 86_400_000).toISOString();
  const { data: candidates, error } = await supabase
    .from("accounts")
    .select("id, user_id, company, refresh_claimed_at, created_at")
    .in("stage", ACTIVE_STAGES)
    .or(`refresh_claimed_at.is.null,refresh_claimed_at.lt.${cutoff}`)
    .order("refresh_claimed_at", { ascending: true, nullsFirst: true })
    .limit(20);
  if (error) throw new Error(`due accounts: ${error.message}`);

  for (const c of candidates ?? []) {
    const userId = c.user_id as string;
    const company = c.company as string;
    const previousClaim = (c.refresh_claimed_at as string | null) ?? null;

    // Claim first (compare-and-set on the old value), so two servers can't both take it.
    const claim = async (at: string) => {
      let q = supabase.from("accounts").update({ refresh_claimed_at: at }).eq("id", c.id);
      q = previousClaim ? q.eq("refresh_claimed_at", previousClaim) : q.is("refresh_claimed_at", null);
      const { data } = await q.select("id");
      return (data ?? []).length > 0;
    };

    if (!(await allowed(userId))) {
      // Plan no longer includes accounts: check again in a week.
      await claim(now.toISOString());
      continue;
    }

    const { data: latest } = await supabase
      .from("research_runs")
      .select("generated_at, status")
      .eq("user_id", userId)
      .eq("type", "company")
      .is("deleted_at", null)
      .in("status", ["completed", "pending"])
      .ilike("subject", likeExact(company))
      .order("generated_at", { ascending: false })
      .limit(1);
    const last = latest?.[0];
    if (last && (last.status === "pending" || (last.generated_at as string) > cutoff)) {
      await claim(last.status === "pending" ? now.toISOString() : (last.generated_at as string));
      continue;
    }

    if (await claim(now.toISOString())) return { id: c.id as string, userId, company };
  }
  return null;
}
