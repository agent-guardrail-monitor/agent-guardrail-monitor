import { performance } from "node:perf_hooks";
import { AUDIT_STATES, aggregateAudit, finding } from "./result.mjs";

function safeMethod(value) {
  const method = String(value || "GET").toUpperCase();
  return ["GET", "HEAD"].includes(method) ? method : "GET";
}

function allowedStatus(config, status) {
  const expected = Array.isArray(config.expectedStatus)
    ? config.expectedStatus
    : [Number(config.expectedStatus || 200)];
  return expected.includes(status);
}

export async function auditHttpTarget(config = {}, {
  fetchImpl = globalThis.fetch,
  headers = {}
} = {}) {
  const domain = config.domain || "api";
  const target = String(config.url || "").trim();
  if (!target) {
    return aggregateAudit(domain, [finding({
      state: AUDIT_STATES.UNKNOWN,
      domain,
      code: "URL_MISSING",
      message: "Nenhum endereço foi configurado para este teste."
    })]);
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(100, Number(config.timeoutMs || 10000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  let response;
  let body = "";
  try {
    response = await fetchImpl(target, {
      method: safeMethod(config.method),
      headers,
      redirect: "follow",
      signal: controller.signal
    });
    if (safeMethod(config.method) !== "HEAD") body = await response.text();
  } catch (error) {
    clearTimeout(timer);
    return aggregateAudit(domain, [finding({
      state: AUDIT_STATES.FAIL,
      domain,
      code: "CONNECTION_FAILED",
      message: "O sistema não respondeu ao teste.",
      evidence: String(error?.message || error),
      target
    })], { target });
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Math.round(performance.now() - started);
  const findings = [];

  findings.push(finding({
    state: allowedStatus(config, response.status) ? AUDIT_STATES.PASS : AUDIT_STATES.FAIL,
    domain,
    code: "HTTP_STATUS",
    message: allowedStatus(config, response.status)
      ? `Resposta HTTP ${response.status} dentro do esperado.`
      : `Resposta HTTP ${response.status} fora do esperado.`,
    evidence: { status: response.status },
    target
  }));

  const maxLatencyMs = Number(config.maxLatencyMs || 0);
  if (maxLatencyMs > 0) {
    findings.push(finding({
      state: latencyMs <= maxLatencyMs ? AUDIT_STATES.PASS : AUDIT_STATES.FAIL,
      domain: domain === "interface" ? "desempenho" : domain,
      code: "LATENCY",
      message: latencyMs <= maxLatencyMs
        ? `Resposta em ${latencyMs} ms.`
        : `Resposta levou ${latencyMs} ms; limite configurado é ${maxLatencyMs} ms.`,
      evidence: { latencyMs, maxLatencyMs },
      target
    }));
  }

  for (const required of config.requiredText || []) {
    findings.push(finding({
      state: body.includes(String(required)) ? AUDIT_STATES.PASS : AUDIT_STATES.FAIL,
      domain,
      code: "REQUIRED_CONTENT",
      message: body.includes(String(required))
        ? "Conteúdo obrigatório encontrado."
        : `Conteúdo obrigatório ausente: ${required}`,
      target
    }));
  }

  for (const forbidden of config.forbiddenText || []) {
    findings.push(finding({
      state: body.includes(String(forbidden)) ? AUDIT_STATES.FAIL : AUDIT_STATES.PASS,
      domain,
      code: "FORBIDDEN_CONTENT",
      message: body.includes(String(forbidden))
        ? `Conteúdo proibido encontrado: ${forbidden}`
        : "Conteúdo proibido ausente.",
      target
    }));
  }

  return aggregateAudit(domain, findings, {
    target,
    latencyMs,
    statusCode: response.status,
    bytes: Buffer.byteLength(body)
  });
}
