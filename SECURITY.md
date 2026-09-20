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