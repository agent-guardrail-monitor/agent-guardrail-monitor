# Agent Guardrail Monitor

**Did an AI coding-agent upgrade silently turn off your guardrails?**

Agent Guardrail Monitor is a vendor-neutral CLI that snapshots the controls around Claude Code, OpenAI Codex, and GitHub Copilot CLI, then fails CI when a later runtime or configuration state loses a control that previously existed.

It treats **PASS**, **FAIL**, and **UNKNOWN** as different states. A missing proof is never promoted to PASS.

## The problem

Coding agents update quickly. Their hook schemas, trust models, event names, settings layers, and runtime behavior can change between versions.

A configuration file can still exist while the protection behind it is no longer active.

Agent Guardrail Monitor creates a baseline and compares later states against it.

```text
Claude Code  2.1.263 -> 2.1.264
PreToolUse   present  -> missing

Gate verdict: FAIL
REGRESSION: HOOK_EVENT_REMOVED
```

## Current support

| Runtime | Static inspection | Runtime canary |
| --- | --- | --- |
| Claude Code | Yes | Implemented; requires a local Claude Code CLI to validate |
| OpenAI Codex | Yes | Experimental live canary |
| GitHub Copilot CLI | Yes | Experimental live canary |

Static inspection never calls a model and is covered by the automated v0.1 test suite.

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

The planned npm package name is `agent-guardrail-monitor`; availability was checked before this release, but the name is not reserved until publication.

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

### `agm doctor`

Detects supported CLIs and known configuration locations. It validates JSON, fingerprints hook commands without storing their plaintext, and reports controls whose activation cannot be proven statically.

```bash
agm doctor
agm doctor --json
agm doctor --cwd /path/to/repository
```

### `agm prove`

Runs synthetic canaries. Live runtime canaries are an experimental v0.1 surface until validated across installed vendor CLI versions.

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
      - run: npm install -g agent-guardrail-monitor
      - run: agm gate --baseline .agent-guardrail-monitor/baseline.json
```

For agent-runtime upgrades, run this job in an environment where the candidate CLI is installed.

## Why vendor-neutral

Each agent vendor can improve its own diagnostics. Organizations still need one independent answer across a mixed fleet:

> Did the controls we approved yesterday still execute after today's runtime change?

Agent Guardrail Monitor is designed around that question.

## Scope of v0.1

This release is intentionally narrow.

It verifies known hook/config surfaces and regression state. It is not a general LLM benchmark, prompt evaluator, malware scanner, policy authoring language, or substitute for the vendor's own security controls.

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

No runtime dependencies are required in v0.1.

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT.