import type { TableInfo, ForeignKeyInfo, ColumnInfo, SchemaSnapshot } from "../../connector/interface.ts";
import type { Sql } from "./types.ts";

export async function getTables(sql: Sql): Promise<TableInfo[]> {
  const rows = await sql`
    SELECT
      t.table_schema AS schema,
      t.table_name AS name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    LEFT JOIN information_schema.table_constraints tc
      ON tc.table_schema = t.table_schema
      AND tc.table_name = t.table_name
      AND tc.constraint_type = 'PRIMARY KEY'
    LEFT JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
      AND kcu.column_name = c.column_name
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT LIKE '__ev_%'
    ORDER BY t.table_name, c.ordinal_position
  `;

  const tableMap = new Map<string, TableInfo>();
  for (const row of rows) {
    const key = `${row.schema}.${row.name}`;
    if (!tableMap.has(key)) {
      tableMap.set(key, { name: row.name, schema: row.schema, columns: [] });
    }
    tableMap.get(key)!.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
      isPrimaryKey: row.is_primary_key === true,
    });
  }
  return Array.from(tableMap.values());
}

export async function getForeignKeys(sql: Sql): Promise<ForeignKeyInfo[]> {
  const rows = await sql`
    SELECT
      kcu.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.constraint_name
  `;

  return rows.map((row: Record<string, string>) => ({
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toTable: row.to_table,
    toColumn: row.to_column,
    constraintName: row.constraint_name,
  }));
}

export async function getSchemaSnapshot(
  sql: Sql,
  tables: string[],
): Promise<SchemaSnapshot> {
  const result: SchemaSnapshot = {
    tables: {},
    capturedAt: new Date(),
  };

  for (const table of tables) {
    const rows = await sql`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
      FROM information_schema.columns c
      LEFT JOIN information_schema.table_constraints tc
        ON tc.table_schema = c.table_schema
        AND tc.table_name = c.table_name
        AND tc.constraint_type = 'PRIMARY KEY'
      LEFT JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
        AND kcu.column_name = c.column_name
      WHERE c.table_schema = 'public'
        AND c.table_name = ${table}
      ORDER BY c.ordinal_position
    `;

    result.tables[table] = rows.map((row: Record<string, unknown>): ColumnInfo => ({
      name: row.column_name as string,
      dataType: row.data_type as string,
      nullable: row.is_nullable === "YES",
      isPrimaryKey: row.is_primary_key === true,
    }));
  }

  return result;
}
