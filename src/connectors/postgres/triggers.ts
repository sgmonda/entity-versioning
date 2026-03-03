import type {
  EntityConfig,
  TriggerInstallResult,
  TeardownResult,
} from "../../connector/interface.ts";
import {
  changelogTableSQL,
  schemaSnapshotsTableSQL,
  triggerFunctionSQL,
  triggerSQL,
} from "./templates.ts";
import type { Sql } from "./types.ts";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function createChangelogTables(sql: Sql): Promise<void> {
  await sql.unsafe(changelogTableSQL());
  await sql.unsafe(schemaSnapshotsTableSQL());
}

export function generateTriggerSQL(
  entity: EntityConfig,
  tableName: string,
  isRoot: boolean,
  fkColumn?: string,
): { functionSql: string; triggerSql: string } {
  const pkColumn = isRoot ? entity.rootPk : "id";

  let entityIdExpr: { insert: string; update: string; delete: string };
  if (isRoot) {
    entityIdExpr = {
      insert: `NEW.${quoteIdent(entity.rootPk)}::TEXT`,
      update: `NEW.${quoteIdent(entity.rootPk)}::TEXT`,
      delete: `OLD.${quoteIdent(entity.rootPk)}::TEXT`,
    };
  } else {
    entityIdExpr = {
      insert: `NEW.${quoteIdent(fkColumn!)}::TEXT`,
      update: `NEW.${quoteIdent(fkColumn!)}::TEXT`,
      delete: `OLD.${quoteIdent(fkColumn!)}::TEXT`,
    };
  }

  return {
    functionSql: triggerFunctionSQL(tableName, entity.name, entityIdExpr, pkColumn),
    triggerSql: triggerSQL(tableName),
  };
}

export async function installTriggers(
  sql: Sql,
  entities: EntityConfig[],
): Promise<TriggerInstallResult> {
  const result: TriggerInstallResult = { installed: 0, errors: [] };

  for (const entity of entities) {
    // Root table trigger
    try {
      const rootSql = generateTriggerSQL(entity, entity.rootTable, true);
      await sql.unsafe(rootSql.functionSql);
      await sql.unsafe(rootSql.triggerSql);
      result.installed++;
    } catch (err) {
      result.errors.push({ table: entity.rootTable, error: String(err) });
    }

    // Child table triggers
    for (const child of entity.children) {
      try {
        const childSql = generateTriggerSQL(entity, child.table, false, child.fkColumn);
        await sql.unsafe(childSql.functionSql);
        await sql.unsafe(childSql.triggerSql);
        result.installed++;
      } catch (err) {
        result.errors.push({ table: child.table, error: String(err) });
      }
    }
  }

  return result;
}

export async function dropTriggers(sql: Sql): Promise<string[]> {
  const triggers = await sql`
    SELECT tgname, relname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE tgname LIKE '__ev_trigger_%'
  `;

  const dropped: string[] = [];
  for (const t of triggers) {
    await sql.unsafe(
      `DROP TRIGGER IF EXISTS ${t.tgname} ON "${t.relname}"`,
    );
    dropped.push(`${t.tgname} ON ${t.relname}`);
  }
  return dropped;
}

export async function teardown(sql: Sql): Promise<TeardownResult> {
  const result: TeardownResult = {
    droppedTriggers: [],
    droppedTables: [],
    droppedFunctions: [],
    droppedEventTriggers: [],
  };

  // Drop triggers
  result.droppedTriggers = await dropTriggers(sql);

  // Drop event triggers
  const eventTriggers = await sql`
    SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'
  `;
  for (const et of eventTriggers) {
    await sql.unsafe(`DROP EVENT TRIGGER IF EXISTS ${et.evtname}`);
    result.droppedEventTriggers.push(et.evtname);
  }

  // Drop functions
  const functions = await sql`
    SELECT proname FROM pg_proc
    WHERE proname LIKE '__ev_%'
  `;
  for (const f of functions) {
    await sql.unsafe(`DROP FUNCTION IF EXISTS ${f.proname} CASCADE`);
    result.droppedFunctions.push(f.proname);
  }

  // Drop tables
  await sql.unsafe(`DROP TABLE IF EXISTS __ev_changelog CASCADE`);
  result.droppedTables.push("__ev_changelog");
  await sql.unsafe(`DROP TABLE IF EXISTS __ev_schema_snapshots CASCADE`);
  result.droppedTables.push("__ev_schema_snapshots");

  return result;
}
