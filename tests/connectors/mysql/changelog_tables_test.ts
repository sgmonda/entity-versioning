import { assertEquals, assert } from "@std/assert";
import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../../test-helpers-mysql.ts";
import type { MySQLConnector } from "../../../src/connectors/mysql/index.ts";

let connector: MySQLConnector;

async function setup() {
  connector = await createMySQLTestConnector();
  await cleanMySQLDatabase(connector);
  await loadMySQLFixture(connector);
}

async function teardown() {
  await cleanMySQLDatabase(connector);
  await connector.disconnect();
}

Deno.test("MySQL changelog tables - createChangelogTables creates both tables", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();

    const [tables] = await pool.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '__ev_%'
    `);
    const names = tables.map((t: Record<string, string>) => t.TABLE_NAME);
    assert(names.includes("__ev_changelog"), "Should create __ev_changelog");
    assert(names.includes("__ev_schema_snapshots"), "Should create __ev_schema_snapshots");
  } finally {
    await teardown();
  }
});

Deno.test("MySQL changelog tables - correct indices exist", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();

    const [indices] = await pool.query(`
      SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '__ev_%'
    `);
    const names = indices.map((i: Record<string, string>) => i.INDEX_NAME);
    assert(names.includes("__ev_idx_entity_lookup"), "entity lookup index");
    assert(names.includes("__ev_idx_transaction"), "transaction index");
    assert(names.includes("__ev_idx_schema_table"), "schema table index");
  } finally {
    await teardown();
  }
});

Deno.test("MySQL changelog tables - IF NOT EXISTS - running twice doesn't fail", async () => {
  await setup();
  try {
    await connector.createChangelogTables();
    await connector.createChangelogTables(); // second call should not throw
  } finally {
    await teardown();
  }
});

Deno.test("MySQL changelog tables - getSchemaSnapshot returns correct data", async () => {
  await setup();
  try {
    const snapshot = await connector.getSchemaSnapshot(["course", "billing"]);
    assert(snapshot.tables.course, "Should have course snapshot");
    assert(snapshot.tables.billing, "Should have billing snapshot");
    assert(snapshot.tables.course.length > 0, "course should have columns");

    const idCol = snapshot.tables.course.find((c) => c.name === "id");
    assert(idCol, "course.id should exist");
    assertEquals(idCol.isPrimaryKey, true);
  } finally {
    await teardown();
  }
});
