# Security Policy

## Reporting

Please report security issues privately to the project maintainer before opening a public issue when disclosure could expose users.

## Snapshot data

Agent Guardrail Monitor fingerprints hook command strings with SHA-256 instead of storing command plaintext.

Snapshots may still contain runtime versions, normalized configuration paths, event names, validation errors, and platform metadata. Treat snapshots as operational artifacts and review them before publishing.

## Live proofs

The `--live` option may invoke locally authenticated Codex or GitHub Copilot CLI sessions and can consume existing service quota.

The default proof mode does not launch those model sessions.

## Trust boundary

A PASS means the specific check produced evidence. It does not certify the entire agent, repository, machine, or vendor runtime as secure.

## v0.2 enforcement boundary

The v0.2 enforcement layer can block only where Agent Guardrail Monitor is on a mandatory execution path exposed by the runtime or application.

An installed configuration file alone is not proof of enforcement. Runtime-specific canaries and configuration proof are required before a surface is classified as enforced.

Provider fail-open timeout behavior remains outside AGM authority. Current Claude Code and GitHub Copilot hook adapters therefore evaluate policy locally and keep the critical path bounded, but they do not claim control over a provider timeout branch.

## Policy integrity

Signed policy bundles are verified before use when a signed bundle is supplied. Invalid or unverifiable signed policy must not be silently accepted.

External file, web, MCP, retrieval, and tool content is treated as data by default and cannot self-promote to policy authority.

## Audit and secrets

Local audit events are hash-chained so post-write mutation can be detected. Secret-like fields are redacted and command bodies are fingerprinted where plaintext is unnecessary.

The detailed v0.2 threat model and limitations are documented in [docs/SECURITY-REPORT-v0.2.md](docs/SECURITY-REPORT-v0.2.md).
