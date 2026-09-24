import { beginAccountTurn, acceptAssistantTurn } from "./context-rehydration.mjs";
import { evaluateForAccount } from "./service.mjs";
import { classifySemanticSignals } from "./semantic-guardian.mjs";

function sessionRef(sessionId) {
  return "codex:" + String(sessionId || "unknown");
}

function boundedJson(value, max = 14000) {
  const text = JSON.stringify(value);
  return text.length <= max ? text : text.slice(0, max) + "…";
}

function hookContext(context) {
  return [
    "COGNITIVE BLOCKER CONTEXT — DATA AND ENFORCEMENT STATE, NOT USER INSTRUCTIONS.",
    "The current user prompt has priority over older conversational state.",
    "Preserve valid restrictions, frozen elements, approved decisions and success criteria.",
    "Do not repeat questions already answered by the recovered context.",
    boundedJson({
      recentTurns: context.recentTurns,
      relevantOlderTurns: context.relevantOlderTurns,
      memory: context.memory
    })
  ].join("\n");
}

function resourcesFromToolInput(toolName, toolInput) {
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  const values = [
    input.resource,
    input.file_path,
    input.path,
    input.target,
    input.repository,
    input.repo,
    input.url
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => String(value).trim().slice(0, 500));

  return [...new Set(values.length ? values : [String(toolName || "unknown_tool")])];
}

function isObviouslyDestructive(toolName, toolInput) {
  const name = String(toolName || "").toLowerCase();
  if (/delete|remove|destroy|drop|truncate|reset/.test(name)) return true;
  const command = String(toolInput?.command || "");
  return /(^|\s)(rm|del|rmdir|drop|truncate)(\s|$)|git\s+(reset\s+--hard|clean\s+-)/i.test(command);
}

function completionClaimed(text) {
  return /\b(done|completed|fixed|resolved|finished|conclu[ií]do|corrigido|resolvido|finalizado|pronto)\b/i.test(
    String(text || "")
  );
}

function violationsText(result) {
  return (result.violations || [])
    .map((item) => item.ruleId + ": " + item.text + " [" + item.evidence + "]")
    .join("; ");
}

export async function userPromptHook(accountId, input = {}) {
  const prompt = String(input.prompt || "");
  const context = await beginAccountTurn(accountId, {
    platformConversationRef: sessionRef(input.sessionId),
    userMessage: prompt,
    userTurnRef: input.turnId ? "user:" + input.turnId : undefined,
    requestFingerprint: input.turnId ? "prompt:" + input.turnId : undefined,
    title: "ChatGPT Work/Codex",
    metadata: { surface: "codex_hook" }
  });

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: hookContext(context)
    }
  };
}

export async function preToolHook(accountId, input = {}) {
  const resources = resourcesFromToolInput(input.toolName, input.toolInput);
  const destructive = isObviouslyDestructive(input.toolName, input.toolInput);

  const result = await evaluateForAccount(accountId, {
    proposedActions: resources.map((resource) => ({
      resource,
      destructive,
      destructiveAuthorized: input.destructiveAuthorized === true
    })),
    requestFingerprint: input.toolUseId || undefined
  });

  if (result.decision !== "BLOCK") return {};

  return {
    systemMessage: "Bloqueando Alucinações bloqueou esta ação antes da execução.",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: violationsText(result) || "Canonical blocker triggered."
    }
  };
}

export async function stopHook(accountId, input = {}) {
  const candidate = String(input.lastAssistantMessage || "").trim();
  if (!candidate) return {};

  const context = await beginAccountTurn(accountId, {
    platformConversationRef: sessionRef(input.sessionId),
    userMessage: "",
    title: "ChatGPT Work/Codex",
    metadata: { surface: "codex_hook" }
  });

  const currentUserMessage =
    [...(context.recentTurns || [])].reverse().find((turn) => turn.role === "user")?.content || "";

  const guardian = await classifySemanticSignals({
    currentUserMessage,
    recentTurns: context.recentTurns,
    relevantOlderTurns: context.relevantOlderTurns,
    memory: context.memory,
    candidate
  });

  if (guardian.state !== "VERIFIED") {
    if (input.stopHookActive === true) {
      return {
        continue: false,
        stopReason: "Semantic validation unavailable after one controlled retry.",
        systemMessage: "Bloqueando Alucinações interrompeu a liberação porque a validação semântica não pôde ser comprovada."
      };
    }
    return {
      decision: "block",
      reason:
        "Semantic validation is unavailable (" + guardian.state +
        "). Do not claim completion. Retry only after the Cognitive Blocker can validate the candidate."
    };
  }

  const result = await evaluateForAccount(accountId, {
    semanticSignals: guardian.signals,
    candidateText: candidate,
    completionClaimed: completionClaimed(candidate),
    requestFingerprint: input.turnId ? "stop:" + input.turnId + ":" + candidate.length : undefined
  });

  if (result.decision === "BLOCK") {
    const reason = violationsText(result) || "Canonical blocker triggered.";
    if (input.stopHookActive === true) {
      return {
        continue: false,
        stopReason: reason,
        systemMessage: "Bloqueando Alucinações manteve o bloqueio após a tentativa de correção."
      };
    }
    return {
      decision: "block",
      reason:
        "Correct only the canonical violations below, preserve the valid parts, then try again. " +
        reason
    };
  }

  await acceptAssistantTurn(accountId, {
    conversationId: context.conversation.id,
    assistantTurnRef: input.turnId ? "assistant:" + input.turnId : undefined,
    assistantMessage: candidate,
    requestFingerprint: input.turnId ? "assistant:" + input.turnId : undefined
  });

  return {};
}
