import { Command } from "@cliffy/command";
import {
  loadConfigFile,
  validateConfig,
  resolveCredentials,
  configToEntityConfigs,
} from "../config.ts";
import { getConnector } from "../connector/registry.ts";
import { getConfigPath, getSqlFromConnector } from "./helpers.ts";

export const refreshCommand = new Command()
  .description("Detect schema drift, record changes, and regenerate triggers")
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

      const entities = configToEntityConfigs(config);
      const health = await connector.healthCheck(entities);

      if (health.schemaDrift.length === 0 && health.missingTriggers.length === 0) {
        console.log("No schema drift detected. Everything is up to date.");
        await connector.disconnect();
        return;
      }

      const sql = getSqlFromConnector(connector);

      for (const drift of health.schemaDrift) {
        console.log(`Schema drift on '${drift.table}':`);
        if (drift.addedColumns.length) console.log(`  Added: ${drift.addedColumns.join(", ")}`);
        if (drift.removedColumns.length) console.log(`  Removed: ${drift.removedColumns.join(", ")}`);
        if (drift.modifiedColumns.length) console.log(`  Modified: ${drift.modifiedColumns.join(", ")}`);

        const oldSnap = await sql`
          SELECT columns FROM __ev_schema_snapshots
          WHERE table_name = ${drift.table}
          ORDER BY captured_at DESC LIMIT 1
        `;
        const newSnapshot = await connector.getSchemaSnapshot([drift.table]);

        await sql`
          INSERT INTO __ev_changelog
            (entity_type, entity_id, table_name, row_id, operation,
             old_values, new_values, transaction_id)
          VALUES (
            '__schema', '*', ${drift.table}, '*', 'SCHEMA_CHANGE',
            ${oldSnap.length > 0 ? JSON.stringify(oldSnap[0].columns) : null},
            ${JSON.stringify(newSnapshot.tables[drift.table])},
            txid_current()::TEXT
          )
        `;

        await sql`
          INSERT INTO __ev_schema_snapshots (table_name, columns)
          VALUES (${drift.table}, ${JSON.stringify(newSnapshot.tables[drift.table])})
        `;
      }

      console.log("\nRegenerating triggers...");
      const { dropTriggers } = await import("../connectors/postgres/triggers.ts");
      await dropTriggers(sql);
      const result = await connector.installTriggers(entities);
      console.log(`  ${result.installed} triggers installed`);

      await connector.disconnect();
      console.log("\nRefresh complete.");
    } catch (err) {
      console.error(`Error: ${err}`);
      Deno.exit(1);
    }
  });
