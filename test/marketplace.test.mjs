import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMarketplacePurchase } from "../src/marketplace.mjs";

test("summarizes a free Marketplace purchase without retaining account login or email", () => {
  const summary = summarizeMarketplacePurchase({
    action: "purchased",
    effective_date: "2026-09-23T00:00:00Z",
    marketplace_purchase: {
      account: { id: 123, type: "Organization", login: "example-org", email: "owner@example.com" },
      plan: { id: 456, name: "Free" },
      billing_cycle: "monthly",
      unit_count: 1,
      on_free_trial: false
    }
  });

  assert.equal(summary.action, "purchased");
  assert.equal(summary.accountId, 123);
  assert.equal(summary.planName, "Free");
  assert.equal(summary.onFreeTrial, false);
  assert.doesNotMatch(JSON.stringify(summary), /example-org|owner@example\.com/);
});

test("summarizes cancellation and billing dates", () => {
  const summary = summarizeMarketplacePurchase({
    action: "cancelled",
    effective_date: "2026-10-01T00:00:00Z",
    marketplace_purchase: {
      account: { id: 8, type: "User" },
      plan: { id: 9, name: "Free" },
      next_billing_date: "2026-10-01T00:00:00Z"
    }
  });

  assert.equal(summary.action, "cancelled");
  assert.equal(summary.effectiveDate, "2026-10-01T00:00:00Z");
  assert.equal(summary.nextBillingDate, "2026-10-01T00:00:00Z");
});

test("malformed Marketplace payload stays safe and observable", () => {
  assert.deepEqual(summarizeMarketplacePurchase(null), {
    event: "marketplace_purchase",
    action: "unknown",
    effectiveDate: null,
    accountId: null,
    accountType: null,
    planId: null,
    planName: null,
    billingCycle: null,
    unitCount: null,
    onFreeTrial: false,
    freeTrialEndsOn: null,
    nextBillingDate: null
  });
});
