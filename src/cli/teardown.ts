import { Command } from "@cliffy/command";
import {
  loadConfigFile,
  validateConfig,
  resolveCredentials,
} from "../config.ts";
import { getConnector } from "../connector/registry.ts";
import { getConfigPath, getSqlFromConnector } from "./helpers.ts";

export const teardownCommand = new Command()
  .description("Remove all __ev_ objects from the database")
  .option("--confirm", "Actually execute teardown (dry-run without this)")
  // deno-lint-ignore no-explicit-any
  .action(async (options: any) => {
    const configPath = getConfigPath(options);
    const confirm = !!options.confirm;

    try {
      const config = await loadConfigFile(configPath);
      const errors = validateConfig(config);
      if (errors.length > 0) {
        console.error("Config validation errors:");
        for (const e of errors) console.error(`  - ${e}`);
        Deno.exit(1);
      }

      const { user, password } = resolveCredentials(config);
      const connector = getConnector(config.connection.engine);

      await connector.connect({
        engine: config.connection.engine,
        host: config.connection.host,
        port: config.connection.port,
        database: config.connection.database,
        user,
        password,
      });

      if (!confirm) {
        console.log("DRY RUN — the following objects would be removed:\n");
        const sql = getSqlFromConnector(connector);

        const triggers = await sql`
          SELECT tgname, c.relname
          FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
          WHERE tgname LIKE '__ev_%'
        `;
        console.log(`Triggers (${triggers.length}):`);
        for (const t of triggers) console.log(`  ${t.tgname} ON ${t.relname}`);

        const fns = await sql`SELECT proname FROM pg_proc WHERE proname LIKE '__ev_%'`;
        console.log(`Functions (${fns.length}):`);
        for (const f of fns) console.log(`  ${f.proname}`);

        const evts = await sql`SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'`;
        console.log(`Event triggers (${evts.length}):`);
        for (const e of evts) console.log(`  ${e.evtname}`);

        console.log(`Tables: __ev_changelog, __ev_schema_snapshots`);
        console.log(`\nRun with --confirm to execute.`);
      } else {
        const result = await connector.teardown();
        console.log("Teardown complete:");
        console.log(`  Triggers dropped: ${result.droppedTriggers.length}`);
        console.log(`  Functions dropped: ${result.droppedFunctions.length}`);
        console.log(`  Event triggers dropped: ${result.droppedEventTriggers.length}`);
        console.log(`  Tables dropped: ${result.droppedTables.length}`);
      }

      await connector.disconnect();
    } catch (err) {
      console.error(`Error: ${err}`);
      Deno.exit(1);
    }
  });
