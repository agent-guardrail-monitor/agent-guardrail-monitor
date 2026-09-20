import { evaluateHook, hookOutput } from "../hook.mjs";

export function evaluateCopilotPreToolUse(policy, input) {
  return evaluateHook(policy, "copilot", input);
}

export function copilotHookOutput(decision) {
  return hookOutput("copilot", decision);
}
