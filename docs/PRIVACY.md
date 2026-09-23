# Agent Guardrail Monitor Privacy Policy

Effective date: September 23, 2026

Agent Guardrail Monitor processes only the information required to provide guardrail verification, GitHub checks, webhook handling, and MCP decision services.

## GitHub App data

The GitHub App currently requests Contents read, Metadata read, and Checks read/write permissions. Repository content is read only to inspect supported guardrail configuration and generate verification results. The application code does not persist repository file contents as a customer database.

## Marketplace data

When GitHub Marketplace sends a `marketplace_purchase` webhook, Agent Guardrail Monitor records a minimal operational summary containing the event action, GitHub account ID and type, plan ID and name, billing cycle, unit count, and relevant effective or billing dates. The handler intentionally excludes account login names and email addresses from its application log summary.

## GitHub OAuth

For Marketplace installation setup, Agent Guardrail Monitor uses GitHub's OAuth web application flow to verify the GitHub user and confirm that the supplied installation ID is actually accessible to that authorized user. OAuth state is signed, PKCE is used, and the user access token is used only during the callback verification request. The application does not retain that user access token after the request completes.

## MCP data

The hosted MCP endpoint transiently processes the inputs required to evaluate policy, skills, tools, evidence, and repair handoff decisions. The application code does not persist MCP evaluation payloads.

## Operational metadata

Hosting and network providers may retain ordinary request, security, availability, and diagnostic metadata according to their own infrastructure policies.

## Data sales

Agent Guardrail Monitor does not sell user data.

## Support and privacy requests

Use the public support channel at:

https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/issues
