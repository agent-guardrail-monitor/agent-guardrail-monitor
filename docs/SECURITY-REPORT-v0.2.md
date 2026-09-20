# Security report — v0.2 alpha

Date: 2026-09-20

## Security objective

Agent Guardrail Monitor (AGM) treats the model as an untrusted proposer for critical actions. Policy decisions, execution proof, claim validation and release decisions are external deterministic steps on surfaces AGM can actually control.

## Implemented controls

| Threat | v0.2-alpha control | Current assurance |
| --- | --- | --- |
| Model skips required tool | REQUIRE_TOOL policy + Tool Router | Deterministic when action passes through AGM |
| Model skips mandatory skill | Skill Resolver + execution-proof requirement | Deterministic when skill state is supplied to AGM |
| Goal / route drift | Route Guard + immutable original objective in Task State Machine | Deterministic for declared allow/deny scope |
| False execution claim | Execution Verifier + completion proof state | Output can remain UNKNOWN even after a tool returned |
| Unsupported factual claim | Evidence Gate rejects UNKNOWN/INFERRED presented as fact | Deterministic for claims represented in the output envelope |
| External prompt/data self-promotes to policy | Source authority model; TOOL/FILE/WEB/MCP data cannot compile itself as active policy | Regression-tested |
| Policy conflict | Mandatory conflicting rules -> REQUIRE_REVIEW | Regression-tested |
| Invalid/missing strict policy | Invalid strict policy -> BLOCK; hook policy-load failure -> deny output | Regression-tested |
| Audit mutation | Append-only JSONL hash chain detects edited/reordered events | Detects mutation of retained local log |
| Secret leakage in logged common fields | key-name redaction + shell command fingerprinting | Partial; arbitrary secret-shaped values in non-secret fields require further scanners |
| Hook/config regression after runtime update | Existing baseline/current drift monitor + runtime proof state | Implemented; exact runtime proof coverage varies by vendor |

## Provider boundaries

### Claude Code

`PreToolUse` can block a tool call. Project/user hooks can also be restricted by managed enterprise policy. Command/HTTP/MCP PreToolUse hooks that time out do not block; the tool call continues into the normal permission flow. AGM therefore uses a local evaluator and records the timeout branch as outside full AGM authority.

Reference: https://code.claude.com/docs/en/hooks

### GitHub Copilot

`preToolUse` command hooks can deny a tool call. Command-hook failures are blocking for preToolUse, but timeouts are documented as fail-open. AGM uses a local command hook and does not claim control over the provider timeout branch.

Reference: https://docs.github.com/en/copilot/reference/hooks-reference

### Codex

AGM keeps enforcement installation at UNKNOWN until a current version/path-specific blocking canary is proven. Static configuration discovery or the mere existence of hook schemas is not treated as enforcement proof.

## Prompt-injection boundary

Data retrieved from tools, files, web content, MCP resources and other external sources receives DATA authority by default. It may influence evidence and task content, but it cannot activate or rewrite policy merely by containing imperative text.

Remaining work for broader injection resistance includes provider-specific retrieval adapters, destination/resource constraints, centralized trust policy and content-aware secret/data-exfiltration checks.

## Policy tampering

Current alpha records policy hashes and binds decisions/receipts to a policy hash.

LIMITATION: local unsigned policy files can still be edited by an actor that has filesystem authority. Signed policy bundles and central policy distribution are required before claiming organization-grade tamper resistance.

## Audit integrity

The local audit chain detects mutation of retained entries.

LIMITATION: a local actor with filesystem authority can delete the entire local audit file. Organization-grade immutable/remote retention is not implemented in alpha.

## Replay / idempotency

Execution receipts include action IDs and request fingerprints.

LIMITATION: durable nonce storage and distributed replay prevention are not yet implemented.

## Least privilege and secrets

The open-source CLI requires no model API key for static enforcement evaluation. It should not log raw passwords, API keys, private keys, auth headers or shell command bodies.

Provider/runtime credentials remain under their own runtimes. AGM does not require copying those credentials into the policy file.

## Release rule

A provider/runtime surface must not be labeled ENFORCED solely because configuration exists. It needs a blocking point in the mandatory path plus current proof of that path. Otherwise use DETECTED, AUDITED, UNKNOWN or OUT_OF_AUTHORITY.
