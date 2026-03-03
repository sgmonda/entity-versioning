import { Command } from "@cliffy/command";
import {
  loadConfigFile,
  validateConfig,
  resolveCredentials,
} from "../config.ts";
import { getConnector } from "../connector/registry.ts";
import { getConfigPath, getSqlFromConnector } from "./helpers.ts";

export const stopCommand = new Command()
  .description("Remove triggers and DDL hooks but keep changelog data")
  // deno-lint-ignore no-explicit-any
  .action(async (options: any) => {
    const configPath = getConfigPath(options);
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

      const sql = getSqlFromConnector(connector);

      const { dropTriggers } = await import("../connectors/postgres/triggers.ts");
      const dropped = await dropTriggers(sql);
      console.log(`Dropped ${dropped.length} triggers`);

      const { dropDdlHooks } = await import("../connectors/postgres/ddl-hooks.ts");
      const droppedHooks = await dropDdlHooks(sql);
      console.log(`Dropped ${droppedHooks.length} DDL hook objects`);

      console.log("Changelog data preserved.");
      await connector.disconnect();
    } catch (err) {
      console.error(`Error: ${err}`);
      Deno.exit(1);
    }
  });
