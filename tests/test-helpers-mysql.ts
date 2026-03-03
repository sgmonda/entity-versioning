import { MySQLConnector } from "../src/connectors/mysql/index.ts";
import type { ConnectionConfig } from "../src/connector/interface.ts";

export const MYSQL_TEST_CONFIG: ConnectionConfig = {
  engine: "mysql",
  host: "localhost",
  port: 3307,
  database: "ev_test_mysql",
  user: "ev_user",
  password: "ev_pass",
};

export async function createMySQLTestConnector(): Promise<MySQLConnector> {
  const connector = new MySQLConnector();
  await connector.connect(MYSQL_TEST_CONFIG);
  return connector;
}

export async function loadMySQLFixture(connector: MySQLConnector): Promise<void> {
  const pool = connector.getPool();
  const fixtureSql = await Deno.readTextFile(
    new URL("./fixtures/edtech-schema-mysql.sql", import.meta.url),
  );
  // Disable FK checks so CREATE TABLE IF NOT EXISTS works regardless of order
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    // Strip comments and split into individual statements
    const stripped = fixtureSql.replace(/--.*$/gm, "");
    const statements = stripped
      .split(";")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
  } finally {
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

export async function cleanMySQLDatabase(connector: MySQLConnector): Promise<void> {
  const pool = connector.getPool();

  // Drop all __ev_ triggers
  try {
    const [triggers] = await pool.query(`
      SELECT TRIGGER_NAME
      FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME LIKE '__ev_%'
    `);
    for (const t of triggers) {
      await pool.query(`DROP TRIGGER IF EXISTS \`${t.TRIGGER_NAME}\``);
    }
  } catch { /* ignore */ }

  // Drop __ev_ tables
  await pool.query(`DROP TABLE IF EXISTS __ev_changelog`);
  await pool.query(`DROP TABLE IF EXISTS __ev_schema_snapshots`);

  // Drop fixture tables in correct order (children before parents)
  await pool.query(`SET FOREIGN_KEY_CHECKS = 0`);
  try {
    const [tables] = await pool.query(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
    `);
    for (const t of tables) {
      await pool.query(`DROP TABLE IF EXISTS \`${t.TABLE_NAME}\``);
    }
  } finally {
    await pool.query(`SET FOREIGN_KEY_CHECKS = 1`);
  }
}
