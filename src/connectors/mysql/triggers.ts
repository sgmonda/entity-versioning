import type {
  EntityConfig,
  TriggerInstallResult,
  TeardownResult,
} from "../../connector/interface.ts";
import {
  changelogTableSQL,
  schemaSnapshotsTableSQL,
  triggerInsertSQL,
  triggerUpdateSQL,
  triggerDeleteSQL,
  triggerDropSQL,
} from "./templates.ts";
import { getTableColumns } from "./introspect.ts";
import type { Sql } from "./types.ts";

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

export async function createChangelogTables(pool: Sql): Promise<void> {
  await pool.query(changelogTableSQL());
  await pool.query(schemaSnapshotsTableSQL());
}

export async function generateTriggerSQL(
  pool: Sql,
  entity: EntityConfig,
  tableName: string,
  isRoot: boolean,
  fkColumn?: string,
): Promise<{ insertSql: string; updateSql: string; deleteSql: string }> {
  const pkColumn = isRoot ? entity.rootPk : "id";
  const columns = await getTableColumns(pool, tableName);

  let insertEntityIdExpr: string;
  let updateEntityIdExpr: string;
  let deleteEntityIdExpr: string;

  if (isRoot) {
    insertEntityIdExpr = `CAST(NEW.${quoteIdent(entity.rootPk)} AS CHAR)`;
    updateEntityIdExpr = `CAST(NEW.${quoteIdent(entity.rootPk)} AS CHAR)`;
    deleteEntityIdExpr = `CAST(OLD.${quoteIdent(entity.rootPk)} AS CHAR)`;
  } else {
    insertEntityIdExpr = `CAST(NEW.${quoteIdent(fkColumn!)} AS CHAR)`;
    updateEntityIdExpr = `CAST(NEW.${quoteIdent(fkColumn!)} AS CHAR)`;
    deleteEntityIdExpr = `CAST(OLD.${quoteIdent(fkColumn!)} AS CHAR)`;
  }

  return {
    insertSql: triggerInsertSQL(tableName, entity.name, insertEntityIdExpr, pkColumn, columns),
    updateSql: triggerUpdateSQL(tableName, entity.name, updateEntityIdExpr, pkColumn, columns),
    deleteSql: triggerDeleteSQL(tableName, entity.name, deleteEntityIdExpr, pkColumn, columns),
  };
}

export async function installTriggers(
  pool: Sql,
  entities: EntityConfig[],
): Promise<TriggerInstallResult> {
  const result: TriggerInstallResult = { installed: 0, errors: [] };

  for (const entity of entities) {
    // Root table triggers
    try {
      const rootSql = await generateTriggerSQL(pool, entity, entity.rootTable, true);
      // Drop existing triggers first
      for (const dropSql of triggerDropSQL(entity.rootTable)) {
        await pool.query(dropSql);
      }
      await pool.query(rootSql.insertSql);
      await pool.query(rootSql.updateSql);
      await pool.query(rootSql.deleteSql);
      result.installed++;
    } catch (err) {
      result.errors.push({ table: entity.rootTable, error: String(err) });
    }

    // Child table triggers
    for (const child of entity.children) {
      try {
        const childSql = await generateTriggerSQL(pool, entity, child.table, false, child.fkColumn);
        for (const dropSql of triggerDropSQL(child.table)) {
          await pool.query(dropSql);
        }
        await pool.query(childSql.insertSql);
        await pool.query(childSql.updateSql);
        await pool.query(childSql.deleteSql);
        result.installed++;
      } catch (err) {
        result.errors.push({ table: child.table, error: String(err) });
      }
    }
  }

  return result;
}

export async function dropTriggers(pool: Sql): Promise<string[]> {
  const [triggers] = await pool.query(`
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()
      AND TRIGGER_NAME LIKE '__ev_trigger_%'
  `);

  const dropped: string[] = [];
  for (const t of triggers) {
    await pool.query(`DROP TRIGGER IF EXISTS ${t.TRIGGER_NAME}`);
    dropped.push(`${t.TRIGGER_NAME} ON ${t.EVENT_OBJECT_TABLE}`);
  }
  return dropped;
}

export async function teardown(pool: Sql): Promise<TeardownResult> {
  const result: TeardownResult = {
    droppedTriggers: [],
    droppedTables: [],
    droppedFunctions: [],
    droppedEventTriggers: [],
  };

  // Drop triggers
  result.droppedTriggers = await dropTriggers(pool);

  // MySQL has no event triggers
  // droppedEventTriggers stays empty

  // Drop functions (if any __ev_ functions exist)
  const [functions] = await pool.query(`
    SELECT ROUTINE_NAME
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = DATABASE()
      AND ROUTINE_NAME LIKE '__ev_%'
  `);
  for (const f of functions) {
    await pool.query(`DROP FUNCTION IF EXISTS \`${f.ROUTINE_NAME}\``);
    result.droppedFunctions.push(f.ROUTINE_NAME);
  }

  // Drop tables
  await pool.query(`DROP TABLE IF EXISTS __ev_changelog`);
  result.droppedTables.push("__ev_changelog");
  await pool.query(`DROP TABLE IF EXISTS __ev_schema_snapshots`);
  result.droppedTables.push("__ev_schema_snapshots");

  return result;
}
