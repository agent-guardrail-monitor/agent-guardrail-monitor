# GitHub Marketplace Submission — Agent Guardrail Monitor

This document records the publication values for the official Agent Guardrail Monitor GitHub App.

## Product identity

- Product: **Agent Guardrail Monitor**
- GitHub App slug: `agent-guardrail-monitor`
- Repository: `agent-guardrail-monitor/agent-guardrail-monitor`
- Initial Marketplace plan: **Free**
- Current public distribution: `v0.2.0-alpha.3`
- Next Marketplace submission target: `v0.3.0-alpha.1`

## Positioning

Short description:

> Detect, prove, and repair AI coding-agent guardrail regressions.

Core value:

Agent Guardrail Monitor independently checks whether approved hooks, policies, and guardrail configuration still have evidence of working after changes to Claude Code, OpenAI Codex, GitHub Copilot CLI, repository configuration, or runtime state.

When a new repairable regression is proven on the default branch, the integrated repair engine can diagnose the change using bounded before/after repository context, create a dedicated repair branch, apply a structured patch, re-run verification, and open a pull request. Repositories may explicitly opt into automatic merge after verification.

PASS, FAIL, and UNKNOWN remain separate evidence states.

## Required GitHub App permissions for v0.3

- Metadata: read
- Contents: read/write
- Checks: read/write
- Pull requests: read/write

The write permissions are required for repair branches and pull requests. Existing installations must approve the permission update before automated repair can operate.

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

1. Attach the listing to the GitHub App **Agent Guardrail Monitor**, App ID `5007193`.
2. Use a **Free** initial plan.
3. Configure the Marketplace webhook as active, JSON content type, pointing to the production webhook URL.
4. Configure the GitHub App Setup URL to the production Setup URL.
5. Configure the GitHub App callback URL to the production OAuth callback URL.
6. Generate a GitHub App client secret and store it only as the Render secret environment variable `GITHUB_CLIENT_SECRET`.
7. The public Client ID is `Iv23lilPmMCpZGickCZN`.
8. Update the GitHub App permissions to the v0.3 permission set above and approve the update on the test installation.
9. Configure the hosted repair provider with `OPENAI_API_KEY`.
10. `AGM_REPAIR_MODEL` may override the default repair model.
11. Use the production privacy, EULA, terms, and support URLs.
12. Supply the publisher contact email in GitHub's listing form.
13. Upload the required listing logo, feature card, and product screenshots.
14. Accept the GitHub Marketplace Developer Agreement under the publishing account.
15. Request publication only after OAuth, webhook handling, repair branch creation, PR creation, verification, and permission updates are proven in production.

## Repair defaults

The default repository behavior is:

```json
{
  "repair": {
    "enabled": true,
    "mode": "pull_request",
    "waitForChecks": true,
    "allowWorkflowChanges": false
  }
}
```

The repository may use `.agent-guardrail-monitor/config.json` to select:

- `off`
- `pull_request`
- `auto_merge`

Automatic merge is never inferred from missing configuration.

See [Integrated Repair Engine — v0.3](REPAIR-ENGINE-v0.3.md).

## Scope boundary

The initial Marketplace plan is free. The v0.3 alpha provides automated repair for guardrail regressions within the evidence and repository surfaces supported by Agent Guardrail Monitor.

The repair engine is intentionally bounded. It does not claim arbitrary unrestricted code modification across unrelated repository areas, and workflow-file mutation is blocked unless explicitly allowed.

Paid plans require a separate billing and entitlement implementation before activation.

## OAuth runtime configuration

Required production secret:

- `GITHUB_CLIENT_SECRET`: generated from the official Agent Guardrail Monitor GitHub App settings.

Optional overrides:

- `GITHUB_CLIENT_ID`: defaults to the verified public client ID above.
- `GITHUB_OAUTH_CALLBACK_URL`: defaults to the production callback URL above.
- `GITHUB_OAUTH_STATE_SECRET`: optional dedicated signing secret; if omitted, the existing GitHub webhook secret is used for OAuth state signing.

The setup flow uses signed state, PKCE, a Secure/HttpOnly/SameSite=Lax transaction cookie, and verifies the installation through the authorized user's GitHub App installation endpoint. User access tokens are not persisted by the flow.
