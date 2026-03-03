import type { PostgresConnector } from "../connectors/postgres/index.ts";
import type { MySQLConnector } from "../connectors/mysql/index.ts";
import type { Connector } from "../connector/interface.ts";
// deno-lint-ignore no-explicit-any
type Sql = any;

// deno-lint-ignore no-explicit-any
export function getConfigPath(options: any): string {
  return options.config ?? "ev.config.yaml";
}

// deno-lint-ignore no-explicit-any
export function isVerbose(options: any): boolean {
  return !!options.verbose;
}

export function getSqlFromConnector(connector: Connector): Sql {
  // Try PostgresConnector first
  if ("getSql" in connector) {
    return (connector as unknown as PostgresConnector).getSql();
  }
  // Try MySQLConnector
  if ("getPool" in connector) {
    return (connector as unknown as MySQLConnector).getPool();
  }
  throw new Error("Cannot extract SQL client from connector");
}
