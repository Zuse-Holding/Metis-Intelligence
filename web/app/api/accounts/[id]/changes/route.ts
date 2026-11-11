import { NextRequest, NextResponse } from "next/server";
import { accountChanges, isUuid, requireAccountsAccess } from "../../../../../lib/supabase/accounts";

/** What the latest report on this account found that the previous one didn't. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  try {
    const changes = await accountChanges(access.userId, id);
    if (!changes) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    return NextResponse.json(changes);
  } catch (err) {
    console.error("[accounts] changes failed:", err);
    return NextResponse.json({ error: "Couldn't compare the reports." }, { status: 500 });
  }
}
