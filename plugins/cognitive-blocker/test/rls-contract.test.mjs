import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const sql = fs.readFileSync(new URL("../sql/002_internal_control_plane.sql", import.meta.url), "utf8");

const tenantTables = [
  "cognitive_projects",
  "cognitive_memory_items",
  "cognitive_decisions",
  "cognitive_frozen_elements",
  "cognitive_task_contracts",
  "cognitive_guard_events",
  "cognitive_feature_flags",
  "cognitive_error_reports"
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
