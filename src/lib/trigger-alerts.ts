import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Trigger alerts (ABM brief §4, "alert reps when something changes"): one
 * email per user with the why-now triggers recorded on their saved accounts
 * since the last alert. Each line says what changed and links its source;
 * each account links to its latest report's Sales tab, where the opening
 * line is rebuilt from that report.
 *
 * Off unless FEATURE_TRIGGER_ALERTS=on. Honors the account-wide email
 * opt-out (profiles.email_opt_out_at) and carries the unsubscribe link.
 * Triggers older than ALERT_WINDOW_HOURS are marked and never sent, so
 * turning the flag on doesn't mail a backlog.
 */

export const ALERT_WINDOW_HOURS = 48;
const MAX_LINES = 25;
const APP_URL = process.env.FRONTEND_URL ?? "https://metisanalytic.com";

export interface AlertTrigger {
  id: string;
  accountId: string;
  company: string;
  runId: string | null;
  kind: string;
  atRisk: boolean;
  title: string;
  url: string;
  eventDate: string | null;
}

const KIND_LABEL: Record<string, string> = {
  leadership_change: "Leadership",
  champion_left: "Champion left",
  layoffs: "Layoffs",
  budget_cut: "Budget",
  acquisition: "Acquisition",
  lawsuit: "Lawsuit",
  competitor_adopted: "Competitor adopted",
  funding: "Funding",
  expansion: "Expansion",
  federal_award: "Federal award",
  tech_added: "Tech added",
  tech_removed: "Tech removed",
  hiring_tool: "Hiring",
};

/** The email body. Pure: grouped by account, at-risk first, every line cited. */
export function triggerAlertEmail(
  triggers: AlertTrigger[], firstName: string, unsubscribeUrl: string, appUrl = APP_URL,
): { subject: string; text: string } | null {
  const cited = triggers.filter((t) => /^https?:\/\//.test(t.url) && t.title.trim());
  if (cited.length === 0) return null;
  const byAccount = new Map<string, AlertTrigger[]>();
  for (const t of cited) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  const accounts = [...byAccount.values()].sort((a, b) => Number(b.some((t) => t.atRisk)) - Number(a.some((t) => t.atRisk)));

  const lines: string[] = [];
  let shown = 0;
  for (const group of accounts) {
    if (shown >= MAX_LINES) break;
    const first = group[0];
    lines.push("", first.company);
    for (const t of [...group].sort((a, b) => Number(b.atRisk) - Number(a.atRisk))) {
      if (shown >= MAX_LINES) break;
      const label = KIND_LABEL[t.kind] ?? "Change";
      const when = t.eventDate ? ` (${t.eventDate.slice(0, 10)})` : "";
      lines.push(`- ${t.atRisk ? "At risk. " : ""}${label}: ${t.title}${when}`, `  Source: ${t.url}`);
      shown++;
    }
    const runId = group.find((t) => t.runId)?.runId;
    if (runId) lines.push(`  Updated opener and what to say: ${appUrl}/app?run=${encodeURIComponent(runId)}&tab=sales`);
  }
  const more = cited.length - shown;
  const name = firstName.trim() || "there";
  const n = byAccount.size;
  return {
    subject: n === 1 ? `What changed at ${accounts[0][0].company}` : `What changed at ${n} of your accounts`,
    text: [
      `Hey ${name},`,
      "",
      `Here's what changed at your saved accounts since their last reports. Each item links to its source; check it there before you act on it.`,
      ...lines,
      ...(more > 0 ? ["", `And ${more} more on your Accounts page: ${appUrl}/accounts`] : ["", `All accounts: ${appUrl}/accounts`]),
      "",
      "— The Metis team",
      "",
      `Don't want emails like this? Unsubscribe: ${unsubscribeUrl}`,
      "",
    ].join("\n"),
  };
}

/** The joined accounts row comes back as an object or a one-item array. */
function joinedCompany(v: unknown): string | undefined {
  const row = Array.isArray(v) ? v[0] : v;
  const c = (row as { company?: unknown } | null | undefined)?.company;
  return typeof c === "string" && c.trim() ? c : undefined;
}

export interface AlertDeps {
  supabase: SupabaseClient;
  send: (email: { to: string; subject: string; text: string; headers: Record<string, string> }) => Promise<boolean>;
  /** The signed unsubscribe page link and one-click headers (email/unsubscribe.ts). */
  unsubscribe: (userId: string) => { url: string; headers: Record<string, string> };
  now?: Date;
}

/**
 * Sends every pending alert. Rows are claimed (alerted_at set where it was
 * null) before sending, so two servers never mail the same trigger; a failed
 * send is logged and not retried. Returns the number of emails sent.
 */
export async function sendTriggerAlerts({ supabase, send, unsubscribe, now = new Date() }: AlertDeps): Promise<number> {
  const cutoff = new Date(now.getTime() - ALERT_WINDOW_HOURS * 3_600_000).toISOString();
  // Too old to be news: mark without sending.
  await supabase.from("account_triggers").update({ alerted_at: now.toISOString() }).is("alerted_at", null).lt("detected_at", cutoff);

  const { data: pending, error } = await supabase
    .from("account_triggers")
    .select("user_id")
    .is("alerted_at", null)
    .limit(500);
  if (error) throw new Error(`pending alerts: ${error.message}`);
  const users = [...new Set((pending ?? []).map((r) => r.user_id as string))];

  let sent = 0;
  for (const userId of users) {
    const { data: claimed, error: claimErr } = await supabase
      .from("account_triggers")
      .update({ alerted_at: now.toISOString() })
      .eq("user_id", userId)
      .is("alerted_at", null)
      .select("id, account_id, run_id, kind, at_risk, title, url, event_date, accounts(company)");
    if (claimErr) { console.error(`[alerts] claiming for a user: ${claimErr.message}`); continue; }
    if (!claimed?.length) continue;

    const { data: profile } = await supabase.from("profiles").select("display_name, email_opt_out_at").eq("id", userId).maybeSingle();
    if (profile?.email_opt_out_at) continue;
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const to = userData?.user?.email;
    if (!to) continue;

    const triggers: AlertTrigger[] = claimed.map((r) => ({
      id: r.id as string,
      accountId: r.account_id as string,
      company: joinedCompany(r.accounts) ?? "Saved account",
      runId: (r.run_id as string | null) ?? null,
      kind: r.kind as string,
      atRisk: !!r.at_risk,
      title: r.title as string,
      url: r.url as string,
      eventDate: (r.event_date as string | null) ?? null,
    }));
    const unsub = unsubscribe(userId);
    const email = triggerAlertEmail(triggers, (profile?.display_name as string | undefined)?.split(" ")[0] ?? "", unsub.url);
    if (!email) continue;
    if (await send({ to, ...email, headers: unsub.headers })) sent++;
    else console.error(`[alerts] email for ${triggers.length} trigger(s) not sent`);
  }
  return sent;
}
