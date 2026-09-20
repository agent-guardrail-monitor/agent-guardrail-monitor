# Enforcement installation — v0.2 alpha

Agent Guardrail Monitor v0.2 adds a local deterministic policy evaluator that can sit on a runtime's pre-tool execution path.

## Install the CLI

Requires Node.js 20 or newer.

```bash
npm install -g github:agent-guardrail-monitor/agent-guardrail-monitor
agm doctor
```

When testing the unmerged alpha branch directly:

```bash
npm install -g github:agent-guardrail-monitor/agent-guardrail-monitor#enforcement-v0.2
```

## Install a project enforcement hook

Run from the project root:

```bash
agm install-hook --runtime claude
agm install-hook --runtime copilot
```

The installer creates `.agent-guardrail-monitor/policy.json` from the shipped strict example only when no local policy exists.

Claude Code:
- merges an AGM `PreToolUse` handler into `.claude/settings.json`;
- preserves unrelated existing settings/hooks;
- rerunning the installer is idempotent for the AGM handler.

GitHub Copilot:
- writes the dedicated `.github/hooks/agent-guardrail-monitor.json`;
- uses a local command hook so policy evaluation does not require a remote network request.

Codex:

```bash
agm install-hook --runtime codex
```

returns `UNKNOWN` and makes no enforcement configuration change until the exact installed Codex runtime/version has a proven blocking path.

## Use an explicit policy

```bash
agm install-hook --runtime claude --policy ./policy/company.json
agm install-hook --runtime copilot --policy ./policy/company.json
```

Validate before activation:

```bash
agm policy validate --file ./policy/company.json
```

## Policy decisions

Pre-action decisions are `ALLOW`, `BLOCK`, `REQUIRE_REVIEW`, and `UNKNOWN`.

Strict mode blocks a critical unmatched action. An invalid strict policy also blocks.

A matching `REQUIRE_TOOL` rule blocks when the proposed tool differs from the required tool.

A matching `REQUIRE_SKILL` rule blocks when the required skill is not loaded or its required execution proof is absent.

Conflicting mandatory rules return `REQUIRE_REVIEW`.

## Runtime output behavior

Claude Code `PreToolUse` receives the tool payload on stdin. A denial is returned using Claude's `hookSpecificOutput.permissionDecision = "deny"` object.

Copilot `preToolUse` receives its tool payload on stdin. A denial is returned using `permissionDecision = "deny"`.

An AGM `ALLOW` emits `{}` so the vendor's normal permission flow still applies. AGM does not turn an allow-policy decision into a permission bypass.

## Important provider boundary

Current Claude Code documentation states that `PreToolUse` command hooks can block tool calls, but a command/http/MCP hook that times out does not block the call; it continues to the normal permission flow.

Current GitHub Copilot documentation likewise states that `preToolUse` command-hook errors deny, while hook timeouts are fail-open.

For that reason AGM:
- evaluates critical policy locally rather than depending on a remote HTTP call;
- keeps the policy path deterministic and small;
- records provider timeout semantics as an external enforcement limitation;
- does not claim that the provider's timeout branch is under AGM authority.

References:
- https://code.claude.com/docs/en/hooks
- https://docs.github.com/en/copilot/reference/hooks-reference

## Validate current state

```bash
agm doctor
agm baseline --prove
agm gate --baseline .agent-guardrail-monitor/baseline.json --prove
```

Live vendor runtime proof remains separate from static configuration proof. If proof is unavailable, the state remains `UNKNOWN`.

## Remove

AGM does not yet provide an automated uninstall command in v0.2-alpha.

To remove the alpha enforcement hook:
- Claude: remove only the AGM command handler from `.claude/settings.json`.
- Copilot: delete `.github/hooks/agent-guardrail-monitor.json`.
- Keep or delete `.agent-guardrail-monitor/policy.json` according to your policy-retention requirements.

Automated uninstall should only be added once it can prove that it is removing the AGM-owned entry and nothing else.
