import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../../lib/supabase/server";
import { loadPendingMatches } from "../../../../../lib/kg-matches";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { BULK_MERGES_PER_HOUR, decideMatch, sessionUserId } from "../../../../../lib/supabase/kg-decide";

/**
 * "Merge all from this report": confirms every pending match that a
 * re-run of one report created against an earlier run of the same report.
 * Each merge goes through kg_decide_match, so every one is checked and
 * logged with who and when, exactly as if clicked one by one. Matches
 * from any other report are refused here, whatever the request says.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const runId: unknown = body?.runId;
  if (typeof runId !== "string" || !runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to review matches." }, { status: 401 });
  const limit = checkRateLimit(`kg-bulk:${userId}`, BULK_MERGES_PER_HOUR, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many merges this hour. Try again later." }, { status: 429, headers: { "Retry-After": String(Math.ceil(limit.resetInMs / 1000)) } });
  }
  const supabase = await createServerSupabaseClient();
  let pending;
  try {
    pending = await loadPendingMatches(supabase, 500);
  } catch {
    return NextResponse.json({ error: "Couldn't load the matches. Try again." }, { status: 500 });
  }
  const targets = pending.filter((m) => m.sameReportRun?.id === runId);
  if (targets.length === 0) return NextResponse.json({ merged: 0, skipped: 0, failed: [] });

  let merged = 0, skipped = 0;
  const failed: { name: string; error: string }[] = [];
  for (const m of targets) {
    const error = await decideMatch(userId, m.id, "confirmed");
    if (!error) merged++;
    // An earlier merge in this batch already folded or removed this one.
    else if (/already decided|not found|no longer exists/i.test(error)) skipped++;
    else failed.push({ name: m.entity_name, error });
  }
  return NextResponse.json({ merged, skipped, failed });
}
