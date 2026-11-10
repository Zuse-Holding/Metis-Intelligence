"use client";
import { FormEvent, useEffect, useState } from "react";
import { MAX_OFFERING, MAX_TARGET, type SellerOffer } from "../lib/sales";
import { Spinner } from "./Skeleton";
import styles from "./SellerOfferForm.module.css";

interface Props {
  offer: SellerOffer | null;
  onSaved: (offer: SellerOffer) => void;
  /** Shown above the fields, e.g. why the Sales tab is asking. */
  intro?: string;
}

/** "What you sell": used on Settings and inline on the Sales tab. */
export default function SellerOfferForm({ offer, onSaved, intro }: Props) {
  const [offering, setOffering] = useState(offer?.offering ?? "");
  const [targetCustomers, setTargetCustomers] = useState(offer?.targetCustomers ?? "");
  const [competitors, setCompetitors] = useState((offer?.competitors ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOffering(offer?.offering ?? "");
    setTargetCustomers(offer?.targetCustomers ?? "");
    setCompetitors((offer?.competitors ?? []).join(", "));
  }, [offer]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/seller-offer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offering,
          targetCustomers,
          competitors: competitors.split(/[,\n]/).map((c) => c.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save. Try again.");
      setSaved(true);
      onSaved(data.offer as SellerOffer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={save}>
      {intro && <p className={styles.intro}>{intro}</p>}
      <label className={styles.field}>
        <span className={styles.label}>What you sell</span>
        <input
          className={styles.input}
          value={offering}
          onChange={(e) => { setOffering(e.target.value); setSaved(false); }}
          maxLength={MAX_OFFERING}
          placeholder="The outcome, e.g. cuts accounts-payable processing time in half"
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Who you sell to</span>
        <input
          className={styles.input}
          value={targetCustomers}
          onChange={(e) => { setTargetCustomers(e.target.value); setSaved(false); }}
          maxLength={MAX_TARGET}
          placeholder="e.g. mid-size distributors, finance leaders"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Competitors you replace</span>
        <input
          className={styles.input}
          value={competitors}
          onChange={(e) => { setCompetitors(e.target.value); setSaved(false); }}
          placeholder="Vendor names, separated by commas, e.g. HubSpot, Salesforce"
        />
        <span className={styles.hint}>Use the vendor&apos;s name as it appears in a report&apos;s tech stack, so we can flag accounts that use them.</span>
      </label>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.actions}>
        <button className={styles.saveBtn} type="submit" disabled={saving || !offering.trim()}>
          {saving ? <><Spinner size={10} /> Saving...</> : saved ? "✓ Saved" : "Save"}
        </button>
      </div>
    </form>
  );
}
