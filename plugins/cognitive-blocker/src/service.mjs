import { evaluateGuard } from "./engine.mjs";
import { appendGuardEvent, listFeatureFlags, listMemory } from "./db.mjs";
import { isFeatureEnabled, resolveFeatures } from "./feature-catalog.mjs";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function memoryValue(item, key) {
  const value = item?.value;
  if (value && typeof value === "object" && key in value) return value[key];
  if (typeof value === "string") return value;
  return null;
}

export function applyMemoryContext(payload, memoryItems) {
  const task = payload.task || {};
  const storedFrozen = memoryItems
    .filter((item) => item.memory_type === "frozen_element")
    .map((item) => memoryValue(item, "resource"));

  const storedAuthorized = memoryItems
    .filter((item) => item.memory_type === "authorized_resource")
    .map((item) => memoryValue(item, "resource"));

  const storedUnmetCriteria = memoryItems
    .filter((item) => item.memory_type === "success_criterion")
    .filter((item) => item.value?.met !== true)
    .map((item) => memoryValue(item, "text"));

  const explicitUnfrozen = new Set(task.unfrozenElements || []);
  const frozenElements = unique([
    ...storedFrozen.filter((item) => !explicitUnfrozen.has(item)),
    ...(task.frozenElements || [])
  ]);

  return {
    ...payload,
    task: {
      ...task,
      authorizedResources: Array.isArray(task.authorizedResources)
        ? task.authorizedResources
        : unique(storedAuthorized),
      frozenElements,
      unmetSuccessCriteria: Array.isArray(task.unmetSuccessCriteria)
        ? task.unmetSuccessCriteria
        : unique(storedUnmetCriteria)
    }
  };
}

export async function evaluateForAccount(accountId, payload) {
  const featureOverrides = await listFeatureFlags(accountId);
  const features = resolveFeatures(featureOverrides);

  const accountMemory = await listMemory(accountId, null);
  const projectMemory = payload.projectId
    ? await listMemory(accountId, payload.projectId)
    : [];
  const memoryItems = [...accountMemory, ...projectMemory];
  const enrichedPayload = applyMemoryContext(payload, memoryItems);

  const effectivePayload = isFeatureEnabled("semantic_signals", featureOverrides)
    ? enrichedPayload
    : { ...enrichedPayload, semanticSignals: [] };

  const result = evaluateGuard(effectivePayload);

  if (isFeatureEnabled("guard_event_history", featureOverrides)) {
    await appendGuardEvent(accountId, {
      result,
      projectId: payload.projectId || null,
      taskContractId: payload.taskContractId || null,
      requestFingerprint: payload.requestFingerprint || null
    });
  }

  return {
    ...result,
    features,
    memoryApplied: memoryItems.map((item) => ({
      key: item.memory_key,
      type: item.memory_type,
      claimState: item.claim_state,
      scope: item.project_id ? "project" : "account",
      version: item.version
    }))
  };
}
