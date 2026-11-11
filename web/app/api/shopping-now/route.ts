import { NextResponse } from "next/server";
import { isEnabled } from "../../../lib/flags";
import { isPostingAgency } from "../../../lib/intent";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { requireAccountsAccess } from "../../../lib/supabase/accounts";
import { openOpportunities, sellerCategory } from "../../../lib/supabase/intent";

/**
 * "Shopping now" (buyer intent v1): open SAM.gov solicitations in the
 * seller's category, soonest deadline first, each marked with the saved
 * account it belongs to, if any. Same plan as Accounts.
 */
export async function GET() {
  if (!isEnabled("buyer_intent")) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const category = await sellerCategory(access.userId);
    const hasCategory = category.naicsCodes.length > 0 || category.keywords.length > 0;
    if (!hasCategory) return NextResponse.json({ hasCategory, opportunities: [] });

    const supabase = await createServerSupabaseClient();
    const [opportunities, { data: accounts, error }] = await Promise.all([
      openOpportunities(category),
      supabase.from("accounts").select("company").eq("user_id", access.userId),
    ]);
    if (error) throw error;
    const companies = (accounts ?? []).map((a) => a.company as string);
    return NextResponse.json({
      hasCategory,
      opportunities: opportunities.map((o) => ({ ...o, savedAs: companies.find((c) => isPostingAgency(c, o.agencyPath)) ?? null })),
    });
  } catch (err) {
    console.error("[shopping-now] load failed:", err);
    return NextResponse.json({ error: "Couldn't load open solicitations." }, { status: 500 });
  }
}
