/**
 * Feature flags for the provenance & trust work (see CHANGELOG.md).
 * Every flag is OFF unless its environment variable is set to on/true/1,
 * so a deploy that doesn't mention a flag never turns anything on.
 *
 *   FEATURE_PROVENANCE=on   per-finding provenance (Feature 2)
 *   FEATURE_COVERAGE=on     source coverage ledger (Feature 1)
 *   FEATURE_ENTITY_RESOLUTION=on  identifier-based entity resolution (Feature 3)
 *   FEATURE_DOMAIN_POSTURE=on     passive domain posture check (Feature 5)
 *   FEATURE_SELF_EXCLUSION=on     self-exclusion list (Feature 6)
 *   FEATURE_RELATED_ENTITIES=on   related-entities expansion (Feature 4; needs Feature 6 on for users)
 *   FEATURE_GAP_FILL=on           targeted second search for empty fields (round 10)
 *   FEATURE_FACT_CACHE=on         saved, sourced company basics reused across runs (round 10; needs company_profiles)
 *   FEATURE_TECH_STACK=on         tech stack from public DNS and the homepage (ABM brief §2, phase 1)
 *   FEATURE_ACCOUNT_REFRESH=on    weekly re-runs of saved accounts, off the plan limits (ABM brief §4; needs the pipeline SQL)
 *   FEATURE_BUYER_INTENT=on       buying signals on saved accounts and the daily SAM.gov pull (needs the buyer intent SQL; the pull needs SAM_GOV_API_KEY)
 *   FEATURE_JOB_POSTINGS=on       tools named in the company's own public job postings (Greenhouse, Lever, Ashby), as "likely" tech stack items
 *   FEATURE_TRIGGER_ALERTS=on     emails each user the why-now triggers on their saved accounts (needs account_triggers.alerted_at and RESEND_API_KEY)
 *   FEATURE_TECH_SEEN=on        first-seen dates on tech stack tools and "new since" on peer gaps (needs company_profiles.tech_seen)
 *   FEATURE_CHAMPION=on         "your champion left" trigger for the champion named on a saved account (needs accounts.champion)
 *   FEATURE_MORE_JOB_BOARDS=on    also Workday, SmartRecruiters and Workable boards (with JOB_POSTINGS on)
 *   FEATURE_PUBLIC_MENTIONS=on    vendors' own customer stories that name the company, as "likely" tech stack items (one search per report)
 *
 * Server-side only. The web app reads its own NEXT_PUBLIC_FEATURE_* copy
 * where the UI needs to know (see web/lib/flags.ts).
 */
export type Flag = "provenance" | "coverage" | "entity_resolution" | "domain_posture" | "self_exclusion" | "related_entities" | "gap_fill" | "fact_cache" | "tech_stack" | "account_refresh" | "buyer_intent" | "job_postings" | "trigger_alerts" | "tech_seen" | "champion" | "more_job_boards" | "public_mentions";

export function isEnabled(flag: Flag, env: Record<string, string | undefined> = process.env): boolean {
  const value = env[`FEATURE_${flag.toUpperCase()}`]?.trim().toLowerCase();
  return value === "on" || value === "true" || value === "1";
}
