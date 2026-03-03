import { assertEquals, assert } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

let connector: PostgresConnector;

const courseEntity: EntityConfig = {
  name: "course",
  rootTable: "course",
  rootPk: "id",
  children: [
    { table: "course_upsell", fkColumn: "courseId" },
    { table: "course_service", fkColumn: "courseId" },
  ],
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

Deno.test("ddl-hooks - installDdlHooks installs event trigger", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    const watchedTables = ["course", "course_upsell", "course_service"];
    const result = await connector.installDdlHooks(watchedTables);

    assert(result.installed, "DDL hooks should be installed");
    assertEquals(result.mechanism, "event_trigger");

    // Verify the event trigger exists in pg_event_trigger
    const triggers = await sql`
      SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'
    `;
    assert(triggers.length > 0, "Should have __ev_ event trigger");
    assertEquals(triggers[0].evtname, "__ev_ddl_hook");
  } finally {
    await teardown();
  }
});

Deno.test("ddl-hooks - ALTER TABLE on watched table creates SCHEMA_CHANGE entry", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    // Install triggers and DDL hooks
    await connector.installTriggers([courseEntity]);
    const watchedTables = ["course", "course_upsell", "course_service"];
    await connector.installDdlHooks(watchedTables);

    // Store initial snapshot
    const allTables = ["course", "course_upsell", "course_service"];
    const snapshot = await connector.getSchemaSnapshot(allTables);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await sql`INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (${table}, ${JSON.stringify(columns)})`;
    }

    // Perform a DDL change on a watched table
    await sql.unsafe(`ALTER TABLE course ADD COLUMN ddl_test_col VARCHAR(50)`);

    // Verify SCHEMA_CHANGE entry was created in changelog
    const logs = await sql`
      SELECT * FROM __ev_changelog WHERE operation = 'SCHEMA_CHANGE'
    `;
    assert(logs.length >= 1, "Should have SCHEMA_CHANGE entry");
    assertEquals(logs[0].table_name, "course");
    assertEquals(logs[0].entity_type, "__schema");

    // new_values should contain the updated schema
    assert(logs[0].new_values !== null, "Should have new schema snapshot");
  } finally {
    await teardown();
  }
});

Deno.test("ddl-hooks - ALTER TABLE creates new schema snapshot", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    const watchedTables = ["course", "course_upsell", "course_service"];
    await connector.installDdlHooks(watchedTables);

    // Store initial snapshot
    const snapshot = await connector.getSchemaSnapshot(watchedTables);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await sql`INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (${table}, ${JSON.stringify(columns)})`;
    }

    // Count snapshots before
    const before = await sql`SELECT COUNT(*) as cnt FROM __ev_schema_snapshots WHERE table_name = 'course'`;
    const countBefore = Number(before[0].cnt);

    // Perform DDL change
    await sql.unsafe(`ALTER TABLE course ADD COLUMN ddl_snap_col INTEGER`);

    // Count snapshots after
    const after = await sql`SELECT COUNT(*) as cnt FROM __ev_schema_snapshots WHERE table_name = 'course'`;
    const countAfter = Number(after[0].cnt);

    assert(countAfter > countBefore, "Should have a new snapshot after DDL change");
  } finally {
    await teardown();
  }
});

Deno.test("ddl-hooks - dropDdlHooks removes event trigger", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    const watchedTables = ["course"];
    await connector.installDdlHooks(watchedTables);

    // Verify it exists
    const before = await sql`SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'`;
    assert(before.length > 0, "Event trigger should exist before drop");

    // Drop DDL hooks
    const { dropDdlHooks } = await import("../../../src/connectors/postgres/ddl-hooks.ts");
    const dropped = await dropDdlHooks(sql);
    assert(dropped.length > 0, "Should drop DDL hooks");

    // Verify it's gone
    const after = await sql`SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'`;
    assertEquals(after.length, 0, "Event trigger should be removed");
  } finally {
    await teardown();
  }
});

Deno.test("ddl-hooks - ALTER TABLE on non-watched table does NOT create entry", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();

    // Only watch course, not billing
    const watchedTables = ["course"];
    await connector.installDdlHooks(watchedTables);

    // Alter a non-watched table
    await sql.unsafe(`ALTER TABLE billing ADD COLUMN ddl_unwatched_col INTEGER`);

    // Should have no SCHEMA_CHANGE entries
    const logs = await sql`
      SELECT * FROM __ev_changelog WHERE operation = 'SCHEMA_CHANGE'
    `;
    assertEquals(logs.length, 0, "Should not track DDL on non-watched tables");
  } finally {
    await teardown();
  }
});
