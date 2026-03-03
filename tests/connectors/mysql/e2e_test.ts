import { assertEquals, assert } from "@std/assert";
import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../../test-helpers-mysql.ts";
import type { MySQLConnector } from "../../../src/connectors/mysql/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";
import { buildChangesets } from "../../../src/core/changeset-builder.ts";

let connector: MySQLConnector;

const entities: EntityConfig[] = [
  {
    name: "course",
    rootTable: "course",
    rootPk: "id",
    children: [
      { table: "course_upsell", fkColumn: "courseId" },
      { table: "course_service", fkColumn: "courseId" },
    ],
  },
  {
    name: "billing",
    rootTable: "billing",
    rootPk: "id",
    children: [{ table: "billing_line", fkColumn: "billingId" }],
  },
  {
    name: "class",
    rootTable: "class",
    rootPk: "id",
    children: [
      { table: "class_evaluations", fkColumn: "classId" },
      { table: "chat", fkColumn: "classId" },
    ],
  },
];

async function setup() {
  connector = await createMySQLTestConnector();
  await cleanMySQLDatabase(connector);
  await loadMySQLFixture(connector);
}

async function teardown() {
  await cleanMySQLDatabase(connector);
  await connector.disconnect();
}

Deno.test("MySQL E2E - full lifecycle: start -> capture -> log -> stop -> restart -> teardown", async () => {
  await setup();
  try {
    const pool = connector.getPool();

    // 1. Start: create tables, install triggers
    await connector.createChangelogTables();
    const allTables = entities.flatMap((e) => [e.rootTable, ...e.children.map((c) => c.table)]);
    const snapshot = await connector.getSchemaSnapshot(allTables);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await pool.query(
        "INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (?, ?)",
        [table, JSON.stringify(columns)],
      );
    }
    const trigResult = await connector.installTriggers(entities);
    assert(trigResult.installed > 0);
    assertEquals(trigResult.errors.length, 0);

    // 2. Health check should be OK
    let health = await connector.healthCheck(entities);
    assertEquals(health.ok, true);

    // 3. Perform operations
    await pool.query("INSERT INTO course (name, `startDate`) VALUES ('E2E Course', '2026-01-01')");
    const [[{ id: courseId }]] = await pool.query("SELECT id FROM course WHERE name = 'E2E Course'");

    // INSERT children
    await pool.query("INSERT INTO course_upsell (`courseId`, licenses) VALUES (?, 10)", [courseId]);
    await pool.query("INSERT INTO course_service (`courseId`, `serviceName`) VALUES (?, 'Support')", [courseId]);

    // UPDATE
    await pool.query("UPDATE course SET name = 'Updated E2E' WHERE id = ?", [courseId]);

    // DELETE
    await pool.query("INSERT INTO course (name) VALUES ('ToDelete')");
    const [[{ id: deleteId }]] = await pool.query("SELECT id FROM course WHERE name = 'ToDelete'");
    await pool.query("DELETE FROM course WHERE id = ?", [deleteId]);

    // 4. Query and verify changelog
    const entries = await connector.queryChangelog({ entityType: "course", entityId: String(courseId) });
    assert(entries.length >= 3, `Expected >= 3 entries, got ${entries.length}`);

    // Verify changesets are created (MySQL uses UUID per trigger, so grouping
    // depends on the autocommit_grouping_window_ms; at least 1 changeset)
    const changesets = buildChangesets(entries, 500);
    assert(changesets.length >= 1, "Should create changesets");

    // 5. Schema drift detection
    await pool.query("ALTER TABLE course ADD COLUMN e2e_test_col VARCHAR(50)");
    health = await connector.healthCheck(entities);
    const drift = health.schemaDrift.find((d) => d.table === "course");
    assert(drift, "Should detect drift on course");
    assert(drift.addedColumns.includes("e2e_test_col"));

    // 6. Stop: drop triggers, keep data
    const { dropTriggers } = await import("../../../src/connectors/mysql/triggers.ts");
    await dropTriggers(pool);

    const [triggersAfterStop] = await pool.query(`
      SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE '__ev_trigger_%'
    `);
    assertEquals(triggersAfterStop.length, 0);

    // Data preserved
    const [[{ cnt }]] = await pool.query("SELECT COUNT(*) as cnt FROM __ev_changelog");
    assert(Number(cnt) > 0, "Changelog data should be preserved after stop");

    // 7. Restart: re-install triggers
    const restartResult = await connector.installTriggers(entities);
    assert(restartResult.installed > 0);

    // 8. Teardown: remove everything
    const teardownResult = await connector.teardown();
    assert(teardownResult.droppedTriggers.length > 0);
    assert(teardownResult.droppedTables.length > 0);

    // Verify 0 __ev_ objects remain
    const [remaining] = await pool.query(`
      SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE '__ev_%'
    `);
    assertEquals(remaining.length, 0);

    const [remainingTables] = await pool.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '__ev_%'
    `);
    assertEquals(remainingTables.length, 0);
  } finally {
    await teardown();
  }
});
