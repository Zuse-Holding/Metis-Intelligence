import { track } from "@vercel/analytics";

// Vercel Web Analytics custom events. Best effort: an ad blocker, a plan without custom events or
// missing storage must never get in the way of signing up, so everything here swallows errors.
const SRC_KEY = "metis_src";
const SRC_PATTERN = /^[a-z0-9_-]{1,40}$/i;

/** Remember a ?src= campaign tag (e.g. ?src=pitch-nov14) for this browser session, so it is still
 *  known when the visitor reaches /login a few clicks later. */
export function rememberSrc(search: string = typeof window === "undefined" ? "" : window.location.search): void {
  try {
    const src = new URLSearchParams(search).get("src");
    if (src && SRC_PATTERN.test(src)) sessionStorage.setItem(SRC_KEY, src.toLowerCase());
  } catch {
    // storage unavailable: the event just goes out as "direct"
  }
}

export function currentSrc(): string {
  try {
    return sessionStorage.getItem(SRC_KEY) ?? "direct";
  } catch {
    return "direct";
  }
}

/** A new account was created, which starts the 7-day trial. */
export function trackTrialStarted(): void {
  try {
    track("trial_started", { src: currentSrc() });
  } catch {
    // never block signup on analytics
  }
}
