import type { MonthlyUsage, Tier, WindowUsage } from "./tier-context";

// Shared by the sidebar meter, the near-limit banner and Settings so all
// three agree on when a cap counts as "near" or "reached".
export const NEAR_LIMIT_PCT = 80;

export type UsageStatus = "ok" | "warn" | "danger";

export interface UsageRow {
  key: string;
  /** "Quick Profiles", "Deep Dives". */
  label: string;
  /** "this month" / "this 8-hour window", for sentences. */
  periodPhrase: string;
  /** Short tag for compact UI: "month" / "8h". */
  periodTag: string;
  used: number;
  limit: number;
  pct: number;
  status: UsageStatus;
  /** "Nov 3" for monthly caps, "3:42 PM" for the work window; null when
   *  no window is open yet. */
  resets: string | null;
  /** Signup-trial totals never reset: the day the trial ends, "Nov 23". */
  ends?: string;
}

function row(key: string, label: string, periodPhrase: string, periodTag: string, used: number, limit: number, resets: string | null, ends?: string): UsageRow[] {
  if (limit <= 0) return [];
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const status: UsageStatus = pct >= 100 ? "danger" : pct >= NEAR_LIMIT_PCT ? "warn" : "ok";
  return [{ key, label, periodPhrase, periodTag, used, limit, pct, status, resets, ...(ends ? { ends } : {}) }];
}

/** A monthly cap, or the same numbers as a signup-trial total. */
function capRow(key: string, label: string, u: MonthlyUsage): UsageRow[] {
  return u.period === "trial"
    ? row(`trial-${key}`, label, "in your free trial", "trial", u.used, u.limit, null, monthDay(u.resetsAt))
    : row(`month-${key}`, label, "this month", "month", u.used, u.limit, monthDay(u.resetsAt));
}

/** "Nov 23" when the account is on its signup trial, else null. */
export function trialEnds(usage: { monthlyUsage: MonthlyUsage | null; monthlyDeepDiveUsage: MonthlyUsage | null }): string | null {
  const u = [usage.monthlyUsage, usage.monthlyDeepDiveUsage].find((m) => m?.period === "trial");
  return u ? monthDay(u.resetsAt) : null;
}

const monthDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Every cap the tier has, work window first (it's the one people hit
 *  during a day), then monthly. */
export function usageRows(usage: {
  monthlyUsage: MonthlyUsage | null;
  monthlyDeepDiveUsage: MonthlyUsage | null;
  windowUsage: WindowUsage | null;
}): UsageRow[] {
  const { monthlyUsage, monthlyDeepDiveUsage, windowUsage: w } = usage;
  const windowPhrase = w ? `this ${w.hours}-hour window` : "";
  const windowTag = w ? `${w.hours}h` : "";
  const windowResets = w?.resetsAt ? clock(w.resetsAt) : null;
  return [
    ...(w?.research ? row("window-research", "Quick Profiles", windowPhrase, windowTag, w.research.used, w.research.limit, windowResets) : []),
    ...(w?.deepDives ? row("window-deep", "Deep Dives", windowPhrase, windowTag, w.deepDives.used, w.deepDives.limit, windowResets) : []),
    ...(monthlyUsage ? capRow("research", "Quick Profiles", monthlyUsage) : []),
    ...(monthlyDeepDiveUsage ? capRow("deep", "Deep Dives", monthlyDeepDiveUsage) : []),
  ];
}

/** Where "upgrade" goes for each tier. Free/Basic self-serve to Pro on
 *  the pricing page; Pro's next step is Team, which is email-only.
 *  Null for tiers with nothing to upgrade to. `trialEndsOn` ("Nov 23", from
 *  trialEnds) marks the signup trial; a hand-assigned trial has none. */
export function upgradeTarget(tier: Tier | null, trialEndsOn?: string | null): { label: string; href: string; pitch: string } | null {
  switch (tier) {
    case "trial":
      return trialEndsOn
        ? { label: "Pick a plan", href: "/pricing", pitch: `Your free trial ends ${trialEndsOn}. After that you're on Free.` }
        : null;
    case "free":
    case "basic":
      return {
        label: "Upgrade to Pro",
        href: "/pricing",
        pitch: "Deep Dives, Knowledge Graph and 300 profiles a month.",
      };
    case "pro":
      return {
        label: "Talk to us about Team",
        href: "mailto:support@metisanalytic.com?subject=Metis Team",
        pitch: "Higher limits for teams that research every day.",
      };
    default:
      return null;
  }
}
