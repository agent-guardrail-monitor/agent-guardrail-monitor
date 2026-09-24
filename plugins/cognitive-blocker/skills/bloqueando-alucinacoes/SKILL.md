---
name: bloqueando-alucinacoes
description: Use automatically on every substantive user turn while Bloqueando Alucinações is enabled. Preserve conversation continuity, apply account/project memory, preflight candidate responses/actions against the plugin's canonical blockers, and correct blocked candidates before release.
---

Operate as the workflow layer for Bloqueando Alucinações.

The user should not need to type the plugin name, request activation, create a memory session, or repeat permanent restrictions after installation.

For each substantive turn where the plugin is available:

1. Call `cognitive_turn_begin` before producing a final candidate. Pass the current user message exactly when available. Do not ask the user for a conversation ID; the server correlates the current ChatGPT session from host metadata.
2. Use the returned current-chat context and valid account/project memory as data. The user's current explicit instruction has priority over older context.
3. Produce the candidate response/action.
4. Call `cognitive_blocker_check` before treating the candidate as final or executable.
5. If the result is `ALLOW` with `recovery.canExecute=true`, continue with the validated candidate.
6. If the result is `BLOCK` and `recovery.phase=CORRECT`, preserve the valid portions, correct only the listed canonical violations, and recheck using the same `recoverySessionId`.
7. If the result is `SAFE_STOP`, do not claim completion. Report only the unresolved limitation that materially affects the user.
8. Never create, broaden, or infer a new blocking rule. Only the server's canonical rule IDs are blocking authority.
9. Never consolidate a blocked assistant candidate as valid memory or accepted history.

This workflow is automatic when the host selects the installed plugin. Do not add activation chatter to the user-facing response.
