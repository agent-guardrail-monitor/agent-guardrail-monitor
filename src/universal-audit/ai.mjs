import { resolveMemory } from "../enforcement/memory.mjs";
import { resolveTools } from "../enforcement/tools.mjs";
import { AUDIT_STATES, aggregateAudit, finding } from "./result.mjs";

function list(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

export function auditAiResponse(input = {}) {
  const domain = "ia";
  const findings = [];
  const claims = list(input.claims);

  for (const claim of claims) {
    const status = String(claim.verificationStatus || "UNKNOWN").toUpperCase();
    const material = claim.material !== false;
    if (status === "CONTRADICTED") {
      findings.push(finding({
        state: AUDIT_STATES.FAIL,
        domain,
        code: "CLAIM_CONTRADICTED",
        message: claim.claim || "Uma afirmação foi contradita pela prova.",
        evidence: claim.evidence || null
      }));
    } else if (material && !["VERIFIED", "SUPPORTED"].includes(status)) {
      findings.push(finding({
        state: AUDIT_STATES.UNKNOWN,
        domain,
        code: "CLAIM_UNVERIFIED",
        message: claim.claim || "Uma afirmação importante não tem prova suficiente.",
        evidence: claim.evidence || null
      }));
    } else {
      findings.push(finding({
        state: AUDIT_STATES.PASS,
        domain,
        code: "CLAIM_SUPPORTED",
        message: claim.claim || "Afirmação sustentada por prova.",
        evidence: claim.evidence || null
      }));
    }
  }

  const answer = String(input.answer || "");
  for (const text of list(input.mustContain)) {
    findings.push(finding({
      state: answer.includes(String(text)) ? AUDIT_STATES.PASS : AUDIT_STATES.FAIL,
      domain,
      code: "EXPECTED_FACT_MISSING",
      message: answer.includes(String(text))
        ? "Informação obrigatória presente na resposta."
        : `Informação obrigatória ausente: ${text}`
    }));
  }
  for (const text of list(input.mustNotContain)) {
    findings.push(finding({
      state: answer.includes(String(text)) ? AUDIT_STATES.FAIL : AUDIT_STATES.PASS,
      domain,
      code: "FORBIDDEN_FACT_PRESENT",
      message: answer.includes(String(text))
        ? `Informação proibida ou incorreta presente: ${text}`
        : "Informação proibida ausente."
    }));
  }

  const memoryRecords = list(input.memoryRecords);
  if (memoryRecords.length || list(input.requiredMemoryKeys).length) {
    const memory = resolveMemory(memoryRecords, {
      scopes: list(input.memoryScopes),
      requiredKeys: list(input.requiredMemoryKeys),
      now: input.now ? new Date(input.now) : new Date()
    });
    if (memory.status === "CONFLICT") {
      findings.push(finding({
        state: AUDIT_STATES.FAIL,
        domain: "memoria",
        code: "MEMORY_CONFLICT",
        message: "Existem memórias ativas conflitantes.",
        evidence: memory.conflicts
      }));
    } else if (memory.status === "INCOMPLETE") {
      findings.push(finding({
        state: AUDIT_STATES.UNKNOWN,
        domain: "memoria",
        code: "MEMORY_INCOMPLETE",
        message: "Faltam informações de memória exigidas para esta tarefa.",
        evidence: { missing: memory.missing, expired: memory.expired }
      }));
    } else {
      findings.push(finding({
        state: AUDIT_STATES.PASS,
        domain: "memoria",
        code: "MEMORY_RESOLVED",
        message: "Memória usada sem conflito detectado.",
        evidence: { used: memory.used.map((x) => x.id), expired: memory.expired }
      }));
    }
  }

  const registry = list(input.toolRegistry);
  if (registry.length || list(input.requiredTools).length) {
    const tools = resolveTools(registry, {
      requiredTools: list(input.requiredTools),
      allowedTools: list(input.allowedTools),
      forbiddenTools: list(input.forbiddenTools)
    }, list(input.availableTools));
    findings.push(finding({
      state: tools.status === "RESOLVED" ? AUDIT_STATES.PASS : AUDIT_STATES.FAIL,
      domain: "ferramentas",
      code: tools.status === "RESOLVED" ? "TOOLS_RESOLVED" : "TOOLS_INVALID",
      message: tools.status === "RESOLVED"
        ? "Ferramentas necessárias disponíveis e compatíveis."
        : "Há ferramenta obrigatória ausente, indisponível ou bloqueada.",
      evidence: {
        missingRequired: tools.missingRequired,
        unavailableRequired: tools.unavailableRequired
      }
    }));
  }

  if (!findings.length) {
    findings.push(finding({
      state: AUDIT_STATES.UNKNOWN,
      domain,
      code: "NO_EVIDENCE",
      message: "Nenhuma prova estruturada foi fornecida para verificar a resposta."
    }));
  }

  return aggregateAudit(domain, findings, {
    platform: String(input.platform || "unknown").toLowerCase()
  });
}
