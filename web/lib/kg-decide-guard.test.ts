import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * kg_decide_match must stay service-role only (Nov 12, 2026 security
 * follow-up): signed-in users reach it only through the rate-limited
 * routes, which take the user id from the session.
 */

const schema = readFileSync(join("supabase", "schema.sql"), "utf8");

test("kg_decide_match is granted to the service role only, and the old signature is dropped", () => {
  assert.match(schema, /REVOKE ALL ON FUNCTION kg_decide_match\(UUID, UUID, TEXT\) FROM PUBLIC, anon, authenticated;/);
  assert.match(schema, /GRANT EXECUTE ON FUNCTION kg_decide_match\(UUID, UUID, TEXT\) TO service_role;/);
  assert.match(schema, /DROP FUNCTION IF EXISTS kg_decide_match\(UUID, TEXT\);/);
  assert.doesNotMatch(schema, /GRANT EXECUTE ON FUNCTION kg_decide_match[^;]*TO authenticated/);
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

test("only web/lib/supabase/kg-decide.ts calls kg_decide_match", () => {
  const callers = files("web").filter((f) => /rpc\(\s*["']kg_decide_match["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(callers.map((f) => f.replace(/\\/g, "/")), ["web/lib/supabase/kg-decide.ts"]);
});
