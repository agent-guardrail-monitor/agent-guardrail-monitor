# Agent Guardrail Monitor End User License Agreement

Effective date: September 23, 2026

This End User License Agreement governs use of the Agent Guardrail Monitor GitHub App, hosted service, CLI, integrated repair engine, and related integration surfaces.

## License

Subject to this agreement and the repository license, users may install and use Agent Guardrail Monitor for guardrail verification, policy evaluation, CI checks, supported enforcement workflows, and automated repair of supported guardrail regressions.

## Pre-release status

Version 0.3 is pre-release software. Supported surfaces, repair scope, and enforcement guarantees are limited to the capabilities explicitly documented for the installed version.

## Automated repair

When repair is enabled, Agent Guardrail Monitor may create a dedicated repair branch, write a bounded patch, and open a pull request in an installed repository using the GitHub permissions approved by the repository owner.

The default repair mode creates a pull request and does not merge it automatically.

Automatic merge occurs only when the repository explicitly configures `auto_merge` and the repair satisfies the applicable verification gates and repository checks.

## User responsibilities

Users are responsible for reviewing their runtime permissions, repository configuration, deployment boundaries, branch protection, security requirements, and repair-mode configuration.

A PASS result applies only to the evidence and controls evaluated by the product. UNKNOWN means evidence is insufficient and must not be treated as PASS.

Users remain responsible for reviewing changes appropriate to their development and production governance, particularly when automatic merge is enabled.

## External model processing

The hosted repair engine may use a configured OpenAI API model to analyze bounded failure evidence and relevant before/after repository context and to propose a structured repair patch. See the Privacy Policy for data-processing details.

## Availability

The hosted service is provided on a best-effort basis during the alpha period. Features may change as runtime vendors change hooks, permissions, trust models, or APIs.

## Warranty and liability

To the maximum extent allowed by applicable law, the software and hosted service are provided without warranties beyond those expressly required by law. The open-source components remain subject to the MIT License included in the repository.

## Termination

Users may stop using the service and uninstall the GitHub App at any time. Marketplace plan changes and cancellations are handled through GitHub Marketplace when applicable.

## Support

https://github.com/agent-guardrail-monitor/agent-guardrail-monitor/issues
