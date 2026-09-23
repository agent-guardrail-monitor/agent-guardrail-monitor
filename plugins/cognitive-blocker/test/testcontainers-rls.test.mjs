import fs from "node:fs";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const { Pool } = pg;
const enabled = process.env.RUN_TESTCONTAINERS === "1";
const maybeTest = enabled ? test : test.skip;

function readMigration(name) {
  return fs.readFileSync(new URL("../sql/" + name, import.meta.url), "utf8");
}

maybeTest("Testcontainers: real PostgreSQL enforces cross-tenant RLS", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("cognitive_blocker")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  const adminPool = new Pool({
    connectionString: container.getConnectionUri(),
    max: 2
  });

  const appPassword = "test-" + crypto.randomBytes(12).toString("hex");
  const appRole = "cognitive_app";
  const accountA = crypto.randomUUID();
  const accountB = crypto.randomUUID();
  const projectA = crypto.randomUUID();
  const projectB = crypto.randomUUID();
  const recoveryA = crypto.randomUUID();

  try {
    await adminPool.query(readMigration("001_init.sql"));
    await adminPool.query(readMigration("002_internal_control_plane.sql"));
    await adminPool.query(readMigration("003_recovery_sessions.sql"));

    await adminPool.query(`CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`);
    await adminPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${appRole}`);

    await adminPool.query(
      `INSERT INTO cognitive_accounts(id, platform, external_account_ref)
       VALUES ($1,'other',$2),($3,'other',$4)`,
      [accountA, "tc-" + accountA, accountB, "tc-" + accountB]
    );

    await adminPool.query(
      `INSERT INTO cognitive_projects(id, account_id, name)
       VALUES ($1,$2,'tenant-a-project'),($3,$4,'tenant-b-project')`,
      [projectA, accountA, projectB, accountB]
    );

    const appPool = new Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: appRole,
      password: appPassword,
      max: 1
    });

    try {
      const roleState = await appPool.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
      );
      assert.equal(roleState.rows[0].rolsuper, false);
      assert.equal(roleState.rows[0].rolbypassrls, false);

      const withoutTenant = await appPool.query(
        "SELECT id, account_id, name FROM cognitive_projects ORDER BY name"
      );
      assert.deepEqual(withoutTenant.rows, []);

      const clientA = await appPool.connect();
      try {
        await clientA.query("BEGIN");
        await clientA.query(
          "SELECT set_config('app.current_account_id', $1, true)",
          [accountA]
        );

        const visibleToA = await clientA.query(
          "SELECT id, account_id, name FROM cognitive_projects ORDER BY name"
        );

        assert.equal(visibleToA.rows.length, 1);
        assert.equal(visibleToA.rows[0].account_id, accountA);
        assert.equal(visibleToA.rows[0].name, "tenant-a-project");

        await clientA.query("SAVEPOINT project_cross_tenant");
        await assert.rejects(
          clientA.query(
            "INSERT INTO cognitive_projects(id, account_id, name) VALUES ($1,$2,'illegal-cross-tenant')",
            [crypto.randomUUID(), accountB]
          ),
          /row-level security|policy/i
        );
        await clientA.query("ROLLBACK TO SAVEPOINT project_cross_tenant");

        await clientA.query(
          `INSERT INTO cognitive_recovery_sessions
             (id, account_id, project_id, root_fingerprint, last_request_fingerprint,
              phase, attempt, max_attempts, last_violations, invalid_resources)
           VALUES ($1,$2,$3,'root-a','last-a','CORRECT',1,3,'[]'::jsonb,'[]'::jsonb)`,
          [recoveryA, accountA, projectA]
        );

        const recoveryVisibleToA = await clientA.query(
          "SELECT id, account_id, phase, attempt FROM cognitive_recovery_sessions"
        );
        assert.equal(recoveryVisibleToA.rows.length, 1);
        assert.equal(recoveryVisibleToA.rows[0].id, recoveryA);
        assert.equal(recoveryVisibleToA.rows[0].account_id, accountA);

        await clientA.query("SAVEPOINT recovery_cross_tenant");
        await assert.rejects(
          clientA.query(
            `INSERT INTO cognitive_recovery_sessions
               (account_id, root_fingerprint, last_request_fingerprint,
                phase, attempt, max_attempts, last_violations, invalid_resources)
             VALUES ($1,'root-b','last-b','CORRECT',1,3,'[]'::jsonb,'[]'::jsonb)`,
            [accountB]
          ),
          /row-level security|policy/i
        );
        await clientA.query("ROLLBACK TO SAVEPOINT recovery_cross_tenant");

        await clientA.query("ROLLBACK");
      } finally {
        clientA.release();
      }

      const clientB = await appPool.connect();
      try {
        await clientB.query("BEGIN");
        await clientB.query(
          "SELECT set_config('app.current_account_id', $1, true)",
          [accountB]
        );
        const visibleToB = await clientB.query(
          "SELECT id, account_id, name FROM cognitive_projects ORDER BY name"
        );
        assert.equal(visibleToB.rows.length, 1);
        assert.equal(visibleToB.rows[0].account_id, accountB);
        assert.equal(visibleToB.rows[0].name, "tenant-b-project");

        const recoveryVisibleToB = await clientB.query(
          "SELECT id, account_id FROM cognitive_recovery_sessions"
        );
        assert.equal(recoveryVisibleToB.rows.length, 0);

        await clientB.query("ROLLBACK");
      } finally {
        clientB.release();
      }
    } finally {
      await appPool.end();
    }
  } finally {
    await adminPool.end().catch(() => {});
    await container.stop().catch(() => {});
  }
});
