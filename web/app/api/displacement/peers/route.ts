import { NextRequest } from "next/server";
import { postToAgentAsUser } from "../../../../lib/agent-proxy";

/** Tools a report's peers use that the company doesn't. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const runId = typeof body?.runId === "string" ? body.runId : "";
  return postToAgentAsUser("/displacement/peers", { runId });
}
