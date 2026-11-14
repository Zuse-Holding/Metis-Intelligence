"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EmptyState from "../../components/EmptyState";
import { SkeletonRow, Spinner } from "../../components/Skeleton";
import { useTier } from "../../lib/tier-context";
import {
  ACCOUNT_STAGES,
  HEALTH_LABELS,
  MAX_CHAMPION_LENGTH,
  MAX_NEXT_STEP_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_OWNER_LENGTH,
  STAGE_LABELS,
  formatMoney,
  stageTotals,
  type AccountStage,
  type AccountTrigger,
  type ChangedFinding,
  type Health,
} from "../../lib/accounts";
import { INTENT_LABELS, INTENT_REASON_LABELS, type Intent } from "../../lib/intent";
import { isEnabled } from "../../lib/flags";
import styles from "./page.module.css";

interface Account {
  id: string;
  company: string;
  stage: AccountStage;
  owner: string | null;
  notes: string | null;
  dealValue: number | null;
  nextStep: string | null;
  champion?: string | null;
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
  latestRun: { id: string; generatedAt: string } | null;
  runCount: number;
  triggers: AccountTrigger[];
  freshTriggers: number;
  health: Health;
  healthReasons: string[];
  /** Present when buyer intent is on. */
  intent?: Intent;
}

interface Changes {
  latestRunAt: string | null;
  previousRunAt: string | null;
  added: ChangedFinding[] | null;
}

type Panel = { id: string; kind: "deal" | "changes" | "intent" } | null;
type View = "list" | "pipeline";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === "string" && data.error) || fallback;
}

function HealthBadge({ health, reasons }: { health: Health; reasons: string[] }) {
  if (health === "closed") return null;
  return (
    <span className={`${styles.health} ${styles[`health_${health}`]}`} title={reasons.join("\n") || undefined}>
      {HEALTH_LABELS[health]}
    </span>
  );
}

function IntentBadge({ intent, onClick }: { intent: Intent; onClick: () => void }) {
  const n = intent.reasons.length;
  return (
    <button
      type="button"
      className={`${styles.health} ${styles.intentBadge} ${styles[`intent_${intent.level}`]}`}
      onClick={onClick}
      title={n ? `${n} buying signal${n === 1 ? "" : "s"}: show why` : "No buying signals found: show why"}
    >
      {INTENT_LABELS[intent.level]}
    </button>
  );
}

export default function AccountsPage() {
  const router = useRouter();
  const { can, loading: tierLoading } = useTier();
  const allowed = can("accountsAccess");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stallDays, setStallDays] = useState(14);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<AccountStage | "all">("all");
  const [newCompany, setNewCompany] = useState("");
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState({ dealValue: "", nextStep: "", notes: "", champion: "" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Changes | "loading" | "error">>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Couldn't load your accounts."));
      const data = await res.json();
      setAccounts(data.accounts ?? []);
      setStallDays(data.stallDays ?? 14);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!tierLoading && allowed) load();
  }, [tierLoading, allowed, load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: accounts.length };
    for (const s of ACCOUNT_STAGES) c[s] = 0;
    for (const a of accounts) c[a.stage] += 1;
    return c;
  }, [accounts]);
  const totals = useMemo(() => stageTotals(accounts), [accounts]);
  const openValue = totals.filter((t) => t.stage !== "won" && t.stage !== "lost").reduce((s, t) => s + t.total, 0);
  const atRisk = accounts.filter((a) => a.health === "at_risk").length;
  const stalled = accounts.filter((a) => a.health === "stalled").length;

  const visible = filter === "all" ? accounts : accounts.filter((a) => a.stage === filter);

  async function patch(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't save the change."));
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function saveStallDays(value: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n === stallDays) return;
    const res = await fetch("/api/pipeline-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stallDays: n }),
    });
    if (!res.ok) setError(await readError(res, "Couldn't save the stall setting."));
    else await load();
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const company = newCompany.trim();
    if (!company || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't save the account."));
      setNewCompany("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove(account: Account) {
    if (!window.confirm(`Remove ${account.company} from your accounts? Its reports stay in Reports.`)) return;
    setError(null);
    const res = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await readError(res, "Couldn't remove the account."));
      return;
    }
    setAccounts((list) => list.filter((a) => a.id !== account.id));
    if (panel?.id === account.id) setPanel(null);
  }

  async function loadChanges(id: string) {
    setChanges((c) => ({ ...c, [id]: "loading" }));
    try {
      const res = await fetch(`/api/accounts/${id}/changes`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data: Changes = await res.json();
      setChanges((c) => ({ ...c, [id]: data }));
    } catch {
      setChanges((c) => ({ ...c, [id]: "error" }));
    }
  }

  function toggleChanges(id: string) {
    if (panel?.id === id && panel.kind === "changes") return setPanel(null);
    setPanel({ id, kind: "changes" });
    loadChanges(id);
  }

  function toggleIntent(id: string) {
    setPanel(panel?.id === id && panel.kind === "intent" ? null : { id, kind: "intent" });
  }

  function renderIntent(a: Account) {
    const intent = a.intent;
    if (!intent) return null;
    if (intent.reasons.length === 0) {
      return (
        <EmptyState
          size="compact"
          title="No buying signals found"
          when="Updates when the account's report is re-run and as SAM.gov posts new solicitations"
          description="Signals are open SAM.gov solicitations from this agency in your category, federal contracts ending soon, stated plans in the news and DNS-backed tech stack changes."
        />
      );
    }
    return (
      <div className={styles.changeSection}>
        <div className={styles.changeHeading}>Why {INTENT_LABELS[intent.level].toLowerCase()}</div>
        <ul className={styles.changeList}>
          {intent.reasons.map((r, i) => (
            <li key={i}>
              <span className={styles.muted}>{INTENT_REASON_LABELS[r.kind]}: </span>
              <a href={r.url} target="_blank" rel="noopener noreferrer">{r.text}</a>
              <span className={styles.source}> · {r.sourceName}</span>
              {r.date && <span className={`${styles.muted} ${styles.mono}`}> · {r.date}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function toggleDeal(a: Account) {
    if (panel?.id === a.id && panel.kind === "deal") return setPanel(null);
    setDraft({ dealValue: a.dealValue === null ? "" : String(a.dealValue), nextStep: a.nextStep ?? "", notes: a.notes ?? "", champion: a.champion ?? "" });
    setPanel({ id: a.id, kind: "deal" });
  }

  async function rerun(account: Account) {
    setRerunningId(account.id);
    setError(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: account.company, type: "company" }),
      });
      if (!res.ok) throw new Error(await readError(res, "The report didn't finish. Try again."));
      // Triggers are saved just after the report returns; give them a moment.
      await new Promise((r) => setTimeout(r, 2500));
      await load();
      setPanel({ id: account.id, kind: "changes" });
      loadChanges(account.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunningId(null);
    }
  }

  function renderTriggers(a: Account) {
    if (a.triggers.length === 0) return null;
    return (
      <div className={styles.changeSection}>
        <div className={styles.changeHeading}>Triggers, last 60 days</div>
        <ul className={styles.changeList}>
          {a.triggers.map((t, i) => (
            <li key={i}>
              {t.atRisk && <span className={`${styles.health} ${styles.health_at_risk}`}>At risk</span>}{" "}
              <a href={t.url} target="_blank" rel="noopener noreferrer">{t.title}</a>
              <span className={styles.muted}> · {t.eventDate ?? `found ${formatDate(t.detectedAt)}`}</span>
            </li>
          ))}
        </ul>
        {a.latestRun && (
          <a className={styles.source} href={`/app?run=${a.latestRun.id}&tab=sales`}>What to say now</a>
        )}
      </div>
    );
  }

  function renderChanges(a: Account) {
    const c = changes[a.id];
    let diff: React.ReactNode;
    if (!c || c === "loading") {
      diff = <div className={styles.panelNote}><Spinner size={10} /> Comparing the last two reports...</div>;
    } else if (c === "error") {
      diff = <EmptyState size="compact" title="Couldn't compare the reports" when={null} action={{ label: "Try again", onClick: () => loadChanges(a.id) }} />;
    } else if (!c.added) {
      diff = <div className={styles.panelNote}>Only one report so far. Re-run it later to see what changed.</div>;
    } else if (c.added.length === 0) {
      diff = <EmptyState size="compact" title={`Nothing new since ${formatDate(c.previousRunAt)}`} when="Updates when you re-run the report" />;
    } else {
      const bySection = new Map<string, ChangedFinding[]>();
      for (const f of c.added) bySection.set(f.section, [...(bySection.get(f.section) ?? []), f]);
      diff = (
        <div>
          <div className={styles.panelNote}>
            <span className={styles.mono}>{c.added.length}</span> new findings since{" "}
            <span className={styles.mono}>{formatDate(c.previousRunAt)}</span>
          </div>
          {[...bySection.entries()].map(([section, items]) => (
            <div key={section} className={styles.changeSection}>
              <div className={styles.changeHeading}>{section}</div>
              <ul className={styles.changeList}>
                {items.map((f, i) => (
                  <li key={i}>
                    {f.claim}
                    {f.sourceUrl && (
                      <>{" "}<a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.source}>{f.sourceName ?? "source"}</a></>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }
    return <>{renderTriggers(a)}{diff}</>;
  }

  function renderDeal(a: Account) {
    return (
      <div className={styles.dealForm}>
        <label className={styles.dealField}>
          <span>Deal value (USD)</span>
          <input
            className={styles.input}
            inputMode="decimal"
            value={draft.dealValue}
            onChange={(e) => setDraft((d) => ({ ...d, dealValue: e.target.value }))}
            placeholder="25000"
          />
        </label>
        <label className={styles.dealField}>
          <span>Next step</span>
          <input
            className={styles.input}
            value={draft.nextStep}
            maxLength={MAX_NEXT_STEP_LENGTH}
            onChange={(e) => setDraft((d) => ({ ...d, nextStep: e.target.value }))}
            placeholder="Send the proposal by Friday"
          />
        </label>
        {isEnabled("champion") && (
          <label className={styles.dealField}>
            <span>Champion</span>
            <input
              className={styles.input}
              value={draft.champion}
              maxLength={MAX_CHAMPION_LENGTH}
              onChange={(e) => setDraft((d) => ({ ...d, champion: e.target.value }))}
              placeholder="Full name, as on their site"
              title="We flag the deal at risk if this person drops off the company's leadership page. Someone who isn't listed there can't be tracked."
            />
          </label>
        )}
        <label className={`${styles.dealField} ${styles.dealWide}`}>
          <span>Notes</span>
          <textarea
            className={styles.textarea}
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            maxLength={MAX_NOTES_LENGTH}
            rows={4}
            placeholder="Who you spoke to, objections heard..."
          />
        </label>
        <div className={styles.panelFooter}>
          <span className={styles.mono}>{draft.notes.length}/{MAX_NOTES_LENGTH}</span>
          <button className={styles.ghostBtn} onClick={() => setPanel(null)}>Cancel</button>
          <button
            className={styles.primaryBtn}
            disabled={savingId === a.id}
            onClick={async () => {
              if (await patch(a.id, { dealValue: draft.dealValue, nextStep: draft.nextStep, notes: draft.notes, ...(isEnabled("champion") ? { champion: draft.champion } : {}) })) setPanel(null);
            }}
          >
            {savingId === a.id ? <><Spinner size={10} /> Saving...</> : "Save deal"}
          </button>
        </div>
      </div>
    );
  }

  function stageSelect(a: Account) {
    return (
      <select
        className={`${styles.select} ${styles[`stage_${a.stage}`]}`}
        value={a.stage}
        onChange={(e) => patch(a.id, { stage: e.target.value })}
        disabled={savingId === a.id}
        aria-label={`Stage for ${a.company}`}
      >
        {ACCOUNT_STAGES.map((s) => (
          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
        ))}
      </select>
    );
  }

  const companyLink = (a: Account) => a.latestRun ? <a href={`/app?run=${a.latestRun.id}`} title={a.company}>{a.company}</a> : <span className={styles.companyName} title={a.company}>{a.company}</span>;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar onResearchComplete={allowed ? load : undefined} />
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 className={styles.title}>Accounts</h2>
            {allowed && accounts.length > 0 && (
              <>
                <div className={styles.viewToggle} role="tablist" aria-label="View">
                  {(["list", "pipeline"] as const).map((v) => (
                    <button key={v} role="tab" aria-selected={view === v} className={`${styles.viewBtn} ${view === v ? styles.viewBtnActive : ""}`} onClick={() => setView(v)}>
                      {v === "list" ? "List" : "Pipeline"}
                    </button>
                  ))}
                </div>
                <a className={styles.ghostBtn} href="/api/accounts/export" download>Export CSV</a>
              </>
            )}
          </div>

          {tierLoading ? (
            <div className={styles.table} aria-hidden>
              {[0, 1, 2].map((i) => <SkeletonRow key={i} index={i} />)}
            </div>
          ) : !allowed ? (
            <EmptyState
              title="Accounts are part of Pro"
              when={null}
              description="Save target companies, track each deal through your pipeline, get flagged when something changes at an account, and export the list to your CRM."
              action={{ label: "See plans", onClick: () => router.push("/pricing") }}
            />
          ) : (
            <>
              <form className={styles.addRow} onSubmit={add}>
                <input
                  className={styles.input}
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="Add a company, e.g. Stripe · stripe.com"
                  maxLength={200}
                  aria-label="Company to add"
                />
                <button className={styles.primaryBtn} type="submit" disabled={adding || !newCompany.trim()}>
                  {adding ? <><Spinner size={10} /> Adding...</> : "Add account"}
                </button>
              </form>

              {error && <div className={styles.errorBanner} role="alert">{error}</div>}

              {accounts.length > 0 && (
                <div className={styles.summaryRow}>
                  <span>Open pipeline <strong className={styles.mono}>{formatMoney(openValue)}</strong></span>
                  <span><strong className={styles.mono}>{atRisk}</strong> at risk</span>
                  <span><strong className={styles.mono}>{stalled}</strong> stalled</span>
                  <label className={styles.stallSetting}>
                    Stalled after
                    <input
                      key={stallDays}
                      className={styles.stallInput}
                      type="number"
                      min={1}
                      max={365}
                      defaultValue={stallDays}
                      onBlur={(e) => saveStallDays(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      aria-label="Days without a stage change before a deal is stalled"
                    />
                    days without a stage change
                  </label>
                </div>
              )}

              {!loaded ? (
                <div className={styles.table} aria-hidden>
                  {[0, 1, 2].map((i) => <SkeletonRow key={i} index={i} />)}
                </div>
              ) : accounts.length === 0 ? (
                <EmptyState
                  title="No accounts yet"
                  when={null}
                  description={<>Add a company above, or open a company report and click <strong>Save to accounts</strong>.</>}
                  action={{ label: "Start research", onClick: () => router.push("/app") }}
                />
              ) : view === "pipeline" ? (
                <div className={styles.board}>
                  {totals.map((col) => (
                    <div key={col.stage} className={styles.column}>
                      <div className={`${styles.columnHead} ${styles[`stage_${col.stage}`]}`}>
                        <span>{STAGE_LABELS[col.stage]}</span>
                        <span className={styles.mono}>{col.count} · {formatMoney(col.total)}</span>
                      </div>
                      {accounts.filter((a) => a.stage === col.stage).map((a) => (
                        <div key={a.id} className={styles.card}>
                          <div className={styles.cardTop}>
                            <span className={styles.company}>{companyLink(a)}</span>
                            <HealthBadge health={a.health} reasons={a.healthReasons} />
                            {a.intent && <IntentBadge intent={a.intent} onClick={() => { setView("list"); toggleIntent(a.id); }} />}
                          </div>
                          <div className={styles.cardMeta}>
                            <span className={styles.mono}>{formatMoney(a.dealValue)}</span>
                            {a.owner && <span>{a.owner}</span>}
                            {a.freshTriggers > 0 && <span className={styles.fresh}>{a.freshTriggers} new</span>}
                          </div>
                          {a.nextStep && <div className={styles.nextStep}>Next: {a.nextStep}</div>}
                          {stageSelect(a)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className={styles.filters} role="tablist" aria-label="Filter by stage">
                    {(["all", ...ACCOUNT_STAGES] as const).map((s) => (
                      <button
                        key={s}
                        role="tab"
                        aria-selected={filter === s}
                        className={`${styles.filter} ${filter === s ? styles.filterActive : ""}`}
                        onClick={() => setFilter(s)}
                      >
                        {s === "all" ? "All" : STAGE_LABELS[s]} <span className={styles.mono}>{counts[s]}</span>
                      </button>
                    ))}
                  </div>
                  {visible.length === 0 ? (
                    <EmptyState size="compact" title={`No accounts in ${filter === "all" ? "this view" : STAGE_LABELS[filter]}`} when={null} />
                  ) : (
                    <div className={styles.table}>
                      <div className={`${styles.row} ${styles.headRow}`}>
                        <span>Company</span>
                        <span>Stage</span>
                        <span>Deal</span>
                        <span>Owner</span>
                        <span>Latest report</span>
                        <span />
                      </div>
                      {visible.map((a) => (
                        <div key={a.id} className={styles.item}>
                          <div className={styles.row}>
                            <span className={styles.company}>
                              {companyLink(a)}
                              <HealthBadge health={a.health} reasons={a.healthReasons} />
                              {a.intent && <IntentBadge intent={a.intent} onClick={() => toggleIntent(a.id)} />}
                              {a.freshTriggers > 0 && <span className={styles.fresh} title="Triggers found in the last 14 days">{a.freshTriggers} new</span>}
                            </span>
                            <span>{stageSelect(a)}</span>
                            <span className={styles.mono}>{formatMoney(a.dealValue)}</span>
                            <span>
                              <input
                                className={styles.ownerInput}
                                defaultValue={a.owner ?? ""}
                                placeholder="Unassigned"
                                maxLength={MAX_OWNER_LENGTH}
                                aria-label={`Owner for ${a.company}`}
                                onBlur={(e) => {
                                  const next = e.target.value.trim();
                                  if (next !== (a.owner ?? "")) patch(a.id, { owner: next || null });
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              />
                            </span>
                            <span className={styles.mono}>
                              {a.latestRun ? formatDate(a.latestRun.generatedAt) : <span className={styles.muted}>Not researched</span>}
                            </span>
                            <span className={styles.actions}>
                              <button className={styles.ghostBtn} onClick={() => toggleDeal(a)}>Deal</button>
                              <button className={styles.ghostBtn} onClick={() => toggleChanges(a.id)} disabled={a.runCount === 0 && a.triggers.length === 0}>
                                What changed
                              </button>
                              <button className={styles.ghostBtn} onClick={() => rerun(a)} disabled={rerunningId !== null}>
                                {rerunningId === a.id ? <><Spinner size={10} /> Running...</> : a.latestRun ? "Re-run" : "Research"}
                              </button>
                              <button className={`${styles.ghostBtn} ${styles.danger}`} onClick={() => remove(a)}>Remove</button>
                            </span>
                          </div>
                          {a.nextStep && panel?.id !== a.id && <div className={styles.nextStepRow}>Next: {a.nextStep}</div>}
                          {panel?.id === a.id && panel.kind === "deal" && <div className={styles.panel}>{renderDeal(a)}</div>}
                          {panel?.id === a.id && panel.kind === "changes" && <div className={styles.panel}>{renderChanges(a)}</div>}
                          {panel?.id === a.id && panel.kind === "intent" && <div className={styles.panel}>{renderIntent(a)}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
