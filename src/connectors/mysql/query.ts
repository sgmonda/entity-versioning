import type {
  ChangelogEntry,
  ChangelogFilter,
  TransactionGroup,
} from "../../connector/interface.ts";
import type { Sql } from "./types.ts";

export async function queryChangelog(
  pool: Sql,
  filter: ChangelogFilter,
): Promise<ChangelogEntry[]> {
  const conditions: string[] = [];
  // deno-lint-ignore no-explicit-any
  const params: any[] = [];

  if (filter.entityType) {
    conditions.push(`entity_type = ?`);
    params.push(filter.entityType);
  }
  if (filter.entityId) {
    conditions.push(`entity_id = ?`);
    params.push(filter.entityId);
  }
  if (filter.since) {
    conditions.push(`created_at >= ?`);
    params.push(filter.since.toISOString().replace("T", " ").replace("Z", ""));
  }
  if (filter.until) {
    conditions.push(`created_at <= ?`);
    params.push(filter.until.toISOString().replace("T", " ").replace("Z", ""));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ? `LIMIT ${filter.limit}` : "";

  const query = `
    SELECT id, entity_type, entity_id, table_name, row_id, operation,
           old_values, new_values, transaction_id, created_at
    FROM __ev_changelog
    ${where}
    ORDER BY created_at ASC, id ASC
    ${limit}
  `;

  const [rows] = await pool.query(query, params);

  return rows.map((row: Record<string, unknown>): ChangelogEntry => ({
    id: BigInt(row.id as string | number),
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    tableName: row.table_name as string,
    rowId: row.row_id as string,
    operation: row.operation as ChangelogEntry["operation"],
    oldValues: typeof row.old_values === "string" ? JSON.parse(row.old_values) : row.old_values as Record<string, unknown> | null,
    newValues: typeof row.new_values === "string" ? JSON.parse(row.new_values) : row.new_values as Record<string, unknown> | null,
    transactionId: row.transaction_id as string,
    createdAt: new Date(row.created_at as string),
  }));
}

export async function getTransactionGroups(
  pool: Sql,
  filter: ChangelogFilter,
): Promise<TransactionGroup[]> {
  const conditions: string[] = [];
  // deno-lint-ignore no-explicit-any
  const params: any[] = [];

  if (filter.entityType) {
    conditions.push(`entity_type = ?`);
    params.push(filter.entityType);
  }
  if (filter.entityId) {
    conditions.push(`entity_id = ?`);
    params.push(filter.entityId);
  }
  if (filter.since) {
    conditions.push(`created_at >= ?`);
    params.push(filter.since.toISOString().replace("T", " ").replace("Z", ""));
  }
  if (filter.until) {
    conditions.push(`created_at <= ?`);
    params.push(filter.until.toISOString().replace("T", " ").replace("Z", ""));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT transaction_id, COUNT(*) as count,
           MIN(created_at) as min_created_at,
           MAX(created_at) as max_created_at
    FROM __ev_changelog
    ${where}
    GROUP BY transaction_id
    ORDER BY min_created_at ASC
  `;

  const [rows] = await pool.query(query, params);

  return rows.map((row: Record<string, unknown>): TransactionGroup => ({
    transactionId: row.transaction_id as string,
    count: Number(row.count),
    minCreatedAt: new Date(row.min_created_at as string),
    maxCreatedAt: new Date(row.max_created_at as string),
  }));
}
