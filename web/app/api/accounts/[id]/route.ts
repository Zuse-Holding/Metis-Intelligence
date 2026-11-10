import { NextRequest, NextResponse } from "next/server";
import { parseAccountPatch } from "../../../../lib/accounts";
import { deleteAccount, isUuid, requireAccountsAccess, updateAccount } from "../../../../lib/supabase/accounts";

/** Changes an account's stage, owner or notes. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  const parsed = parseAccountPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const found = await updateAccount(access.userId, id, parsed.patch);
    if (!found) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[accounts] update failed:", err);
    return NextResponse.json({ error: "Couldn't save the change." }, { status: 500 });
  }
}

/** Removes an account from the list. Its reports are kept. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  try {
    const found = await deleteAccount(access.userId, id);
    if (!found) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[accounts] delete failed:", err);
    return NextResponse.json({ error: "Couldn't remove the account." }, { status: 500 });
  }
}
