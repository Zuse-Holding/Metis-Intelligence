import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { parseSellerOffer, type SellerOffer } from "../../../lib/sales";

/** The signed-in user's offer (what they sell), or null if not set yet. */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const { data, error } = await supabase
    .from("seller_offers")
    .select("offering, competitors, target_customers, naics_codes, keywords")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[seller-offer] read failed:", error.message);
    return NextResponse.json({ error: "Couldn't load what you sell." }, { status: 500 });
  }
  const offer: SellerOffer | null = data
    ? {
        offering: data.offering as string,
        competitors: (data.competitors as string[]) ?? [],
        targetCustomers: (data.target_customers as string) ?? "",
        naicsCodes: (data.naics_codes as string[]) ?? [],
        keywords: (data.keywords as string[]) ?? [],
      }
    : null;
  return NextResponse.json({ offer });
}

/** Saves it (create or replace). RLS limits the write to the caller's row. */
export async function PUT(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const parsed = parseSellerOffer(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { offering, competitors, targetCustomers, naicsCodes, keywords } = parsed.offer;
  const { error } = await supabase
    .from("seller_offers")
    .upsert(
      { user_id: user.id, offering, competitors, target_customers: targetCustomers, naics_codes: naicsCodes, keywords, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) {
    console.error("[seller-offer] save failed:", error.message);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
  return NextResponse.json({ offer: parsed.offer });
}
