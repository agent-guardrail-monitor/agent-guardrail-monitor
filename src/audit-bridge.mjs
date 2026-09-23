let bridge = null;

export function registerAuditBridge(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("audit bridge must be an object");
  }
  bridge = value;
}

export function getAuditBridge() {
  if (!bridge) throw new Error("O Guardião ainda não conectou o serviço de auditoria.");
  return bridge;
}
