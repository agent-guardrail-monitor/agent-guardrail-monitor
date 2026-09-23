# System Map — Cognitive Blocker Plugin

## Dependency order

1. PRD / canonical contract
2. System boundaries and module map
3. Tenant identity and account isolation
4. RBAC permission decision
5. PostgreSQL RLS enforcement
6. Feature catalog and feature flags
7. Internal error reporting
8. Automated tests across every layer

This order is intentional: later controls depend on identity and authorization established earlier.

## Component map

```mermaid
flowchart TD
  HOST[AI Host / Compatible Runtime] --> API[HTTP or MCP Entry Point]
  API --> AUTH[Instance Token Authentication]
  AUTH --> TENANT[Tenant Context: account_id]
  TENANT --> RBAC[Internal RBAC]
  RBAC --> FLAGS[Internal Feature Catalog]
  FLAGS --> SERVICE[Cognitive Service]
  SERVICE --> MEMORY[Account + Project Memory]
  SERVICE --> ENGINE[Canonical 59-rule Blocking Engine]
  MEMORY --> DB[(PostgreSQL)]
  ENGINE --> EVENTS[Guard Events]
  EVENTS --> DB
  DB --> RLS[Row Level Security]
  API --> ERRORS[Internal Error Reporter]
  ERRORS --> DB
  TESTS[Unit / Integration / DB E2E] --> AUTH
  TESTS --> TENANT
  TESTS --> RBAC
  TESTS --> FLAGS
  TESTS --> ENGINE
  TESTS --> RLS
```

## Request sequence

```mermaid
sequenceDiagram
  participant H as AI Host
  participant A as Plugin API/MCP
  participant I as Authentication
  participant R as RBAC
  participant F as Feature Catalog
  participant S as Cognitive Service
  participant D as PostgreSQL/RLS

  H->>A: proposed response/action
  A->>I: resolve instance token
  I-->>A: account_id + role
  A->>R: authorize permission
  R-->>A: allow/deny
  A->>F: resolve required/optional modules
  F-->>A: effective feature state
  A->>S: evaluate in tenant context
  S->>D: load account/project memory
  D-->>S: RLS-filtered rows
  S->>S: canonical blocker evaluation
  S->>D: append guard event
  S-->>A: ALLOW or BLOCK
  A-->>H: decision + canonical violations
```

## Boundary rule

The model never decides whether its own bypass is acceptable. The deterministic plugin control path makes that decision using canonical rules, tenant state and evidence.
