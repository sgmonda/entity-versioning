import { Command } from "@cliffy/command";
import {
  loadConfigFile,
  validateConfig,
  resolveCredentials,
} from "../config.ts";
import { getConnector } from "../connector/registry.ts";
import { queryEntityHistory, formatChangeset } from "../core/query-engine.ts";
import { getConfigPath, isVerbose } from "./helpers.ts";

export const logCommand = new Command()
  .description("Show change history of a specific entity instance")
  .option("--entity <entity:string>", "Entity type", { required: true })
  .option("--id <id:string>", "Entity ID", { required: true })
  .option("--since <since:string>", "Start date (ISO 8601)")
  .option("--until <until:string>", "End date (ISO 8601)")
  .option("--version <version:number>", "Show specific changeset version")
  .option("--format <format:string>", "Output format: text or json", { default: "text" })
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

      const verbose = isVerbose(options);
      const changesets = await queryEntityHistory(
        connector,
        options.entity,
        options.id,
        {
          since: options.since ? new Date(options.since) : undefined,
          until: options.until ? new Date(options.until) : undefined,
          version: options.version,
          groupingWindowMs: config.settings.autocommit_grouping_window_ms,
        },
      );

      if (changesets.length === 0) {
        console.log("No changes found.");
      } else {
        const fmt = options.format as "text" | "json";
        if (fmt === "json") {
          console.log(
            JSON.stringify(
              changesets,
              (_key, value) => (typeof value === "bigint" ? value.toString() : value),
              2,
            ),
          );
        } else {
          for (const cs of changesets.reverse()) {
            console.log(formatChangeset(cs, "text", verbose));
            console.log();
          }
        }
      }

      await connector.disconnect();
    } catch (err) {
      console.error(`Error: ${err}`);
      Deno.exit(1);
    }
  });
