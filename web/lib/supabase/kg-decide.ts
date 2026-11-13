import { createServerSupabaseClient, createServiceClient } from "./server";

/**
 * Match decisions (knowledge graph). kg_decide_match is service-role only
 * (supabase/schema.sql), so the only way to call it is through these
 * routes: the user id always comes from the session, never the request,
 * and each user is rate-limited before the call.
 *
 * The limits are per server instance (web/lib/rate-limit.ts), so they slow
 * a burst rather than set a hard global ceiling; the function still only
 * ever touches the caller's own rows.
 */

/** One-by-one confirms and rejects a user can make in a minute. */
export const DECISIONS_PER_MINUTE = 60;
/** "Merge all from this report" runs a user can start in an hour. */
export const BULK_MERGES_PER_HOUR = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** The signed-in user's id, from the session cookie. */
export async function sessionUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Confirms or rejects one match for `userId`. Returns the refusal, if any. */
export async function decideMatch(userId: string, reviewId: string, decision: "confirmed" | "rejected"): Promise<string | null> {
  const service = createServiceClient();
  const { error } = await service.rpc("kg_decide_match", { p_user_id: userId, p_review_id: reviewId, p_decision: decision });
  return error ? (error.message as string) : null;
}
