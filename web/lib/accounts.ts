/**
 * Account pipeline (ABM brief §4): pure helpers shared by the API routes and
 * the Accounts page. No I/O here, so it's unit-tested directly.
 */

export const ACCOUNT_STAGES = ["researching", "contacted", "meeting", "proposal", "won", "lost"] as const;
export type AccountStage = (typeof ACCOUNT_STAGES)[number];

export const STAGE_LABELS: Record<AccountStage, string> = {
  researching: "Researching",
  contacted: "Contacted",
  meeting: "Meeting",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const MAX_COMPANY_LENGTH = 200;
export const MAX_OWNER_LENGTH = 120;
export const MAX_NOTES_LENGTH = 5000;
export const MAX_NEXT_STEP_LENGTH = 300;
export const MAX_DEAL_VALUE = 1_000_000_000_000;

export function isAccountStage(value: unknown): value is AccountStage {
  return typeof value === "string" && (ACCOUNT_STAGES as readonly string[]).includes(value);
}

/** Strips control characters (keeping newlines and tabs in notes) and trims. */
function clean(value: string, keepNewlines: boolean): string {
  const pattern = keepNewlines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
  return value.replace(pattern, "").trim();
}

export interface AccountPatch {
  stage?: AccountStage;
  owner?: string | null;
  notes?: string | null;
  dealValue?: number | null;
  nextStep?: string | null;
}

/**
 * Validates an edit from the browser. Only stage, owner and notes can change;
 * anything else in the body is ignored. Empty owner/notes clear the field.
 */
export function parseAccountPatch(body: unknown): { ok: true; patch: AccountPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Nothing to update." };
  const input = body as Record<string, unknown>;
  const patch: AccountPatch = {};

  if ("stage" in input) {
    if (!isAccountStage(input.stage)) return { ok: false, error: "Pick a stage from the list." };
    patch.stage = input.stage;
  }
  if ("owner" in input) {
    if (input.owner !== null && typeof input.owner !== "string") return { ok: false, error: "Owner must be text." };
    const owner = input.owner === null ? "" : clean(input.owner, false);
    if (owner.length > MAX_OWNER_LENGTH) return { ok: false, error: `Owner can be at most ${MAX_OWNER_LENGTH} characters.` };
    patch.owner = owner || null;
  }
  if ("notes" in input) {
    if (input.notes !== null && typeof input.notes !== "string") return { ok: false, error: "Notes must be text." };
    const notes = input.notes === null ? "" : clean(input.notes, true);
    if (notes.length > MAX_NOTES_LENGTH) return { ok: false, error: `Notes can be at most ${MAX_NOTES_LENGTH} characters.` };
    patch.notes = notes || null;
  }

  if ("dealValue" in input) {
    const v = input.dealValue;
    if (v === null || v === "") patch.dealValue = null;
    else {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
      if (!Number.isFinite(n) || n < 0 || n > MAX_DEAL_VALUE) return { ok: false, error: "Deal value must be a positive amount." };
      patch.dealValue = Math.round(n * 100) / 100;
    }
  }
  if ("nextStep" in input) {
    if (input.nextStep !== null && typeof input.nextStep !== "string") return { ok: false, error: "Next step must be text." };
    const step = input.nextStep === null ? "" : clean(input.nextStep, false);
    if (step.length > MAX_NEXT_STEP_LENGTH) return { ok: false, error: `Next step can be at most ${MAX_NEXT_STEP_LENGTH} characters.` };
    patch.nextStep = step || null;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}

/** The company name as saved, or null if it's empty or too long. */
export function parseCompany(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const company = clean(value, false);
  if (!company || company.length > MAX_COMPANY_LENGTH) return null;
  return company;
}

/**
 * Report subjects for a company look like "Stripe · stripe.com". Splits off
 * the domain when there is one, so it gets its own CSV column.
 */
export function splitSubject(subject: string): { name: string; domain: string | null } {
  const parts = subject.split(" · ");
  if (parts.length < 2) return { name: subject.trim(), domain: null };
  const last = parts[parts.length - 1].trim();
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(last);
  if (!looksLikeDomain) return { name: subject.trim(), domain: null };
  return { name: parts.slice(0, -1).join(" · ").trim(), domain: last.toLowerCase() };
}

// ── What changed between two runs ────────────────────────────────────────────

export interface FindingLike {
  section: string;
  claim: string;
  source_name?: string | null;
  source_url?: string | null;
}

export interface ChangedFinding {
  section: string;
  claim: string;
  sourceName: string | null;
  sourceUrl: string | null;
}

function findingKey(f: FindingLike): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return `${norm(f.section)}\u0000${norm(f.claim)}`;
}

/**
 * Findings in the newer run that weren't in the older one, in the newer
 * run's order, duplicates collapsed. Comparison ignores case and spacing so
 * a re-run that words a claim identically doesn't show as a change.
 */
export function newFindings(previous: FindingLike[], latest: FindingLike[]): ChangedFinding[] {
  const seen = new Set(previous.map(findingKey));
  const out: ChangedFinding[] = [];
  for (const f of latest) {
    const key = findingKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ section: f.section, claim: f.claim, sourceName: f.source_name ?? null, sourceUrl: f.source_url ?? null });
  }
  return out;
}

// ── Deal health and ranking ──────────────────────────────────────────────────

export interface AccountTrigger {
  kind: string;
  atRisk: boolean;
  title: string;
  url: string;
  eventDate: string | null;
  detectedAt: string;
}

export type Health = "at_risk" | "stalled" | "on_track" | "closed";

export const HEALTH_LABELS: Record<Health, string> = {
  at_risk: "At risk",
  stalled: "Stalled",
  on_track: "On track",
  closed: "Closed",
};

export const DEFAULT_STALL_DAYS = 14;
/** At-risk triggers this recent flag a deal. */
export const AT_RISK_WINDOW_DAYS = 30;
/** Triggers this recent count as fresh for ranking. */
export const FRESH_DAYS = 14;
const DAY_MS = 86_400_000;

export function parseStallDays(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

/**
 * At risk: an at-risk trigger in the last 30 days. Stalled: no stage change
 * in `stallDays`. Won and lost deals are closed. At risk wins over stalled.
 */
export function dealHealth(
  a: { stage: AccountStage; stageChangedAt: string; triggers: AccountTrigger[] },
  stallDays: number,
  now = new Date(),
): { health: Health; reasons: string[] } {
  if (a.stage === "won" || a.stage === "lost") return { health: "closed", reasons: [] };
  const risky = a.triggers.filter((t) => t.atRisk && now.getTime() - Date.parse(t.detectedAt) <= AT_RISK_WINDOW_DAYS * DAY_MS);
  if (risky.length) return { health: "at_risk", reasons: risky.map((t) => t.title) };
  const idle = Math.floor((now.getTime() - Date.parse(a.stageChangedAt)) / DAY_MS);
  if (idle >= stallDays) return { health: "stalled", reasons: [`No stage change in ${idle} days`] };
  return { health: "on_track", reasons: [] };
}

export function freshTriggerCount(triggers: AccountTrigger[], now = new Date()): number {
  return triggers.filter((t) => now.getTime() - Date.parse(t.detectedAt) <= FRESH_DAYS * DAY_MS).length;
}

const HEALTH_ORDER: Record<Health, number> = { at_risk: 0, stalled: 1, on_track: 2, closed: 3 };

/** Work these first: most fresh triggers, then at risk, then stalled. */
export function rankAccounts<T extends { health: Health; freshTriggers: number; updatedAt: string }>(accounts: T[]): T[] {
  return [...accounts].sort((a, b) =>
    b.freshTriggers - a.freshTriggers
    || HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]
    || b.updatedAt.localeCompare(a.updatedAt));
}

/** Count and total deal value per stage, in pipeline order. */
export function stageTotals(accounts: { stage: AccountStage; dealValue: number | null }[]): { stage: AccountStage; count: number; total: number }[] {
  return ACCOUNT_STAGES.map((stage) => {
    const inStage = accounts.filter((a) => a.stage === stage);
    return { stage, count: inStage.length, total: inStage.reduce((sum, a) => sum + (a.dealValue ?? 0), 0) };
  });
}

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

// ── CSV export ───────────────────────────────────────────────────────────────

export interface AccountCsvRow {
  company: string;
  stage: AccountStage;
  dealValue: number | null;
  nextStep: string | null;
  health: Health;
  owner: string | null;
  notes: string | null;
  latestReportAt: string | null;
  latestReportUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export const CSV_HEADERS = ["Company", "Domain", "Stage", "Deal value", "Health", "Owner", "Next step", "Notes", "Latest report", "Report link", "Added", "Updated"];

/**
 * One CSV cell. Quotes when needed, and neutralises spreadsheet formulas: a
 * cell starting with = + - @ (or a tab/CR) gets a leading apostrophe, so a
 * note like "=HYPERLINK(...)" can't run when the file is opened in Excel or
 * Sheets.
 */
export function csvCell(value: string | null | undefined): string {
  let s = value ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** CRLF line endings and a BOM so Excel opens it as UTF-8. */
export function accountsToCsv(rows: AccountCsvRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const r of rows) {
    const { name, domain } = splitSubject(r.company);
    lines.push(
      [
        name,
        domain,
        STAGE_LABELS[r.stage],
        r.dealValue === null ? "" : r.dealValue.toFixed(2),
        HEALTH_LABELS[r.health],
        r.owner,
        r.nextStep,
        r.notes,
        isoDate(r.latestReportAt),
        r.latestReportUrl,
        isoDate(r.createdAt),
        isoDate(r.updatedAt),
      ].map(csvCell).join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
