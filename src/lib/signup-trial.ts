/**
 * Self-serve signup trial. Every new account gets SIGNUP_TRIAL_DAYS of the
 * "trial" tier, set by supabase/schema.sql's handle_new_user() trigger in
 * profiles.signup_trial_expires_at.
 *
 * Kept apart from the hand-assigned "trial" tier (profiles.tier = 'trial' +
 * trial_expires_at, for demo/partner accounts) on purpose:
 * - profiles.tier stays "free" (or unset), so the Stripe webhook, which
 *   never overwrites a "trial" tier, still upgrades someone who pays mid-trial.
 * - When it runs out the account drops back to Free, not to the dead
 *   "expired" state hand-assigned trials end in.
 */
export const SIGNUP_TRIAL_DAYS = 7;

/** True while the account is on the Free tier and its signup trial hasn't ended. */
export function onSignupTrial(
  tier: string | null | undefined,
  signupTrialExpiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (tier && tier !== "free") return false;
  if (!signupTrialExpiresAt) return false;
  const ends = new Date(signupTrialExpiresAt).getTime();
  return !Number.isNaN(ends) && now.getTime() < ends;
}
