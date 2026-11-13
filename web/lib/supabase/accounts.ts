import { createServerSupabaseClient, createServiceClient } from "./server";
import { getAgentSecret } from "../agent-secret";
import { trackEvent } from "../analytics";
import {
  DEFAULT_STALL_DAYS,
  dealHealth,
  freshTriggerCount,
  newFindings,
  rankAccounts,
  type AccountPatch,
  type AccountStage,
  type AccountTrigger,
  type ChangedFinding,
  type FindingLike,
  type Health,
} from "../accounts";
import { isEnabled } from "../flags";
import { isPostingAgency, scoreIntent, type Intent, type IntentSignal } from "../intent";
import { openOpportunities, sellerCategory } from "./intent";

/**
 * Account pipeline data layer. Reads go through the signed-in user's client
 * (RLS limits them to their own rows); writes use the service role, because
 * the accounts table is read-only to its owner (see supabase/schema.sql),
 * and every write is scoped to the caller's user_id.
 */

/** Per-user cap, so one account can't fill the table. Far above real use. */
export const MAX_ACCOUNTS_PER_USER = 500;
/** Triggers shown per account (newest first). */
const TRIGGERS_PER_ACCOUNT = 10;
/** How far back triggers are loaded. */
const TRIGGER_LOOKBACK_DAYS = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export interface Account {
  id: string;
  company: string;
  stage: AccountStage;
  owner: string | null;
  notes: string | null;
  dealValue: number | null;
  nextStep: string | null;
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
  latestRun: { id: string; generatedAt: string } | null;
  /** Completed company reports for this account; "what changed" needs 2. */
  runCount: number;
  triggers: AccountTrigger[];
  freshTriggers: number;
  health: Health;
  healthReasons: string[];
  /** Buyer intent, with every reason cited. Absent while the feature is off. */
  intent?: Intent;
}

export type AccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * The signed-in user, if their plan includes the account pipeline. Fails
 * closed: if the plan can't be checked, the request is refused. The one
 * exception is local development with no agent server configured.
 */
export async function requireAccountsAccess(): Promise<AccessResult> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Your session expired. Sign in again." };

  const agentUrl = process.env.AGENT_SERVER_URL;
  if (!agentUrl) {
    if (process.env.NODE_ENV !== "production") return { ok: true, userId: user.id };
    return { ok: false, status: 503, error: "Couldn't check your plan. Try again in a minute." };
  }
  try {
    const res = await fetch(`${agentUrl}/tier/${user.id}`, {
      headers: { "x-agent-secret": getAgentSecret() },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: 503, error: "Couldn't check your plan. Try again in a minute." };
    const data = await res.json();
    if (data?.config?.accountsAccess !== true) {
      return { ok: false, status: 403, error: "Accounts are part of Pro. Upgrade at metisanalytic.com/pricing." };
    }
    return { ok: true, userId: user.id };
  } catch (err) {
    console.error("[accounts] tier check failed:", err instanceof Error ? err.message : err);
    return { ok: false, status: 503, error: "Couldn't check your plan. Try again in a minute." };
  }
}

interface AccountRow {
  id: string;
  company: string;
  stage: AccountStage;
  owner: string | null;
  notes: string | null;
  deal_value: string | number | null;
  next_step: string | null;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  intent_signals?: unknown;
}

interface RunRow {
  id: string;
  subject: string;
  generated_at: string;
}

const subjectKey = (s: string) => s.trim().toLowerCase();

/** Completed, non-deleted company reports for the user, newest first. */
async function companyRuns(userId: string): Promise<RunRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("research_runs")
    .select("id, subject, generated_at")
    .eq("user_id", userId)
    .eq("type", "company")
    .eq("status", "completed")
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RunRow[];
}

/** Days without a stage change before a deal shows as stalled. */
export async function getStallDays(userId: string): Promise<number> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("pipeline_settings").select("stall_days").eq("user_id", userId).maybeSingle();
  return (data?.stall_days as number | undefined) ?? DEFAULT_STALL_DAYS;
}

export async function setStallDays(userId: string, stallDays: number): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("pipeline_settings")
    .upsert({ user_id: userId, stall_days: stallDays, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

const ACCOUNT_COLUMNS = "id, company, stage, owner, notes, deal_value, next_step, stage_changed_at, created_at, updated_at";

/** Stored signals as read back from JSONB; anything malformed is dropped. */
function storedSignals(value: unknown): IntentSignal[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is IntentSignal =>
    !!v && typeof v === "object"
    && ["contract_ending", "stated_plan", "tech_change", "hiring"].includes((v as IntentSignal).kind)
    && typeof (v as IntentSignal).title === "string"
    && typeof (v as IntentSignal).url === "string" && /^https?:\/\//.test((v as IntentSignal).url)
    && typeof (v as IntentSignal).date === "string");
}

/** Accounts with their latest report, triggers and health, ranked: work the top first. */
export async function listAccounts(userId: string, now = new Date()): Promise<{ accounts: Account[]; stallDays: number }> {
  const supabase = await createServerSupabaseClient();
  const since = new Date(now.getTime() - TRIGGER_LOOKBACK_DAYS * 86_400_000).toISOString();
  const intentOn = isEnabled("buyer_intent");
  const [{ data, error }, runs, stallDays, { data: triggerRows, error: tErr }, { opportunities, offer }] = await Promise.all([
    intentOn
      ? supabase.from("accounts").select(`${ACCOUNT_COLUMNS}, intent_signals`).eq("user_id", userId)
      : supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("user_id", userId),
    companyRuns(userId),
    getStallDays(userId),
    supabase
      .from("account_triggers")
      .select("account_id, kind, at_risk, title, url, event_date, detected_at")
      .eq("user_id", userId)
      .gte("detected_at", since)
      .order("detected_at", { ascending: false }),
    // A lookup failure drops only the solicitation and hiring reasons, not the list.
    intentOn
      ? sellerCategory(userId)
          .then(async (c) => ({ opportunities: await openOpportunities(c, now), offer: { keywords: c.keywords, competitors: c.competitors } }))
          .catch((err) => {
            console.error("[accounts] open solicitations lookup failed:", err);
            return { opportunities: [], offer: undefined };
          })
      : Promise.resolve({ opportunities: [], offer: undefined }),
  ]);
  if (error) throw error;
  if (tErr) throw tErr;

  // Runs arrive newest-first, so the first one per subject is the latest.
  const bySubject = new Map<string, { latest: RunRow; count: number }>();
  for (const run of runs) {
    const key = subjectKey(run.subject);
    const entry = bySubject.get(key);
    if (entry) entry.count += 1;
    else bySubject.set(key, { latest: run, count: 1 });
  }

  const triggersByAccount = new Map<string, AccountTrigger[]>();
  for (const t of triggerRows ?? []) {
    const list = triggersByAccount.get(t.account_id as string) ?? [];
    if (list.length < TRIGGERS_PER_ACCOUNT) {
      list.push({
        kind: t.kind as string, atRisk: !!t.at_risk, title: t.title as string, url: t.url as string,
        eventDate: (t.event_date as string | null) ?? null, detectedAt: t.detected_at as string,
      });
    }
    triggersByAccount.set(t.account_id as string, list);
  }

  const accounts = ((data ?? []) as AccountRow[]).map((row): Account => {
    const match = bySubject.get(subjectKey(row.company));
    const triggers = triggersByAccount.get(row.id) ?? [];
    const { health, reasons } = dealHealth({ stage: row.stage, stageChangedAt: row.stage_changed_at, triggers }, stallDays, now);
    return {
      id: row.id,
      company: row.company,
      stage: row.stage,
      owner: row.owner,
      notes: row.notes,
      dealValue: row.deal_value === null ? null : Number(row.deal_value),
      nextStep: row.next_step,
      stageChangedAt: row.stage_changed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      latestRun: match ? { id: match.latest.id, generatedAt: match.latest.generated_at } : null,
      runCount: match?.count ?? 0,
      triggers,
      freshTriggers: freshTriggerCount(triggers, now),
      health,
      healthReasons: reasons,
      ...(intentOn ? {
        intent: scoreIntent(
          storedSignals(row.intent_signals),
          opportunities.filter((o) => isPostingAgency(row.company, o.agencyPath)),
          now,
          offer,
        ),
      } : {}),
    };
  });
  return { accounts: rankAccounts(accounts), stallDays };
}

export type CreateResult =
  | { ok: true; id: string; existed: boolean }
  | { ok: false; status: 409; error: string };

const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Saves a company. Saving one that's already on the list returns it. */
export async function createAccount(userId: string, company: string): Promise<CreateResult> {
  const service = createServiceClient();

  const { data: existing } = await service
    .from("accounts")
    .select("id")
    .eq("user_id", userId)
    .ilike("company", likeExact(company))
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id as string, existed: true };

  const { count } = await service
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) >= MAX_ACCOUNTS_PER_USER) {
    return { ok: false, status: 409, error: `You can save up to ${MAX_ACCOUNTS_PER_USER} accounts. Remove some to add more.` };
  }

  const { data, error } = await service
    .from("accounts")
    .insert({ user_id: userId, company })
    .select("id")
    .single();
  if (error) {
    // Two saves at once: the unique index wins, so return the row it kept.
    if (error.code === "23505") {
      const { data: row } = await service
        .from("accounts")
        .select("id")
        .eq("user_id", userId)
        .ilike("company", likeExact(company))
        .maybeSingle();
      if (row) return { ok: true, id: row.id as string, existed: true };
    }
    throw error;
  }
  trackEvent(userId, "account_add", {});
  return { ok: true, id: data.id as string, existed: false };
}

/** False when the account doesn't exist or isn't the caller's. A stage
 *  change also resets the "stalled" clock. */
export async function updateAccount(userId: string, id: string, patch: AccountPatch): Promise<boolean> {
  const service = createServiceClient();
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { updated_at: now };
  if (patch.owner !== undefined) row.owner = patch.owner;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.dealValue !== undefined) row.deal_value = patch.dealValue;
  if (patch.nextStep !== undefined) row.next_step = patch.nextStep;
  if (patch.stage !== undefined) {
    const { data: current } = await service.from("accounts").select("stage").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!current) return false;
    row.stage = patch.stage;
    if (current.stage !== patch.stage) row.stage_changed_at = now;
  }
  const { data, error } = await service
    .from("accounts")
    .update(row)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  if (patch.stage) trackEvent(userId, "account_stage", { stage: patch.stage });
  return (data ?? []).length > 0;
}

export async function deleteAccount(userId: string, id: string): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface AccountChanges {
  latestRunAt: string | null;
  previousRunAt: string | null;
  /** Null when there's nothing to compare (fewer than two reports). */
  added: ChangedFinding[] | null;
}

/** What the latest report found that the one before it didn't. */
export async function accountChanges(userId: string, id: string): Promise<AccountChanges | null> {
  const supabase = await createServerSupabaseClient();
  const { data: account, error } = await supabase
    .from("accounts")
    .select("company")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!account) return null;

  const key = subjectKey(account.company as string);
  const runs = (await companyRuns(userId)).filter((r) => subjectKey(r.subject) === key);
  const [latest, previous] = runs;
  if (!latest || !previous) {
    return { latestRunAt: latest?.generated_at ?? null, previousRunAt: null, added: null };
  }

  const { data: findings, error: fErr } = await supabase
    .from("findings")
    .select("run_id, section, claim, source_name, source_url, created_at")
    .eq("user_id", userId)
    .in("run_id", [latest.id, previous.id])
    .order("created_at", { ascending: true });
  if (fErr) throw fErr;

  const rows = (findings ?? []) as (FindingLike & { run_id: string })[];
  return {
    latestRunAt: latest.generated_at,
    previousRunAt: previous.generated_at,
    added: newFindings(
      rows.filter((f) => f.run_id === previous.id),
      rows.filter((f) => f.run_id === latest.id),
    ),
  };
}
