import { assertEquals, assert } from "@std/assert";
import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../../test-helpers-mysql.ts";
import type { MySQLConnector } from "../../../src/connectors/mysql/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

let connector: MySQLConnector;

const courseEntity: EntityConfig = {
  name: "course",
  rootTable: "course",
  rootPk: "id",
  children: [{ table: "course_upsell", fkColumn: "courseId" }],
};

async function setup() {
  connector = await createMySQLTestConnector();
  await cleanMySQLDatabase(connector);
  await loadMySQLFixture(connector);
}

async function teardown() {
  await cleanMySQLDatabase(connector);
  await connector.disconnect();
}

Deno.test("MySQL health check - all triggers installed -> ok=true", async () => {
  await setup();
  try {
    await connector.createChangelogTables();

    const pool = connector.getPool();
    const snapshot = await connector.getSchemaSnapshot(["course", "course_upsell"]);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await pool.query(
        "INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (?, ?)",
        [table, JSON.stringify(columns)],
      );
    }

    await connector.installTriggers([courseEntity]);

    const result = await connector.healthCheck([courseEntity]);
    assertEquals(result.ok, true);
    assertEquals(result.missingTriggers.length, 0);
    assertEquals(result.schemaDrift.length, 0);
  } finally {
    await teardown();
  }
});

Deno.test("MySQL health check - missing trigger detected", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();

    const snapshot = await connector.getSchemaSnapshot(["course", "course_upsell"]);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await pool.query(
        "INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (?, ?)",
        [table, JSON.stringify(columns)],
      );
    }

    await connector.installTriggers([courseEntity]);

    // Manually drop one trigger
    await pool.query("DROP TRIGGER IF EXISTS __ev_trigger_course_insert");

    const result = await connector.healthCheck([courseEntity]);
    assertEquals(result.ok, false);
    assert(result.missingTriggers.includes("__ev_trigger_course_insert"));
  } finally {
    await teardown();
  }
});

Deno.test("MySQL health check - schema drift detected", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();

    const snapshot = await connector.getSchemaSnapshot(["course", "course_upsell"]);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await pool.query(
        "INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (?, ?)",
        [table, JSON.stringify(columns)],
      );
    }

    await connector.installTriggers([courseEntity]);

    // Alter schema without updating snapshot
    await pool.query("ALTER TABLE course ADD COLUMN test_drift_col INT");

    const result = await connector.healthCheck([courseEntity]);
    assertEquals(result.ok, false);
    const courseDrift = result.schemaDrift.find((d) => d.table === "course");
    assert(courseDrift, "Should detect drift on course");
    assert(courseDrift.addedColumns.includes("test_drift_col"));
  } finally {
    await teardown();
  }
});
