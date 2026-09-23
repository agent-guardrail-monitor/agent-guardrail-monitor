# Cognitive Blocker Plugin

Account-scoped cognitive control layer for ChatGPT, Claude, Gemini and compatible AI runtimes.

## Canonical product contract

The product has one fixed purpose: block the 59 behaviors defined in the canonical ruleset while allowing unrelated AI behavior to continue normally.

It does not create new rules automatically. It does not expand a rule by interpretation. A block requires either a deterministic condition or an evidence-bearing semantic signal for an existing canonical rule.

## Account model

Each platform account receives its own instance token and database account ID.

Examples:

- one ChatGPT account -> one plugin instance;
- one Claude account -> another plugin instance;
- one Gemini account -> another plugin instance.

All persisted records carry account scope. Project-scoped records use composite foreign keys that require the project and account to match.

## Components

- `src/rule-catalog.mjs` — immutable 59-rule catalog.
- `src/engine.mjs` — deterministic ALLOW/BLOCK engine.
- `src/service.mjs` — automatically loads relevant account/project memory before evaluation.
- `src/db.mjs` — token hashing, account installation, memory and audit persistence.
- `src/mcp.mjs` — authenticated MCP tools for compatible AI clients.
- `src/server.mjs` — HTTP API and MCP endpoint.
- `sql/001_init.sql` — Lakebase Postgres/Neon schema.
- `test/` — deterministic regression tests.

## Enforcement boundary

The plugin can hard-block only on paths where it is technically placed before the response/action is accepted or executed.

Examples of enforceable paths:

- an owned API/model gateway;
- a custom tool/function loop where every side effect passes through the plugin;
- runtime hooks that call the local/remote policy engine before execution;
- an MCP workflow when the host actually invokes the MCP tool as part of the mandatory path.

A normal ChatGPT/Claude/Gemini conversation that never invokes the plugin is outside this server's interception authority. The server must not claim otherwise.

## Decision model

`ALLOW` means no canonical blocker was evidenced for that proposed response/action.

`BLOCK` means at least one canonical rule was triggered.

Semantic signals are accepted only when:

1. the rule ID exists in the canonical 59-rule catalog;
2. confidence is at least 0.80;
3. an evidence string is present.

Unknown rules and weak signals are ignored rather than turned into new blocks.

## Persistent cognitive memory

Memory items keep explicit epistemic state:

- EVIDENCE
- INFERENCE
- HYPOTHESIS
- ESTIMATE
- UNKNOWN
- REFUTED

The plugin never needs to rewrite a hypothesis as a fact to store it.

Memory types with automatic enforcement behavior in the MVP:

- `frozen_element` with `{ "resource": "header" }`
- `authorized_resource` with `{ "resource": "auth" }`
- `success_criterion` with `{ "text": "tests pass", "met": false }`

Account memory and project memory are loaded automatically before each check.

Current explicit task scope overrides older stored authorized-resource scope. Persisted frozen elements remain active unless the current task explicitly supplies `unfrozenElements`.

## API

### Health

`GET /health`

### Install one account instance

`POST /v1/install`

Header:

`x-install-secret: <INSTALL_SECRET>`

Body example:

```json
{
  "platform": "chatgpt",
  "externalAccountRef": "opaque-platform-account-id",
  "label": "Primary ChatGPT account"
}
```

The instance token is returned once. Only its SHA-256 hash is stored.

### Evaluate a proposed response/action

`POST /v1/check`

Header:

`Authorization: Bearer <instance-token>`

Example:

```json
{
  "projectId": null,
  "task": {
    "authorizedResources": ["auth"],
    "frozenElements": ["header"],
    "unmetSuccessCriteria": []
  },
  "proposedActions": [
    { "resource": "auth", "destructive": false },
    { "resource": "header", "destructive": false }
  ]
}
```

The second action triggers `EXE-002` and the result is `BLOCK`.

### Persist memory

`PUT /v1/memory`

Body example:

```json
{
  "key": "freeze-header",
  "type": "frozen_element",
  "value": { "resource": "header" },
  "claimState": "EVIDENCE",
  "source": "explicit user directive"
}
```

### Read memory

`GET /v1/memory`

Optional project scope:

`GET /v1/memory?projectId=<uuid>`

## MCP tools

- `cognitive_blocker_status`
- `cognitive_blocker_check`
- `cognitive_memory_put`
- `cognitive_memory_list`

The MCP endpoint is `/mcp` and requires the same Bearer instance token.

## Database migration

Apply `sql/001_init.sql` to the intended Neon/Lakebase Postgres database before production traffic.

The current deployment must not be marked ready until the migration is confirmed on the intended database.

## Environment

- `DATABASE_URL` — pooled application connection string.
- `INSTALL_SECRET` — protects account-instance installation.
- `PORT` — supplied by Render; defaults to 10000 locally.

## Verification

Run:

```bash
npm install
npm run check
npm test
```

A deployment is complete only after:

1. code checks pass;
2. engine regression tests pass;
3. database migration is confirmed;
4. Render health endpoint returns 200;
5. a real authenticated `/v1/check` returns the expected BLOCK/ALLOW behavior.
