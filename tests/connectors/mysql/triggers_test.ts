import { assertEquals, assert } from "@std/assert";
import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../../test-helpers-mysql.ts";
import type { MySQLConnector } from "../../../src/connectors/mysql/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

let connector: MySQLConnector;

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
  connector = await createMySQLTestConnector();
  await cleanMySQLDatabase(connector);
  await loadMySQLFixture(connector);
}

async function teardown() {
  await cleanMySQLDatabase(connector);
  await connector.disconnect();
}

Deno.test("MySQL triggers - install and verify triggers exist", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    const result = await connector.installTriggers([courseEntity]);

    assertEquals(result.installed, 3); // root + 2 children
    assertEquals(result.errors.length, 0);

    const [triggers] = await pool.query(`
      SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE '__ev_trigger_%'
    `);
    const names = triggers.map((t: Record<string, string>) => t.TRIGGER_NAME);
    // MySQL uses 3 triggers per table (insert/update/delete)
    assert(names.includes("__ev_trigger_course_insert"));
    assert(names.includes("__ev_trigger_course_update"));
    assert(names.includes("__ev_trigger_course_delete"));
    assert(names.includes("__ev_trigger_course_upsell_insert"));
    assert(names.includes("__ev_trigger_course_service_insert"));
  } finally {
    await teardown();
  }
});

Deno.test("MySQL triggers - INSERT on root table creates changelog entry", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await pool.query("INSERT INTO course (name, `startDate`) VALUES ('Test Course', '2026-01-01')");

    const [logs] = await pool.query("SELECT * FROM __ev_changelog");
    assertEquals(logs.length, 1);
    assertEquals(logs[0].entity_type, "course");
    assertEquals(logs[0].operation, "INSERT");
    const newValues = typeof logs[0].new_values === "string" ? JSON.parse(logs[0].new_values) : logs[0].new_values;
    assert(newValues !== null);
    assertEquals(newValues.name, "Test Course");
  } finally {
    await teardown();
  }
});

Deno.test("MySQL triggers - UPDATE on root creates changelog with old and new values", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await pool.query("INSERT INTO course (name, `startDate`) VALUES ('Test', '2026-01-01')");
    const [[{ id }]] = await pool.query("SELECT id FROM course LIMIT 1");
    await pool.query("UPDATE course SET name = 'Updated' WHERE id = ?", [id]);

    const [logs] = await pool.query("SELECT * FROM __ev_changelog WHERE operation = 'UPDATE'");
    assertEquals(logs.length, 1);
    const oldValues = typeof logs[0].old_values === "string" ? JSON.parse(logs[0].old_values) : logs[0].old_values;
    const newValues = typeof logs[0].new_values === "string" ? JSON.parse(logs[0].new_values) : logs[0].new_values;
    assertEquals(oldValues.name, "Test");
    assertEquals(newValues.name, "Updated");
  } finally {
    await teardown();
  }
});

Deno.test("MySQL triggers - DELETE on root creates changelog with old values", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await pool.query("INSERT INTO course (name) VALUES ('ToDelete')");
    const [[{ id }]] = await pool.query("SELECT id FROM course LIMIT 1");
    await pool.query("DELETE FROM course WHERE id = ?", [id]);

    const [logs] = await pool.query("SELECT * FROM __ev_changelog WHERE operation = 'DELETE'");
    assertEquals(logs.length, 1);
    const oldValues = typeof logs[0].old_values === "string" ? JSON.parse(logs[0].old_values) : logs[0].old_values;
    assertEquals(oldValues.name, "ToDelete");
    assert(logs[0].new_values === null);
  } finally {
    await teardown();
  }
});

Deno.test("MySQL triggers - INSERT on child resolves entity_id via FK", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await pool.query("INSERT INTO course (name) VALUES ('Parent')");
    const [[{ id: courseId }]] = await pool.query("SELECT id FROM course LIMIT 1");
    await pool.query("INSERT INTO course_upsell (`courseId`, licenses) VALUES (?, 10)", [courseId]);

    const [logs] = await pool.query(
      "SELECT * FROM __ev_changelog WHERE table_name = 'course_upsell'",
    );
    assertEquals(logs.length, 1);
    assertEquals(logs[0].entity_type, "course");
    assertEquals(logs[0].entity_id, String(courseId));
  } finally {
    await teardown();
  }
});

Deno.test("MySQL triggers - different operations have different transaction_ids (UUID)", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    await pool.query("INSERT INTO course (name) VALUES ('First')");
    await pool.query("INSERT INTO course (name) VALUES ('Second')");

    const [logs] = await pool.query("SELECT DISTINCT transaction_id FROM __ev_changelog");
    assertEquals(logs.length, 2, "Separate operations should have different transaction_ids");
  } finally {
    await teardown();
  }
});

Deno.test("MySQL triggers - dropTriggers removes all __ev_trigger_*", async () => {
  await setup();
  try {
    const pool = connector.getPool();
    await connector.createChangelogTables();
    await connector.installTriggers([courseEntity]);

    const { dropTriggers } = await import("../../../src/connectors/mysql/triggers.ts");
    const dropped = await dropTriggers(pool);
    assert(dropped.length >= 9); // 3 tables * 3 triggers each

    const [remaining] = await pool.query(`
      SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE '__ev_trigger_%'
    `);
    assertEquals(remaining.length, 0);
  } finally {
    await teardown();
  }
});
