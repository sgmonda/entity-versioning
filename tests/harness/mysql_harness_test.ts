import { createMySQLTestConnector, loadMySQLFixture, cleanMySQLDatabase } from "../test-helpers-mysql.ts";
import { runConnectorTests } from "./connector-tests.ts";

const setupSql = await Deno.readTextFile(
  new URL("../fixtures/edtech-schema-mysql.sql", import.meta.url),
);

async function execMulti(pool: ReturnType<typeof Object>, query: string): Promise<unknown> {
  // If it looks like multiple statements, split and execute individually
  const stripped = query.replace(/--.*$/gm, "");
  const statements = stripped.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  if (statements.length <= 1) {
    const [rows] = await pool.query(query);
    return rows;
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  let lastResult: unknown = [];
  for (const stmt of statements) {
    const [rows] = await pool.query(stmt);
    lastResult = rows;
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  return lastResult;
}

runConnectorTests(
  "MySQL",
  async () => {
    const connector = await createMySQLTestConnector();
    await cleanMySQLDatabase(connector);
    await loadMySQLFixture(connector);
    // deno-lint-ignore no-explicit-any
    const pool: any = connector.getPool();
    return {
      connector,
      sql: { unsafe: (q: string) => execMulti(pool, q) },
    };
  },
  setupSql,
);
