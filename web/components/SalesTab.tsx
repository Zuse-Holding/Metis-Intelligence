"use client";
import { useEffect, useMemo, useState } from "react";
import EmptyState from "./EmptyState";
import SellerOfferForm from "./SellerOfferForm";
import { Spinner } from "./Skeleton";
import { contacts, isCompetitor, outreachBrief, snapshot, whyNow, type SalesBundle, type SellerOffer } from "../lib/sales";
import styles from "./SalesTab.module.css";

interface Props {
  subject: string;
  bundle: SalesBundle | null | undefined;
  /** The report's id: peer comparison reads the report on the server. */
  runId?: string;
}

interface WeakSpot { kind: string; title: string; url: string; date: string; outlet?: string }
interface PeerGap { vendor: string; category: string; of: number; peers: { name: string; evidence: string; url: string }[] }
interface PeerResult { gaps: PeerGap[]; compared: { name: string; domain: string; tools: number }[]; skipped: string[]; reason?: string }

const WEAK_SPOT_LABELS: Record<string, string> = {
  price_increase: "Price increase", outage: "Outage", layoffs: "Layoffs", acquisition: "Acquisition",
  sunset: "Product retired", security: "Security incident", lawsuit: "Lawsuit",
};

type Load<T> = { state: "idle" } | { state: "loading" } | { state: "error"; message: string } | { state: "done"; data: T };

/**
 * A company report seen as a seller sees it: tech stack, why now, who to
 * contact and a short snapshot, all from the report's own cited data, plus
 * a "Copy for outreach" brief to paste into an email tool.
 */
export default function SalesTab({ subject, bundle, runId }: Props) {
  const [offer, setOffer] = useState<SellerOffer | null>(null);
  const [offerLoaded, setOfferLoaded] = useState(false);
  const [editingOffer, setEditingOffer] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [spots, setSpots] = useState<Record<string, Load<WeakSpot[]>>>({});
  const [peers, setPeers] = useState<Load<PeerResult>>({ state: "idle" });

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Try again shortly.");
    return data as T;
  }

  async function loadSpots(vendor: string) {
    setSpots((s) => ({ ...s, [vendor]: { state: "loading" } }));
    try {
      const data = await post<{ weakSpots: WeakSpot[] }>("/api/displacement/weak-spots", { vendor });
      setSpots((s) => ({ ...s, [vendor]: { state: "done", data: data.weakSpots } }));
    } catch (err) {
      setSpots((s) => ({ ...s, [vendor]: { state: "error", message: err instanceof Error ? err.message : String(err) } }));
    }
  }

  async function loadPeers() {
    if (!runId) return;
    setPeers({ state: "loading" });
    try {
      setPeers({ state: "done", data: await post<PeerResult>("/api/displacement/peers", { runId }) });
    } catch (err) {
      setPeers({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  useEffect(() => {
    fetch("/api/seller-offer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { offer: null }))
      .then((d) => setOffer(d.offer ?? null))
      .catch(() => setOffer(null))
      .finally(() => setOfferLoaded(true));
  }, []);

  const b = useMemo<SalesBundle>(() => bundle ?? {}, [bundle]);
  const events = useMemo(() => whyNow(b), [b]);
  const people = useMemo(() => contacts(b), [b]);
  const snap = useMemo(() => snapshot(b), [b]);
  const stack = b.techStack;
  const competitorsUsed = stack && offer ? stack.items.filter((i) => isCompetitor(i.vendor, offer.competitors)) : [];

  const byCategory = useMemo(() => {
    const m = new Map<string, NonNullable<SalesBundle["techStack"]>["items"]>();
    for (const i of stack?.items ?? []) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [stack]);

  async function copyBrief() {
    const text = outreachBrief(subject, b, offer);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  }

  if (!bundle) {
    return <EmptyState title="This report has no saved data for the Sales tab" when="Re-run the report to build it" />;
  }

  return (
    <div className={styles.tab}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarNote}>Everything here comes from this report and links to its source.</span>
        <button className={styles.copyBtn} onClick={copyBrief} title="Copies why now, tech stack and contacts, with links, as plain text">
          {copied === "done" ? "✓ Copied" : copied === "failed" ? "Copy blocked by the browser" : "Copy for outreach"}
        </button>
      </div>

      {/* 1. Tech stack */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>Tech stack</h3>
          {offerLoaded && !editingOffer && (
            <button className={styles.linkBtn} onClick={() => setEditingOffer(true)}>
              {offer ? "Edit what you sell" : "Add what you sell to flag competitors"}
            </button>
          )}
        </div>
        {editingOffer && (
          <div className={styles.offerBox}>
            <SellerOfferForm
              offer={offer}
              onSaved={(o) => { setOffer(o); setEditingOffer(false); }}
              intro="Tell us what you sell and who you replace. It's saved to your account and used on every report."
            />
          </div>
        )}
        {!stack ? (
          <EmptyState size="compact" title="Tech stack wasn't checked on this report" when="Re-run the report to add it" />
        ) : (
          <>
            {competitorsUsed.length > 0 && (
              <div className={styles.callout}>
                Runs {competitorsUsed.map((c) => c.vendor).join(", ")}, which you replace.
              </div>
            )}
            {competitorsUsed.map((c) => {
              const s = spots[c.vendor] ?? { state: "idle" as const };
              return (
                <div key={c.vendor} className={styles.displace}>
                  <div className={styles.displaceHead}>
                    <span>Why they might switch from <strong>{c.vendor}</strong></span>
                    {s.state === "idle" && <button className={styles.linkBtn} onClick={() => loadSpots(c.vendor)}>Check the news</button>}
                    {s.state === "loading" && <span className={styles.note}><Spinner size={10} /> Searching the news...</span>}
                  </div>
                  {s.state === "error" && <p className={styles.errorText}>{s.message}</p>}
                  {s.state === "done" && (s.data.length === 0 ? (
                    <EmptyState size="compact" title={`Nothing in the news about ${c.vendor} in the last two years`} when="Checked weekly" />
                  ) : (
                    <ul className={styles.events}>
                      {s.data.map((w) => (
                        <li key={w.url} className={styles.event}>
                          <span className={styles.eventDate}>{w.date}</span>
                          <span className={styles.eventKind}>{WEAK_SPOT_LABELS[w.kind] ?? w.kind}</span>
                          <a href={w.url} target="_blank" rel="noopener noreferrer" className={styles.eventText}>
                            {w.title}{w.outlet ? <span className={styles.eventSource}> · {w.outlet}</span> : null}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ))}
                </div>
              );
            })}
            {stack.items.length === 0 ? (
              <EmptyState size="compact" title={`Nothing visible in ${stack.domain}'s public records`} when="Internal tools often leave no public trace" />
            ) : (
              <div className={styles.stack}>
                {byCategory.map(([category, items]) => (
                  <div key={category} className={styles.stackRow}>
                    <span className={styles.stackCategory}>{category}</span>
                    <span className={styles.stackVendors}>
                      {items.map((i) => (
                        <a
                          key={i.vendor}
                          href={i.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${i.confidence === "likely" ? "Likely, from a subdomain name only. " : ""}${i.evidence} (${i.sourceName})`}
                          className={`${styles.vendor} ${i.confidence === "likely" ? styles.vendorLikely : ""} ${offer && isCompetitor(i.vendor, offer.competitors) ? styles.vendorCompetitor : ""}`}
                        >
                          {i.vendor}{i.confidence === "likely" && <span className={styles.likelyMark}> · likely</span>}
                        </a>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {stack.websiteUnavailable && (
              <p className={styles.note}>From public DNS only; the homepage couldn&apos;t be read ({stack.websiteUnavailable}).</p>
            )}
          </>
        )}
      </section>

      {/* Peer urgency */}
      {stack && (b.competitors?.length ?? 0) >= 2 && runId && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>What their peers use</h3>
            {peers.state === "idle" && <button className={styles.linkBtn} onClick={loadPeers}>Compare with {Math.min(b.competitors!.length, 5)} peers</button>}
          </div>
          {peers.state === "loading" && <p className={styles.note}><Spinner size={10} /> Reading peers&apos; public records...</p>}
          {peers.state === "error" && <p className={styles.errorText}>{peers.message}</p>}
          {peers.state === "done" && (
            <>
              {peers.data.gaps.length === 0 ? (
                <EmptyState size="compact" title="No tool that two or more peers use is missing here" when={null} />
              ) : (
                <ul className={styles.gaps}>
                  {peers.data.gaps.map((g) => (
                    <li key={g.vendor}>
                      <strong>{g.peers.length} of {g.of}</strong> peers use <strong>{g.vendor}</strong> ({g.category}); {subject.split(" · ")[0]} doesn&apos;t show it:{" "}
                      {g.peers.map((p, i) => (
                        <span key={p.name}>{i > 0 && ", "}<a href={p.url} target="_blank" rel="noopener noreferrer" title={p.evidence} className={styles.source}>{p.name}</a></span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.note}>
                Compared {peers.data.compared.map((c) => `${c.name} (${c.domain})`).join(", ") || "no peers"}.
                {peers.data.skipped.length > 0 && ` Left out ${peers.data.skipped.join(", ")}: no website we could confirm was theirs.`}
              </p>
            </>
          )}
        </section>
      )}

      {/* 2. Why now */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Why now</h3>
        {events.length === 0 ? (
          <EmptyState size="compact" title="No dated events in the last 12 months" when="Updates when you re-run the report" />
        ) : (
          <ul className={styles.events}>
            {events.map((e, i) => (
              <li key={i} className={styles.event}>
                <span className={styles.eventDate}>{e.date}</span>
                <span className={styles.eventKind}>{e.kind}</span>
                <a href={e.url} target="_blank" rel="noopener noreferrer" className={styles.eventText}>
                  {e.text}{e.sourceName ? <span className={styles.eventSource}> · {e.sourceName}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Who to contact */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Who to contact</h3>
        {people.length === 0 ? (
          <EmptyState size="compact" title="No leaders named in public sources" when={null} />
        ) : (
          <ul className={styles.people}>
            {people.map((p) => (
              <li key={p.name} className={styles.person}>
                <span className={styles.personName}>{p.name}</span>
                <span className={styles.personTitle}>{p.title}</span>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className={styles.source}>source ↗</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Account snapshot */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Account snapshot</h3>
        {snap.summary && <p className={styles.summary}>{snap.summary}</p>}
        {snap.rows.length > 0 && (
          <dl className={styles.snapshot}>
            {snap.rows.map((r) => (
              <div key={r.label} className={styles.snapshotRow}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {!snap.summary && snap.rows.length === 0 && (
          <EmptyState size="compact" title="The report found no company basics" when="Updates when you re-run the report" />
        )}
      </section>
    </div>
  );
}
