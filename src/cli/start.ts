import { Command } from "@cliffy/command";
import {
  loadConfigFile,
  validateConfig,
  resolveCredentials,
  configToEntityConfigs,
} from "../config.ts";
import { getConnector } from "../connector/registry.ts";
import { getConfigPath, getSqlFromConnector } from "./helpers.ts";

export const startCommand = new Command()
  .description("Install changelog tables, triggers, and DDL hooks for all configured entities")
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

      console.log("Connecting...");
      await connector.connect({
        engine: config.connection.engine,
        host: config.connection.host,
        port: config.connection.port,
        database: config.connection.database,
        user,
        password,
      });

      const entities = configToEntityConfigs(config);

      console.log("Creating changelog tables...");
      await connector.createChangelogTables();

      console.log("Taking initial schema snapshot...");
      const allTables = entities.flatMap((e) => [
        e.rootTable,
        ...e.children.map((c) => c.table),
      ]);
      const snapshot = await connector.getSchemaSnapshot(allTables);

      const sql = getSqlFromConnector(connector);
      for (const [table, columns] of Object.entries(snapshot.tables)) {
        await sql`
          INSERT INTO __ev_schema_snapshots (table_name, columns)
          VALUES (${table}, ${JSON.stringify(columns)})
        `;
      }

      console.log("Installing triggers...");
      const trigResult = await connector.installTriggers(entities);
      console.log(`  ${trigResult.installed} triggers installed`);
      if (trigResult.errors.length > 0) {
        for (const err of trigResult.errors) {
          console.error(`  Error on ${err.table}: ${err.error}`);
        }
      }

      console.log("Installing DDL hooks...");
      const ddlResult = await connector.installDdlHooks(allTables);
      if (ddlResult.installed) {
        console.log(`  DDL hooks installed (${ddlResult.mechanism})`);
      } else {
        console.log("  DDL hooks not installed. Use 'ev refresh' after schema changes.");
      }

      const health = await connector.healthCheck(entities);
      if (health.ok) {
        console.log("\nHealth check: OK");
      } else {
        console.log("\nHealth check: Issues found");
        if (health.missingTriggers.length > 0) {
          console.log(`  Missing triggers: ${health.missingTriggers.join(", ")}`);
        }
      }

      await connector.disconnect();
      console.log("\nDone. Entity versioning is active.");
    } catch (err) {
      console.error(`Error: ${err}`);
      Deno.exit(1);
    }
  });
