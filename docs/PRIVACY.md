# Agent Guardrail Monitor Privacy Policy

Effective date: September 23, 2026

Agent Guardrail Monitor processes information required to provide guardrail verification, GitHub checks, automated repair, webhook handling, Marketplace setup, and MCP decision services.

## GitHub App data

The integrated GitHub App requires Metadata read, Contents read/write, Checks read/write, and Pull requests read/write permissions.

Repository content is read to inspect supported guardrail configuration, compare the pre-regression and broken states, produce verification results, and, when repair is enabled, create a bounded repair branch and pull request.

The hosted application does not maintain repository file contents as a customer document database. Repository changes created by the repair engine are stored by GitHub as ordinary commits and pull requests.

## Automated repair model processing

When a repairable regression is detected and repair is enabled, Agent Guardrail Monitor first attempts deterministic baseline restoration using the immediately previous approved guardrail state. This path does not require sending repository context to an external model.

If deterministic restoration is unavailable and an optional OpenAI API fallback is configured, the fallback receives relevant failure evidence plus selected before/after repository files needed to diagnose the regression. It does not intentionally receive the entire repository.

Fallback OpenAI Responses API requests are made with `store: false`. OpenAI infrastructure and account-level data controls remain governed by the OpenAI API terms and the data controls configured for the service account.

## Repair behavior

The default repair mode creates a dedicated `agm/repair/...` branch and pull request. Automatic merge occurs only when the repository explicitly selects `auto_merge` and the repair satisfies the configured verification gates.

## Marketplace data

When GitHub Marketplace sends a `marketplace_purchase` webhook, Agent Guardrail Monitor records a minimal operational summary containing the event action, GitHub account ID and type, plan ID and name, billing cycle, unit count, and relevant effective or billing dates. The handler intentionally excludes account login names and email addresses from its application log summary.

## GitHub OAuth

For Marketplace installation setup, Agent Guardrail Monitor uses GitHub's OAuth web application flow to verify the GitHub user and confirm that the supplied installation ID is accessible to that authorized user.

OAuth state is signed, PKCE is used, and the user access token is used only during the callback verification request. The application does not retain that user access token after the request completes.

## MCP data

The hosted MCP endpoint transiently processes the inputs required to evaluate policy, skills, tools, evidence, integrated repair state, and final verification decisions. The application code does not persist MCP evaluation payloads as customer records.

## Operational metadata

Hosting and network providers may retain ordinary request, security, availability, and diagnostic metadata according to their own infrastructure policies.

## Data sales

Agent Guardrail Monitor does not sell user data.

## Support and privacy requests

Use the public support channel at:

https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/issues
