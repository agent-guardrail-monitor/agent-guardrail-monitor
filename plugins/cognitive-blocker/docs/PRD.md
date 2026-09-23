# PRD — Cognitive Blocker Plugin

Status: canonical internal product contract  
Version: 2026-09-23.2

## 1. Purpose

The plugin is an account-scoped cognitive control layer for AI platforms. Its primary function is active blocking: prevent a canonical blocked behavior from being accepted as valid execution on technical paths the plugin actually controls.

The AI remains responsible for reasoning, answering and executing. The plugin is responsible for enforcing the fixed blocking catalog, preserving relevant account/project memory and refusing invalid completion states.

## 2. Non-negotiable product rules

1. The canonical blocking catalog contains exactly the approved rules. The plugin does not invent additional blocking rules.
2. A rule is not broadened silently.
3. Each platform account is isolated as its own tenant.
4. Memory, projects, decisions, errors, feature state and audit events never cross tenant boundaries.
5. Current explicit task instructions outrank older stored task scope.
6. Frozen elements remain frozen until explicitly unfrozen.
7. Hypothesis, inference, estimate and unknown states remain epistemically distinct from evidence.
8. Completion claims require the applicable proof defined by the canonical blocking rules.
9. The plugin only claims hard enforcement on mandatory paths it actually controls.
10. All control-plane functions in this package are internal. No external logging, RBAC, feature-flag or error-reporting service is required.

## 3. Functional modules

- Canonical blocker engine.
- Account/project cognitive memory.
- Tenant isolation.
- Internal RBAC.
- PostgreSQL row-level security.
- Internal feature catalog and per-account flags.
- Internal error reporting and technical trace capture.
- Guard/audit event history.
- Automated unit, integration and conditional database E2E tests.

## 4. Success criteria

The plugin is considered technically ready only when:

- canonical rule integrity tests pass;
- tenant scope tests pass;
- RBAC tests pass;
- mandatory feature tests pass;
- RLS migration contract tests pass;
- internal error sanitization tests pass;
- CI passes;
- the intended PostgreSQL migration is applied;
- a real authenticated database-backed E2E proves account A cannot read or write account B data;
- Render health and authenticated ALLOW/BLOCK checks succeed.

## 5. Internal-only constraint

The following must stay inside this product:

- permission matrix;
- tenant context;
- RLS policies;
- feature catalog and flags;
- error reports;
- technical audit events;
- test orchestration.

Infrastructure providers may host the application/database, but these product controls are implemented by this repository rather than delegated to third-party control services.
