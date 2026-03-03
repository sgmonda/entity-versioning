import { assertEquals, assert } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";

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

Deno.test("introspect - getTables returns all expected tables", async () => {
  await setup();
  try {
    const tables = await connector.getTables();
    const tableNames = tables.map((t) => t.name).sort();

    // The fixture has these tables
    const expected = [
      "activity_answer", "billing", "billing_bonus_course_tutor",
      "billing_line", "billing_rate_incentive", "bi_calendar",
      "category", "chat", "class", "class_evaluations",
      "class_feedback_teacher", "class_history", "class_issue",
      "country", "course", "course_forum_topic", "course_service",
      "course_state", "course_teacher_blacklist", "course_upsell",
      "course_users_user", "language", "migrations",
      "tracking_event", "user",
    ].sort();

    for (const name of expected) {
      assert(tableNames.includes(name), `Missing table: ${name}`);
    }
  } finally {
    await teardown();
  }
});

Deno.test("introspect - getTables detects column info correctly", async () => {
  await setup();
  try {
    const tables = await connector.getTables();
    const course = tables.find((t) => t.name === "course");
    assert(course, "course table not found");
    assert(course.columns.length > 0, "course should have columns");

    const idCol = course.columns.find((c) => c.name === "id");
    assert(idCol, "course.id column not found");
    assertEquals(idCol.isPrimaryKey, true);
    assertEquals(idCol.nullable, false);
  } finally {
    await teardown();
  }
});

Deno.test("introspect - getTables detects PKs correctly", async () => {
  await setup();
  try {
    const tables = await connector.getTables();
    const billing = tables.find((t) => t.name === "billing");
    assert(billing, "billing table not found");
    const pkCols = billing.columns.filter((c) => c.isPrimaryKey);
    assertEquals(pkCols.length, 1);
    assertEquals(pkCols[0].name, "id");
  } finally {
    await teardown();
  }
});

Deno.test("introspect - getForeignKeys returns all FK relationships", async () => {
  await setup();
  try {
    const fks = await connector.getForeignKeys();
    assert(fks.length > 0, "Should have foreign keys");

    // Check course_upsell -> course FK
    const courseUpsellFk = fks.find(
      (fk) => fk.fromTable === "course_upsell" && fk.toTable === "course",
    );
    assert(courseUpsellFk, "course_upsell -> course FK not found");
    assertEquals(courseUpsellFk.fromColumn, "courseId");
  } finally {
    await teardown();
  }
});

Deno.test("introspect - tables without PK", async () => {
  await setup();
  try {
    const tables = await connector.getTables();
    const tracking = tables.find((t) => t.name === "tracking_event");
    assert(tracking, "tracking_event table not found");
    const pkCols = tracking.columns.filter((c) => c.isPrimaryKey);
    assertEquals(pkCols.length, 0, "tracking_event should have no PK");
  } finally {
    await teardown();
  }
});

Deno.test("introspect - tables without FKs", async () => {
  await setup();
  try {
    const fks = await connector.getForeignKeys();
    const migrationsFks = fks.filter(
      (fk) => fk.fromTable === "migrations" || fk.toTable === "migrations",
    );
    assertEquals(migrationsFks.length, 0, "migrations should have no FKs");
  } finally {
    await teardown();
  }
});
