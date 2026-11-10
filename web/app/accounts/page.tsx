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
  MAX_NOTES_LENGTH,
  MAX_OWNER_LENGTH,
  STAGE_LABELS,
  type AccountStage,
  type ChangedFinding,
} from "../../lib/accounts";
import styles from "./page.module.css";

interface Account {
  id: string;
  company: string;
  stage: AccountStage;
  owner: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  latestRun: { id: string; generatedAt: string } | null;
  runCount: number;
}

interface Changes {
  latestRunAt: string | null;
  previousRunAt: string | null;
  added: ChangedFinding[] | null;
}

type Panel = { id: string; kind: "notes" | "changes" } | null;

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === "string" && data.error) || fallback;
}

export default function AccountsPage() {
  const router = useRouter();
  const { can, loading: tierLoading } = useTier();
  const allowed = can("accountsAccess");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccountStage | "all">("all");
  const [newCompany, setNewCompany] = useState("");
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Changes | "loading" | "error">>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Couldn't load your accounts."));
      setAccounts(await res.json());
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

  const visible = filter === "all" ? accounts : accounts.filter((a) => a.stage === filter);

  async function patch(id: string, body: Partial<Pick<Account, "stage" | "owner" | "notes">>) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't save the change."));
      setAccounts((list) => list.map((a) => (a.id === id ? { ...a, ...body, updatedAt: new Date().toISOString() } : a)));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingId(null);
    }
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

  function toggleNotes(account: Account) {
    if (panel?.id === account.id && panel.kind === "notes") return setPanel(null);
    setNotesDraft(account.notes ?? "");
    setPanel({ id: account.id, kind: "notes" });
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
      await load();
      // Sources are saved just after the report returns; give them a moment.
      setPanel({ id: account.id, kind: "changes" });
      setTimeout(() => loadChanges(account.id), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunningId(null);
    }
  }

  function renderChanges(id: string) {
    const c = changes[id];
    if (!c || c === "loading") {
      return <div className={styles.panelNote}><Spinner size={10} /> Comparing the last two reports...</div>;
    }
    if (c === "error") {
      return <EmptyState size="compact" title="Couldn't compare the reports" when={null} action={{ label: "Try again", onClick: () => loadChanges(id) }} />;
    }
    if (!c.added) {
      return <div className={styles.panelNote}>Only one report so far. Re-run it later to see what changed.</div>;
    }
    if (c.added.length === 0) {
      return <EmptyState size="compact" title={`Nothing new since ${formatDate(c.previousRunAt)}`} when="Updates when you re-run the report" />;
    }
    const bySection = new Map<string, ChangedFinding[]>();
    for (const f of c.added) bySection.set(f.section, [...(bySection.get(f.section) ?? []), f]);
    return (
      <div>
        <div className={styles.panelNote}>
          <span className={styles.mono}>{c.added.length}</span> new since{" "}
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
                    <>
                      {" "}
                      <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.source}>
                        {f.sourceName ?? "source"}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar onResearchComplete={allowed ? load : undefined} />
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 className={styles.title}>Accounts</h2>
            {allowed && accounts.length > 0 && (
              <a className={styles.ghostBtn} href="/api/accounts/export" download>
                Export CSV
              </a>
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
              description="Save target companies, track each one through your pipeline, see what changed since the last report, and export the list to your CRM."
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
              ) : visible.length === 0 ? (
                <EmptyState size="compact" title={`No accounts in ${filter === "all" ? "this view" : STAGE_LABELS[filter]}`} when={null} />
              ) : (
                <div className={styles.table}>
                  <div className={`${styles.row} ${styles.headRow}`}>
                    <span>Company</span>
                    <span>Stage</span>
                    <span>Owner</span>
                    <span>Latest report</span>
                    <span />
                  </div>
                  {visible.map((a) => (
                    <div key={a.id} className={styles.item}>
                      <div className={styles.row}>
                        <span className={styles.company}>
                          {a.latestRun ? (
                            <a href={`/app?run=${a.latestRun.id}`}>{a.company}</a>
                          ) : (
                            a.company
                          )}
                          {a.notes && <span className={styles.hasNotes} title="Has notes">✎</span>}
                        </span>
                        <span>
                          <select
                            className={`${styles.select} ${styles[`stage_${a.stage}`]}`}
                            value={a.stage}
                            onChange={(e) => patch(a.id, { stage: e.target.value as AccountStage })}
                            disabled={savingId === a.id}
                            aria-label={`Stage for ${a.company}`}
                          >
                            {ACCOUNT_STAGES.map((s) => (
                              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                            ))}
                          </select>
                        </span>
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
                          <button className={styles.ghostBtn} onClick={() => toggleNotes(a)}>Notes</button>
                          <button
                            className={styles.ghostBtn}
                            onClick={() => toggleChanges(a.id)}
                            disabled={a.runCount === 0}
                            title={a.runCount < 2 ? "Needs two reports to compare" : undefined}
                          >
                            What changed
                          </button>
                          <button className={styles.ghostBtn} onClick={() => rerun(a)} disabled={rerunningId !== null}>
                            {rerunningId === a.id ? <><Spinner size={10} /> Running...</> : a.latestRun ? "Re-run" : "Research"}
                          </button>
                          <button className={`${styles.ghostBtn} ${styles.danger}`} onClick={() => remove(a)}>Remove</button>
                        </span>
                      </div>

                      {panel?.id === a.id && panel.kind === "notes" && (
                        <div className={styles.panel}>
                          <textarea
                            className={styles.textarea}
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            maxLength={MAX_NOTES_LENGTH}
                            rows={5}
                            placeholder="Who you spoke to, next step, objections heard..."
                            aria-label={`Notes for ${a.company}`}
                          />
                          <div className={styles.panelFooter}>
                            <span className={styles.mono}>{notesDraft.length}/{MAX_NOTES_LENGTH}</span>
                            <button className={styles.ghostBtn} onClick={() => setPanel(null)}>Cancel</button>
                            <button
                              className={styles.primaryBtn}
                              disabled={savingId === a.id}
                              onClick={async () => {
                                if (await patch(a.id, { notes: notesDraft.trim() || null })) setPanel(null);
                              }}
                            >
                              {savingId === a.id ? <><Spinner size={10} /> Saving...</> : "Save notes"}
                            </button>
                          </div>
                        </div>
                      )}

                      {panel?.id === a.id && panel.kind === "changes" && (
                        <div className={styles.panel}>{renderChanges(a.id)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
