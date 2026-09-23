# Internal Feature Catalog

Feature flags are stored and evaluated inside the plugin.

## Required modules

- `core_blocking`
- `tenant_isolation`
- `rbac`
- `database_rls`
- `cognitive_memory`

Required modules always resolve to enabled. Attempts to disable them are rejected.

## Optional modules

- `semantic_signals`
- `guard_event_history`
- `internal_error_reporting`

Optional state is persisted per account in `cognitive_feature_flags`.

No external feature-flag service is used.
