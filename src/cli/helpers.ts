import type { PostgresConnector } from "../connectors/postgres/index.ts";
import type { Connector } from "../connector/interface.ts";
import type { Sql } from "../connectors/postgres/types.ts";

// deno-lint-ignore no-explicit-any
export function getConfigPath(options: any): string {
  return options.config ?? "ev.config.yaml";
}

// deno-lint-ignore no-explicit-any
export function isVerbose(options: any): boolean {
  return !!options.verbose;
}

export function getSqlFromConnector(connector: Connector): Sql {
  return (connector as unknown as PostgresConnector).getSql();
}
