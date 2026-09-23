# Premium Quality Gates

Status: implemented on `feat/cognitive-blocker-plugin`.

## Purpose

These gates attack the blocker itself before a change can be treated as trustworthy.

They are development-time controls only. They do not become runtime dependencies of the deployed plugin.

## 1. fast-check — generative invariants

Pinned version: `4.10.2`.

The property suite uses a fixed replayable seed and 500 generated cases per property.

Current invariants include:

- every canonical rule blocks when a strong evidence-bearing semantic signal references it;
- weak evidence does not create a block by itself;
- unknown rule IDs never become automatic rules;
- destructive actions require explicit authorization;
- frozen resources remain blocked;
- OWNER remains a permission superset;
- required features cannot be disabled;
- optional feature flags preserve the account override.

Command:

```bash
npm run test:property
```

## 2. Testcontainers — real PostgreSQL isolation

Pinned module: `@testcontainers/postgresql@12.1.0`.

The test launches a disposable PostgreSQL 16 container, applies the real migrations, creates a non-superuser / non-BYPASSRLS application role and two accounts, then verifies:

- no tenant context sees no tenant rows;
- tenant A sees only tenant A;
- tenant A cannot write tenant B data;
- tenant B sees only tenant B;
- the application database role is neither superuser nor BYPASSRLS.

Command:

```bash
npm run test:containers
```

The first execution found a real malformed PL/pgSQL delimiter in the migration. That defect was corrected and a deterministic regression assertion was added.

## 3. StrykerJS — mutation resistance

Pinned versions:

- `@stryker-mutator/core@10.0.0`
- `@stryker-mutator/tap-runner@10.0.0`

Stryker mutates the high-value deterministic logic:

- blocker engine;
- RBAC;
- feature catalog;
- error sanitization.

It uses Stryker's TAP runner, which integrates with the existing Node built-in test runner.

Configured mutation thresholds:

- high: 90
- low: 80
- break: 80

Command:

```bash
npm run test:mutation
```

## 4. Production dependency audit

The runtime install excludes every quality tool:

```bash
npm install --omit=dev
```

The premium workflow blocks production dependency findings at moderate severity or higher:

```bash
npm audit --omit=dev --audit-level=moderate
```

## 5. Deployment boundary

The Render deployment template uses `npm install --omit=dev`.

Therefore fast-check, Testcontainers and Stryker stay in CI/development and are not required by the runtime process.

## Gate sequence

```
syntax + deterministic tests
        |
        v
property-based invariants
        |
        +--> disposable PostgreSQL / RLS proof
        |
        +--> production dependency audit
        |
        v
mutation resistance
        |
        v
eligible for database-backed E2E / release
```

No external testing SaaS is required for these gates. Execution occurs inside the repository's GitHub Actions environment.


## Verified CI result — 2026-09-23

Verified on GitHub Actions after strengthening the mutation contracts:

- production dependency audit: **PASS**;
- fast-check property invariants: **PASS**;
- disposable PostgreSQL 16 + real migrations + RLS tenant isolation: **PASS**;
- Stryker mutation gate: **PASS**.

Mutation result:

| Module | Mutation score |
| --- | ---: |
| All selected files | 93.17% |
| blocker engine | 92.44% |
| feature catalog | 94.38% |
| internal error sanitization | 93.06% |
| RBAC | 96.23% |

Stryker executed 573 mutants in the first diagnostic pass. That pass scored 68.65% and was rejected by the 80% gate. The tests were strengthened rather than lowering the threshold. The verified final run scored 93.17%.

The disposable PostgreSQL test also found a malformed PL/pgSQL dollar-quote delimiter in migration `002_internal_control_plane.sql`. The migration was corrected and a deterministic regression test was added before the PostgreSQL/RLS gate passed.

Runtime audit is intentionally separate from development tooling: `npm audit --omit=dev --audit-level=moderate` passed. The quality tools remain development-only and are omitted by the deployment template.
