import { Command } from "@cliffy/command";
import {
  loadConfigFile,
  validateConfig,
  resolveCredentials,
  configToEntityConfigs,
} from "../config.ts";
import { getConnector } from "../connector/registry.ts";
import { getConfigPath, getSqlFromConnector } from "./helpers.ts";

export const statusCommand = new Command()
  .description("Show connection status, trigger health, and changelog stats")
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
      console.log(`Connected to ${config.connection.engine}://${config.connection.host}:${config.connection.port}/${config.connection.database}`);

      const health = await connector.healthCheck(entities);
      const expectedTriggers = entities.reduce((acc, e) => acc + 1 + e.children.length, 0);
      const activeTriggers = expectedTriggers - health.missingTriggers.length;

      console.log(`\nTriggers: ${activeTriggers}/${expectedTriggers} active`);
      if (health.missingTriggers.length > 0) {
        console.log(`  Missing: ${health.missingTriggers.join(", ")}`);
      }

      if (health.schemaDrift.length > 0) {
        console.log(`\nSchema drift detected:`);
        for (const drift of health.schemaDrift) {
          const changes: string[] = [];
          if (drift.addedColumns.length) changes.push(`+${drift.addedColumns.join(", +")}`);
          if (drift.removedColumns.length) changes.push(`-${drift.removedColumns.join(", -")}`);
          if (drift.modifiedColumns.length) changes.push(`~${drift.modifiedColumns.join(", ~")}`);
          console.log(`  ${drift.table}: ${changes.join(", ")}`);
        }
      }

      const sql = getSqlFromConnector(connector);
      try {
        const stats = await sql`
          SELECT
            COUNT(*) as total,
            COUNT(DISTINCT entity_type) as entity_types,
            MIN(created_at) as oldest,
            MAX(created_at) as newest
          FROM __ev_changelog
        `;
        const row = stats[0];
        console.log(`\nChangelog: ${row.total} entries`);
        if (Number(row.total) > 0) {
          console.log(`  Entity types: ${row.entity_types}`);
          console.log(`  Oldest: ${row.oldest}`);
          console.log(`  Newest: ${row.newest}`);
        }
      } catch {
        console.log("\nChangelog table not found. Run 'ev start' first.");
      }

      console.log(`\nOverall: ${health.ok ? "OK" : "Issues found"}`);
      await connector.disconnect();
    } catch (err) {
      console.error(`Error: ${err}`);
      Deno.exit(1);
    }
  });
