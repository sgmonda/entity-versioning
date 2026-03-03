import { assertEquals, assert } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";
import { generateTriggerSQL } from "../../../src/connectors/postgres/triggers.ts";
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

Deno.test("triggers - generateTriggerSQL for root table", () => {
  const result = generateTriggerSQL(courseEntity, "course", true);
  assert(result.functionSql.includes("__ev_trigger_course_fn"), "Should have function name");
  assert(result.functionSql.includes("'course'"), "Should reference entity type");
  assert(result.functionSql.includes('NEW."id"::TEXT'), "Entity ID from PK");
  assert(result.functionSql.includes("txid_current()"), "Should use txid_current");
  assert(result.triggerSql.includes("__ev_trigger_course"), "Trigger name");
});

Deno.test("triggers - generateTriggerSQL for child table with FK column", () => {
  const result = generateTriggerSQL(courseEntity, "course_upsell", false, "courseId");
  assert(result.functionSql.includes("__ev_trigger_course_upsell_fn"));
  assert(result.functionSql.includes('NEW."courseId"::TEXT'), "Entity ID from FK");
  assert(result.functionSql.includes("'course'"), "Entity type is parent");
});

Deno.test("triggers - install and verify triggers exist in pg_trigger", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    const result = await connector.installTriggers([courseEntity]);

    assertEquals(result.installed, 3); // root + 2 children
    assertEquals(result.errors.length, 0);

    const triggers = await sql`
      SELECT tgname FROM pg_trigger WHERE tgname LIKE '__ev_trigger_%'
    `;
    const names = triggers.map((t: Record<string, string>) => t.tgname);
    assert(names.includes("__ev_trigger_course"));
    assert(names.includes("__ev_trigger_course_upsell"));
    assert(names.includes("__ev_trigger_course_service"));
  } finally {
    await teardown();
  }
});

Deno.test("triggers - INSERT on root table creates changelog entry", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await sql`INSERT INTO course (name, "startDate") VALUES ('Test Course', '2026-01-01')`;

    const logs = await sql`SELECT * FROM __ev_changelog`;
    assertEquals(logs.length, 1);
    assertEquals(logs[0].entity_type, "course");
    assertEquals(logs[0].operation, "INSERT");
    assert(logs[0].new_values !== null);
    assert(logs[0].new_values.name === "Test Course");
  } finally {
    await teardown();
  }
});

Deno.test("triggers - UPDATE on root creates changelog with old and new values", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await sql`INSERT INTO course (name, "startDate") VALUES ('Test', '2026-01-01')`;
    const [{ id }] = await sql`SELECT id FROM course LIMIT 1`;
    await sql`UPDATE course SET name = 'Updated' WHERE id = ${id}`;

    const logs = await sql`SELECT * FROM __ev_changelog WHERE operation = 'UPDATE'`;
    assertEquals(logs.length, 1);
    assertEquals(logs[0].old_values.name, "Test");
    assertEquals(logs[0].new_values.name, "Updated");
  } finally {
    await teardown();
  }
});

Deno.test("triggers - DELETE on root creates changelog with old values", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await sql`INSERT INTO course (name) VALUES ('ToDelete')`;
    const [{ id }] = await sql`SELECT id FROM course LIMIT 1`;
    await sql`DELETE FROM course WHERE id = ${id}`;

    const logs = await sql`SELECT * FROM __ev_changelog WHERE operation = 'DELETE'`;
    assertEquals(logs.length, 1);
    assertEquals(logs[0].old_values.name, "ToDelete");
    assert(logs[0].new_values === null);
  } finally {
    await teardown();
  }
});

Deno.test("triggers - INSERT on child resolves entity_id via FK", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await sql`INSERT INTO course (name) VALUES ('Parent')`;
    const [{ id: courseId }] = await sql`SELECT id FROM course LIMIT 1`;
    await sql`INSERT INTO course_upsell ("courseId", licenses) VALUES (${courseId}, 10)`;

    const logs = await sql`
      SELECT * FROM __ev_changelog
      WHERE table_name = 'course_upsell'
    `;
    assertEquals(logs.length, 1);
    assertEquals(logs[0].entity_type, "course");
    assertEquals(logs[0].entity_id, String(courseId));
  } finally {
    await teardown();
  }
});

Deno.test("triggers - operations in 1 transaction share transaction_id", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    // deno-lint-ignore no-explicit-any
    await sql.begin(async (tx: any) => {
      await tx`INSERT INTO course (name) VALUES ('Tx Course')`;
      const [{ id: courseId }] = await tx`SELECT id FROM course WHERE name = 'Tx Course'`;
      await tx`INSERT INTO course_upsell ("courseId", licenses) VALUES (${courseId}, 5)`;
    });

    const logs = await sql`SELECT DISTINCT transaction_id FROM __ev_changelog`;
    assertEquals(logs.length, 1, "All entries should share the same transaction_id");
  } finally {
    await teardown();
  }
});

Deno.test("triggers - different transactions have different transaction_ids", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await sql`INSERT INTO course (name) VALUES ('First')`;
    await sql`INSERT INTO course (name) VALUES ('Second')`;

    const logs = await sql`SELECT DISTINCT transaction_id FROM __ev_changelog`;
    assertEquals(logs.length, 2, "Separate operations should have different transaction_ids");
  } finally {
    await teardown();
  }
});

Deno.test("triggers - dropTriggers removes all __ev_trigger_*", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    const { dropTriggers } = await import("../../../src/connectors/postgres/triggers.ts");
    const dropped = await dropTriggers(sql);
    assert(dropped.length >= 3);

    const remaining = await sql`
      SELECT tgname FROM pg_trigger WHERE tgname LIKE '__ev_trigger_%'
    `;
    assertEquals(remaining.length, 0);
  } finally {
    await teardown();
  }
});
