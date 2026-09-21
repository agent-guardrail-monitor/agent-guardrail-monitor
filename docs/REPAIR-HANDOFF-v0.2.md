# Agent Guardrail Monitor → Software Repair Engineer handoff

## Purpose

The integration keeps the products separate while giving them one deterministic workflow:

```text
detect -> prove -> prepare repair handoff -> diagnose -> repair -> retest -> validate
```

Agent Guardrail Monitor owns detection evidence and post-repair verification.
Software Repair Engineer owns root-cause investigation, patching, executable regression tests, and recurrence hardening.

## Trigger

A handoff is created only when AGM has repair-triggering evidence, such as:

- a snapshot regression;
- a new static `FAIL` finding;
- a runtime proof with status `FAIL`.

A runtime version change by itself does not create a repair requirement.

## Contract

The artifact uses `kind: AGM_TO_SRE_REPAIR_HANDOFF`.

The `repairRequest` object is shaped for the Software Repair Engineer `sre_preflight` interface:

- `objective`
- `systemKind`
- `failureEvidence`
- `changedFiles`
- `checksRun`
- `recurrenceReviewed`
- `deploymentInScope`
- `deploymentVerified`

AGM sets `rootCauseState` to `UNKNOWN`. Root cause belongs to the repair investigation and must not be inferred from temporal correlation with an update.

## CLI behavior

A failing command:

```bash
agm gate --baseline baseline.json
```

writes:

```text
.agent-guardrail-monitor/repair-handoff.json
```

Choose another path with:

```bash
agm gate --baseline baseline.json --repair-handoff artifacts/repair.json
```

The gate still exits non-zero on failure.

## ChatGPT MCP behavior

`agm_prepare_repair_handoff` converts AGM-observed regression evidence into the same contract. It is read-only and does not execute a patch.

An orchestrator can pass `repairRequest` to the separate Software Repair Engineer. After that agent returns a verified repair, rerun AGM against the same approved baseline.

## Completion rule

Repair is not complete merely because files changed.

The verification loop is complete only when the relevant post-patch executable checks pass and AGM no longer reproduces the original regression. If runtime proof is required and available, it must return `PASS`.