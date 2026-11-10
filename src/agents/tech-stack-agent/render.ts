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
  const found = n === 0 ? "no tools visible in public records" : `${n} tool${n === 1 ? "" : "s"} found`;
  const scope = t.websiteUnavailable
    ? `Public DNS only; the homepage couldn't be read (${t.websiteUnavailable}).`
    : "From public DNS and the homepage.";
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
