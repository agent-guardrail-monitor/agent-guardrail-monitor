import { executeFunctionCall } from "./generic.mjs";

export function normalizeOpenAIFunctionCall(item = {}, { critical = true } = {}) {
  if (item.type && item.type !== "function_call") {
    return { status: "OUT_OF_AUTHORITY", reason: "Item is not an application-owned function_call.", rawType: item.type };
  }
  return {
    id: item.call_id || item.id || null,
    name: item.name || "",
    arguments: item.arguments || "{}",
    critical
  };
}

export async function executeOpenAIFunctionCall(options = {}) {
  const call = normalizeOpenAIFunctionCall(options.item || options.call || {}, { critical: options.critical !== false });
  if (call.status === "OUT_OF_AUTHORITY") {
    return { executed: false, status: call.status, reason: call.reason, releaseable: false };
  }
  return executeFunctionCall({ ...options, call, runtime: "openai" });
}
