import { Command } from "@cliffy/command";
import denoConfig from "../../deno.json" with { type: "json" };

const REPO = "sgmonda/entity-versioning";

function getAssetName(): string {
  const os = Deno.build.os;
  const arch = Deno.build.arch;

  let osPart: string;
  switch (os) {
    case "linux":
      osPart = "linux";
      break;
    case "darwin":
      osPart = "macos";
      break;
    case "windows":
      osPart = "windows";
      break;
    default:
      throw new Error(`Unsupported OS: ${os}`);
  }

  let archPart: string;
  switch (arch) {
    case "x86_64":
      archPart = "x86_64";
      break;
    case "aarch64":
      archPart = "aarch64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  const ext = os === "windows" ? ".exe" : "";
  return `ev-${osPart}-${archPart}${ext}`;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseInfo {
  tag_name: string;
  assets: ReleaseAsset[];
}

async function getLatestRelease(): Promise<ReleaseInfo> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
  );
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

export const upgradeCommand = new Command()
  .description("Upgrade ev to the latest version")
  .option("--force", "Force upgrade even if already on latest version")
  // deno-lint-ignore no-explicit-any
  .action(async (options: any) => {
    // Check that we're running as a compiled binary
    // deno-lint-ignore no-explicit-any
    if (!(Deno.build as any).standalone) {
      console.error(
        "Error: 'ev upgrade' only works with compiled binaries.",
      );
      console.error(
        "If running from source, update with: git pull && deno task compile",
      );
      Deno.exit(1);
    }

    const currentVersion = denoConfig.version;
    console.log(`Current version: v${currentVersion}`);
    console.log("Checking for updates...");

    let release: ReleaseInfo;
    try {
      release = await getLatestRelease();
    } catch (err) {
      console.error(`Failed to check for updates: ${err}`);
      Deno.exit(1);
    }

    const latestVersion = release.tag_name.replace(/^v/, "");
    if (latestVersion === currentVersion && !options.force) {
      console.log(`Already on the latest version (v${currentVersion}).`);
      return;
    }

    console.log(`New version available: v${latestVersion}`);

    const assetName = getAssetName();
    const asset = release.assets.find((a) => a.name === assetName);
    if (!asset) {
      console.error(
        `Error: no binary found for this platform (${assetName}).`,
      );
      Deno.exit(1);
    }

    console.log(`Downloading ${assetName}...`);
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) {
      console.error(`Download failed: ${res.status} ${res.statusText}`);
      Deno.exit(1);
    }
    const binary = new Uint8Array(await res.arrayBuffer());

    const execPath = Deno.execPath();
    const isWindows = Deno.build.os === "windows";

    if (isWindows) {
      // On Windows, rename current binary then write new one
      const bakPath = execPath + ".bak";
      try {
        await Deno.remove(bakPath);
      } catch {
        // ignore if backup doesn't exist
      }
      await Deno.rename(execPath, bakPath);
      await Deno.writeFile(execPath, binary);
      try {
        await Deno.remove(bakPath);
      } catch {
        // old binary may be locked; it'll be cleaned up next time
      }
    } else {
      // On Unix, delete and write
      await Deno.remove(execPath);
      await Deno.writeFile(execPath, binary, { mode: 0o755 });
    }

    console.log(`Upgraded to v${latestVersion}.`);
  });
