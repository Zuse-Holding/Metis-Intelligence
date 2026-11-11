import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "./supabase/server";
import { getAgentSecret } from "./agent-secret";

/**
 * POSTs to the agent server as the signed-in user: the user id comes from
 * the session cookie, never from the browser, and AGENT_SECRET stays here.
 */
export async function postToAgentAsUser(path: string, body: Record<string, unknown>): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (!agentUrl) return NextResponse.json({ error: "This isn't available right now." }, { status: 503 });
  try {
    const res = await fetch(`${agentUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": getAgentSecret() },
      body: JSON.stringify({ ...body, userId: user.id }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the research server. Try again shortly." }, { status: 502 });
  }
}
