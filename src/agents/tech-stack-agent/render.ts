import type { TechStack } from "./index.js";

/**
 * The "Tech Stack" report section. A summary line, then one line per tool:
 *
 *   - [confirmed] CRM | Salesforce | SPF: v=spf1 include:_spf.salesforce.com ~all | [Public DNS (TXT)](https://...)
 *
 * web/components/ReportViewer.tsx parses exactly this shape (TECH_LINE
 * there); change both together.
 */
export const TECH_SECTION_TITLE = "Tech Stack";

const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
const linkText = (s: string) => cell(s).replace(/\[/g, "(").replace(/\]/g, ")");
const linkUrl = (s: string) => s.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

export function techSummary(t: TechStack): string {
  const n = t.items.length;
  const likely = t.items.filter((i) => i.confidence === "likely").length;
  const fromJobs = t.items.some((i) => i.layer === "jobs");
  const found = n === 0 ? "no tools visible in public records"
    : `${n} tool${n === 1 ? "" : "s"} found${likely ? ` (${likely} likely, from ${fromJobs ? "subdomain names or job postings" : "subdomain names only"})` : ""}`;
  const boards = (t.jobBoards ?? []).map((b) => `job postings on ${b.ats}`);
  const sources = ["public DNS", t.websiteUnavailable ? "" : "the homepage", t.subdomainsChecked ? "certificate logs" : "", ...boards].filter(Boolean);
  const list = sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}` : sources[0];
  const scope = `From ${list}.${t.websiteUnavailable ? ` The homepage couldn't be read (${t.websiteUnavailable}).` : ""}`;
  return `${t.domain}: ${found}. ${scope} Internal tools often leave no public trace, so a missing category means not visible, not not used.`;
}

export function pushTechStackSection(lines: string[], t: TechStack | undefined): void {
  if (!t) return;
  lines.push(`## ${TECH_SECTION_TITLE}`);
  lines.push(`_${techSummary(t)}_`);
  for (const i of t.items) {
    lines.push(`- [${i.confidence}] ${cell(i.category)} | ${cell(i.vendor)} | ${cell(i.evidence)} | [${linkText(i.sourceName)}](${linkUrl(i.sourceUrl)})`);
  }
  lines.push(``);
}
