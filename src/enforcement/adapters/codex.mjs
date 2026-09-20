export function codexEnforcementCapability({ canaryStatus = "UNKNOWN", runtimeVersion = null } = {}) {
  if (canaryStatus !== "PASS") {
    return {
      status: "UNKNOWN",
      runtime: "codex",
      runtimeVersion,
      reason: "Blocking enforcement is not asserted until the exact runtime/version has a passing AGM canary."
    };
  }
  return {
    status: "DETECTED",
    runtime: "codex",
    runtimeVersion,
    reason: "A passing canary proves the tested hook path. Promotion to ENFORCED requires an installed mandatory blocking path and current configuration proof."
  };
}
