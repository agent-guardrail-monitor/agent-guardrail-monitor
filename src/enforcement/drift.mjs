function change(changes, code, before, after) {
  if (before !== after) changes.push({ code, before: before ?? null, after: after ?? null });
}

export function detectDrift(baseline = {}, current = {}) {
  const changes = [];
  change(changes, "MODEL_DRIFT", baseline.modelVersion || baseline.modelName, current.modelVersion || current.modelName);
  change(changes, "RUNTIME_DRIFT", baseline.runtimeVersion, current.runtimeVersion);
  change(changes, "POLICY_DRIFT", baseline.policyHash, current.policyHash);
  change(changes, "DIRECTIVE_DRIFT", baseline.directiveSnapshotHash, current.directiveSnapshotHash);
  change(changes, "SKILL_DRIFT", baseline.skillSnapshotHash, current.skillSnapshotHash);
  change(changes, "TOOL_DRIFT", baseline.toolRegistryHash, current.toolRegistryHash);
  change(changes, "MEMORY_DRIFT", baseline.memorySnapshotHash, current.memorySnapshotHash);
  change(changes, "CONFIG_DRIFT", baseline.configurationHash, current.configurationHash);
  change(changes, "PLUGIN_DRIFT", baseline.pluginVersion, current.pluginVersion);

  const canaryBefore = baseline.canaryStatus;
  const canaryAfter = current.canaryStatus;
  if (canaryBefore === "PASS" && canaryAfter && canaryAfter !== "PASS") {
    changes.push({ code: "PROOF_DRIFT", before: canaryBefore, after: canaryAfter, critical: true });
  }

  return {
    driftDetected: changes.length > 0,
    critical: changes.some((item) => item.critical === true),
    changes
  };
}
