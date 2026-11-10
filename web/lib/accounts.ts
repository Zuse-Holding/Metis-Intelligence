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

// ── CSV export ───────────────────────────────────────────────────────────────

export interface AccountCsvRow {
  company: string;
  stage: AccountStage;
  owner: string | null;
  notes: string | null;
  latestReportAt: string | null;
  latestReportUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export const CSV_HEADERS = ["Company", "Domain", "Stage", "Owner", "Notes", "Latest report", "Report link", "Added", "Updated"];

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
        r.owner,
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
