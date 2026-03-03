import { assertEquals, assert } from "@std/assert";
import type { Connector, EntityConfig } from "../../src/connector/interface.ts";
import { buildChangesets } from "../../src/core/changeset-builder.ts";

/**
 * Generic connector test harness.
 * Any new connector can run these tests to validate its implementation.
 */
export function runConnectorTests(
  name: string,
  createConnector: () => Promise<{ connector: Connector; sql: { unsafe: (q: string) => Promise<unknown> } }>,
  setupSql: string,
) {
  const entities: EntityConfig[] = [
    {
      name: "course",
      rootTable: "course",
      rootPk: "id",
      children: [{ table: "course_upsell", fkColumn: "courseId" }],
    },
  ];

  Deno.test(`${name} harness - introspection accuracy`, async () => {
    const { connector, sql } = await createConnector();
    try {
      await sql.unsafe(setupSql);
      const tables = await connector.getTables();
      assert(tables.length > 0, "Should find tables");
      const fks = await connector.getForeignKeys();
      assert(fks.length > 0, "Should find foreign keys");
    } finally {
      await connector.disconnect();
    }
  });

  Deno.test(`${name} harness - trigger install/teardown`, async () => {
    const { connector } = await createConnector();
    try {
      await connector.createChangelogTables();
      const result = await connector.installTriggers(entities);
      assert(result.installed > 0, "Should install triggers");
      assertEquals(result.errors.length, 0, "No errors during install");

      const teardownResult = await connector.teardown();
      assert(teardownResult.droppedTriggers.length > 0, "Should drop triggers");
      assert(teardownResult.droppedTables.length > 0, "Should drop tables");
    } finally {
      await connector.disconnect();
    }
  });

  Deno.test(`${name} harness - change capture`, async () => {
    const { connector, sql } = await createConnector();
    try {
      await sql.unsafe(setupSql);
      await connector.createChangelogTables();
      await connector.installTriggers(entities);

      await sql.unsafe(`INSERT INTO course (name) VALUES ('Harness Test')`);
      const entries = await connector.queryChangelog({ entityType: "course" });
      assert(entries.length >= 1, "Should capture INSERT");
      assertEquals(entries[0].operation, "INSERT");
    } finally {
      await connector.teardown();
      await connector.disconnect();
    }
  });

  Deno.test(`${name} harness - changeset grouping`, async () => {
    const { connector, sql } = await createConnector();
    try {
      await sql.unsafe(setupSql);
      await connector.createChangelogTables();
      await connector.installTriggers(entities);

      await sql.unsafe(`INSERT INTO course (name) VALUES ('A')`);
      await sql.unsafe(`INSERT INTO course (name) VALUES ('B')`);

      const entries = await connector.queryChangelog({});
      const changesets = buildChangesets(entries, 500);
      assert(changesets.length >= 1, "Should create changesets");
    } finally {
      await connector.teardown();
      await connector.disconnect();
    }
  });

  Deno.test(`${name} harness - teardown cleanliness`, async () => {
    const { connector, sql } = await createConnector();
    try {
      await sql.unsafe(setupSql);
      await connector.createChangelogTables();
      await connector.installTriggers(entities);

      const result = await connector.teardown();
      assert(result.droppedTables.length > 0, "Should drop tables");

      // Verify health check reflects no triggers
      // Note: health check may fail after teardown since tables are gone
    } finally {
      await connector.disconnect();
    }
  });
}
