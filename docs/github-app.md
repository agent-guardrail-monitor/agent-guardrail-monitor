# GitHub App

The Agent Guardrail Monitor GitHub App performs a vendor-neutral static scan of supported coding-agent guardrail configuration stored in a repository.

## Current repository permissions

- **Contents:** Read-only
- **Metadata:** Read-only
- **Checks:** Read and write

## Event subscription

- **Push**

On each push, the App reads supported configuration files and publishes an **Agent Guardrail Monitor** check on the new commit.

## Evidence states

- **PASS** — supported guardrail configuration was found and no static failure or unresolved runtime condition was detected.
- **FAIL** — a broken or invalid control was observed.
- **UNKNOWN** — repository evidence is insufficient to claim success.

The App does not request write access to repository contents.
