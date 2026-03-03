import { assertEquals } from "@std/assert";
import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../../test-helpers-mysql.ts";
import type { MySQLConnector } from "../../../src/connectors/mysql/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

let connector: MySQLConnector;

const entities: EntityConfig[] = [
  {
    name: "course",
    rootTable: "course",
    rootPk: "id",
    children: [{ table: "course_upsell", fkColumn: "courseId" }],
  },
];

async function setup() {
  connector = await createMySQLTestConnector();
  await cleanMySQLDatabase(connector);
  await loadMySQLFixture(connector);
}

async function teardownDb() {
  await cleanMySQLDatabase(connector);
  await connector.disconnect();
}

Deno.test("MySQL teardown - removes all __ev_ objects", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    await connector.installTriggers(entities);

    const result = await connector.teardown();
    assertEquals(result.droppedTables.length, 2); // changelog + snapshots

    // Verify nothing remains
    const [triggers] = await pool.query(`
      SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE '__ev_%'
    `);
    assertEquals(triggers.length, 0);

    const [tables] = await pool.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '__ev_%'
    `);
    assertEquals(tables.length, 0);
  } finally {
    await teardownDb();
  }
});

Deno.test("MySQL teardown - idempotent (running twice doesn't fail)", async () => {
  await setup();
  try {
    await connector.createChangelogTables();
    await connector.installTriggers(entities);

    await connector.teardown();
    await connector.teardown(); // second call should not throw
  } finally {
    await teardownDb();
  }
});
