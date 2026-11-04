import { test } from "node:test";
import assert from "node:assert/strict";
import { signUnsubscribeToken, unsubscribeHeaders, unsubscribePageUrl, verifyUnsubscribeToken } from "./unsubscribe.js";
import { capReachedEmail, day7Email } from "./copy.js";

const env = { AGENT_SECRET: "a".repeat(40) };
const USER = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";

test("a signed token verifies back to its user", () => {
  assert.equal(verifyUnsubscribeToken(signUnsubscribeToken(USER, env), env), USER);
});

test("a token can't be moved to another user or forged", () => {
  const token = signUnsubscribeToken(USER, env);
  const other = "11111111-2222-4333-8444-555555555555";
  assert.equal(verifyUnsubscribeToken(`${other}.${token.split(".")[1]}`, env), null);
  assert.equal(verifyUnsubscribeToken(`${USER}.forged`, env), null);
  assert.equal(verifyUnsubscribeToken("not-a-token", env), null);
  assert.equal(verifyUnsubscribeToken(token, { AGENT_SECRET: "b".repeat(40) }), null);
});

test("signing refuses to run without AGENT_SECRET", () => {
  assert.throws(() => signUnsubscribeToken(USER, {}), /AGENT_SECRET/);
});

test("one-click headers point at the POST endpoint", () => {
  const token = signUnsubscribeToken(USER, env);
  const h = unsubscribeHeaders(token);
  assert.match(h["List-Unsubscribe"], /^<https:\/\/.+\/api\/unsubscribe\?t=.+>$/);
  assert.equal(h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("the day-7 and cap-reached emails carry the unsubscribe link", () => {
  const url = unsubscribePageUrl(signUnsubscribeToken(USER, env));
  assert.ok(day7Email("Nick", url).text.includes(`Unsubscribe: ${url}`));
  assert.ok(capReachedEmail("Nick", "monthly research limit", url).text.includes(`Unsubscribe: ${url}`));
});
