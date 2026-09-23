function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function summarizeMarketplacePurchase(payload = {}) {
  const purchase = payload?.marketplace_purchase && typeof payload.marketplace_purchase === "object"
    ? payload.marketplace_purchase
    : {};
  const account = purchase?.account && typeof purchase.account === "object" ? purchase.account : {};
  const plan = purchase?.plan && typeof purchase.plan === "object" ? purchase.plan : {};

  return {
    event: "marketplace_purchase",
    action: stringOrNull(payload?.action) || "unknown",
    effectiveDate: stringOrNull(payload?.effective_date) || stringOrNull(purchase?.effective_date),
    accountId: numberOrNull(account?.id),
    accountType: stringOrNull(account?.type),
    planId: numberOrNull(plan?.id),
    planName: stringOrNull(plan?.name),
    billingCycle: stringOrNull(purchase?.billing_cycle),
    unitCount: numberOrNull(purchase?.unit_count),
    onFreeTrial: purchase?.on_free_trial === true,
    freeTrialEndsOn: stringOrNull(purchase?.free_trial_ends_on),
    nextBillingDate: stringOrNull(purchase?.next_billing_date)
  };
}
