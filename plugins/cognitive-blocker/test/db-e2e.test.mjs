import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const enabled = process.env.RUN_DB_E2E === "1" && Boolean(process.env.DATABASE_URL);
const maybeTest = enabled ? test : test.skip;

maybeTest("database RLS isolates tenant rows in a real PostgreSQL transaction", async () => {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();

  const accountA = crypto.randomUUID();
  const accountB = crypto.randomUUID();
  const projectA = crypto.randomUUID();
  const projectB = crypto.randomUUID();

  try {
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO cognitive_accounts(id, platform, external_account_ref) VALUES ($1,'other',$2),($3,'other',$4)",
      [accountA, "e2e-" + accountA, accountB, "e2e-" + accountB]
    );

    await client.query("SELECT set_config('app.current_account_id', $1, true)", [accountA]);
    await client.query(
      "INSERT INTO cognitive_projects(id, account_id, name) VALUES ($1,$2,'tenant-a-project')",
      [projectA, accountA]
    );

    await client.query("SELECT set_config('app.current_account_id', $1, true)", [accountB]);
    await client.query(
      "INSERT INTO cognitive_projects(id, account_id, name) VALUES ($1,$2,'tenant-b-project')",
      [projectB, accountB]
    );

    await client.query("SELECT set_config('app.current_account_id', $1, true)", [accountA]);
    const visibleToA = await client.query(
      "SELECT id, account_id, name FROM cognitive_projects ORDER BY name"
    );

    assert.equal(visibleToA.rows.length, 1);
    assert.equal(visibleToA.rows[0].account_id, accountA);
    assert.equal(visibleToA.rows[0].name, "tenant-a-project");

    await assert.rejects(
      client.query(
        "INSERT INTO cognitive_projects(id, account_id, name) VALUES ($1,$2,'illegal-cross-tenant')",
        [crypto.randomUUID(), accountB]
      )
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
});
