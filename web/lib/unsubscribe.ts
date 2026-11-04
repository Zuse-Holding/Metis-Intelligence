import { getAgentSecret } from "./agent-secret";

/** Forwards a signed unsubscribe token to the agent server, which verifies and records it. */
export async function submitUnsubscribe(token: string): Promise<boolean> {
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (!agentUrl || !token) return false;
  try {
    const res = await fetch(`${agentUrl}/email/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": getAgentSecret() },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
