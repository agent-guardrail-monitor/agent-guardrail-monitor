# Cognitive Blocker Plugin

Internal account-scoped cognitive control layer for ChatGPT, Claude, Gemini and compatible AI runtimes.

Current package version: **0.2.0**  
Canonical ruleset: **2026-09-23.1**

## Product contract

The product has one fixed purpose: actively block the 59 approved behaviors on technical paths the plugin actually controls, while leaving unrelated AI behavior operating normally.

The canonical rule catalog is fixed. The plugin does not create new blocking rules automatically and does not silently broaden an existing rule.

See:

- `docs/PRD.md` — canonical product requirements.
- `docs/SYSTEM-MAP.md` — system map and request sequence.
- `docs/ACCESS-CONTROL.md` — account isolation, RBAC and RLS.
- `docs/FEATURE-CATALOG.md` — internal modules and feature flags.

## Internal dependency order

1. PRD / canonical contract.
2. System map and module boundaries.
3. Account isolation / multi-tenancy.
4. Internal RBAC.
5. PostgreSQL Row Level Security.
6. Internal feature catalog + per-account feature flags.
7. Internal error reporting.
8. Automated unit, integration and conditional database E2E tests.

No external RBAC provider, feature-flag service, error tracker or monitoring SaaS is required by these controls.

## Account model / multi-tenancy

Each AI-platform account receives one plugin account/tenant scope.

Examples:

- one ChatGPT account -> one isolated plugin account;
- one Claude account -> another isolated plugin account;
- one Gemini account -> another isolated plugin account.

`account_id` is the tenant boundary. Project-scoped records also use composite account/project references, so a project from account B cannot be attached to data from account A.

## Database RLS

The database migration `sql/002_internal_control_plane.sql` enables and **forces** Row Level Security on tenant data.

Every tenant transaction sets:

`app.current_account_id=<authenticated account_id>`

RLS policies enforce both reads and writes with that account ID.

Protected tenant tables include:

- projects;
- cognitive memory;
- decisions;
- frozen elements;
- task contracts;
- guard events;
- feature flags;
- internal error reports.

Authentication lookup tables remain outside tenant RLS so an instance token can be resolved before a tenant context exists.

## RBAC

Internal roles:

- `OWNER`
- `ADMIN`
- `MANAGER`
- `CLIENT`

The installation token is created as `OWNER`.

The fixed permission matrix lives in `src/rbac.mjs` and can be inspected through:

- HTTP: `GET /v1/permissions`
- MCP: `cognitive_permission_matrix`

## Internal feature catalog

Required controls cannot be disabled:

- `core_blocking`
- `tenant_isolation`
- `rbac`
- `database_rls`
- `cognitive_memory`

Optional account-scoped flags:

- `semantic_signals`
- `guard_event_history`
- `internal_error_reporting`

Feature state is stored internally in `cognitive_feature_flags`.

HTTP:

- `GET /v1/features`
- `PUT /v1/features/:feature`

MCP:

- `cognitive_features_list`
- `cognitive_feature_set`

## Internal error reporting

The plugin now contains its own error-reporting pipeline.

It captures:

- source/module;
- error code;
- bounded message;
- sanitized context;
- SHA-256 stack fingerprint;
- request fingerprint;
- project scope when available;
- account scope;
- status and timestamp.

Secret-like fields such as tokens, passwords, authorization values, cookies and API keys are redacted before persistence.

HTTP:

- `POST /v1/errors`
- `GET /v1/errors`

MCP:

- `cognitive_report_error`
- `cognitive_errors_list`

Unhandled authenticated HTTP failures also attempt an internal error record when the feature is enabled. The reporter never calls an external service.

## Canonical blocker engine

`src/rule-catalog.mjs` contains exactly 59 approved rules.

`src/engine.mjs` returns:

- `ALLOW` — no canonical blocker was evidenced;
- `BLOCK` — one or more canonical rules were triggered.

Semantic signals are considered only when:

1. the rule ID exists in the canonical catalog;
2. confidence is at least 0.80;
3. evidence is supplied.

Unknown or weak signals do not become new rules.

## Cognitive memory

Memory preserves epistemic state:

- EVIDENCE
- INFERENCE
- HYPOTHESIS
- ESTIMATE
- UNKNOWN
- REFUTED

Account memory and project memory are automatically applied to controlled checks.

Supported automatic enforcement types include:

- `frozen_element`
- `authorized_resource`
- `success_criterion`

Current explicit task scope overrides older stored authorized-resource scope. Frozen elements remain active until explicitly unfrozen.

## HTTP API

Public health:

- `GET /health`

Install one account instance:

- `POST /v1/install`
- header: `x-install-secret: <INSTALL_SECRET>`

Authenticated endpoints use:

`Authorization: Bearer <instance-token>`

Core endpoints:

- `GET /v1/status`
- `POST /v1/check`
- `PUT /v1/memory`
- `GET /v1/memory`
- `GET /v1/features`
- `PUT /v1/features/:feature`
- `POST /v1/errors`
- `GET /v1/errors`
- `GET /v1/permissions`

Only the token hash is stored.

## MCP tools

- `cognitive_blocker_status`
- `cognitive_blocker_check`
- `cognitive_memory_put`
- `cognitive_memory_list`
- `cognitive_features_list`
- `cognitive_feature_set`
- `cognitive_report_error`
- `cognitive_errors_list`
- `cognitive_permission_matrix`

The MCP endpoint is `/mcp` and uses the same account-instance Bearer token.

## Enforcement boundary

The plugin can hard-block only where it is on the mandatory pre-action or pre-release path.

Examples:

- owned API/model gateway;
- controlled custom tool/function loop;
- runtime hook that calls the policy decision before execution;
- MCP flow in which the host actually invokes the plugin before accepting the action.

An ordinary AI-platform turn that never invokes the plugin is outside this server's interception authority.

## Database migrations

Apply in order:

1. `sql/001_init.sql`
2. `sql/002_internal_control_plane.sql`

The second migration adds:

- RBAC role state;
- internal feature flags;
- internal error reports;
- tenant-safe composite references;
- forced RLS policies.

These migrations are prepared but the real Neon database E2E remains pending until the approved Neon connection is available.

## Automated tests

Normal CI runs:

```bash
npm install
npm run check
npm test
```

This covers:

- 59-rule catalog integrity;
- deterministic blocking;
- memory-context behavior;
- RBAC matrix;
- required/optional feature flags;
- secret redaction;
- RLS migration contract;
- tenant-safe composite foreign keys.

A real database isolation test also exists:

```bash
RUN_DB_E2E=1 DATABASE_URL=... npm run test:db
```

It is intentionally skipped unless explicitly enabled.

## Completion criteria

The plugin is not marked production-complete until all of the following are verified:

1. code syntax checks pass;
2. automated test suite passes;
3. both database migrations are applied to the intended database;
4. real PostgreSQL RLS E2E proves account A cannot access account B;
5. Render health returns 200;
6. authenticated ALLOW/BLOCK behavior passes against the real database.
