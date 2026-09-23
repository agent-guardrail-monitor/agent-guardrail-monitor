# GitHub App

The Agent Guardrail Monitor GitHub App performs vendor-neutral guardrail verification and, in v0.3, integrated repair of supported default-branch guardrail regressions.

## Install

https://github.com/apps/agent-guardrail-monitor

## v0.3 repository permissions

- **Metadata:** Read-only
- **Contents:** Read and write
- **Checks:** Read and write
- **Pull requests:** Read and write

Contents and pull-request write access are used by the integrated repair engine to create a dedicated `agm/repair/...` branch, apply a bounded patch, and open a pull request. The default mode does not merge automatically.

Existing installations must approve the permission update before v0.3 repair actions can operate.

## Event subscriptions

### GitHub App webhook

- **Push**
- **Check suite** when requested or rerequested

On supported repository events, the App reads supported configuration files and publishes an **Agent Guardrail Monitor** check on the target commit.

For a push to the default branch, AGM compares the immediately previous commit with the pushed commit. A new repairable regression may trigger the integrated repair cycle.

Pushes to repair branches are monitored but do not recursively start another repair cycle.

### GitHub Marketplace webhook

The Marketplace listing must deliver `marketplace_purchase` events to the production `/webhook` endpoint. The server validates GitHub's webhook signature, accepts lifecycle actions, and records only a minimal operational summary. Account login names and email addresses are deliberately excluded from that summary.

## Supported guardrail configuration surfaces

- `.claude/settings.json`
- `.claude/settings.local.json`
- `.codex/hooks.json`
- `.codex/config.toml`
- `.github/hooks/*.json`

The hosted repair context may also include bounded adjacent project documentation such as `AGENTS.md`, `CLAUDE.md`, `package.json`, and `README.md` when needed to interpret the detected regression.

## Evidence states

- **PASS** — supported evidence does not show a failing control.
- **FAIL** — a broken or invalid control was observed.
- **UNKNOWN** — repository evidence is insufficient to claim success.

A missing proof is never promoted to PASS.

## Integrated repair behavior

The default repository repair mode is `pull_request`.

A repository may configure repair behavior in:

```text
.agent-guardrail-monitor/config.json
```

Supported modes:

- `off`
- `pull_request`
- `auto_merge`

`auto_merge` must be explicitly configured. It is allowed only after the repair branch passes AGM verification and does not have failing repository checks. AGM then re-verifies the merged state.

See [Integrated Repair Engine — v0.3](REPAIR-ENGINE-v0.3.md).

## Marketplace endpoints

Production base URL: `https://agent-guardrail-monitor.onrender.com`

- Setup URL: `/setup`
- OAuth callback: `/oauth/callback`
- Privacy policy: `/privacy`
- Terms: `/terms`
- EULA: `/eula`
- Support: `/support`
- Webhook: `/webhook`
- Health: `/health`
- MCP: `/mcp`

The initial Marketplace plan is intended to be **Free**. Paid-plan handling remains outside the current alpha scope.

## Marketplace publication note

The Marketplace listing itself is configured in GitHub's publisher interface. The production webhook URL, Setup URL, legal/support URLs, plan, listing copy, images, publisher contact information, and v0.3 permission update must be attached to the **Agent Guardrail Monitor** GitHub App before requesting publication.
