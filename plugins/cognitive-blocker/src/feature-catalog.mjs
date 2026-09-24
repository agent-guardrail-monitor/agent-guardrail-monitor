const rows = [
  { key: "core_blocking", required: true, defaultEnabled: true },
  { key: "tenant_isolation", required: true, defaultEnabled: true },
  { key: "rbac", required: true, defaultEnabled: true },
  { key: "database_rls", required: true, defaultEnabled: true },
  { key: "cognitive_memory", required: true, defaultEnabled: true },
  { key: "semantic_signals", required: false, defaultEnabled: true },
  { key: "guard_event_history", required: false, defaultEnabled: true },
  { key: "internal_error_reporting", required: false, defaultEnabled: true }
];

export const FEATURE_CATALOG = Object.freeze(rows.map((item) => Object.freeze({ ...item })));
export const FEATURE_MAP = new Map(FEATURE_CATALOG.map((item) => [item.key, item]));

export function resolveFeatures(overrides = []) {
  const byKey = new Map(
    (overrides || []).map((item) => [String(item.feature_key || item.key), Boolean(item.enabled)])
  );

  return FEATURE_CATALOG.map((feature) => ({
    ...feature,
    enabled: feature.required ? true : (byKey.has(feature.key) ? byKey.get(feature.key) : feature.defaultEnabled)
  }));
}

export function isFeatureEnabled(key, overrides = []) {
  const feature = FEATURE_MAP.get(String(key));
  if (!feature) return false;
  if (feature.required) return true;
  const override = (overrides || []).find(
    (item) => String(item.feature_key || item.key) === feature.key
  );
  return override ? Boolean(override.enabled) : feature.defaultEnabled;
}

export function validateFeatureChange(key, enabled) {
  const feature = FEATURE_MAP.get(String(key));
  if (!feature) {
    throw Object.assign(new Error("unknown_feature"), { code: "UNKNOWN_FEATURE", feature: key });
  }
  if (feature.required && enabled === false) {
    throw Object.assign(new Error("required_feature_cannot_be_disabled"), {
      code: "REQUIRED_FEATURE",
      feature: key
    });
  }
  return { feature, enabled: feature.required ? true : Boolean(enabled) };
}
