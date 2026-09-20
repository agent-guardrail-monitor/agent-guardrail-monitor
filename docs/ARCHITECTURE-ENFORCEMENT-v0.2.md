# Enforcement Architecture v0.2

Status: architecture decision record and implementation contract  
Branch: `enforcement-v0.2`  
Date: 2026-09-20

## 1. Decision

Agent Guardrail Monitor will evolve from a regression monitor into a **vendor-neutral enforcement system with runtime-specific policy enforcement points (PEPs)**.

The strongest deployable architecture is not a universal in-chat plugin. It is a layered system:

1. **Local Runtime Adapter / PEP** on every controllable execution path.
2. **Deterministic Policy Engine** that evaluates normalized directives before side effects.
3. **Enforcement Gateway** for model/API flows the customer owns.
4. **Evidence + Execution Verifier** that refuses to promote an action to completed without proof.
5. **Versioned registries** for directives, skills, tools, memory-like project state, tasks and policy.
6. **Drift Monitor** comparing approved baseline to current runtime/configuration.
7. **Central policy controller** for organization policy distribution, audit retention and optional OPA/Rego authoring.
8. Runtime adapters for Claude Code, Codex, GitHub Copilot, OpenAI API/Agents SDK, Gemini and generic function-calling agents.

The model is never the authority over whether its own action complied.

## 2. Evidence labels

This document uses these labels:

- **FACT**: directly supported by current vendor documentation or reproducible project evidence.
- **EVIDENCE**: observed issue, benchmark or implementation artifact that supports a conclusion.
- **INFERENCE**: architecture conclusion derived from facts/evidence.
- **LIMITATION**: a boundary that prevents stronger enforcement on that surface.
- **UNKNOWN**: not established strongly enough to claim.

## 3. Hard platform limits

### ChatGPT plugins/apps

**FACT.** Current ChatGPT plugins can package skills and apps; apps use MCP/Apps SDK to expose approved external tools and data. Full MCP write/modify support is plan- and workspace-dependent. The documented app surface is a tool/data integration surface.

**INFERENCE.** A normal ChatGPT plugin/app must not be represented as if it can universally intercept every assistant response, private model runtime step, internal memory retrieval, or arbitrary tool call outside its own exposed integration. No current public app API establishes that universal interception authority.

Therefore ChatGPT distribution can expose Agent Guardrail Monitor capabilities, but it is not itself the universal enforcement boundary.

Sources:
- https://help.openai.com/en/articles/11487775
- https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk
- https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

### OpenAI API / Agents SDK

**FACT.** OpenAI Agents SDK input/output guardrails can halt runs. Function-tool guardrails can validate/block custom function tools before and after execution.

**LIMITATION.** Hosted tools and several built-in execution tools do not use the same function-tool guardrail pipeline.

**INFERENCE.** Strict mode should keep critical side-effecting tools inside Agent Guardrail Monitor-controlled custom tools/MCP or inside an owned orchestration loop. Provider-hosted side effects that bypass the controlled tool path cannot be labeled fully enforced.

Source:
- https://openai.github.io/openai-agents-python/guardrails/

### Claude Code

**FACT.** `PreToolUse` runs before tool execution and can block it. Exit code 2 blocks supported events. `UserPromptExpansion` covers direct slash-command/skill expansion paths. `ConfigChange`, `PreCompact`, `TaskCompleted` and `PreModelSwitch` expose additional control points.

**LIMITATION.** Timed-out command/HTTP/MCP `PreToolUse` hooks do not block the tool call. HTTP failures/non-2xx also do not block by themselves.

**INFERENCE.** The critical pre-action policy check must be local, bounded and deterministic. A remote HTTP policy request cannot be the sole critical barrier.

Source:
- https://code.claude.com/docs/en/hooks

### GitHub Copilot

**FACT.** `preToolUse` can allow, deny or modify tool calls. Command-hook crashes/non-zero exits can deny a pre-tool call.

**LIMITATION.** Hook timeouts are fail-open and proceed through the normal permission flow.

**INFERENCE.** As with Claude Code, critical rules need a local policy bundle and local evaluation. Remote policy sync can occur outside the pre-action critical path.

Sources:
- https://docs.github.com/en/copilot/reference/hooks-reference
- https://docs.github.com/en/copilot/concepts/agents/hooks

### OpenAI Codex

**FACT.** Current Codex source contains hook schemas and hook implementation/tests, including SessionStart-related schemas.

**EVIDENCE.** Public Codex issues document version-specific cases where hooks were discovered but did not fire, fired twice, or skipped specific lifecycle paths.

**INFERENCE.** Codex hook enforcement must be preceded by an execution canary tied to the exact runtime version. Until a specific version/path has current proof, Agent Guardrail Monitor must report UNKNOWN rather than assume enforcement.

Sources:
- https://github.com/openai/codex
- https://github.com/openai/codex/issues/19780
- https://github.com/openai/codex/issues/21639
- https://github.com/openai/codex/issues/24228
- https://github.com/openai/codex/issues/25645

### Gemini / generic function calling

**FACT.** In Gemini custom function calling, the model proposes a function call and the application is responsible for executing the function.

**INFERENCE.** Where the customer owns that application loop, Agent Guardrail Monitor can put the PEP directly between model proposal and execution. Provider-hosted tools remain a different trust surface.

Source:
- https://ai.google.dev/gemini-api/docs/function-calling

## 4. Why model-only compliance is insufficient

**EVIDENCE.** ToolFailBench (2026) evaluates 1,000 tasks and separates Tool-Skip, Result-Ignore, Output-Fabrication and Unnecessary-Tool-Use. The paper reports that the best of 19 headline models reached an 86.33% Clean Tool-Use Rate.

**EVIDENCE.** Long-context research shows position sensitivity: relevant information in the middle of long context can be used less reliably than information near the beginning or end.

**EVIDENCE.** Prompt-injection research and current platform guidance treat external/tool data as an attack surface.

**INFERENCE.** Critical directives cannot exist only as natural-language text inside model context. They need external state plus deterministic checks.

Sources:
- https://arxiv.org/abs/2607.04686
- https://aclanthology.org/2024.tacl-1.9/
- https://openai.com/index/designing-agents-to-resist-prompt-injection/
- https://genai.owasp.org/llmrisk/llm01-prompt-injection/

## 5. Instruction authority model

Agent Guardrail Monitor never attempts to override legitimate higher-authority platform policy.

For user-controlled/project-controlled directives the normalized precedence is:

1. platform/provider rules outside AGM authority;
2. organization/enterprise policy administered above the local user when applicable;
3. current explicit authorized task directive;
4. active project policy;
5. active scoped directive;
6. versioned project memory/state;
7. defaults.

External content receives **DATA authority by default**, not directive authority:

- TOOL_OUTPUT -> DATA
- FILE_CONTENT -> DATA
- WEB_CONTENT -> DATA
- RETRIEVED_CONTENT -> DATA
- MCP_RESULT -> DATA

Promotion to directive authority requires an explicit trusted policy rule.

OpenAI's current public hierarchy documents higher-trust system/developer/user instructions over tool output, reinforcing the separation between authority and data.

Sources:
- https://model-spec.openai.com/2025-04-11.html
- https://openai.com/index/instruction-hierarchy-challenge/

## 6. Twenty-layer study summary

| Layer | Finding | Control decision |
| --- | --- | --- |
| 1. Model behavior | Instruction following and tool use are probabilistic; context position and long-horizon state can degrade. | Critical checks external to the model. |
| 2. Instruction hierarchy | Provider/system policy can outrank user policy. | Compiler records source/authority; never attempts to override provider policy. |
| 3. Memory | Probabilistic retrieval is not a reliable policy store. | Versioned external state registry with provenance and expiry. |
| 4. Skills | Installed does not imply invoked. | Skill Registry + MANDATORY/CONDITIONAL/OPTIONAL/FORBIDDEN + invocation proof. |
| 5. Tool calling | Tool skip, wrong selection, bad args and fabricated execution are real failure classes. | Tool Router + pre-action PEP + execution receipts. |
| 6. Prompt compliance | Natural-language-only rules are hard to validate deterministically. | Instruction Compiler produces structured policy records. |
| 7. Route drift | Plans can substitute objectives/subgoals. | Immutable original objective + pre-action route check. |
| 8. Anti-hallucination | Unsupported claims can appear fluent. | Claim decomposition + evidence states + release gate. |
| 9. Execution verification | Model assertion is not execution evidence. | Verifier requires external receipt/state change/read-back. |
| 10. Policy enforcement | Policy decision and enforcement should be separate. | Central PDP + local PEP. OPA/Rego-compatible design. |
| 11. Prompt injection | External content can contain hostile instructions. | Source authority labels + least privilege + action PEP. |
| 12. Multi-model | Tool and hook semantics vary materially by vendor/runtime. | Adapter contract, capability matrix, per-version proof. |
| 13. Plugin limits | In-chat integrations do not establish universal runtime control. | Put enforcement in mandatory execution path. |
| 14. State/versioning | Audits need exact policy/config/model snapshot. | Content hashes + immutable execution envelope. |
| 15. Drift | Runtime/provider/config changes can invalidate assumptions. | Baseline/current comparison + canaries. |
| 16. Evals | Subjective “looks better” is not enough. | Deterministic fixtures + adversarial scenarios + metrics. |
| 17. Competition | Gateways/guardrails cover adjacent pieces. | Differentiate on directive/skill/tool/execution-proof + runtime drift. |
| 18. Security | Policy tampering, token leakage, replay and malicious MCP are material risks. | Signed bundles, least privilege, secret redaction, nonce/idempotency, audit hash chain. |
| 19. Privacy | Full conversations and secrets are unnecessary for many decisions. | Metadata-first logging, redaction, bounded retention. |
| 20. UX | A block without a traceable rule is a black box. | Every verdict includes rule IDs, evidence and reason. |

## 7. Competitive/adjacent systems

### Open Policy Agent

OPA is a general policy-decision engine and cleanly separates policy decision from enforcement.

**Use in AGM:** compatible central PDP / authoring layer.  
**Gap relative to AGM:** OPA does not supply agent runtime adapters, proof semantics or agent-specific drift canaries by itself.

Source: https://www.openpolicyagent.org/docs

### Cloudflare AI Gateway Guardrails

Proxy-based prompt/response interception with safety moderation and blocking.

**Adjacent strength:** model-provider gateway boundary.  
**AGM distinction:** directive/skill/tool requirements, runtime hook proof, action receipts and regression baselines.

Source: https://developers.cloudflare.com/ai-gateway/features/guardrails/

### NVIDIA NeMo Guardrails

Supports input, retrieval, dialog, execution and output rails. Current IORails tool validation can fail closed for schema/structure violations.

**Adjacent strength:** programmable rails around application/model/tool flow.  
**Important limitation for provenance:** structural tool-result validation confirms internal consistency, not necessarily server-verified provenance.

**AGM distinction:** explicit execution proof, per-runtime hook health, skill/directive registries and baseline drift.

Sources:
- https://docs.nvidia.com/nemo/guardrails/about-nemo-guardrails-library/how-it-works
- https://docs.nvidia.com/nemo/guardrails/configure-guardrails/guardrail-catalog/tool-calling

### Check Point/Lakera Guard

Screens user/model/agent/tool content, prompt attacks, data leakage and denied/dangerous tools.

**Adjacent strength:** prompt-injection and content/action screening.  
**AGM distinction:** reproducible enforcement proof and regression monitoring across runtime versions.

Source: https://docs.lakera.ai/docs/api

### PRISMA AIRS / Portkey AI Gateway

Gateway, observability, guardrails and governance.

**Adjacent strength:** centralized provider routing and observability.  
**AGM distinction:** runtime-hook canaries and policy proof spanning local coding-agent runtimes plus API agents.

Source: https://portkey.ai/

## 8. Chosen architecture

```
                        ORGANIZATION CONTROL PLANE
                  +----------------------------------+
                  | Directive / Skill / Tool Registry|
                  | Policy Registry + Versioning     |
                  | OPA/Rego-compatible authoring    |
                  | Bundle signer                    |
                  | Audit / Drift / Evals            |
                  +----------------+-----------------+
                                   |
                          signed/versioned bundle
                                   |
             +---------------------+----------------------+
             |                                            |
   LOCAL RUNTIME PEP                               API ENFORCEMENT GATEWAY
 +---------------------+                         +-------------------------+
 | cached policy bundle|                         | context/directive resolve|
 | deterministic check |                         | memory/skill/tool resolve|
 | no network required |                         | PDP / route guard        |
 | pre-tool hook        |                         | model call               |
 | execution receipt   |                         | tool broker / verifier   |
 +----------+----------+                         | evidence/output validator|
            |                                    +------------+------------+
     Claude/Codex/Copilot                                      |
                                                     OpenAI/Gemini/Generic API
```

### Core design rule

**Critical local tool enforcement must not require a network round trip.**

The control plane distributes a versioned policy bundle. Runtime adapters evaluate the relevant critical subset locally. This avoids turning documented hook timeouts into fail-open bypasses.

## 9. Required components and contracts

### Directive Registry

Minimum record:

```json
{
  "id": "RULE-023",
  "source": "USER",
  "authority": "CURRENT_EXPLICIT_USER_DIRECTIVE",
  "text": "For computer changes use the approved device tool",
  "normalizedRule": {"kind": "require_tool", "tool": "connect-device"},
  "scope": ["computer_change"],
  "priority": "MANDATORY",
  "triggers": ["task.computer_change"],
  "failureMode": "BLOCK",
  "version": 1,
  "status": "ACTIVE",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Instruction Compiler

Compiler output must be declarative. An LLM may assist compilation, but activation requires schema validation and, for critical rules, explicit policy acceptance or deterministic mapping.

A model-generated policy is never activated merely because the model said it understood the instruction.

### Memory / State Registry

Important operational rules are external versioned state, not dependent on model recall.

Fields: id, scope, value, source, priority, provenance, version, validFrom, expiresAt, status, hash.

### Skill Registry

Fields: skillId, name, version, scope, triggers, priority, dependencies, requiredTools, requiredFiles, status, hash, source.

States: MANDATORY, CONDITIONAL, OPTIONAL, FORBIDDEN.

A MANDATORY skill with no load/invocation proof -> BLOCK or REQUIRE_REVIEW according to policy.

### Tool Registry

Fields: toolId, aliases, runtime names, effect class, read/write, reversibility, scopes, argument schema, proof strategy, required permissions, status.

### Task State Machine

The task envelope is immutable for objective identity and append-only for state transitions:

- originalObjective
- subObjectives
- currentPlan
- currentStep
- currentAction
- allowedActions
- forbiddenActions
- expectedOutput
- proofOfCompletion
- policySnapshotHash
- model/runtime version
- status

### Policy Engine

Verdicts:

- ALLOW
- BLOCK
- REQUIRE_REVIEW
- UNKNOWN

No generic PASS state exists for a pre-action decision; ALLOW means only that this specific proposed action passed the applicable current checks.

### Route Guard

Compare current action to original objective and allowed scope. Critical mismatch -> BLOCK.

### Evidence Gate

Claim states:

- VERIFIED
- SUPPORTED
- INFERRED
- UNKNOWN
- CONTRADICTED

UNKNOWN cannot be released as VERIFIED. CONTRADICTED cannot be released as factual.

### Execution Verifier

An action receipt contains:

- action ID
- tool ID
- policy decision ID
- request fingerprint
- startedAt / completedAt
- tool result fingerprint
- external proof type
- external proof reference/fingerprint
- verification status

Examples:
- file edit -> read-back hash/content check;
- Git commit -> returned SHA then fetch commit;
- deployment -> deployment ID then provider state;
- email -> provider send response/message ID;
- configuration -> reread final state.

### Output Validator

Checks applicable directives, mandatory skills/tools, claims/evidence, execution receipts, objective scope and required format before release on controlled API surfaces.

### Audit Log

Append-only JSONL in local mode, moving to tamper-evident centralized storage in hosted mode.

Each event includes a previous-event hash so mutation is detectable.

Secrets and raw command bodies are redacted/fingerprinted by default.

## 10. Fail-closed policy

Critical action:

```
policy applicable?
  no -> continue normal evaluation
  yes
    policy bundle valid?
      no -> BLOCK
    mandatory skill proof present?
      no -> BLOCK
    required tool selected?
      no -> BLOCK
    route compatible?
      no -> BLOCK
    arguments valid?
      no -> BLOCK
    -> ALLOW
```

After execution:

```
proof required?
  yes
    external proof verified?
      no -> UNKNOWN/BLOCK completion
      yes -> VERIFIED
```

A tool may have executed while completion remains UNKNOWN. These are distinct states.

## 11. Prompt-injection boundary

All content obtained from files, web pages, retrieved chunks, tool results and MCP resources is untrusted DATA unless policy explicitly grants a stronger role.

Mitigations:

- treat external instructions as quoted data;
- narrow tool capabilities;
- schema-validate actions;
- require action-level policy approval;
- restrict destinations and resource scopes;
- keep secrets out of model context where possible;
- require human review for high-impact ambiguous actions;
- validate tool outputs before feeding them back into the model;
- never let retrieved content mutate policy registries directly.

Reference:
- https://openai.com/index/designing-agents-to-resist-prompt-injection/
- https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html

## 12. Security threat model

| Threat | Primary control |
| --- | --- |
| Policy tampering | signed/versioned bundles; hash verification |
| Audit tampering | append-only chain hash; remote retention |
| Replay | action nonce + task/action IDs + expiry |
| Credential leakage | secret redaction; no plaintext command logging |
| Malicious MCP/tool | allowlist, schema, trust label, least privilege |
| Memory poisoning | provenance + write authorization + review for critical memory |
| Hook bypass | canary + runtime version binding + config drift detection |
| Hook timeout | local-only critical evaluator; deny on missing/invalid local policy |
| Privilege escalation | capability scopes + OS/runtime permissions |
| Supply chain | pinned releases, CI, checksums/signatures, dependency minimization |

NIST AI RMF/GAI Profile is used as a governance reference, not as proof of product security:
- https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence

## 13. Privacy

Default collection is metadata-first:

Allowed by default:
- rule IDs and hashes;
- policy version/hash;
- runtime/version;
- tool name;
- redacted/fingerprinted argument metadata;
- verdict;
- proof type/status;
- timestamps.

Off by default:
- full conversations;
- plaintext secrets/tokens/API keys/private keys;
- complete file bodies;
- unredacted shell commands when a fingerprint is sufficient.

Retention is configurable by deployment; deletion and export must be explicit hosted-product capabilities.

## 14. Version and drift envelope

Every decision records:

```
productVersion
adapterVersion
runtimeName
runtimeVersion
modelName?
modelVersion?
policyVersion
policyHash
directiveSnapshotHash
skillSnapshotHash
toolRegistryHash
stateSnapshotHash
```

Drift classes:

- MODEL_DRIFT
- RUNTIME_DRIFT
- POLICY_DRIFT
- DIRECTIVE_DRIFT
- SKILL_DRIFT
- TOOL_DRIFT
- CONFIG_DRIFT
- HOOK_DRIFT
- PROOF_DRIFT

A version change is informational until a controlled property regresses. A canary regression is blocking for a runtime designated CRITICAL.

## 15. Evaluation plan

Unit/deterministic:
- directive precedence;
- policy conflicts;
- mandatory skill missing;
- required tool mismatch;
- forbidden tool;
- malformed arguments;
- route deviation;
- missing proof;
- invalid policy bundle;
- external content cannot elevate authority;
- hash-chain tamper detection.

Runtime contract:
- Claude PreToolUse deny canary;
- Copilot preToolUse deny canary;
- Codex per-version hook canary;
- API custom-tool block before execution;
- execution receipt read-back.

Adversarial:
- direct/indirect prompt injection;
- tool-result injection;
- memory poisoning;
- policy rewrite attempt;
- task objective substitution;
- fake execution success;
- UNKNOWN -> PASS laundering;
- long-output hiding of violations;
- timeout/failure;
- duplicate/replayed action;
- runtime upgrade.

Metrics:
- mandatory rule violation rate;
- silent critical violation rate;
- unsupported material claim rate;
- false execution claim rate;
- mandatory skill invocation rate;
- mandatory tool invocation rate;
- route deviation detection rate;
- policy conflict detection rate;
- false positive rate;
- false negative rate;
- UNKNOWN correctness rate;
- block correctness rate.

Primary target remains:

**SILENT CRITICAL VIOLATION RATE = 0 on surfaces under AGM authority.**

This target is valid only when the enforcement point is actually on the mandatory execution path and its runtime canary is currently passing.

## 16. Implementation sequence

### v0.2-alpha — deterministic enforcement core

Build now:
- policy schema and compiler for explicit deterministic rule forms;
- Directive / Skill / Tool registries;
- local policy evaluator;
- route guard;
- evidence/execution receipt verifier;
- hash-chained audit log;
- runtime hook adapter command for Claude/Copilot/Codex-compatible PreToolUse payloads;
- CLI commands to validate policy and evaluate a hook event;
- deterministic unit/adversarial tests;
- architecture/security documentation.

### v0.2-beta — API gateway

- OpenAI Responses/Agents adapter using owned custom tools;
- Gemini function-calling adapter;
- generic OpenAI-compatible gateway;
- output/claim validator;
- MCP gateway;
- optional central OPA/Rego PDP;
- signed policy bundles.

### v0.3 — organization control plane

- policy distribution;
- hosted audit retention;
- organization baselines;
- rollout gates;
- compatibility matrix;
- signed proof artifacts;
- web UI.

## 17. Completion rule

No surface is marked ENFORCED solely because configuration exists.

A surface may be:
- ENFORCED: blocking point is in mandatory path and current canary proves it;
- DETECTED: violation can be identified but not prevented;
- AUDITED: evidence is available only after action;
- UNKNOWN: current proof is insufficient;
- OUT_OF_AUTHORITY: no technical interception point is available.

This classification is the product contract.
