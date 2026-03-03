import type { DdlHookInstallResult } from "../../connector/interface.ts";
import { ddlHookFunctionSQL, ddlEventTriggerSQL } from "./templates.ts";
import type { Sql } from "./types.ts";

export async function installDdlHooks(
  sql: Sql,
  watchedTables: string[],
): Promise<DdlHookInstallResult> {
  try {
    await sql.unsafe(ddlHookFunctionSQL(watchedTables));
    await sql.unsafe(ddlEventTriggerSQL());
    return { supported: true, installed: true, mechanism: "event_trigger" };
  } catch (err) {
    const msg = String(err);
    if (msg.includes("permission denied") || msg.includes("must be superuser")) {
      console.error(
        "Warning: Cannot install DDL hooks (requires superuser). Use 'ev refresh' after schema changes.",
      );
      return { supported: true, installed: false, mechanism: "event_trigger" };
    }
    throw err;
  }
}

export async function dropDdlHooks(sql: Sql): Promise<string[]> {
  const dropped: string[] = [];
  const eventTriggers = await sql`
    SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'
  `;
  for (const et of eventTriggers) {
    await sql.unsafe(`DROP EVENT TRIGGER IF EXISTS ${et.evtname}`);
    dropped.push(et.evtname);
  }

  await sql.unsafe(`DROP FUNCTION IF EXISTS __ev_ddl_hook_fn() CASCADE`);
  dropped.push("__ev_ddl_hook_fn");

  return dropped;
}
