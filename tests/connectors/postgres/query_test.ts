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

const billingEntity: EntityConfig = {
  name: "billing",
  rootTable: "billing",
  rootPk: "id",
  children: [{ table: "billing_line", fkColumn: "billingId" }],
};

async function setup() {
  connector = await createTestConnector();
  await cleanDatabase(connector);
  await loadFixture(connector);
  await connector.createChangelogTables();
  await connector.installTriggers([courseEntity, billingEntity]);
}

async function teardown() {
  await cleanDatabase(connector);
  await connector.disconnect();
}

Deno.test("query - queryChangelog filters by entity_type", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await sql`INSERT INTO course (name) VALUES ('Course 1')`;
    await sql`INSERT INTO billing (amount) VALUES (100)`;

    const entries = await connector.queryChangelog({ entityType: "course" });
    assert(entries.length >= 1);
    for (const e of entries) {
      assertEquals(e.entityType, "course");
    }
  } finally {
    await teardown();
  }
});

Deno.test("query - queryChangelog filters by entity_id", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await sql`INSERT INTO course (name) VALUES ('A')`;
    await sql`INSERT INTO course (name) VALUES ('B')`;

    const courses = await sql`SELECT id FROM course ORDER BY id`;
    const firstId = String(courses[0].id);

    const entries = await connector.queryChangelog({
      entityType: "course",
      entityId: firstId,
    });
    assert(entries.length >= 1);
    for (const e of entries) {
      assertEquals(e.entityId, firstId);
    }
  } finally {
    await teardown();
  }
});

Deno.test("query - queryChangelog filters by limit", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await sql`INSERT INTO course (name) VALUES ('A')`;
    await sql`INSERT INTO course (name) VALUES ('B')`;
    await sql`INSERT INTO course (name) VALUES ('C')`;

    const entries = await connector.queryChangelog({ limit: 2 });
    assertEquals(entries.length, 2);
  } finally {
    await teardown();
  }
});

Deno.test("query - queryChangelog returns entries ordered by created_at", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await sql`INSERT INTO course (name) VALUES ('First')`;
    await sql`INSERT INTO course (name) VALUES ('Second')`;

    const entries = await connector.queryChangelog({});
    for (let i = 1; i < entries.length; i++) {
      assert(
        entries[i].createdAt.getTime() >= entries[i - 1].createdAt.getTime(),
        "Entries should be ordered by created_at ASC",
      );
    }
  } finally {
    await teardown();
  }
});

Deno.test("query - getTransactionGroups returns distinct groups", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await sql`INSERT INTO course (name) VALUES ('A')`;
    await sql`INSERT INTO course (name) VALUES ('B')`;

    const groups = await connector.getTransactionGroups({});
    assert(groups.length >= 2, "Should have at least 2 transaction groups");
    for (const g of groups) {
      assert(g.transactionId, "Each group should have a transactionId");
      assert(g.count >= 1, "Each group should have count >= 1");
    }
  } finally {
    await teardown();
  }
});
