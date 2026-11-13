import { createServerSupabaseClient, createServiceClient } from "./server";
import { matchesOffer, type Opportunity } from "../intent";

/**
 * Buyer intent data layer. sam_opportunities is service-role only (see
 * supabase/schema.sql), so callers must have passed requireAccountsAccess.
 */

/** Most solicitations a match returns; the feed shows the soonest due. */
const MAX_OPPORTUNITIES = 200;

export interface SellerCategory { naicsCodes: string[]; keywords: string[]; competitors: string[] }

/** The user's NAICS codes, keywords and competitors from "What you sell", if any. */
export async function sellerCategory(userId: string): Promise<SellerCategory> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("seller_offers")
    .select("naics_codes, keywords, competitors")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    naicsCodes: (data?.naics_codes as string[] | undefined) ?? [],
    keywords: (data?.keywords as string[] | undefined) ?? [],
    competitors: (data?.competitors as string[] | undefined) ?? [],
  };
}

interface OpportunityRow {
  notice_id: string;
  title: string;
  solicitation_number: string | null;
  notice_type: string;
  agency_path: string;
  naics_code: string | null;
  set_aside: string | null;
  posted_date: string;
  response_deadline: string | null;
  url: string;
}

/**
 * Open SAM.gov opportunities in the seller's category, soonest deadline
 * first. NAICS codes and keywords are validated on save (digits; letters,
 * digits, spaces, & / -), so they're safe inside the PostgREST filter; the
 * whole-word keyword check runs here after the database's substring match.
 */
export async function openOpportunities(category: SellerCategory, now = new Date()): Promise<Opportunity[]> {
  const naics = category.naicsCodes.filter((c) => /^\d{2,6}$/.test(c));
  const keywords = category.keywords.filter((k) => /^[a-z0-9][a-z0-9 &/-]*$/i.test(k));
  if (naics.length === 0 && keywords.length === 0) return [];

  const match = [
    ...naics.map((c) => `naics_code.like.${c}*`),
    ...keywords.map((k) => `title.ilike."*${k}*"`),
  ].join(",");
  const service = createServiceClient();
  const { data, error } = await service
    .from("sam_opportunities")
    .select("notice_id, title, solicitation_number, notice_type, agency_path, naics_code, set_aside, posted_date, response_deadline, url")
    .or(match)
    .or(`response_deadline.gte.${now.toISOString()},response_deadline.is.null`)
    .order("response_deadline", { ascending: true, nullsFirst: false })
    .limit(MAX_OPPORTUNITIES);
  if (error) throw error;

  return ((data ?? []) as OpportunityRow[])
    .map((r): Opportunity => ({
      noticeId: r.notice_id,
      title: r.title,
      solicitationNumber: r.solicitation_number,
      noticeType: r.notice_type,
      agencyPath: r.agency_path,
      naicsCode: r.naics_code,
      setAside: r.set_aside,
      postedDate: r.posted_date,
      responseDeadline: r.response_deadline,
      url: r.url,
    }))
    .filter((o) => matchesOffer(o, naics, keywords));
}
