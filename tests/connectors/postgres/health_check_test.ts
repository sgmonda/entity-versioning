import { assertEquals, assert } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

let connector: PostgresConnector;

const courseEntity: EntityConfig = {
  name: "course",
  rootTable: "course",
  rootPk: "id",
  children: [{ table: "course_upsell", fkColumn: "courseId" }],
};

async function setup() {
  connector = await createTestConnector();
  await cleanDatabase(connector);
  await loadFixture(connector);
}

async function teardown() {
  await cleanDatabase(connector);
  await connector.disconnect();
}

Deno.test("health check - all triggers installed -> ok=true", async () => {
  await setup();
  try {
    await connector.createChangelogTables();

    // Take snapshot
    const sql = connector.getSql();
    const snapshot = await connector.getSchemaSnapshot(["course", "course_upsell"]);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await sql`INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (${table}, ${JSON.stringify(columns)})`;
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

Deno.test("health check - missing trigger detected", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    const snapshot = await connector.getSchemaSnapshot(["course", "course_upsell"]);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await sql`INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (${table}, ${JSON.stringify(columns)})`;
    }

    await connector.installTriggers([courseEntity]);

    // Manually drop one trigger
    await sql.unsafe(`DROP TRIGGER IF EXISTS __ev_trigger_course ON course`);

    const result = await connector.healthCheck([courseEntity]);
    assertEquals(result.ok, false);
    assert(result.missingTriggers.includes("__ev_trigger_course"));
  } finally {
    await teardown();
  }
});

Deno.test("health check - schema drift detected", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    // Take snapshot
    const snapshot = await connector.getSchemaSnapshot(["course", "course_upsell"]);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await sql`INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (${table}, ${JSON.stringify(columns)})`;
    }

    await connector.installTriggers([courseEntity]);

    // Alter schema without updating snapshot
    await sql.unsafe(`ALTER TABLE course ADD COLUMN test_drift_col INTEGER`);

    const result = await connector.healthCheck([courseEntity]);
    assertEquals(result.ok, false);
    const courseDrift = result.schemaDrift.find((d) => d.table === "course");
    assert(courseDrift, "Should detect drift on course");
    assert(courseDrift.addedColumns.includes("test_drift_col"));
  } finally {
    await teardown();
  }
});
