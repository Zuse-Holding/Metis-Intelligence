import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { DECISIONS_PER_MINUTE, decideMatch, isUuid, sessionUserId } from "../../../../../lib/supabase/kg-decide";

/**
 * Confirm or reject a possible match. kg_decide_match (supabase/schema.sql)
 * applies it atomically for the signed-in user and logs who and when.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to review matches." }, { status: 401 });
  if (!isUuid(id)) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  const limit = checkRateLimit(`kg-decide:${userId}`, DECISIONS_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many decisions at once. Wait a minute and try again." }, { status: 429, headers: { "Retry-After": String(Math.ceil(limit.resetInMs / 1000)) } });
  }
  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== "confirmed" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be confirmed or rejected" }, { status: 400 });
  }
  const error = await decideMatch(userId, id, decision);
  if (error) return NextResponse.json({ error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
