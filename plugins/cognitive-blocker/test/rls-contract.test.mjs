import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const sql = [
  fs.readFileSync(new URL("../sql/002_internal_control_plane.sql", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../sql/003_recovery_sessions.sql", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../sql/004_account_wide_conversations.sql", import.meta.url), "utf8")
].join("\n");

const tenantTables = [
  "cognitive_projects",
  "cognitive_memory_items",
  "cognitive_decisions",
  "cognitive_frozen_elements",
  "cognitive_task_contracts",
  "cognitive_guard_events",
  "cognitive_feature_flags",
  "cognitive_error_reports",
  "cognitive_recovery_sessions",
  "cognitive_conversations",
  "cognitive_turns"
];

test("RLS migration defines database tenant context", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION cognitive_current_account_id/);
  assert.match(sql, /current_setting\('app\.current_account_id', true\)/);
});

test("every tenant data table enables and forces RLS", () => {
  for (const table of tenantTables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`CREATE POLICY ${table}_tenant ON ${table}`));
  }
});

test("RLS policies restrict both reads and writes to current account", () => {
  const usingCount = (sql.match(/USING \(account_id = cognitive_current_account_id\(\)\)/g) || []).length;
  const checkCount = (sql.match(/WITH CHECK \(account_id = cognitive_current_account_id\(\)\)/g) || []).length;
  assert.equal(usingCount, tenantTables.length);
  assert.equal(checkCount, tenantTables.length);
});

test("task-to-guard references are tenant-composite", () => {
  assert.match(sql, /UNIQUE \(id, account_id\)/);
  assert.match(sql, /FOREIGN KEY \(task_contract_id, account_id\)/);
  assert.match(sql, /REFERENCES cognitive_task_contracts\(id, account_id\)/);
});

test("PLpgSQL migration blocks use complete dollar-quote delimiters", () => {
  const starts = (sql.match(/DO \$\$/g) || []).length;
  const ends = (sql.match(/END \$\$;/g) || []).length;
  assert.ok(starts >= 1);
  assert.equal(starts, ends);
  assert.doesNotMatch(sql, /DO \$\n/);
  assert.doesNotMatch(sql, /END \$;/);
});


test("recovery sessions enforce the fixed three-attempt policy", () => {
  assert.match(sql, /attempt integer NOT NULL DEFAULT 1 CHECK \(attempt >= 1 AND attempt <= 3\)/);
  assert.match(sql, /max_attempts integer NOT NULL DEFAULT 3 CHECK \(max_attempts = 3\)/);
  assert.match(sql, /phase text NOT NULL CHECK \(phase IN \('CORRECT','ALLOW','SAFE_STOP'\)\)/);
});


test("account installation is fixed to ALWAYS_ON with automatic chat registration", () => {
  assert.match(sql, /activation_mode text NOT NULL DEFAULT 'ALWAYS_ON'/);
  assert.match(sql, /CHECK \(activation_mode IN \('ALWAYS_ON'\)\)/);
  assert.match(sql, /auto_register_conversations boolean NOT NULL DEFAULT true/);
});

test("chat history is account-scoped and conversation-scoped", () => {
  assert.match(sql, /UNIQUE \(account_id, platform_conversation_ref\)/);
  assert.match(sql, /FOREIGN KEY \(conversation_id, account_id\)/);
  assert.match(sql, /REFERENCES cognitive_conversations\(id, account_id\)/);
  assert.match(sql, /accepted_source text NOT NULL CHECK \(accepted_source IN \('USER_EXPLICIT','ALLOW'\)\)/);
});
