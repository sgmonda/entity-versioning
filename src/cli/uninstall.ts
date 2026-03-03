import { Command } from "@cliffy/command";

export const uninstallCommand = new Command()
  .description("Uninstall ev by removing the compiled binary")
  .action(async () => {
    // Check that we're running as a compiled binary
    // deno-lint-ignore no-explicit-any
    if (!(Deno.build as any).standalone) {
      console.error(
        "Error: 'ev uninstall' only works with compiled binaries.",
      );
      console.error("If running from source, simply delete the project directory.");
      Deno.exit(1);
    }

    const execPath = Deno.execPath();
    console.log(`Removing ${execPath}...`);

    try {
      await Deno.remove(execPath);
    } catch (err) {
      console.error(`Failed to remove binary: ${err}`);
      Deno.exit(1);
    }

    console.log("ev has been uninstalled.");
    console.log("");
    console.log("Note: This only removes the ev binary. You may also want to:");
    console.log("  - Delete any ev.config.yaml files in your projects");
    console.log("  - Run 'ev teardown --confirm' on your databases before uninstalling");
    console.log("    to remove all __ev_ objects (tables, triggers, functions)");
  });
