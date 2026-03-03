import { assertEquals, assert } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";
import { buildChangesets } from "../../../src/core/changeset-builder.ts";

let connector: PostgresConnector;

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
  connector = await createTestConnector();
  await cleanDatabase(connector);
  await loadFixture(connector);
}

async function teardown() {
  await cleanDatabase(connector);
  await connector.disconnect();
}

Deno.test("E2E - full lifecycle: start -> capture -> log -> stop -> restart -> teardown", async () => {
  await setup();
  try {
    const sql = connector.getSql();

    // 1. Start: create tables, install triggers
    await connector.createChangelogTables();
    const allTables = entities.flatMap((e) => [e.rootTable, ...e.children.map((c) => c.table)]);
    const snapshot = await connector.getSchemaSnapshot(allTables);
    for (const [table, columns] of Object.entries(snapshot.tables)) {
      await sql`INSERT INTO __ev_schema_snapshots (table_name, columns) VALUES (${table}, ${JSON.stringify(columns)})`;
    }
    const trigResult = await connector.installTriggers(entities);
    assert(trigResult.installed > 0);
    assertEquals(trigResult.errors.length, 0);

    // 2. Health check should be OK
    let health = await connector.healthCheck(entities);
    assertEquals(health.ok, true);

    // 3. Perform operations
    // INSERT course
    await sql`INSERT INTO course (name, "startDate") VALUES ('E2E Course', '2026-01-01')`;
    const [{ id: courseId }] = await sql`SELECT id FROM course WHERE name = 'E2E Course'`;

    // INSERT child in transaction
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (tx: any) => {
      await tx`INSERT INTO course_upsell ("courseId", licenses) VALUES (${courseId}, 10)`;
      await tx`INSERT INTO course_service ("courseId", "serviceName") VALUES (${courseId}, 'Support')`;
    });

    // UPDATE
    await sql`UPDATE course SET name = 'Updated E2E' WHERE id = ${courseId}`;

    // DELETE
    await sql`INSERT INTO course (name) VALUES ('ToDelete')`;
    const [{ id: deleteId }] = await sql`SELECT id FROM course WHERE name = 'ToDelete'`;
    await sql`DELETE FROM course WHERE id = ${deleteId}`;

    // 4. Query and verify changelog
    const entries = await connector.queryChangelog({ entityType: "course", entityId: String(courseId) });
    assert(entries.length >= 3, `Expected >= 3 entries, got ${entries.length}`);

    // Verify changesets are grouped
    const changesets = buildChangesets(entries, 500);
    assert(changesets.length >= 2, "Should have multiple changesets");

    // 5. Check transaction grouping
    const txEntries = entries.filter(
      (e) => e.tableName === "course_upsell" || e.tableName === "course_service",
    );
    if (txEntries.length >= 2) {
      assertEquals(
        txEntries[0].transactionId,
        txEntries[1].transactionId,
        "Transaction entries should share txid",
      );
    }

    // 6. Schema drift detection
    await sql.unsafe(`ALTER TABLE course ADD COLUMN e2e_test_col VARCHAR(50)`);
    health = await connector.healthCheck(entities);
    const drift = health.schemaDrift.find((d) => d.table === "course");
    assert(drift, "Should detect drift on course");
    assert(drift.addedColumns.includes("e2e_test_col"));

    // 7. Stop: drop triggers, keep data
    const { dropTriggers } = await import("../../../src/connectors/postgres/triggers.ts");
    await dropTriggers(sql);

    const triggersAfterStop = await sql`
      SELECT tgname FROM pg_trigger WHERE tgname LIKE '__ev_trigger_%'
    `;
    assertEquals(triggersAfterStop.length, 0);

    // Data preserved
    const logCount = await sql`SELECT COUNT(*) as cnt FROM __ev_changelog`;
    assert(Number(logCount[0].cnt) > 0, "Changelog data should be preserved after stop");

    // 8. Restart: re-install triggers
    const restartResult = await connector.installTriggers(entities);
    assert(restartResult.installed > 0);

    // 9. Teardown: remove everything
    const teardownResult = await connector.teardown();
    assert(teardownResult.droppedTriggers.length > 0);
    assert(teardownResult.droppedTables.length > 0);

    // Verify 0 __ev_ objects remain
    const remaining = await sql`
      SELECT tgname FROM pg_trigger WHERE tgname LIKE '__ev_%'
    `;
    assertEquals(remaining.length, 0);

    const remainingTables = await sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '__ev_%'
    `;
    assertEquals(remainingTables.length, 0);
  } finally {
    await teardown();
  }
});
