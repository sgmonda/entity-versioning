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
      console.error(
        "If running from source, simply delete the project directory.",
      );
      Deno.exit(1);
    }

    const execPath = Deno.execPath();

    console.log("This will remove the ev binary at:");
    console.log(`  ${execPath}`);
    console.log("");
    console.log("Note: This only removes the binary. You may also want to:");
    console.log("  - Run 'ev teardown --confirm' on your databases first");
    console.log("    to remove all __ev_ objects (tables, triggers, functions)");
    console.log("  - Delete any ev.config.yaml files in your projects");
    console.log("");

    const buf = new Uint8Array(1);
    Deno.stdout.writeSync(new TextEncoder().encode("Proceed? [y/N] "));
    const n = Deno.stdin.readSync(buf);
    const answer = n ? new TextDecoder().decode(buf.subarray(0, n)).trim() : "";

    if (answer !== "y" && answer !== "Y") {
      console.log("Aborted.");
      return;
    }

    try {
      await Deno.remove(execPath);
    } catch (err) {
      console.error(`Failed to remove binary: ${err}`);
      Deno.exit(1);
    }

    console.log("ev has been uninstalled.");
  });
