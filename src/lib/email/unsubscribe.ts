/**
 * Unsubscribe links for non-transactional email (CAN-SPAM). A link carries
 * the user id and an HMAC of it, so it works without signing in and can't be
 * forged for someone else's account. It never expires: an unsubscribe link
 * has to keep working long after the email was sent.
 *
 * Keyed off AGENT_SECRET (domain-separated), which the agent server and the
 * Railway jobs already require, so there's no new secret to deploy. Rotating
 * AGENT_SECRET invalidates links in emails already sent.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const APP_URL = process.env.FRONTEND_URL ?? "https://metisanalytic.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unsubscribeKey(env: Record<string, string | undefined>): string {
  const secret = env.AGENT_SECRET;
  if (!secret) throw new Error("AGENT_SECRET is not set — can't sign unsubscribe links.");
  return secret;
}

function mac(userId: string, key: string): string {
  return createHmac("sha256", key).update(`unsubscribe:${userId}`).digest("base64url");
}

export function signUnsubscribeToken(userId: string, env: Record<string, string | undefined> = process.env): string {
  return `${userId}.${mac(userId, unsubscribeKey(env))}`;
}

/** The user id the token was issued for, or null if it's malformed or forged. */
export function verifyUnsubscribeToken(token: string, env: Record<string, string | undefined> = process.env): string | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const userId = token.slice(0, dot);
  if (!UUID.test(userId)) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(userId, unsubscribeKey(env)));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

/** Link shown in the email body: a page that asks for a click (mail scanners open links). */
export function unsubscribePageUrl(token: string): string {
  return `${APP_URL}/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** RFC 8058 one-click headers, which Gmail and Yahoo look for on bulk mail. */
export function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${APP_URL}/api/unsubscribe?t=${encodeURIComponent(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
