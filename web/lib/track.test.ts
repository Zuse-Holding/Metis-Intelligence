import { test } from "node:test";
import assert from "node:assert/strict";

// lib/track.ts imports @vercel/analytics (browser code), so these tests only cover the pure
// src-tag rules by re-reading them through a stubbed sessionStorage.
test("src tags are accepted only in a safe, short form", async () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const { rememberSrc, currentSrc } = await import("./track");
  assert.equal(currentSrc(), "direct");
  rememberSrc("?src=<script>alert(1)</script>");
  assert.equal(currentSrc(), "direct");
  rememberSrc("?src=" + "a".repeat(41));
  assert.equal(currentSrc(), "direct");
  rememberSrc("?utm=x");
  assert.equal(currentSrc(), "direct");
  rememberSrc("?src=Pitch-Nov14");
  assert.equal(currentSrc(), "pitch-nov14");
});
