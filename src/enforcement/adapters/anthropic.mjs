import { executeFunctionCall } from "./generic.mjs";

export function normalizeAnthropicToolUse(block = {}, { critical = true } = {}) {
  if (block.type && block.type !== "tool_use") {
    return { status: "OUT_OF_AUTHORITY", reason: "Block is not an application-owned tool_use.", rawType: block.type };
  }
  return {
    id: block.id || null,
    name: block.name || "",
    args: block.input || {},
    critical
  };
}

export async function executeAnthropicToolUse(options = {}) {
  const call = normalizeAnthropicToolUse(options.block || options.call || {}, { critical: options.critical !== false });
  if (call.status === "OUT_OF_AUTHORITY") {
    return { executed: false, status: call.status, reason: call.reason, releaseable: false };
  }
  return executeFunctionCall({ ...options, call, runtime: "anthropic" });
}
