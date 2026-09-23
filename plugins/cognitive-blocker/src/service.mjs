import crypto from "node:crypto";
import { evaluateGuard } from "./engine.mjs";
import { appendGuardEvent, listFeatureFlags, listMemory } from "./db.mjs";
import { isFeatureEnabled, resolveFeatures } from "./feature-catalog.mjs";
import {
  createRecoverySession,
  getRecoverySession,
  updateRecoverySession
} from "./recovery-db.mjs";
import { buildRecoveryPlan, resolveRecoveryAttempt } from "./recovery.mjs";
import { beginAccountTurn, acceptAssistantTurn } from "./context-rehydration.mjs";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function memoryValue(item, key) {
  const value = item?.value;
  if (value && typeof value === "object" && key in value) return value[key];
  if (typeof value === "string") return value;
  return null;
}

function fingerprintPayload(payload) {
  const normalized = { ...payload };
  delete normalized.recoverySessionId;
  delete normalized.requestFingerprint;
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
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
  const recoverySessionId = payload.recoverySessionId || null;
  const candidatePayload = { ...payload };
  delete candidatePayload.recoverySessionId;

  const candidateFingerprint =
    candidatePayload.requestFingerprint || fingerprintPayload(candidatePayload);

  let conversationContext = null;
  if (candidatePayload.platformConversationRef) {
    conversationContext = await beginAccountTurn(accountId, {
      platformConversationRef: candidatePayload.platformConversationRef,
      title: candidatePayload.conversationTitle,
      metadata: candidatePayload.conversationMetadata,
      userMessage: candidatePayload.userMessage,
      userTurnRef: candidatePayload.userTurnRef,
      requestFingerprint: candidatePayload.userRequestFingerprint || candidateFingerprint,
      projectId: candidatePayload.projectId,
      recentLimit: candidatePayload.recentLimit,
      relevantLimit: candidatePayload.relevantLimit
    });
    candidatePayload.conversationId = conversationContext.conversation.id;
  }

  let recoverySession = null;

  if (recoverySessionId) {
    recoverySession = await getRecoverySession(accountId, recoverySessionId);
    if (!recoverySession) {
      throw Object.assign(new Error("recovery_session_not_found"), {
        code: "RECOVERY_SESSION_NOT_FOUND",
        recoverySessionId
      });
    }
  }

  const recoveryAttempt = resolveRecoveryAttempt(
    recoverySession,
    candidateFingerprint,
    candidatePayload.projectId || null
  );
  const attempt = recoveryAttempt.attempt;

  const featureOverrides = await listFeatureFlags(accountId);
  const features = resolveFeatures(featureOverrides);

  const accountMemory = await listMemory(accountId, null);
  const projectMemory = candidatePayload.projectId
    ? await listMemory(accountId, candidatePayload.projectId)
    : [];
  const memoryItems = [...accountMemory, ...projectMemory];
  const enrichedPayload = applyMemoryContext(candidatePayload, memoryItems);

  const effectivePayload = isFeatureEnabled("semantic_signals", featureOverrides)
    ? enrichedPayload
    : { ...enrichedPayload, semanticSignals: [] };

  const result = evaluateGuard(effectivePayload);

  if (isFeatureEnabled("guard_event_history", featureOverrides)) {
    await appendGuardEvent(accountId, {
      result,
      projectId: candidatePayload.projectId || null,
      taskContractId: candidatePayload.taskContractId || null,
      requestFingerprint: candidateFingerprint
    });
  }

  const recoveryPlan = buildRecoveryPlan(effectivePayload, result, attempt);
  let persistedRecovery = recoverySession;
  let acceptedAssistantTurn = null;

  if (!recoverySession && result.decision === "BLOCK") {
    persistedRecovery = await createRecoverySession(accountId, {
      projectId: candidatePayload.projectId || null,
      rootFingerprint: candidateFingerprint,
      lastRequestFingerprint: candidateFingerprint,
      plan: recoveryPlan,
      result
    });
  } else if (recoverySession) {
    persistedRecovery = await updateRecoverySession(
      accountId,
      recoverySession.id,
      {
        lastRequestFingerprint: candidateFingerprint,
        plan: recoveryPlan,
        result
      }
    );
  }

  if (result.decision === "ALLOW" && conversationContext) {
    const assistantMessage = String(
      candidatePayload.assistantMessage ||
      candidatePayload.candidateText ||
      candidatePayload.responseText ||
      ""
    ).trim();

    if (assistantMessage) {
      acceptedAssistantTurn = await acceptAssistantTurn(accountId, {
        conversationId: conversationContext.conversation.id,
        assistantTurnRef: candidatePayload.assistantTurnRef,
        assistantMessage,
        requestFingerprint: candidateFingerprint
      });
    }
  }

  return {
    ...result,
    features,
    conversation: conversationContext
      ? {
          ...conversationContext.conversation,
          assistantTurnStored: Boolean(acceptedAssistantTurn),
          blockedCandidateStored: false
        }
      : null,
    memoryApplied: memoryItems.map((item) => ({
      key: item.memory_key,
      type: item.memory_type,
      claimState: item.claim_state,
      scope: item.project_id ? "project" : "account",
      version: item.version
    })),
    recovery: {
      recoverySessionId: persistedRecovery?.id || null,
      replayed: recoveryAttempt.replayed,
      ...recoveryPlan
    }
  };
}
