/**
 * Task 4.2 — the one place to edit transactional email copy. Plain text,
 * signed by the team rather than an individual.
 */
export const SENDER_NAME = "The Metis team";
export const SUPPORT_EMAIL = "support@metisanalytic.com";
const APP_URL = process.env.FRONTEND_URL ?? "https://metisanalytic.com";

export interface EmailContent {
  subject: string;
  text: string;
  replyTo?: string;
}

export function welcomeEmail(firstName: string): EmailContent {
  const name = firstName?.trim() || "there";
  return {
    subject: "Welcome to Metis",
    text: `Hey ${name},

Thanks for signing up for Metis. You can start researching right away —
type a company, person, or product name into the search box and we'll put
together a full report for you: ${APP_URL}/app

Your first 7 days are a free trial with the paid features turned on: up to
50 quick profiles and 10 Deep Dives, the sales view on every company
report, and your account pipeline. After that your account moves to the
Free plan unless you pick one: ${APP_URL}/pricing

If anything in a report looks off, there's a "Something wrong in this
report?" link at the bottom of every one — we read every submission.

Questions? Just reply to this email.

— ${SENDER_NAME}
`,
  };
}

/**
 * `unsubscribeUrl`: the signed link from ./unsubscribe.ts (CAN-SPAM).
 * `trialEnded`: the account had the 7-day signup trial and hasn't picked a
 * plan, so it has just moved to Free.
 */
export function day7Email(firstName: string, unsubscribeUrl: string, trialEnded = false): EmailContent {
  const name = firstName?.trim() || "there";
  const trialNote = trialEnded
    ? `
Your 7-day trial has also wrapped up, so your account is on the Free plan
now, with 3 quick profiles. Plans are here if you want to keep the rest:
${APP_URL}/pricing
`
    : "";
  return {
    subject: "What did Metis get wrong?",
    text: `Hey ${name},

You signed up for Metis about a week ago, and we wanted to ask directly:
what did it get wrong?

Every report is only as good as the sources it can find, and the fastest
way we improve is hearing about the specific thing that was outdated,
missing, or just off. Hit reply and tell us — we read every one of these.
${trialNote}
— ${SENDER_NAME}

Don't want emails like this? Unsubscribe: ${unsubscribeUrl}
`,
    replyTo: SUPPORT_EMAIL,
  };
}

/** `unsubscribeUrl`: the signed link from ./unsubscribe.ts (CAN-SPAM). */
export function capReachedEmail(firstName: string, capLabel: string, unsubscribeUrl: string): EmailContent {
  const name = firstName?.trim() || "there";
  return {
    subject: `You've hit your ${capLabel}`,
    text: `Hey ${name},

You just ran into your ${capLabel} on Metis. Wanted to flag what Pro gets
you if you want to keep going: up to 300 quick profiles and 50 Deep Dives
a month, the Knowledge Graph, and your account pipeline with weekly
alerts —
${APP_URL}/pricing

Questions, or something not adding up? Just reply to this email.

— ${SENDER_NAME}

Don't want emails like this? Unsubscribe: ${unsubscribeUrl}
`,
  };
}
