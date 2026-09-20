# Red-team report — v0.2 alpha

Date: 2026-09-20

## Method

The v0.2 branch was intentionally tested for rule bypass, authority injection, missing proof, route drift, policy conflict, missing policy, audit tampering and install/config regression. CI failures are preserved as evidence rather than rewritten as success.

## Automated adversarial coverage

The suite currently tests, among other cases:

- invalid strict policy cannot silently allow;
- disabled policy rules do not execute;
- critical unmatched action blocks;
- destructive shell policy blocks;
- required tool mismatch blocks;
- mandatory skill requires load, execution and proof;
- conflicting mandatory allow/block requires review;
- external tool output cannot promote itself into policy authority;
- normalized policy payload cannot override trusted source/authority metadata;
- route deviation blocks;
- audit log redacts common secrets/commands and detects mutation;
- file-hash proof is independently read back;
- executor is never called after a pre-action block;
- allow output does not bypass vendor permission flow;
- hook policy load failure emits deny;
- memory conflict requires review;
- unavailable required tool blocks;
- task completion without proof is rejected;
- UNKNOWN/INFERRED claims presented as fact are rejected;
- PASS-to-UNKNOWN canary drift is critical;
- installer is idempotent for Claude and preserves unrelated settings;
- Codex installer returns UNKNOWN instead of writing an unproven enforcement configuration.

## Finding 1 — package metadata serialization

First pull-request CI run: https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/actions/runs/35534812858

Observed result: FAILURE before tests. `package.json` and lock metadata had a literal `\\n` after the JSON document.

Root cause: escaped marker was appended instead of a real newline.

Correction: normalized both package files and reran CI.

Regression record: https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/issues/2

## Finding 2 — directive authority overwrite

Observed during code review/red-team before promotion: unrestricted spread of normalized policy payload could attempt to overwrite compiler-owned metadata such as source/authority/status/id.

Correction: normalized input is now whitelisted to phase/match/effect; trusted metadata remains compiler-owned.

Regression test: `normalized rule cannot override directive authority metadata`.

Regression record: https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/issues/3

## Verified CI evidence

Corrected enforcement-core run: https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/actions/runs/35534854186 — SUCCESS.

Full resolver/pipeline run: https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/actions/runs/35535140117 — SUCCESS, 45 tests passed, 0 failed, plus `agm doctor` success.

## Known attack surfaces not yet closed

- provider hook timeout fail-open branches;
- deletion/replacement of local unsigned policy by a filesystem-authorized actor;
- deletion of the entire local audit file;
- provider-specific hosted tools that bypass an AGM-controlled tool broker;
- incomplete live blocking-canary coverage across exact Claude/Copilot/Codex versions and operating systems;
- generalized semantic prompt-injection detection is not treated as solved.

These remain explicit limitations, not PASS results.


## Finding 3 — duplicate route gate hid Tool Router provenance

**Observed:** CI blocked the forbidden tool but returned no `pipelineStage` instead of `TOOL_RESOLUTION`.

**Root cause:** `evaluateHook` had a standalone route check before the canonical pre-action pipeline. The early block prevented Tool Router provenance from being emitted.

**Correction:** removed the duplicate preliminary gate. Runtime hooks now traverse one ordered pipeline for memory, skills, tools, route, and policy.

**Regression:** `runtime hook blocks forbidden registered tool before policy allow`.

**Issue:** https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/issues/4

**Verified:** commit `0b9e3901af0efdd2f0f2295c3fca08cc4942e4bb` passed the Node 20/22/24 CI matrix, `agm doctor`, and `npm pack --dry-run`.
