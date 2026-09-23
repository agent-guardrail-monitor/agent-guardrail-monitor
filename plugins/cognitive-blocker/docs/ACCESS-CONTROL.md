# Internal Access Control

## Tenant boundary

The plugin uses `account_id` as the tenant boundary. A platform account and its plugin instance share one account scope.

Every project, memory item, approved decision, frozen element, task contract, guard event, feature flag and internal error report carries that account identity.

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
