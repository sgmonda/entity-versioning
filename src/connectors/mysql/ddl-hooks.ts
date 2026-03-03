import type { DdlHookInstallResult } from "../../connector/interface.ts";

// MySQL does not support event triggers / DDL hooks
export function installDdlHooks(
  _sql: unknown,
  _watchedTables: string[],
): Promise<DdlHookInstallResult> {
  return Promise.resolve({ supported: false, installed: false, mechanism: "none" });
}

export function dropDdlHooks(_sql: unknown): Promise<string[]> {
  return Promise.resolve([]);
}
