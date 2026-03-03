import { assertEquals } from "@std/assert";
import { createTestConnector, loadFixture, cleanDatabase } from "../../test-helpers.ts";
import type { PostgresConnector } from "../../../src/connectors/postgres/index.ts";
import type { EntityConfig } from "../../../src/connector/interface.ts";

let connector: PostgresConnector;

const entities: EntityConfig[] = [
  {
    name: "course",
    rootTable: "course",
    rootPk: "id",
    children: [{ table: "course_upsell", fkColumn: "courseId" }],
  },
];

async function setup() {
  connector = await createTestConnector();
  await cleanDatabase(connector);
  await loadFixture(connector);
}

async function teardownDb() {
  await cleanDatabase(connector);
  await connector.disconnect();
}

Deno.test("teardown - removes all __ev_ objects", async () => {
  await setup();
  try {
    const sql = connector.getSql();
    await connector.createChangelogTables();
    await connector.installTriggers(entities);

    const result = await connector.teardown();
    assertEquals(result.droppedTables.length, 2); // changelog + snapshots

    // Verify nothing remains
    const triggers = await sql`
      SELECT tgname FROM pg_trigger WHERE tgname LIKE '__ev_%'
    `;
    assertEquals(triggers.length, 0);

    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE '__ev_%'
    `;
    assertEquals(tables.length, 0);

    const fns = await sql`
      SELECT proname FROM pg_proc WHERE proname LIKE '__ev_%'
    `;
    assertEquals(fns.length, 0);
  } finally {
    await teardownDb();
  }
});

Deno.test("teardown - idempotent (running twice doesn't fail)", async () => {
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
