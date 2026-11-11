"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EmptyState from "../../components/EmptyState";
import { SkeletonRow, Spinner } from "../../components/Skeleton";
import { useTier } from "../../lib/tier-context";
import { isEnabled } from "../../lib/flags";
import { agencyLevels, agencyToSave, type Opportunity } from "../../lib/intent";
import styles from "./page.module.css";

type Row = Opportunity & { savedAs: string | null };

function formatDay(iso: string | null) {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === "string" && data.error) || fallback;
}

/** Buyer intent v1: federal agencies with open solicitations in what you sell. */
export default function ShoppingNowPage() {
  const router = useRouter();
  const { can, loading: tierLoading } = useTier();
  const allowed = can("accountsAccess");
  const enabled = isEnabled("buyer_intent");

  const [rows, setRows] = useState<Row[]>([]);
  const [hasCategory, setHasCategory] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shopping-now", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Couldn't load open solicitations."));
      const data = await res.json();
      setRows(data.opportunities ?? []);
      setHasCategory(data.hasCategory !== false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (enabled && !tierLoading && allowed) load();
  }, [enabled, tierLoading, allowed, load]);

  async function save(row: Row) {
    const company = agencyToSave(row.agencyPath);
    setSavingId(row.noticeId);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't save the account."));
      setRows((rs) => rs.map((r) => (r.agencyPath === row.agencyPath || agencyToSave(r.agencyPath) === company ? { ...r, savedAs: r.savedAs ?? company } : r)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  let body: React.ReactNode;
  if (!enabled) {
    body = <EmptyState title="Shopping now isn't switched on" when={null} description="This page lists federal solicitations in your category once buyer intent is turned on." />;
  } else if (tierLoading) {
    body = <div className={styles.list} aria-hidden>{[0, 1, 2].map((i) => <SkeletonRow key={i} index={i} />)}</div>;
  } else if (!allowed) {
    body = (
      <EmptyState
        title="Shopping now is part of Pro"
        when={null}
        description="See federal agencies with open solicitations in what you sell, and save them to your accounts."
        action={{ label: "See plans", onClick: () => router.push("/pricing") }}
      />
    );
  } else if (!loaded) {
    body = <div className={styles.list} aria-hidden>{[0, 1, 2].map((i) => <SkeletonRow key={i} index={i} />)}</div>;
  } else if (!hasCategory) {
    body = (
      <EmptyState
        title="Add your NAICS codes or keywords"
        when={null}
        description="Add them under What you sell in Settings, and we'll list open SAM.gov solicitations that match."
        action={{ label: "Open settings", onClick: () => router.push("/settings") }}
      />
    );
  } else if (rows.length === 0 && !error) {
    body = (
      <EmptyState
        title="No open solicitations match what you sell"
        when="Updates daily as SAM.gov posts new notices"
        description="Try a shorter NAICS code or broader keywords in Settings."
        action={{ label: "Open settings", onClick: () => router.push("/settings") }}
      />
    );
  } else {
    body = (
      <ul className={styles.list}>
        {rows.map((r) => {
          const due = formatDay(r.responseDeadline);
          const posted = formatDay(r.postedDate);
          return (
            <li key={r.noticeId} className={styles.item}>
              <div className={styles.itemMain}>
                <a className={styles.itemTitle} href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
                <div className={styles.agency}>{agencyLevels(r.agencyPath).join(" › ")}</div>
                <div className={styles.meta}>
                  <span>{r.noticeType}</span>
                  {r.naicsCode && <span className={styles.mono}>NAICS {r.naicsCode}</span>}
                  {r.setAside && <span>{r.setAside}</span>}
                  {posted && <span>Posted <span className={styles.mono}>{posted}</span></span>}
                  <span className={styles.source}>SAM.gov</span>
                </div>
              </div>
              <div className={styles.itemSide}>
                {due && <div className={styles.due}>Due <span className={styles.mono}>{due}</span></div>}
                {r.savedAs ? (
                  <span className={styles.saved}>In accounts as {r.savedAs}</span>
                ) : (
                  <button className={styles.ghostBtn} onClick={() => save(r)} disabled={savingId !== null}>
                    {savingId === r.noticeId ? <><Spinner size={10} /> Saving...</> : `Save ${agencyToSave(r.agencyPath)} to accounts`}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 className={styles.title}>Shopping now</h2>
            {enabled && allowed && loaded && rows.length > 0 && <span className={styles.count}><span className={styles.mono}>{rows.length}</span> open</span>}
          </div>
          <p className={styles.intro}>Federal agencies with open SAM.gov solicitations in what you sell, soonest deadline first. Each links to the notice on SAM.gov.</p>
          {error && <div className={styles.errorBanner} role="alert">{error}</div>}
          {body}
        </div>
      </main>
    </div>
  );
}
