import { executeFunctionCall } from "./generic.mjs";

export function normalizeGoogleFunctionCall(part = {}, { critical = true } = {}) {
  const functionCall = part.functionCall || part.function_call || part;
  if (!functionCall?.name) {
    return { status: "OUT_OF_AUTHORITY", reason: "No application-owned function call was provided." };
  }
  return {
    id: functionCall.id || null,
    name: functionCall.name,
    args: functionCall.args || {},
    critical
  };
}

export async function executeGoogleFunctionCall(options = {}) {
  const call = normalizeGoogleFunctionCall(options.part || options.call || {}, { critical: options.critical !== false });
  if (call.status === "OUT_OF_AUTHORITY") {
    return { executed: false, status: call.status, reason: call.reason, releaseable: false };
  }
  return executeFunctionCall({ ...options, call, runtime: "google" });
}
