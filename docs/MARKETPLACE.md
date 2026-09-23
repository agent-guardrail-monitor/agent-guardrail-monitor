# GitHub Marketplace Submission — Agent Guardrail Monitor

This document records the publication values for the official Agent Guardrail Monitor GitHub App.

## Product identity

- Product: **Agent Guardrail Monitor**
- GitHub App slug: `agent-guardrail-monitor`
- Repository: `agent-guardrail-monitor/agent-guardrail-monitor`
- Initial Marketplace plan: **Free**
- Current public distribution: `v0.2.0-alpha.3`

## Positioning

Short description:

> Verify AI coding-agent guardrails after runtime and configuration changes.

Core value:

Agent Guardrail Monitor independently checks whether approved hooks, policies, and guardrail configuration still have evidence of working after changes to Claude Code, OpenAI Codex, GitHub Copilot CLI, repository configuration, or runtime state. Results preserve PASS, FAIL, and UNKNOWN as separate evidence states.

## Production URLs

- Homepage: `https://agent-guardrail-monitor.onrender.com/`
- Setup URL: `https://agent-guardrail-monitor.onrender.com/setup`
- Privacy: `https://agent-guardrail-monitor.onrender.com/privacy`
- Terms: `https://agent-guardrail-monitor.onrender.com/terms`
- EULA: `https://agent-guardrail-monitor.onrender.com/eula`
- Support: `https://agent-guardrail-monitor.onrender.com/support`
- OAuth callback: `https://agent-guardrail-monitor.onrender.com/oauth/callback`
- Marketplace webhook: `https://agent-guardrail-monitor.onrender.com/webhook`

## Listing configuration

1. Attach the listing to the GitHub App **Agent Guardrail Monitor**.
2. Use a **Free** initial plan.
3. Configure the Marketplace webhook as active, JSON content type, pointing to the production webhook URL.
4. Configure the GitHub App Setup URL to the production Setup URL.
5. Configure the GitHub App callback URL to the production OAuth callback URL.
6. Generate a GitHub App client secret and store it only as the Render secret environment variable `GITHUB_CLIENT_SECRET`.
7. The public Client ID is `Iv23lilPmMCpZGickCZN`. The server also accepts `GITHUB_CLIENT_ID`, but defaults to that verified public value.
8. Use the production privacy, EULA, terms, and support URLs.
9. Supply the publisher contact email in GitHub's listing form. This repository does not publish a personal contact email by default.
10. Add the required listing logo, feature card, and product screenshots.
11. Accept the GitHub Marketplace Developer Agreement under the publishing account.
12. Request publication only after the production deployment, OAuth flow, and webhook behavior are verified.

## Scope boundary

The initial Marketplace plan is free. This release records Marketplace purchase/change/cancellation webhook metadata for lifecycle observability but does not implement paid billing entitlements. Paid plans require a separate billing/entitlement implementation and validation before activation.


## OAuth runtime configuration

Required production secret:
- `GITHUB_CLIENT_SECRET`: generated from the official Agent Guardrail Monitor GitHub App settings.

Optional overrides:
- `GITHUB_CLIENT_ID`: defaults to the verified public client ID above.
- `GITHUB_OAUTH_CALLBACK_URL`: defaults to the production callback URL above.
- `GITHUB_OAUTH_STATE_SECRET`: optional dedicated signing secret; if omitted, the existing GitHub webhook secret is used for OAuth state signing.

The setup flow uses signed state, PKCE, a Secure/HttpOnly/SameSite=Lax transaction cookie, and verifies the installation through the authorized user's GitHub App installation endpoint. User access tokens are not persisted by the flow.
