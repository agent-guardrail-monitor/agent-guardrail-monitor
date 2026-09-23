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
  ENGINE --> RECOVERY[Controlled Recovery Controller]
  MEMORY --> DB[(PostgreSQL)]
  RECOVERY --> EVENTS[Guard Events]
  RECOVERY --> DB
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

## Class map

```mermaid
classDiagram
  class CognitiveAccount {
    +uuid id
    +string platform
    +string external_account_ref
  }

  class CognitiveInstance {
    +uuid id
    +uuid account_id
    +string role
    +string token_hash
  }

  class CognitiveProject {
    +uuid id
    +uuid account_id
    +string name
  }

  class CognitiveMemoryItem {
    +uuid account_id
    +uuid project_id
    +string memory_key
    +string claim_state
  }

  class GuardEvent {
    +uuid account_id
    +string decision
    +json violations
  }

  class FeatureFlag {
    +uuid account_id
    +string feature_key
    +boolean enabled
  }

  class ErrorReport {
    +uuid account_id
    +uuid project_id
    +string error_code
    +json context
  }

  CognitiveAccount "1" --> "1" CognitiveInstance
  CognitiveAccount "1" --> "*" CognitiveProject
  CognitiveAccount "1" --> "*" CognitiveMemoryItem
  CognitiveAccount "1" --> "*" GuardEvent
  CognitiveAccount "1" --> "*" FeatureFlag
  CognitiveAccount "1" --> "*" ErrorReport
  CognitiveProject "1" --> "*" CognitiveMemoryItem
  CognitiveProject "1" --> "*" ErrorReport
```


## Controlled recovery sequence

```mermaid
sequenceDiagram
  participant H as AI Host
  participant P as Plugin
  participant E as 59-rule Engine
  participant R as Recovery Controller
  participant D as PostgreSQL/RLS

  H->>P: candidate
  P->>E: canonical check
  E-->>P: BLOCK + violations
  P->>R: build surgical correction plan
  R->>D: create/update tenant recovery session
  R-->>H: CORRECT + recoverySessionId + preserve/corrections
  H->>H: regenerate only invalid portions
  H->>P: corrected candidate + same recoverySessionId
  P->>E: recheck
  alt valid
    E-->>P: ALLOW
    P->>R: close session
    R-->>H: ALLOW + canExecute=true
  else blocked before limit
    E-->>P: BLOCK
    P->>R: advance distinct attempt
    R-->>H: CORRECT
  else third distinct BLOCK
    E-->>P: BLOCK
    P->>R: close as SAFE_STOP
    R-->>H: SAFE_STOP + canExecute=false
  end
```
