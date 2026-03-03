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
  // Try PostgresConnector first — returns postgres.js tagged template function
  if ("getSql" in connector) {
    return (connector as unknown as PostgresConnector).getSql();
  }
  // Try MySQLConnector — wrap pool in tagged template compatible function
  if ("getPool" in connector) {
    // deno-lint-ignore no-explicit-any
    const pool: any = (connector as unknown as MySQLConnector).getPool();
    // Return a function that mimics postgres.js tagged template syntax
    return function mysqlTaggedTemplate(strings: TemplateStringsArray, ...values: unknown[]) {
      let query = strings[0];
      for (let i = 0; i < values.length; i++) {
        query += "?";
        query += strings[i + 1];
      }
      return pool.query(query, values).then(
        // deno-lint-ignore no-explicit-any
        ([rows]: [any]) => rows,
      );
    };
  }
  throw new Error("Cannot extract SQL client from connector");
}

export function getEngineFromConnector(connector: Connector): string {
  if ("getSql" in connector) return "postgres";
  if ("getPool" in connector) return "mysql";
  throw new Error("Unknown connector type");
}
