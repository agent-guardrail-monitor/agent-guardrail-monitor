# Internal Access Control

## Tenant boundary

The plugin uses `account_id` as the tenant boundary. A platform account and its plugin instance share one account scope.

Every project, memory item, approved decision, frozen element, task contract, guard event, feature flag, internal error report and recovery session carries that account identity.

PostgreSQL RLS reads `app.current_account_id` inside the active database transaction and refuses rows outside that tenant.

## RBAC matrix

| Capability | OWNER | ADMIN | MANAGER | CLIENT |
| --- | --- | --- | --- | --- |
| Read status | yes | yes | yes | yes |
| Run guard check | yes | yes | yes | yes |
| Read memory | yes | yes | yes | yes |
| Write memory | yes | yes | yes | no |
| Read feature state | yes | yes | yes | yes |
| Manage optional feature flags | yes | yes | no | no |
| Report internal errors | yes | yes | yes | yes |
| Read error history | yes | yes | no | no |
| Read audit history | yes | yes | no | no |
| Manage instance boundary | yes | no | no | no |

The installation token is created as `OWNER`. The matrix exists inside the plugin so future delegated access does not require an external authorization product.

## Required controls

These features are structural and cannot be disabled by feature flags:

- core blocking;
- tenant isolation;
- RBAC;
- database RLS;
- cognitive memory.

Optional features may be toggled per account while the required control plane remains active.


## Recovery-session isolation

`cognitive_recovery_sessions` is protected by forced PostgreSQL RLS.

A recovery session stores only control state needed for the correction loop:

- account/project scope;
- current phase;
- attempt counter;
- request fingerprints;
- last canonical violations;
- invalid resource identifiers.

The fixed maximum is three distinct attempts. Recovery state is internal and cannot be shared across accounts.


## Account-wide chat isolation

The installed account operates in `ALWAYS_ON` mode, but each platform chat keeps a separate episodic history.

RLS-protected tables:

- `cognitive_conversations`
- `cognitive_turns`

The composite foreign key `(conversation_id, account_id)` prevents a turn from being attached to a conversation owned by another account.

Assistant candidate content is accepted into `cognitive_turns` only with `accepted_source='ALLOW'`. Explicit user turns use `USER_EXPLICIT`.

Raw chat history is never automatically shared between chats. Cross-chat continuity comes from validated account memory, not from copying another chat's transcript.
