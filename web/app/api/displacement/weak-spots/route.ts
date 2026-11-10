import { NextRequest } from "next/server";
import { postToAgentAsUser } from "../../../../lib/agent-proxy";

/** Why an account might leave an incumbent vendor: dated, cited news about the vendor. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const vendor = typeof body?.vendor === "string" ? body.vendor.slice(0, 120) : "";
  return postToAgentAsUser("/displacement/weak-spots", { vendor });
}
