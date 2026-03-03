import { createTestConnector, loadFixture, cleanDatabase } from "../test-helpers.ts";
import { runConnectorTests } from "./connector-tests.ts";

const setupSql = await Deno.readTextFile(
  new URL("../fixtures/edtech-schema.sql", import.meta.url),
);

runConnectorTests(
  "PostgreSQL",
  async () => {
    const connector = await createTestConnector();
    await cleanDatabase(connector);
    await loadFixture(connector);
    const sql = connector.getSql();
    return {
      connector,
      sql: { unsafe: (q: string) => sql.unsafe(q) },
    };
  },
  setupSql,
);
