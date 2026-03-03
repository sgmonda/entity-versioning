import { Command } from "@cliffy/command";
import { loadConfigFile, validateConfig } from "../config.ts";
import { getConfigPath } from "./helpers.ts";

export const entitiesCommand = new Command()
  .description("Review and adjust entity configuration")
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

      console.log("Current entities:\n");
      for (const [name, entity] of Object.entries(config.entities)) {
        console.log(`  ${name} (root: ${entity.root_table})`);
        for (const child of entity.children ?? []) {
          console.log(`    - ${child.table} (FK: ${child.fk_column})`);
        }
      }

      if (config.ignored_tables?.length) {
        console.log(`\nIgnored tables: ${config.ignored_tables.join(", ")}`);
      }

      console.log("\nTo modify entities, edit the config file directly or re-run 'ev init'.");
    } catch (err) {
      console.error(`Error: ${err}`);
      Deno.exit(1);
    }
  });
