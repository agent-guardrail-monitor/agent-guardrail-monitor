# GitHub App

The Agent Guardrail Monitor GitHub App performs a vendor-neutral static scan of supported coding-agent guardrail configuration stored in a repository.

## Install

https://github.com/apps/agent-guardrail-monitor

## Current repository permissions

- **Contents:** Read-only
- **Metadata:** Read-only
- **Checks:** Read and write

## Event subscriptions

### GitHub App webhook

- **Push**
- **Check suite** when requested or rerequested

On each supported repository event, the App reads supported configuration files and can publish an **Agent Guardrail Monitor** check on the target commit.

### GitHub Marketplace webhook

The Marketplace listing must deliver `marketplace_purchase` events to the production `/webhook` endpoint. The server validates GitHub's webhook signature, accepts `purchased`, `changed`, and `cancelled` actions, and records only a minimal operational summary. Account login names and email addresses are deliberately excluded from that summary.

## Supported configuration surfaces

- `.claude/settings.json`
- `.codex/hooks.json`
- `.codex/config.toml`
- `.github/hooks/*.json`

## Evidence states

- **PASS** — supported guardrail configuration was found and no static failure or unresolved runtime condition was detected.
- **FAIL** — a broken or invalid control was observed.
- **UNKNOWN** — repository evidence is insufficient to claim success.

A missing proof is never promoted to PASS.

The App does not request write access to repository contents.


## Marketplace endpoints

Production base URL: `https://agent-guardrail-monitor.onrender.com`

- Setup URL: `/setup`
- Privacy policy: `/privacy`
- Terms: `/terms`
- EULA: `/eula`
- Support: `/support`
- Webhook: `/webhook`
- Health: `/health`

The initial Marketplace plan is intended to be **Free**. Paid-plan handling is outside the current alpha scope and must not be enabled until billing behavior has separate validation.

## Marketplace publication note

The Marketplace listing itself is configured in GitHub's publisher interface. The production webhook URL, Setup URL, legal/support URLs, plan, listing copy, images, and publisher contact information must be attached to the **Agent Guardrail Monitor** GitHub App before requesting publication.
