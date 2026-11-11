// When a federal award's period of performance ends, as a phrase for the
// report ("ends in 5 months (2027-04-30)"). Pure; buyer intent's
// "contract ending" signal reads the same end date.

function parseDay(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Whole calendar months from `now` until `end`; negative once it has passed. */
export function monthsUntil(end: Date, now: Date): number {
  let m = (end.getUTCFullYear() - now.getUTCFullYear()) * 12 + (end.getUTCMonth() - now.getUTCMonth());
  if (end.getUTCDate() < now.getUTCDate()) m -= 1;
  return m;
}

/** "ends in 5 months (2027-04-30)", "ends in under a month (…)", "ended 2024-03-31"; undefined without a usable date. */
export function contractEndPhrase(endDate: string | undefined, now = new Date()): string | undefined {
  const end = parseDay(endDate);
  if (!end) return undefined;
  if (end.getTime() < now.getTime()) return `ended ${endDate}`;
  const m = monthsUntil(end, now);
  const when = m < 1 ? "under a month" : m === 1 ? "1 month" : `${m} months`;
  return `ends in ${when} (${endDate})`;
}
