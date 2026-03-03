import { assertEquals, assert } from "@std/assert";
import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../../test-helpers-mysql.ts";
import type { MySQLConnector } from "../../../src/connectors/mysql/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

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

Deno.test("MySQL edge case - NULL values serialized correctly in JSON", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    const entity: EntityConfig = {
      name: "course",
      rootTable: "course",
      rootPk: "id",
      children: [],
    };
    await connector.installTriggers([entity]);

    await pool.query("INSERT INTO course (name, `startDate`, `endDate`) VALUES ('Null Test', NULL, NULL)");

    const [logs] = await pool.query("SELECT * FROM __ev_changelog WHERE operation = 'INSERT'");
    assert(logs.length >= 1);
    const newVals = typeof logs[logs.length - 1].new_values === "string"
      ? JSON.parse(logs[logs.length - 1].new_values)
      : logs[logs.length - 1].new_values;
    assertEquals(newVals.startDate, null);
    assertEquals(newVals.endDate, null);
  } finally {
    await teardown();
  }
});

Deno.test("MySQL edge case - special data types (decimal, datetime) serialized", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    const entity: EntityConfig = {
      name: "billing",
      rootTable: "billing",
      rootPk: "id",
      children: [],
    };
    await connector.installTriggers([entity]);

    await pool.query("INSERT INTO billing (amount, status) VALUES (12345.67, 'paid')");

    const [logs] = await pool.query("SELECT * FROM __ev_changelog WHERE table_name = 'billing'");
    assert(logs.length >= 1);
    const newVals = typeof logs[logs.length - 1].new_values === "string"
      ? JSON.parse(logs[logs.length - 1].new_values)
      : logs[logs.length - 1].new_values;
    assert(newVals.amount !== undefined, "amount should be captured");
  } finally {
    await teardown();
  }
});

Deno.test("MySQL edge case - bulk INSERT captures all rows", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    const entity: EntityConfig = {
      name: "course",
      rootTable: "course",
      rootPk: "id",
      children: [],
    };
    await connector.installTriggers([entity]);

    await pool.query(
      "INSERT INTO course (name) VALUES ('Bulk 1'), ('Bulk 2'), ('Bulk 3'), ('Bulk 4'), ('Bulk 5')",
    );

    const [logs] = await pool.query("SELECT * FROM __ev_changelog WHERE operation = 'INSERT'");
    assert(logs.length >= 5, `Expected >= 5 changelog entries for bulk insert, got ${logs.length}`);
  } finally {
    await teardown();
  }
});

Deno.test("MySQL edge case - empty database tables list", async () => {
  connector = await createMySQLTestConnector();
  const pool = connector.getPool();
  // Clean everything
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  const [tables] = await pool.query(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
  `);
  for (const t of tables) {
    await pool.query(`DROP TABLE IF EXISTS \`${t.TABLE_NAME}\``);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");

  try {
    const result = await connector.getTables();
    assertEquals(result.length, 0, "Empty database should return empty tables list");
  } finally {
    await connector.disconnect();
  }
});

Deno.test("MySQL edge case - table without PK detected correctly", async () => {
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

Deno.test("MySQL edge case - identifiers with special characters", async () => {
  connector = await createMySQLTestConnector();
  const pool = connector.getPool();
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  await pool.query("DROP TABLE IF EXISTS `weird-table`");
  await pool.query("DROP TABLE IF EXISTS __ev_changelog");
  await pool.query("DROP TABLE IF EXISTS __ev_schema_snapshots");
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");

  try {
    await pool.query(`
      CREATE TABLE \`weird-table\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`column-with-dashes\` TEXT
      )
    `);

    const tables = await connector.getTables();
    const weirdTable = tables.find((t) => t.name === "weird-table");
    assert(weirdTable, "Should find table with special characters");
  } finally {
    await pool.query("DROP TABLE IF EXISTS `weird-table`");
    await connector.disconnect();
  }
});
