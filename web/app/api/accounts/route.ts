import { NextRequest, NextResponse } from "next/server";
import { parseCompany } from "../../../lib/accounts";
import { createAccount, listAccounts, requireAccountsAccess } from "../../../lib/supabase/accounts";

/** The signed-in user's saved accounts, with each one's latest report. */
export async function GET() {
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    return NextResponse.json(await listAccounts(access.userId));
  } catch (err) {
    console.error("[accounts] list failed:", err);
    return NextResponse.json({ error: "Couldn't load your accounts." }, { status: 500 });
  }
}

/** Saves a company to the list. Saving one that's already there returns it. */
export async function POST(req: NextRequest) {
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await req.json().catch(() => null);
  const company = parseCompany(body?.company);
  if (!company) return NextResponse.json({ error: "Enter a company name (up to 200 characters)." }, { status: 400 });
  try {
    const result = await createAccount(access.userId, company);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ id: result.id, existed: result.existed }, { status: result.existed ? 200 : 201 });
  } catch (err) {
    console.error("[accounts] create failed:", err);
    return NextResponse.json({ error: "Couldn't save the account." }, { status: 500 });
  }
}
