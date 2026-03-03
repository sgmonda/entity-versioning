import type {
  Connector,
  ChangelogEntry,
  Changeset,
  ChangelogFilter,
} from "../connector/interface.ts";
import { buildChangesets } from "./changeset-builder.ts";

export async function queryEntityHistory(
  connector: Connector,
  entityType: string,
  entityId: string,
  options: {
    since?: Date;
    until?: Date;
    version?: number;
    groupingWindowMs?: number;
  } = {},
): Promise<Changeset[]> {
  const filter: ChangelogFilter = {
    entityType,
    entityId,
    since: options.since,
    until: options.until,
  };

  const entries = await connector.queryChangelog(filter);
  const changesets = buildChangesets(entries, options.groupingWindowMs ?? 500);

  if (options.version !== undefined) {
    return changesets.filter((c) => c.version === options.version);
  }

  return changesets;
}

export function formatChangeset(
  changeset: Changeset,
  format: "text" | "json" = "text",
  verbose: boolean = false,
): string {
  if (format === "json") {
    return JSON.stringify(changeset, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  }

  const lines: string[] = [];
  const txShort = changeset.transactionId.substring(0, 8);
  const dateStr = changeset.timestamp.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

  if (changeset.operations[0]?.operation === "SCHEMA_CHANGE") {
    lines.push(`schema change  ${dateStr}`);
  } else {
    lines.push(`changeset v${changeset.version}  [tx: ${txShort}]  ${dateStr}`);
  }

  // Collect affected tables
  const tables = [...new Set(changeset.operations.map((op) => op.tableName))];
  if (changeset.operations[0]?.operation !== "SCHEMA_CHANGE") {
    lines.push(`  tables: ${tables.join(", ")}`);
  }

  for (const op of changeset.operations) {
    if (op.operation === "SCHEMA_CHANGE") {
      lines.push(`  -- ${op.tableName}`);
      formatSchemaChange(lines, op);
    } else {
      lines.push(`  -- ${op.tableName} (id=${op.rowId})`);
      formatOperation(lines, op, verbose);
    }
  }

  return lines.join("\n");
}

function formatOperation(
  lines: string[],
  op: ChangelogEntry,
  verbose: boolean,
): void {
  if (op.operation === "INSERT") {
    if (verbose && op.newValues) {
      const fields = Object.entries(op.newValues)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(", ");
      lines.push(`     INSERT  ${fields}`);
    } else if (op.newValues) {
      const fields = Object.entries(op.newValues)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(", ");
      lines.push(`     INSERT  ${fields}`);
    } else {
      lines.push(`     INSERT`);
    }
  } else if (op.operation === "UPDATE") {
    if (op.oldValues && op.newValues) {
      const changes: string[] = [];
      for (const [key, newVal] of Object.entries(op.newValues)) {
        const oldVal = op.oldValues[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push(`${key}: ${formatValue(oldVal)} -> ${formatValue(newVal)}`);
        }
      }
      lines.push(`     UPDATE  ${changes.join(", ")}`);
    } else {
      lines.push(`     UPDATE`);
    }
  } else if (op.operation === "DELETE") {
    if (verbose && op.oldValues) {
      const fields = Object.entries(op.oldValues)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(", ");
      lines.push(`     DELETE  ${fields}`);
    } else {
      lines.push(`     DELETE`);
    }
  }
}

function formatSchemaChange(lines: string[], op: ChangelogEntry): void {
  const oldCols = op.oldValues as unknown as { name: string }[] | null;
  const newCols = op.newValues as unknown as { name: string; dataType?: string; nullable?: boolean }[] | null;

  if (!oldCols || !newCols) {
    lines.push("     SCHEMA_CHANGE");
    return;
  }

  const oldNames = new Set(oldCols.map((c) => c.name));
  const newNames = new Set(newCols.map((c) => c.name));

  for (const col of newCols) {
    if (!oldNames.has(col.name)) {
      const nullable = col.nullable ? ", nullable" : "";
      lines.push(`     + column '${col.name}' (${col.dataType ?? "unknown"}${nullable})`);
    }
  }
  for (const col of oldCols) {
    if (!newNames.has(col.name)) {
      lines.push(`     - column '${col.name}'`);
    }
  }
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "string") return val;
  return String(val);
}
