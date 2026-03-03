import { Command } from "@cliffy/command";
import { initCommand } from "./init.ts";
import { entitiesCommand } from "./entities.ts";
import { startCommand } from "./start.ts";
import { stopCommand } from "./stop.ts";
import { statusCommand } from "./status.ts";
import { logCommand } from "./log.ts";
import { teardownCommand } from "./teardown.ts";
import { refreshCommand } from "./refresh.ts";

export function createCli() {
  return new Command()
    .name("ev")
    .version("0.1.0")
    .description(
      "Entity Versioning — track data changes in your relational database",
    )
    .globalOption("-c, --config <path:string>", "Path to config file", {
      default: "ev.config.yaml",
    })
    .globalOption("-v, --verbose", "Enable verbose output")
    .command("init", initCommand)
    .command("entities", entitiesCommand)
    .command("start", startCommand)
    .command("stop", stopCommand)
    .command("status", statusCommand)
    .command("log", logCommand)
    .command("teardown", teardownCommand)
    .command("refresh", refreshCommand);
}

export async function run(): Promise<void> {
  const cli = createCli();
  await cli.parse(Deno.args);
}
