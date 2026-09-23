# Integrated Repair Engine — v0.3 alpha

Agent Guardrail Monitor v0.3 unifies guardrail detection, repair, and post-repair verification in one GitHub App and one hosted service.

## Closed-loop flow

```text
detect -> prove -> compare baseline/current -> diagnose -> patch -> verify -> PR -> checks -> merge (optional) -> re-verify
```

The monitor remains the source of failure evidence and the final verification authority. The repair engine is internal to the same product.

## Trigger

Automated repair is considered only when a push to the repository default branch introduces a new repairable regression relative to the immediately previous commit.

Examples include:

- a previously present hook event disappears;
- a supported guardrail configuration file is removed;
- a new static FAIL condition appears, such as declared hooks being disabled.

Pushes to repair branches do not recursively trigger another repair cycle.

## Repair context

The repair engine receives bounded repository context from both:

- the pre-regression commit; and
- the broken commit that triggered the monitor.

This prevents the repair model from guessing the previous approved state when restoring a removed control.

The context collector is intentionally narrow. It prioritizes supported guardrail configuration, hook files, and adjacent project documentation instead of sending the entire repository.

## Patch generation

The hosted repair model produces a structured repair plan containing:

- evidence-backed root cause;
- complete replacement contents for each changed file;
- reason for each change;
- suggested verification;
- recurrence review;
- residual risks.

The plan is rejected if it:

- has no root cause;
- changes more than eight files;
- exceeds per-file size limits;
- attempts path traversal or Git internals;
- attempts to change GitHub Actions workflow files.

The default hosted model is configurable with `AGM_REPAIR_MODEL`. The current default is `gpt-5.6-sol`. The OpenAI Responses API request uses `store: false`.

## GitHub mutation model

Repairs are never written directly to the default branch as the first action.

The engine:

1. anchors the repair to the exact broken commit;
2. creates an `agm/repair/...` branch;
3. applies the bounded patch;
4. re-runs AGM verification against the repair commit;
5. opens a pull request;
6. observes repository checks when available.

## Repair modes

Repository configuration may be stored in:

```text
.agent-guardrail-monitor/config.json
```

Default:

```json
{
  "repair": {
    "enabled": true,
    "mode": "pull_request",
    "waitForChecks": true
  }
}
```

Supported modes:

- `off`: detection and evidence only;
- `pull_request`: automatically create and verify a repair PR;
- `auto_merge`: after repair verification and non-failing repository checks, merge the repair PR and re-run AGM on the merged state.

`auto_merge` is never inferred from the absence of configuration. It must be explicitly configured.

## Final evidence rule

A repair is not reported as `VERIFIED FIX` merely because a patch was generated or a PR was opened.

The final gate requires:

- original failure evidence;
- root cause;
- changed files;
- recurrence review;
- passing post-patch executable verification;
- merged-state re-verification when auto-merge is used.

If those requirements are not satisfied, the state remains `PATCHED, NOT VERIFIED` or another lower evidence state.

## Required GitHub App permissions

The integrated repair workflow requires:

- Metadata: read;
- Contents: read/write;
- Checks: read/write;
- Pull requests: read/write.

Users must approve the GitHub permission update before the repair engine can create branches, write patches, or open pull requests.
