import type {
  EntityConfig,
  HealthCheckResult,
  SchemaDriftEntry,
  ColumnInfo,
} from "../../connector/interface.ts";
import type { Sql } from "./types.ts";

export async function healthCheck(
  sql: Sql,
  entities: EntityConfig[],
): Promise<HealthCheckResult> {
  const missingTriggers: string[] = [];
  const schemaDrift: SchemaDriftEntry[] = [];

  // Check triggers
  const expectedTriggers: string[] = [];
  for (const entity of entities) {
    expectedTriggers.push(`__ev_trigger_${entity.rootTable}`);
    for (const child of entity.children) {
      expectedTriggers.push(`__ev_trigger_${child.table}`);
    }
  }

  const existingTriggers = await sql`
    SELECT tgname FROM pg_trigger WHERE tgname LIKE '__ev_trigger_%'
  `;
  const existingSet = new Set(
    existingTriggers.map((t: Record<string, string>) => t.tgname),
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
      const drift = await checkTableDrift(sql, table);
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
  sql: Sql,
  table: string,
): Promise<SchemaDriftEntry | null> {
  const snapshots = await sql`
    SELECT columns FROM __ev_schema_snapshots
    WHERE table_name = ${table}
    ORDER BY captured_at DESC LIMIT 1
  `;

  if (snapshots.length === 0) return null;

  const rawCols = snapshots[0].columns;
  const snapshotCols: ColumnInfo[] = typeof rawCols === "string" ? JSON.parse(rawCols) : rawCols;
  const snapshotColNames = new Set(snapshotCols.map((c: ColumnInfo) => c.name));

  const currentCols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;
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
