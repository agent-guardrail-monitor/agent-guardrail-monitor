import { evaluateHook, hookOutput } from "../hook.mjs";

export function evaluateClaudePreToolUse(policy, input) {
  return evaluateHook(policy, "claude", input);
}

export function claudeHookOutput(decision) {
  return hookOutput("claude", decision);
}
