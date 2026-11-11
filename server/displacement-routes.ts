import type express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SerperSearchProvider } from "../src/lib/providers.js";
import { TechStackAgent } from "../src/agents/tech-stack-agent/index.js";
import { knownVendor, peerDomain, peerGaps, weakSpotQueries, weakSpots, type PeerStack, type WeakSpot } from "../src/lib/displacement.js";
import type { ResearchBundle } from "../src/types/research.js";

/**
 * Competitive displacement and peer urgency for the Sales tab (ABM brief §3).
 * Called by the web app with the agent secret and the signed-in user's id.
 *
 *   POST /displacement/weak-spots  { userId, vendor }   why a target might leave an incumbent
 *   POST /displacement/peers       { userId, runId }    tools the report's peers use that it doesn't
 *
 * Vendor news is shared by everyone and cached a week; peers' domains and
 * stacks are cached a week too. Both are rate-limited per user.
 */

interface Deps {
  supabase: SupabaseClient;
  authCheck: (req: express.Request, res: express.Response) => boolean;
  checkHourlyBucket: (key: string, max: number) => { allowed: boolean; resetInMs: number };
}

const WEEK_MS = 7 * 86_400_000;
const PER_HOUR = 60;
const MAX_PEERS = 5;

const weakSpotCache = new Map<string, { at: number; spots: WeakSpot[] }>();
const domainCache = new Map<string, { at: number; domain?: string }>();
const stackCache = new Map<string, { at: number; items: PeerStack["items"] }>();

const fresh = (at: number) => Date.now() - at < WEEK_MS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerDisplacementRoutes(app: express.Express, d: Deps) {
  const searcher = new SerperSearchProvider();

  const limited = (req: express.Request, res: express.Response, userId: unknown): userId is string => {
    if (typeof userId !== "string" || !UUID.test(userId)) {
      res.status(400).json({ error: "userId required" });
      return false;
    }
    const bucket = d.checkHourlyBucket(`displacement:${userId}`, PER_HOUR);
    if (!bucket.allowed) {
      res.status(429).json({ error: `Too many lookups. Try again in ${Math.ceil(bucket.resetInMs / 60000)} minutes.` });
      return false;
    }
    return true;
  };

  app.post("/displacement/weak-spots", async (req, res) => {
    if (!d.authCheck(req, res)) return;
    const { userId } = req.body ?? {};
    if (!limited(req, res, userId)) return;
    const vendor = knownVendor(req.body?.vendor);
    if (!vendor) {
      res.status(400).json({ error: "Unknown vendor." });
      return;
    }
    const cached = weakSpotCache.get(vendor);
    if (cached && fresh(cached.at)) {
      res.json({ vendor, weakSpots: cached.spots, checkedAt: new Date(cached.at).toISOString() });
      return;
    }
    try {
      const batches = await Promise.all(weakSpotQueries(vendor).map((q) => searcher.news(q, 10)));
      const spots = weakSpots(vendor, batches.flat());
      const at = Date.now();
      weakSpotCache.set(vendor, { at, spots });
      res.json({ vendor, weakSpots: spots, checkedAt: new Date(at).toISOString() });
    } catch (err) {
      console.error("[displacement] weak spots failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "Couldn't search the news right now. Try again shortly." });
    }
  });

  app.post("/displacement/peers", async (req, res) => {
    if (!d.authCheck(req, res)) return;
    const { userId, runId } = req.body ?? {};
    if (!limited(req, res, userId)) return;
    if (typeof runId !== "string" || !UUID.test(runId)) {
      res.status(400).json({ error: "runId required" });
      return;
    }
    // The report's own peers and stack, read for this user only.
    const { data: run, error } = await d.supabase
      .from("research_runs")
      .select("bundle")
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("type", "company")
      .eq("status", "completed")
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !run?.bundle) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    const bundle = run.bundle as ResearchBundle;
    const targetVendors = (bundle.techStack?.items ?? []).map((i) => i.vendor);
    const peers = (bundle.competitors ?? []).slice(0, MAX_PEERS);
    if (!bundle.techStack || peers.length < 2) {
      res.json({ gaps: [], compared: [], skipped: peers.map((p) => p.name), reason: !bundle.techStack ? "no_stack" : "few_peers" });
      return;
    }

    try {
      const stacks = await Promise.all(peers.map(async (p): Promise<PeerStack | { name: string; domain?: undefined }> => {
        const key = p.name.toLowerCase();
        let entry = domainCache.get(key);
        if (!entry || !fresh(entry.at)) {
          const results = await searcher.search(`"${p.name}" official website`, 5);
          entry = { at: Date.now(), domain: peerDomain(p.name, results) };
          domainCache.set(key, entry);
        }
        if (!entry.domain) return { name: p.name };
        const domain = entry.domain;
        let s = stackCache.get(domain);
        if (!s || !fresh(s.at)) {
          const { stack } = await new TechStackAgent().run(domain);
          s = { at: Date.now(), items: (stack?.items ?? []).map((i) => ({ vendor: i.vendor, category: i.category, sourceUrl: i.sourceUrl, evidence: i.evidence })) };
          stackCache.set(domain, s);
        }
        return { name: p.name, domain, items: s.items };
      }));
      const compared = stacks.filter((s): s is PeerStack => !!s.domain);
      res.json({
        gaps: peerGaps(targetVendors, compared),
        compared: compared.map((c) => ({ name: c.name, domain: c.domain, tools: c.items.length })),
        skipped: stacks.filter((s) => !s.domain).map((s) => s.name),
      });
    } catch (err) {
      console.error("[displacement] peers failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "Couldn't compare peers right now. Try again shortly." });
    }
  });
}
