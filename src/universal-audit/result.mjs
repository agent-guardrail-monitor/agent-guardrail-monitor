export const AUDIT_STATES = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  UNKNOWN: "UNKNOWN"
});

export function finding({
  state = AUDIT_STATES.UNKNOWN,
  domain,
  code,
  message,
  evidence = null,
  target = null,
  repairable = false
}) {
  return {
    state,
    domain,
    code,
    message,
    evidence,
    target,
    repairable: Boolean(repairable)
  };
}

export function aggregateAudit(domain, findings = [], meta = {}) {
  const list = findings.filter(Boolean);
  let state = AUDIT_STATES.PASS;
  if (list.some((item) => item.state === AUDIT_STATES.FAIL)) state = AUDIT_STATES.FAIL;
  else if (list.some((item) => item.state === AUDIT_STATES.UNKNOWN)) state = AUDIT_STATES.UNKNOWN;

  return {
    domain,
    state,
    findings: list,
    summary: {
      passed: list.filter((x) => x.state === AUDIT_STATES.PASS).length,
      failed: list.filter((x) => x.state === AUDIT_STATES.FAIL).length,
      unknown: list.filter((x) => x.state === AUDIT_STATES.UNKNOWN).length
    },
    ...meta
  };
}

export function combineAudits(audits = [], meta = {}) {
  const list = audits.filter(Boolean);
  let state = AUDIT_STATES.PASS;
  if (list.some((item) => item.state === AUDIT_STATES.FAIL)) state = AUDIT_STATES.FAIL;
  else if (list.some((item) => item.state === AUDIT_STATES.UNKNOWN)) state = AUDIT_STATES.UNKNOWN;
  return { state, audits: list, ...meta };
}
