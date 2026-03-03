import type {
  EntityConfig,
  HealthCheckResult,
  SchemaDriftEntry,
  ColumnInfo,
} from "../../connector/interface.ts";
import type { Sql } from "./types.ts";

export async function healthCheck(
  pool: Sql,
  entities: EntityConfig[],
): Promise<HealthCheckResult> {
  const missingTriggers: string[] = [];
  const schemaDrift: SchemaDriftEntry[] = [];

  // Check triggers — MySQL uses 3 triggers per table (insert/update/delete)
  const expectedTriggers: string[] = [];
  for (const entity of entities) {
    const tables = [entity.rootTable, ...entity.children.map((c) => c.table)];
    for (const table of tables) {
      expectedTriggers.push(`__ev_trigger_${table}_insert`);
      expectedTriggers.push(`__ev_trigger_${table}_update`);
      expectedTriggers.push(`__ev_trigger_${table}_delete`);
    }
  }

  const [existingTriggers] = await pool.query(`
    SELECT TRIGGER_NAME
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()
      AND TRIGGER_NAME LIKE '__ev_trigger_%'
  `);
  const existingSet = new Set(
    existingTriggers.map((t: Record<string, string>) => t.TRIGGER_NAME),
  );

  for (const expected of expectedTriggers) {
    if (!existingSet.has(expected)) {
      missingTriggers.push(expected);
    }
  }

  // Check schema drift
  for (const entity of entities) {
    const allTables = [entity.rootTable, ...entity.children.map((c) => c.table)];
    for (const table of allTables) {
      const drift = await checkTableDrift(pool, table);
      if (drift) schemaDrift.push(drift);
    }
  }

  return {
    ok: missingTriggers.length === 0 && schemaDrift.length === 0,
    missingTriggers,
    schemaDrift,
  };
}

async function checkTableDrift(
  pool: Sql,
  table: string,
): Promise<SchemaDriftEntry | null> {
  const [snapshots] = await pool.query(
    `SELECT columns FROM __ev_schema_snapshots
     WHERE table_name = ?
     ORDER BY captured_at DESC LIMIT 1`,
    [table],
  );

  if (snapshots.length === 0) return null;

  const rawCols = snapshots[0].columns;
  const snapshotCols: ColumnInfo[] = typeof rawCols === "string" ? JSON.parse(rawCols) : rawCols;
  const snapshotColNames = new Set(snapshotCols.map((c: ColumnInfo) => c.name));

  const [currentCols] = await pool.query(
    `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table],
  );
  const currentColNames = new Set<string>(
    currentCols.map((c: Record<string, string>) => c.column_name),
  );

  const addedColumns: string[] = [];
  const removedColumns: string[] = [];
  const modifiedColumns: string[] = [];

  for (const name of currentColNames) {
    if (!snapshotColNames.has(name)) addedColumns.push(name as string);
  }
  for (const name of snapshotColNames) {
    if (!currentColNames.has(name)) removedColumns.push(name as string);
  }

  for (const col of currentCols) {
    const snapCol = snapshotCols.find((c: ColumnInfo) => c.name === col.column_name);
    if (snapCol) {
      if (
        snapCol.dataType !== col.data_type ||
        snapCol.nullable !== (col.is_nullable === "YES")
      ) {
        modifiedColumns.push(col.column_name);
      }
    }
  }

  if (addedColumns.length === 0 && removedColumns.length === 0 && modifiedColumns.length === 0) {
    return null;
  }

  return { table, addedColumns, removedColumns, modifiedColumns };
}
