import { assertEquals, assert } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

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

Deno.test("edge case - NULL values serialized correctly in JSONB", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    const entity: EntityConfig = {
      name: "course",
      rootTable: "course",
      rootPk: "id",
      children: [],
    };
    await connector.installTriggers([entity]);

    // Insert with NULL values
    await sql`INSERT INTO course (name, "startDate", "endDate") VALUES ('Null Test', NULL, NULL)`;

    const logs = await sql`SELECT * FROM __ev_changelog WHERE operation = 'INSERT'`;
    assert(logs.length >= 1);
    const newVals = logs[logs.length - 1].new_values;
    assertEquals(newVals.startDate, null);
    assertEquals(newVals.endDate, null);
  } finally {
    await teardown();
  }
});

Deno.test("edge case - special data types (numeric, timestamp) serialized", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    const entity: EntityConfig = {
      name: "billing",
      rootTable: "billing",
      rootPk: "id",
      children: [],
    };
    await connector.installTriggers([entity]);

    await sql`INSERT INTO billing (amount, status) VALUES (12345.67, 'paid')`;

    const logs = await sql`SELECT * FROM __ev_changelog WHERE table_name = 'billing'`;
    assert(logs.length >= 1);
    const newVals = logs[logs.length - 1].new_values;
    assert(newVals.amount !== undefined, "amount should be captured");
  } finally {
    await teardown();
  }
});

Deno.test("edge case - bulk INSERT captures all rows", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    const entity: EntityConfig = {
      name: "course",
      rootTable: "course",
      rootPk: "id",
      children: [],
    };
    await connector.installTriggers([entity]);

    // Bulk insert
    await sql`
      INSERT INTO course (name) VALUES ('Bulk 1'), ('Bulk 2'), ('Bulk 3'), ('Bulk 4'), ('Bulk 5')
    `;

    const logs = await sql`SELECT * FROM __ev_changelog WHERE operation = 'INSERT'`;
    assert(logs.length >= 5, `Expected >= 5 changelog entries for bulk insert, got ${logs.length}`);
  } finally {
    await teardown();
  }
});

Deno.test("edge case - empty database tables list", async () => {
  connector = await createTestConnector();
  const sql = connector.getSql();
  // Clean everything
  const tables = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  for (const t of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
  }

  try {
    const result = await connector.getTables();
    assertEquals(result.length, 0, "Empty database should return empty tables list");
  } finally {
    await connector.disconnect();
  }
});

Deno.test("edge case - table without PK detected correctly", async () => {
  await setup();
  try {
    const tables = await connector.getTables();
    const trackingEvent = tables.find((t) => t.name === "tracking_event");
    assert(trackingEvent, "tracking_event should exist");

    const hasPk = trackingEvent.columns.some((c) => c.isPrimaryKey);
    assertEquals(hasPk, false, "tracking_event should not have a PK");
  } finally {
    await teardown();
  }
});

Deno.test("edge case - identifiers with special characters", async () => {
  connector = await createTestConnector();
  const sql = connector.getSql();
  // Clean first
  await sql.unsafe(`DROP TABLE IF EXISTS "weird-table" CASCADE`);
  await sql.unsafe(`DROP TABLE IF EXISTS __ev_changelog CASCADE`);
  await sql.unsafe(`DROP TABLE IF EXISTS __ev_schema_snapshots CASCADE`);

  try {
    // Create table with special chars
    await sql.unsafe(`
      CREATE TABLE "weird-table" (
        id SERIAL PRIMARY KEY,
        "column-with-dashes" TEXT
      )
    `);

    const tables = await connector.getTables();
    const weirdTable = tables.find((t) => t.name === "weird-table");
    assert(weirdTable, "Should find table with special characters");
  } finally {
    await sql.unsafe(`DROP TABLE IF EXISTS "weird-table" CASCADE`);
    await connector.disconnect();
  }
});
