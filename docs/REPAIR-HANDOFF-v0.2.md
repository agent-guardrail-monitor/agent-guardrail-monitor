# Historical v0.2 Repair Handoff — SUPERSEDED

Status: **SUPERSEDED by the integrated v0.3 repair engine.**

This document preserves the architecture used in v0.2, when Agent Guardrail Monitor and Software Repair Engineer were separate components connected by a machine-readable handoff.

The v0.2 flow was:

```text
detect -> prove -> prepare repair handoff -> separate repair agent -> retest -> validate
```

That separation is no longer the active product architecture.

In v0.3:

- Agent Guardrail Monitor owns detection and evidence;
- the repair protocol is built into Agent Guardrail Monitor;
- the GitHub App can create the repair branch and pull request itself;
- the integrated engine performs root-cause planning and bounded patch generation;
- AGM remains the final verification authority;
- `auto_merge` is available only through explicit repository configuration.

The legacy symbols `buildRepairHandoff`, `saveRepairHandoff`, and MCP tool `agm_prepare_repair_handoff` remain temporarily as compatibility aliases. Their consumer is now the integrated AGM repair engine.

See:

- [Integrated Repair Engine — v0.3](REPAIR-ENGINE-v0.3.md)
- [Marketplace submission configuration](MARKETPLACE.md)

The original v0.2 artifact path may still appear in older CLI workflows:

```text
.agent-guardrail-monitor/repair-handoff.json
```

It should be interpreted as historical compatibility data, not as a handoff to a separate product.
