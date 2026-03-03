import type {
  Connector,
  ChangelogEntry,
  Changeset,
  ChangelogFilter,
} from "../connector/interface.ts";
import { buildChangesets } from "./changeset-builder.ts";

// ---------------------------------------------------------------------------
// ANSI colors (enabled when stdout is a terminal)
// ---------------------------------------------------------------------------

function useColor(): boolean {
  try {
    // deno-lint-ignore no-explicit-any
    return (Deno as any).stdout?.isTerminal?.() ?? false;
  } catch {
    return false;
  }
}

const esc = (code: string) => `\x1b[${code}m`;

function makeColors(enabled: boolean) {
  const wrap = (code: string, resetCode = "0") =>
    enabled ? (s: string) => `${esc(code)}${s}${esc(resetCode)}` : (s: string) => s;
  return {
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    red: wrap("31", "39"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39"),
    cyan: wrap("36", "39"),
    magenta: wrap("35", "39"),
    boldYellow: wrap("1;33", "22;39"),
    boldGreen: wrap("1;32", "22;39"),
    boldRed: wrap("1;31", "22;39"),
    boldCyan: wrap("1;36", "22;39"),
    boldMagenta: wrap("1;35", "22;39"),
  };
}

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

  const c = makeColors(useColor());
  const lines: string[] = [];
  const txShort = changeset.transactionId.substring(0, 8);
  const dateStr = changeset.timestamp.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

  if (changeset.operations[0]?.operation === "SCHEMA_CHANGE") {
    lines.push(`${c.boldMagenta("schema change")}  ${c.dim(dateStr)}`);
  } else {
    lines.push(
      `${c.boldYellow(`changeset v${changeset.version}`)}  ${c.dim(`[tx: ${txShort}]`)}  ${c.dim(dateStr)}`,
    );
  }

  // Collect affected tables
  const tables = [...new Set(changeset.operations.map((op) => op.tableName))];
  if (changeset.operations[0]?.operation !== "SCHEMA_CHANGE") {
    lines.push(`  ${c.dim("tables:")} ${tables.join(", ")}`);
  }

  for (const op of changeset.operations) {
    if (op.operation === "SCHEMA_CHANGE") {
      lines.push(`  -- ${c.boldCyan(op.tableName)}`);
      formatSchemaChange(lines, op, c);
    } else {
      lines.push(`  -- ${c.boldCyan(op.tableName)} ${c.dim(`(id=${op.rowId})`)}`);
      formatOperation(lines, op, verbose, c);
    }
  }

  return lines.join("\n");
}

function formatOperation(
  lines: string[],
  op: ChangelogEntry,
  verbose: boolean,
  c: ReturnType<typeof makeColors>,
): void {
  if (op.operation === "INSERT") {
    if (verbose && op.newValues) {
      const fields = Object.entries(op.newValues)
        .map(([k, v]) => `${c.bold(k)}=${formatValue(v)}`)
        .join(", ");
      lines.push(`     ${c.boldGreen("INSERT")}  ${fields}`);
    } else if (op.newValues) {
      const fields = Object.entries(op.newValues)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => `${c.bold(k)}=${formatValue(v)}`)
        .join(", ");
      lines.push(`     ${c.boldGreen("INSERT")}  ${fields}`);
    } else {
      lines.push(`     ${c.boldGreen("INSERT")}`);
    }
  } else if (op.operation === "UPDATE") {
    if (op.oldValues && op.newValues) {
      const changes: string[] = [];
      for (const [key, newVal] of Object.entries(op.newValues)) {
        const oldVal = op.oldValues[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push(
            `${c.bold(key)}: ${c.red(formatValue(oldVal))} -> ${c.green(formatValue(newVal))}`,
          );
        }
      }
      lines.push(`     ${c.boldYellow("UPDATE")}  ${changes.join(", ")}`);
    } else {
      lines.push(`     ${c.boldYellow("UPDATE")}`);
    }
  } else if (op.operation === "DELETE") {
    if (verbose && op.oldValues) {
      const fields = Object.entries(op.oldValues)
        .map(([k, v]) => `${c.bold(k)}=${formatValue(v)}`)
        .join(", ");
      lines.push(`     ${c.boldRed("DELETE")}  ${fields}`);
    } else {
      lines.push(`     ${c.boldRed("DELETE")}`);
    }
  }
}

function formatSchemaChange(
  lines: string[],
  op: ChangelogEntry,
  c: ReturnType<typeof makeColors>,
): void {
  const oldCols = op.oldValues as unknown as { name: string }[] | null;
  const newCols = op.newValues as unknown as { name: string; dataType?: string; nullable?: boolean }[] | null;

  if (!oldCols || !newCols) {
    lines.push(`     ${c.boldMagenta("SCHEMA_CHANGE")}`);
    return;
  }

  const oldNames = new Set(oldCols.map((col) => col.name));
  const newNames = new Set(newCols.map((col) => col.name));

  for (const col of newCols) {
    if (!oldNames.has(col.name)) {
      const nullable = col.nullable ? ", nullable" : "";
      lines.push(c.green(`     + column '${col.name}' (${col.dataType ?? "unknown"}${nullable})`));
    }
  }
  for (const col of oldCols) {
    if (!newNames.has(col.name)) {
      lines.push(c.red(`     - column '${col.name}'`));
    }
  }
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "string") return val;
  return String(val);
}
