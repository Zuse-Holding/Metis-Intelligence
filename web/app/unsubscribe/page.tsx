import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { submitUnsubscribe } from "../../lib/unsubscribe";
import styles from "../exclusion-confirm/page.module.css";

export const metadata: Metadata = {
  title: "Unsubscribe — Metis",
  robots: { index: false },
};

/**
 * Opened from the unsubscribe link in an email, usually without a session.
 * Asks for a click rather than acting on load: mail scanners open links.
 */
async function unsubscribe(formData: FormData) {
  "use server";
  const ok = await submitUnsubscribe(String(formData.get("token") ?? ""));
  redirect(`/unsubscribe?result=${ok ? "done" : "failed"}`);
}

export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ t?: string; result?: string }> }) {
  const { t: token, result } = await searchParams;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.label}>Email</div>
        {result === "done" ? (
          <>
            <h1 className={styles.title}>You&apos;re unsubscribed.</h1>
            <p className={styles.text}>We won&apos;t send you emails like this again. You&apos;ll still get emails about your account, like password resets.</p>
          </>
        ) : result === "failed" ? (
          <>
            <h1 className={styles.title}>That link didn&apos;t work.</h1>
            <p className={styles.text}>Try the link from the email again, or write to support@metisanalytic.com and we&apos;ll take you off the list.</p>
          </>
        ) : token ? (
          <form action={unsubscribe}>
            <h1 className={styles.title}>Unsubscribe from Metis emails?</h1>
            <p className={styles.text}>You&apos;ll stop getting check-ins like this one. Emails about your account, like password resets, still come through.</p>
            <input type="hidden" name="token" value={token} />
            <button type="submit" className={styles.button}>Unsubscribe</button>
          </form>
        ) : (
          <>
            <h1 className={styles.title}>Nothing to unsubscribe.</h1>
            <p className={styles.text}>Open the link from the email you got.</p>
          </>
        )}
      </div>
    </main>
  );
}
