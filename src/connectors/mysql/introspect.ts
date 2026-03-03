import type { TableInfo, ForeignKeyInfo, ColumnInfo, SchemaSnapshot } from "../../connector/interface.ts";
import type { Sql } from "./types.ts";

export async function getTables(pool: Sql): Promise<TableInfo[]> {
  const [rows] = await pool.query(`
    SELECT
      t.TABLE_SCHEMA AS \`schema\`,
      t.TABLE_NAME AS name,
      c.COLUMN_NAME AS column_name,
      c.DATA_TYPE AS data_type,
      c.IS_NULLABLE AS is_nullable,
      CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
    FROM information_schema.TABLES t
    JOIN information_schema.COLUMNS c
      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
    LEFT JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.TABLE_SCHEMA = t.TABLE_SCHEMA
      AND tc.TABLE_NAME = t.TABLE_NAME
      AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
    LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
      ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
      AND kcu.TABLE_NAME = tc.TABLE_NAME
      AND kcu.COLUMN_NAME = c.COLUMN_NAME
    WHERE t.TABLE_SCHEMA = DATABASE()
      AND t.TABLE_TYPE = 'BASE TABLE'
      AND t.TABLE_NAME NOT LIKE '__ev_%'
    ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
  `);

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
      isPrimaryKey: row.is_primary_key === 1,
    });
  }
  return Array.from(tableMap.values());
}

export async function getForeignKeys(pool: Sql): Promise<ForeignKeyInfo[]> {
  const [rows] = await pool.query(`
    SELECT
      kcu.TABLE_NAME AS from_table,
      kcu.COLUMN_NAME AS from_column,
      kcu.REFERENCED_TABLE_NAME AS to_table,
      kcu.REFERENCED_COLUMN_NAME AS to_column,
      kcu.CONSTRAINT_NAME AS constraint_name
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
      AND tc.TABLE_NAME = kcu.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
      AND kcu.TABLE_SCHEMA = DATABASE()
    ORDER BY kcu.CONSTRAINT_NAME
  `);

  return rows.map((row: Record<string, string>) => ({
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toTable: row.to_table,
    toColumn: row.to_column,
    constraintName: row.constraint_name,
  }));
}

export async function getSchemaSnapshot(
  pool: Sql,
  tables: string[],
): Promise<SchemaSnapshot> {
  const result: SchemaSnapshot = {
    tables: {},
    capturedAt: new Date(),
  };

  for (const table of tables) {
    const [rows] = await pool.query(`
      SELECT
        c.COLUMN_NAME AS column_name,
        c.DATA_TYPE AS data_type,
        c.IS_NULLABLE AS is_nullable,
        CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
      FROM information_schema.COLUMNS c
      LEFT JOIN information_schema.TABLE_CONSTRAINTS tc
        ON tc.TABLE_SCHEMA = c.TABLE_SCHEMA
        AND tc.TABLE_NAME = c.TABLE_NAME
        AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
        AND kcu.TABLE_NAME = tc.TABLE_NAME
        AND kcu.COLUMN_NAME = c.COLUMN_NAME
      WHERE c.TABLE_SCHEMA = DATABASE()
        AND c.TABLE_NAME = ?
      ORDER BY c.ORDINAL_POSITION
    `, [table]);

    result.tables[table] = rows.map((row: Record<string, unknown>): ColumnInfo => ({
      name: row.column_name as string,
      dataType: row.data_type as string,
      nullable: row.is_nullable === "YES",
      isPrimaryKey: row.is_primary_key === 1,
    }));
  }

  return result;
}

export async function getTableColumns(pool: Sql, tableName: string): Promise<string[]> {
  const [rows] = await pool.query(`
    SELECT COLUMN_NAME AS column_name
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [tableName]);
  return rows.map((row: Record<string, string>) => row.column_name);
}
