import { NextRequest, NextResponse } from "next/server";
import { parseStallDays } from "../../../lib/accounts";
import { requireAccountsAccess, setStallDays } from "../../../lib/supabase/accounts";

/** Sets how many days without a stage change make a deal "stalled". */
export async function PUT(req: NextRequest) {
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await req.json().catch(() => null);
  const stallDays = parseStallDays(body?.stallDays);
  if (stallDays === null) return NextResponse.json({ error: "Pick a whole number of days from 1 to 365." }, { status: 400 });
  try {
    await setStallDays(access.userId, stallDays);
    return NextResponse.json({ stallDays });
  } catch (err) {
    console.error("[pipeline-settings] save failed:", err);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}
