import { Command } from "@cliffy/command";
import { getConnector } from "../connector/registry.ts";
import { buildFkGraph, classifyTables } from "../core/schema-analyzer.ts";
import { resolveEntities } from "../core/entity-resolver.ts";
import type { EvConfig } from "../config.ts";
import { writeConfigFile } from "../config.ts";
import { getConfigPath } from "./helpers.ts";

export const initCommand = new Command()
  .description("Connect to database, infer entities, and generate ev.config.yaml")
  .option("--host <host:string>", "Database host", { default: "localhost" })
  .option("--port <port:number>", "Database port", { default: 5432 })
  .option("--database <database:string>", "Database name", { required: true })
  .option("--engine <engine:string>", "Database engine", { default: "postgres" })
  .option("--user-env <userEnv:string>", "Env var for username", {
    default: "EV_DB_USER",
  })
  .option("--password-env <passwordEnv:string>", "Env var for password", {
    default: "EV_DB_PASSWORD",
  })
  // deno-lint-ignore no-explicit-any
  .action(async (options: any) => {
    const { host, port, database, engine, userEnv, passwordEnv } = options;
    const configPath = getConfigPath(options);

    const user = Deno.env.get(userEnv);
    if (!user) {
      console.error(`Error: Environment variable '${userEnv}' is not set`);
      Deno.exit(1);
    }
    const password = Deno.env.get(passwordEnv);
    if (!password) {
      console.error(`Error: Environment variable '${passwordEnv}' is not set`);
      Deno.exit(1);
    }

    const connector = getConnector(engine);
    try {
      console.log(`Connecting to ${engine}://${host}:${port}/${database}...`);
      await connector.connect({ engine, host, port, database, user, password });

      console.log("Introspecting schema...");
      const tables = await connector.getTables();
      const fks = await connector.getForeignKeys();

      if (tables.length === 0) {
        console.log("No tables found in the database. Nothing to configure.");
        await connector.disconnect();
        return;
      }

      console.log(`Found ${tables.length} tables and ${fks.length} foreign keys.`);

      const graph = buildFkGraph(tables, fks);
      const classification = classifyTables(graph);
      const resolution = resolveEntities(graph, classification, tables);

      console.log(`\nInferred ${resolution.entities.length} entities:`);
      for (const entity of resolution.entities) {
        console.log(`  ${entity.name}: ${entity.children.length} children`);
      }

      // Resolve conflicts: remove conflicting children from all entities
      const conflictTables = new Set(resolution.conflicts.map((c) => c.table));
      if (resolution.conflicts.length > 0) {
        console.log(`\n${resolution.conflicts.length} conflicts detected (tables claimed by multiple entities):`);
        for (const conflict of resolution.conflicts) {
          console.log(`  ${conflict.table} -> claimed by: ${conflict.claimedBy.join(", ")}`);
        }
        console.log(`  These tables will be added to ignored_tables. Use 'ev entities' to reassign them manually.`);
        // Remove conflicting tables from entity children
        for (const entity of resolution.entities) {
          entity.children = entity.children.filter((c) => !conflictTables.has(c.table));
        }
      }

      if (resolution.warnings.length > 0) {
        console.log(`\nWarnings:`);
        for (const w of resolution.warnings) console.log(`  ${w}`);
      }

      const entities: EvConfig["entities"] = {};
      for (const entity of resolution.entities) {
        entities[entity.name] = {
          root_table: entity.rootTable,
          root_pk: entity.rootPk,
          children: entity.children.map((c) => ({
            table: c.table,
            fk_column: c.fkColumn,
          })),
        };
      }

      const ignoredTables = [...classification.isolated, ...classification.lookup, ...conflictTables];

      const config: EvConfig = {
        version: 1,
        connection: { engine, host, port, database, user_env: userEnv, password_env: passwordEnv },
        settings: {
          changelog_table: "__ev_changelog",
          schema_snapshots_table: "__ev_schema_snapshots",
          autocommit_grouping_window_ms: 500,
          max_entity_depth: 1,
          capture_old_values: true,
          capture_new_values: true,
        },
        entities,
        ignored_tables: ignoredTables,
      };

      await writeConfigFile(configPath, config);
      console.log(`\nConfig written to ${configPath}`);
      await connector.disconnect();
    } catch (err) {
      console.error(`Error: ${err}`);
      await connector.disconnect().catch(() => {});
      Deno.exit(1);
    }
  });
