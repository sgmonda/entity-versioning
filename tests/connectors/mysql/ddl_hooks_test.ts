import { assertEquals } from "@std/assert";
import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../../test-helpers-mysql.ts";
import type { MySQLConnector } from "../../../src/connectors/mysql/index.ts";

let connector: MySQLConnector;

async function setup() {
  connector = await createMySQLTestConnector();
  await cleanMySQLDatabase(connector);
  await loadMySQLFixture(connector);
}

async function teardown() {
  await cleanMySQLDatabase(connector);
  await connector.disconnect();
}

Deno.test("MySQL ddl-hooks - installDdlHooks returns not supported", async () => {
  await setup();
  try {
    await connector.createChangelogTables();

    const result = await connector.installDdlHooks(["course"]);
    assertEquals(result.supported, false);
    assertEquals(result.installed, false);
    assertEquals(result.mechanism, "none");
  } finally {
    await teardown();
  }
});

Deno.test("MySQL ddl-hooks - dropDdlHooks is no-op", async () => {
  await setup();
  try {
    const { dropDdlHooks } = await import("../../../src/connectors/mysql/ddl-hooks.ts");
    const dropped = await dropDdlHooks(connector.getPool());
    assertEquals(dropped.length, 0);
  } finally {
    await teardown();
  }
});
