import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { peerKey, stablePeers, updatePeerVotes, type PeerVotes } from "./profile-cache.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const v = (name: string, count: number, daysAgo = 1) => ({ name, url: `https://src/${name}`, count, lastSeen: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString() });

describe("stable peer sets", () => {
  it("peers found in two or more runs stay, even when this run missed them", () => {
    const votes: PeerVotes = { wesco: v("Wesco", 3), sonepar: v("Sonepar", 2), rexel: v("Rexel", 1) };
    const out = stablePeers([{ name: "Wesco", url: "https://new/wesco" }, { name: "Fastenal", url: "https://new/f" }], votes);
    assert.deepEqual(out.map((c) => [c.name, c.url, !!c.carried]), [
      ["Wesco", "https://new/wesco", false],
      ["Sonepar", "https://src/Sonepar", true],
      ["Fastenal", "https://new/f", false],
    ]);
  });

  it("a peer seen once before and again now becomes stable", () => {
    const out = stablePeers([{ name: "Rexel", url: "https://new/r" }], { rexel: v("Rexel", 1) });
    assert.deepEqual(out.map((c) => c.name), ["Rexel"]);
  });

  it("caps the list at 8 and keeps the most-found first", () => {
    const votes: PeerVotes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}`, v(`P${i}`, 10 - i)]));
    const out = stablePeers([], votes);
    assert.equal(out.length, 8);
    assert.equal(out[0].name, "P0");
  });

  it("no tally: this run's list is unchanged", () => {
    const cur = [{ name: "A Co", url: "https://a" }];
    assert.deepEqual(stablePeers(cur, null), cur);
  });

  it("votes count only peers this run found itself, and forget stale ones", () => {
    const prior: PeerVotes = { wesco: v("Wesco", 2), old: v("Old Peer", 5, 400) };
    const votes = updatePeerVotes(prior, [{ name: "Wesco Inc", url: "https://w2" }, { name: "Carried Co", url: "https://c", carried: true }, { name: "No Source" }], NOW);
    assert.deepEqual(Object.keys(votes), ["wesco"]);
    assert.equal(votes.wesco.count, 3);
    assert.equal(votes.wesco.url, "https://w2");
  });

  it("peer keys ignore case, punctuation and legal suffixes, but not words that contain them", () => {
    assert.equal(peerKey("Wesco International, Inc."), "wesco international");
    assert.equal(peerKey("WESCO international"), "wesco international");
    assert.equal(peerKey("Costco"), "costco");
  });
});
