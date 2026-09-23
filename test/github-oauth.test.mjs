import test from "node:test";
import assert from "node:assert/strict";
import {
  OAUTH_TRANSACTION_TTL_MS,
  createOAuthTransaction,
  verifyOAuthTransaction
} from "../src/github-oauth.mjs";

test("creates and verifies a signed Marketplace OAuth transaction", () => {
  const now = 1_800_000_000_000;
  const tx = createOAuthTransaction({
    installationId: 123,
    marketplacePlanId: 456,
    secret: "test-secret",
    now
  });

  assert.match(tx.state, /^[A-Za-z0-9_-]+$/);
  assert.match(tx.verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(tx.challenge, /^[A-Za-z0-9_-]+$/);

  const payload = verifyOAuthTransaction({
    transaction: tx.transaction,
    state: tx.state,
    secret: "test-secret",
    now: now + 1000
  });

  assert.equal(payload.installationId, "123");
  assert.equal(payload.marketplacePlanId, "456");
  assert.equal(payload.verifier, tx.verifier);
});

test("rejects a tampered or mismatched OAuth transaction", () => {
  const tx = createOAuthTransaction({
    installationId: 123,
    secret: "test-secret",
    now: 1_800_000_000_000
  });

  assert.throws(() => verifyOAuthTransaction({
    transaction: tx.transaction + "x",
    state: tx.state,
    secret: "test-secret",
    now: 1_800_000_001_000
  }));

  assert.throws(() => verifyOAuthTransaction({
    transaction: tx.transaction,
    state: "wrong-state",
    secret: "test-secret",
    now: 1_800_000_001_000
  }));
});

test("rejects expired OAuth transactions and nonnumeric installation ids", () => {
  assert.throws(() => createOAuthTransaction({
    installationId: "not-an-id",
    secret: "test-secret"
  }));

  const now = 1_800_000_000_000;
  const tx = createOAuthTransaction({
    installationId: 123,
    secret: "test-secret",
    now
  });

  assert.throws(() => verifyOAuthTransaction({
    transaction: tx.transaction,
    state: tx.state,
    secret: "test-secret",
    now: now + OAUTH_TRANSACTION_TTL_MS + 1
  }));
});
