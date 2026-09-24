# PRD — Cognitive Blocker Plugin

Status: canonical internal product contract  
Version: 2026-09-24.5

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
11. A BLOCK starts controlled correction rather than being treated as valid completion.
12. Recovery may attempt at most three distinct candidates in one session; identical replay does not consume an attempt.
13. Recovery preserves non-violating work and never creates or broadens blocking rules.
14. One successful installation activates one plugin instance for the whole platform account in ALWAYS_ON mode.
15. Every controlled chat is auto-registered from the platform conversation reference; the user never activates the plugin per chat.
16. Raw conversation history is chat-local and must not cross into another chat automatically.
17. Durable account memory may apply across chats when relevant and valid.
18. The current user message has priority over recovered historical state.
19. Explicit user turns may be stored as source data; assistant candidate turns are consolidated only after canonical ALLOW.
20. Blocked candidate content must never become accepted conversation history merely because the model produced it.
21. Public installation authentication uses OAuth 2.1 Authorization Code + PKCE S256; no manual user API key is the public install path.
22. OAuth tokens are bound to the canonical MCP resource and cognitive:use scope.
23. Semantic classification may only emit IDs from the fixed canonical catalog.
24. The product does not claim lifecycle coverage on host turns that never pass through the integration.

## 3. Functional modules

- Canonical blocker engine.
- Account/project cognitive memory.
- Tenant isolation.
- Internal RBAC.
- PostgreSQL row-level security.
- Internal feature catalog and per-account flags.
- Internal error reporting and technical trace capture.
- Guard/audit event history.
- Controlled correction/recheck recovery after canonical BLOCK.
- ALWAYS_ON account activation and automatic chat registration.
- Chat-local episodic history with account-wide durable memory.
- Automatic context rehydration before candidate generation.
- Internal relevant-history retrieval for older turns in the same chat.
- Portable plugin manifest, MCP package, Skill and Work/Codex hooks.
- OAuth 2.1 install/link flow with PKCE and rotating refresh tokens.
- Optional Semantic Guardian constrained to the fixed canonical rule catalog.
- Automated unit, integration and conditional database E2E tests.

## 4. Success criteria

The plugin is considered technically ready only when:

- canonical rule integrity tests pass;
- tenant scope tests pass;
- RBAC tests pass;
- mandatory feature tests pass;
- RLS migration contract tests pass;
- internal error sanitization tests pass;
- controlled recovery state-machine tests pass;
- recovery-session tenant isolation tests pass;
- conversation/turn tenant isolation tests pass;
- ALWAYS_ON installation contract tests pass;
- blocked-candidate non-persistence tests pass;
- portable package contract tests pass;
- OAuth PKCE/replay/refresh tests pass;
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
