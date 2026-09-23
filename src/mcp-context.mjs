import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function withMcpContext(context, run) {
  const value = Object.freeze({
    installationId: Number(context?.installationId || 0) || null,
    platform: String(context?.platform || "").trim().toLowerCase() || null
  });
  return storage.run(value, run);
}

export function getMcpContext() {
  return storage.getStore() || null;
}
