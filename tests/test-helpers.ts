import { PostgresConnector } from "../src/connectors/postgres/index.ts";
import type { ConnectionConfig } from "../src/connector/interface.ts";

export const TEST_CONFIG: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5433,
  database: "ev_test",
  user: "ev_user",
  password: "ev_pass",
};

export async function createTestConnector(): Promise<PostgresConnector> {
  const connector = new PostgresConnector();
  await connector.connect(TEST_CONFIG);
  return connector;
}

export async function loadFixture(connector: PostgresConnector): Promise<void> {
  const sql = connector.getSql();
  const fixtureSql = await Deno.readTextFile(
    new URL("./fixtures/edtech-schema.sql", import.meta.url),
  );
  await sql.unsafe(fixtureSql);
}

export async function cleanDatabase(connector: PostgresConnector): Promise<void> {
  const sql = connector.getSql();
  // Drop all __ev_ objects first
  try {
    const evtTriggers = await sql`SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'`;
    for (const et of evtTriggers) {
      await sql.unsafe(`DROP EVENT TRIGGER IF EXISTS ${et.evtname}`);
    }
  } catch { /* ignore */ }

  try {
    const triggers = await sql`
      SELECT tgname, c.relname FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      WHERE tgname LIKE '__ev_%'
    `;
    for (const t of triggers) {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${t.tgname} ON "${t.relname}"`);
    }
  } catch { /* ignore */ }

  try {
    const fns = await sql`SELECT proname FROM pg_proc WHERE proname LIKE '__ev_%'`;
    for (const f of fns) {
      await sql.unsafe(`DROP FUNCTION IF EXISTS ${f.proname} CASCADE`);
    }
  } catch { /* ignore */ }

  await sql.unsafe(`DROP TABLE IF EXISTS __ev_changelog CASCADE`);
  await sql.unsafe(`DROP TABLE IF EXISTS __ev_schema_snapshots CASCADE`);

  // Drop fixture tables
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  `;
  for (const t of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
  }
}
