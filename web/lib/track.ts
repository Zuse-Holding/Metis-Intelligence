import { track } from "@vercel/analytics";
import { currentSrc } from "./src-tag";

// Vercel Web Analytics custom events. Best effort: an ad blocker or a plan without custom events
// must never get in the way of signing up, so everything here swallows errors.
// The ?src= tag logic lives in ./src-tag so it can be tested without this browser-only dependency.
export { rememberSrc, currentSrc } from "./src-tag";

/** A new account was created, which starts the 7-day trial. */
export function trackTrialStarted(): void {
  try {
    track("trial_started", { src: currentSrc() });
  } catch {
    // never block signup on analytics
  }
}
