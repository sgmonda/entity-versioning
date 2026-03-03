import { assertEquals, assert } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";

let connector: PostgresConnector;

async function setup() {
  connector = await createTestConnector();
  await cleanDatabase(connector);
  await loadFixture(connector);
}

async function teardown() {
  await cleanDatabase(connector);
  await connector.disconnect();
}

Deno.test("changelog tables - createChangelogTables creates both tables", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE '__ev_%'
    `;
    const names = tables.map((t: Record<string, string>) => t.tablename);
    assert(names.includes("__ev_changelog"), "Should create __ev_changelog");
    assert(names.includes("__ev_schema_snapshots"), "Should create __ev_schema_snapshots");
  } finally {
    await teardown();
  }
});

Deno.test("changelog tables - correct indices exist", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    const indices = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename LIKE '__ev_%'
    `;
    const names = indices.map((i: Record<string, string>) => i.indexname);
    assert(names.includes("__ev_idx_entity_lookup"), "entity lookup index");
    assert(names.includes("__ev_idx_transaction"), "transaction index");
    assert(names.includes("__ev_idx_schema_table"), "schema table index");
  } finally {
    await teardown();
  }
});

Deno.test("changelog tables - IF NOT EXISTS - running twice doesn't fail", async () => {
  await setup();
  try {
    await connector.createChangelogTables();
    await connector.createChangelogTables(); // second call should not throw
  } finally {
    await teardown();
  }
});

Deno.test("changelog tables - getSchemaSnapshot returns correct data", async () => {
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
