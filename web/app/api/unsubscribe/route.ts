import { NextRequest, NextResponse } from "next/server";
import { submitUnsubscribe } from "../../../lib/unsubscribe";

/**
 * One-click unsubscribe (RFC 8058): the mail client POSTs to the
 * List-Unsubscribe URL with the token in the query string and no session.
 * Only POST is handled, so a link scanner's GET can't unsubscribe anyone;
 * people clicking the link in the email body land on /unsubscribe instead.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const ok = await submitUnsubscribe(token);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
