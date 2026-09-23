# Agent Guardrail Monitor

**Detect, prove, and repair AI coding-agent guardrail regressions.**

Agent Guardrail Monitor is a vendor-neutral GitHub App and CLI that verifies controls around Claude Code, OpenAI Codex, and GitHub Copilot CLI, proves regressions against prior evidence, and in v0.3-alpha adds an integrated closed-loop repair engine that can diagnose supported guardrail regressions, create a bounded repair branch, apply a structured patch, re-run verification, and open a pull request. Repositories can explicitly opt into verified auto-merge.

**Free GitHub App:** [Install Agent Guardrail Monitor](https://github.com/apps/agent-guardrail-monitor)

The v0.3 GitHub App requires **Metadata: read**, **Contents: read/write**, **Checks: read/write**, and **Pull requests: read/write**. On each push it publishes an **Agent Guardrail Monitor** check. Write permissions are used only for the integrated repair workflow: a dedicated `agm/repair/...` branch and pull request by default.

It treats **PASS**, **FAIL**, and **UNKNOWN** as different states. A missing proof is never promoted to PASS.

## The problem

Coding agents update quickly. Their hook schemas, trust models, event names, settings layers, and runtime behavior can change between versions.

A configuration file can still exist while the protection behind it is no longer active.

Agent Guardrail Monitor creates a baseline and compares later states against it.

## v0.2-alpha enforcement

The enforcement layer is external to the model. It includes:

- versioned Directive, Memory, Skill, Tool, Task State and Policy registries;
- a conservative Instruction Compiler that refuses to activate unvalidated natural-language directives;
- Memory Resolver, Skill Resolver and Tool Router;
- deterministic Policy Engine with `ALLOW`, `BLOCK`, `REQUIRE_REVIEW` and `UNKNOWN`;
- Route Guard;
- Evidence Gate and Execution Verifier;
- Output Validator;
- Drift Monitor;
- tamper-evident hash-chained local audit log;
- local `PreToolUse` adapters for Claude Code and GitHub Copilot;
- a generic controlled-execution gateway primitive for application-owned tool loops.

Install enforcement into a project:

```bash
agm install-hook --runtime claude
agm install-hook --runtime copilot
```

Codex installation intentionally returns `UNKNOWN` until the exact runtime/version blocking path has current proof.

See [Enforcement installation](docs/INSTALL-ENFORCEMENT-v0.2.md) and [Architecture](docs/ARCHITECTURE-ENFORCEMENT-v0.2.md).

## ChatGPT MCP app

v0.3.0-alpha.1 extends the remote MCP app at `https://agent-guardrail-monitor.onrender.com/mcp` with the integrated repair protocol.

It exposes AGM policy gates plus `agm_prepare_repair`, `agm_repair_preflight`, and `agm_validate_repair`. The legacy `agm_prepare_repair_handoff` name remains only as a compatibility alias; its consumer is the integrated AGM repair engine.

The ChatGPT integration reports `AVAILABLE_WHEN_INVOKED`: it produces deterministic decisions whenever the host calls AGM, while ordinary ChatGPT turns outside the MCP call path remain outside AGM authority. See [ChatGPT app installation](docs/INSTALL-CHATGPT-APP.md).

### Integrated repair engine

In v0.3, repair is part of Agent Guardrail Monitor itself. There is no separate operational product in the repair path.

```text
detect -> prove -> compare baseline/current -> diagnose -> patch -> verify -> PR -> checks -> merge (optional) -> re-verify
```

For a repair-triggering default-branch regression, AGM captures the exact pre-regression commit and the broken commit, sends only bounded relevant context to the configured repair model, validates a structured patch, writes changes to an `agm/repair/...` branch, re-runs the original guardrail evidence check, and opens a pull request.

The default mode is `pull_request`. A repository must explicitly configure `auto_merge` before AGM may merge a verified repair automatically.

```json
{
  "repair": {
    "enabled": true,
    "mode": "pull_request",
    "waitForChecks": true
  }
}
```

Configuration lives at `.agent-guardrail-monitor/config.json`. Workflow-file mutation is blocked in v0.3 alpha. A repair is never released as `VERIFIED FIX` from model output alone; AGM requires executable post-patch evidence and, for auto-merge, re-verifies the merged state.

The hosted repair provider uses the OpenAI Responses API with `store: false`. The default model is `gpt-5.6-sol`, configurable with `AGM_REPAIR_MODEL`. See [Integrated Repair Engine — v0.3](docs/REPAIR-ENGINE-v0.3.md).

## Current support

| Runtime | Static inspection | Runtime canary |
| --- | --- | --- |
| Claude Code | Yes | Implemented; requires a local Claude Code CLI to validate |
| OpenAI Codex | Yes | Experimental live canary |
| GitHub Copilot CLI | Yes | Experimental live canary |

Static inspection never calls a model and is covered by the automated test suite.

### Enforcement surface status

| Surface | Pre-action block | Current AGM status |
| --- | --- | --- |
| Claude Code `PreToolUse` command hook | Vendor supports deny/block | Adapter + installer implemented; provider timeout path is fail-open |
| GitHub Copilot `preToolUse` command hook | Vendor supports deny/block | Adapter + installer implemented; provider timeout path is fail-open |
| OpenAI application-owned function tools | Controllable in owned orchestration path | Generic gateway primitive implemented; provider-specific beta adapter pending |
| Gemini application-owned function calling | Client executes function | Generic gateway primitive implemented; provider-specific beta adapter pending |
| Codex | Version/path dependent | `UNKNOWN` for enforcement installation until a current blocking canary passes |
| Ordinary ChatGPT plugin/app surface | No universal interception API established | Integration surface only; not represented as a universal enforcement boundary |

The live canary code is included for early adopters, but it has not been executed on the current release machine because those vendor CLIs are not installed there. Codex and Copilot live proof also requires `--live` because a real CLI session may consume the user's existing service quota.

## Install

Requires Node.js 20 or newer.

Install directly from GitHub:

```bash
npm install -g github:agent-guardrail-monitor/agent-guardrail-monitor
agm doctor
```

From a local checkout:

```bash
npm install
npm link
agm doctor
```

The public distribution installs directly from GitHub. An npm publication is not required; v0.3-alpha remains a pre-release until its release tag is published.

## Fast path

Inspect the current repository and user-level configuration:

```bash
agm doctor
```

Create the approved baseline:

```bash
agm baseline --prove
```

Later, after an agent upgrade or configuration change:

```bash
agm gate --baseline .agent-guardrail-monitor/baseline.json --prove
```

A detected regression exits non-zero and can block CI or rollout.

## Commands

### `agm install-hook`

Installs the local enforcement point without replacing unrelated runtime configuration:

```bash
agm install-hook --runtime claude
agm install-hook --runtime copilot
agm install-hook --runtime codex
```

Claude and Copilot return an installation record. Codex returns `UNKNOWN` in v0.2-alpha.

### `agm policy`

Validates, compiles, or evaluates structured policy:

```bash
agm policy validate --file policy.json
agm policy compile --file directive.json
agm policy check --file policy.json --event event.json
```

### `agm hook`

Runtime hook entry point. It reads the vendor event from stdin and returns the vendor-specific decision JSON.

```bash
agm hook --runtime claude --policy policy.json
agm hook --runtime copilot --policy policy.json
```

A missing or unreadable policy causes a deny response instead of an allow.

### `agm doctor`

Detects supported CLIs and known configuration locations. It validates JSON, fingerprints hook commands without storing their plaintext, and reports controls whose activation cannot be proven statically.

```bash
agm doctor
agm doctor --json
agm doctor --cwd /path/to/repository
```

### `agm prove`

Runs synthetic canaries. Live runtime canaries remain an experimental surface and must be validated against the exact installed vendor CLI version.

```bash
agm prove
agm prove --live
```

Without `--live`, Codex and Copilot remain UNKNOWN rather than spending model quota.

### `agm baseline`

Stores the current approved state:

```bash
agm baseline --prove
```

Default output:

```text
.agent-guardrail-monitor/baseline.json
```

Commit the baseline only if your organization wants it versioned. Review it first like any security artifact.

### `agm snapshot`

Writes a point-in-time snapshot:

```bash
agm snapshot --out current.json
```

### `agm diff`

Compares two stored snapshots:

```bash
agm diff baseline.json candidate.json
```

### `agm gate`

Compares the current environment with an approved baseline and exits with status 1 on regression:

```bash
agm gate --baseline baseline.json
```

For runtime proof:

```bash
agm gate --baseline baseline.json --prove --live
```

When the local gate fails, AGM writes an integrated repair request to:

```text
.agent-guardrail-monitor/repair-request.json
```

Use `--repair-request FILE` to choose another path. The legacy `--repair-handoff` flag remains accepted for compatibility. The local artifact captures failure evidence for the integrated repair protocol; the hosted GitHub App can execute the closed-loop repair workflow when the required permissions and repair provider are configured.

## What currently fails the gate

Version 0.1 detects these regression classes:

- a previously installed supported runtime disappears;
- a known hook/config file disappears;
- a previously valid configuration becomes invalid;
- a hook event present in the baseline disappears;
- a new static FAIL finding appears;
- a runtime proof that was PASS becomes FAIL or UNKNOWN.

A runtime version change alone is informational. The product asks whether controls regressed, not whether software merely changed.

## Evidence model

Agent Guardrail Monitor deliberately distinguishes:

**PASS** — execution or static evidence supports the claim.

**FAIL** — a broken control or regression was observed.

**UNKNOWN** — evidence is insufficient. This includes missing CLIs, blocked trust, missing authentication, unavailable network access, or a live proof that was not requested.

This prevents the most dangerous failure mode for a security gate: claiming success because nothing visibly crashed.

## Configuration privacy

Snapshots store SHA-256 fingerprints of hook commands rather than raw command text.

Agent Guardrail Monitor does not upload repository content in the open-source CLI.

Live Codex/Copilot canaries invoke the locally installed CLI only when the user explicitly passes `--live`.

## CI example

```yaml
name: agent-guardrail-monitor

on:
  pull_request:
  workflow_dispatch:

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g github:agent-guardrail-monitor/agent-guardrail-monitor
      - run: agm gate --baseline .agent-guardrail-monitor/baseline.json
```

For agent-runtime upgrades, run this job in an environment where the candidate CLI is installed.

## Why vendor-neutral

Each agent vendor can improve its own diagnostics. Organizations still need one independent answer across a mixed fleet:

> Did the controls we approved yesterday still execute after today's runtime change?

Agent Guardrail Monitor is designed around that question.

## Scope of v0.2-alpha

The v0.1 regression monitor remains intact. v0.2-alpha adds deterministic enforcement components and project-level hook installation for Claude Code and Copilot.

The alpha does not claim universal control over closed model runtimes. A surface is only called enforced when AGM is actually in the mandatory execution path and the relevant runtime behavior is currently proven. Provider fail-open timeout branches, provider-hosted tools outside AGM's broker, and inaccessible internal memory/runtime behavior remain outside full AGM authority.

## Roadmap

The commercial direction is an organization-level release gate:

- test matrices across runtime versions and operating systems;
- automatic detection of new Claude Code, Codex, and Copilot CLI releases;
- organization baselines across repositories;
- GitHub Checks and pull-request evidence;
- rollout approval/block decisions;
- historical compatibility matrix;
- signed proof artifacts and audit retention.

The local CLI remains useful by itself. The hosted layer is where continuous release monitoring and organization-wide evidence fit.

## Development

```bash
npm test
node ./bin/agent-guardrail-monitor.mjs doctor
```

The ChatGPT MCP app adds runtime dependencies on the official MCP server/node packages and Zod; `npm ci` installs the pinned dependency graph used by CI and deployment.

## Security

See [SECURITY.md](SECURITY.md), [v0.2 security report](docs/SECURITY-REPORT-v0.2.md), and [v0.2 red-team report](docs/RED-TEAM-v0.2.md).

## License

MIT.