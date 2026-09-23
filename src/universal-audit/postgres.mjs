import { performance } from "node:perf_hooks";
import { AUDIT_STATES, aggregateAudit, finding } from "./result.mjs";

function readOnly(sql) {
  const text = String(sql || "").trim().replace(/^\(+/, "").toUpperCase();
  return /^(SELECT|SHOW|EXPLAIN|WITH)\b/.test(text);
}

export async function auditPostgresTarget(config = {}, {
  connectionString,
  pgModule
} = {}) {
  const domain = "banco";
  const target = config.name || "PostgreSQL";
  if (!connectionString) {
    return aggregateAudit(domain, [finding({
      state: AUDIT_STATES.UNKNOWN,
      domain,
      code: "DATABASE_NOT_CONNECTED",
      message: "Banco configurado sem uma conexão autorizada.",
      target
    })], { target });
  }

  const pg = pgModule || await import("pg");
  const Client = pg.Client || pg.default?.Client;
  if (!Client) throw new Error("PostgreSQL client indisponível");

  const client = new Client({
    connectionString,
    statement_timeout: Math.max(500, Number(config.timeoutMs || 5000)),
    query_timeout: Math.max(500, Number(config.timeoutMs || 5000)),
    application_name: "o-guardiao-w"
  });

  const findings = [];
  const started = performance.now();
  try {
    await client.connect();
    const latencyMs = Math.round(performance.now() - started);
    findings.push(finding({
      state: AUDIT_STATES.PASS,
      domain,
      code: "DATABASE_CONNECTED",
      message: `Conexão com o banco confirmada em ${latencyMs} ms.`,
      evidence: { latencyMs },
      target
    }));

    await client.query("BEGIN READ ONLY");
    for (const probe of config.queries || [{ name: "ping", sql: "SELECT 1 AS ok" }]) {
      if (!readOnly(probe.sql)) {
        findings.push(finding({
          state: AUDIT_STATES.FAIL,
          domain,
          code: "UNSAFE_DATABASE_PROBE",
          message: `Consulta de auditoria não é somente leitura: ${probe.name || "consulta"}.`,
          target
        }));
        continue;
      }
      const qStarted = performance.now();
      try {
        const result = await client.query(probe.sql);
        const qMs = Math.round(performance.now() - qStarted);
        const minRows = Number(probe.minRows ?? 0);
        const maxRows = probe.maxRows == null ? null : Number(probe.maxRows);
        const rowOk = result.rowCount >= minRows && (maxRows == null || result.rowCount <= maxRows);
        findings.push(finding({
          state: rowOk ? AUDIT_STATES.PASS : AUDIT_STATES.FAIL,
          domain,
          code: "DATABASE_QUERY",
          message: rowOk
            ? `${probe.name || "Consulta"} aprovada.`
            : `${probe.name || "Consulta"} retornou quantidade de linhas fora do esperado.`,
          evidence: { rowCount: result.rowCount, latencyMs: qMs },
          target
        }));
      } catch (error) {
        findings.push(finding({
          state: AUDIT_STATES.FAIL,
          domain,
          code: "DATABASE_QUERY_FAILED",
          message: `${probe.name || "Consulta"} falhou.`,
          evidence: String(error?.message || error),
          target
        }));
      }
    }
    await client.query("ROLLBACK");
  } catch (error) {
    findings.push(finding({
      state: AUDIT_STATES.FAIL,
      domain,
      code: "DATABASE_CONNECTION_FAILED",
      message: "Não foi possível conectar ao banco.",
      evidence: String(error?.message || error),
      target
    }));
  } finally {
    try { await client.end(); } catch {}
  }

  return aggregateAudit(domain, findings, { target });
}
