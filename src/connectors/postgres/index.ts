import type {
  Connector,
  ConnectionConfig,
  TableInfo,
  ForeignKeyInfo,
  EntityConfig,
  TriggerInstallResult,
  DdlHookInstallResult,
  TeardownResult,
  SchemaSnapshot,
  ChangelogEntry,
  ChangelogFilter,
  TransactionGroup,
  HealthCheckResult,
} from "../../connector/interface.ts";
import type { Sql } from "./types.ts";

export class PostgresConnector implements Connector {
  private _sql: Sql | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    const postgres = (await import("postgres")).default;
    this._sql = postgres({
      host: config.host,
      port: config.port,
      database: config.database,
      username: config.user,
      password: config.password,
    });
    // Test connection
    await this._sql`SELECT 1`;
  }

  async disconnect(): Promise<void> {
    if (this._sql) {
      await this._sql.end();
      this._sql = null;
    }
  }

  getSql(): Sql {
    if (!this._sql) throw new Error("Not connected. Call connect() first.");
    return this._sql;
  }

  async getTables(): Promise<TableInfo[]> {
    const { getTables } = await import("./introspect.ts");
    return getTables(this.getSql());
  }

  async getForeignKeys(): Promise<ForeignKeyInfo[]> {
    const { getForeignKeys } = await import("./introspect.ts");
    return getForeignKeys(this.getSql());
  }

  async createChangelogTables(): Promise<void> {
    const { createChangelogTables } = await import("./triggers.ts");
    return createChangelogTables(this.getSql());
  }

  async installTriggers(entities: EntityConfig[]): Promise<TriggerInstallResult> {
    const { installTriggers } = await import("./triggers.ts");
    return installTriggers(this.getSql(), entities);
  }

  async installDdlHooks(watchedTables: string[]): Promise<DdlHookInstallResult> {
    const { installDdlHooks } = await import("./ddl-hooks.ts");
    return installDdlHooks(this.getSql(), watchedTables);
  }

  async teardown(): Promise<TeardownResult> {
    const { teardown } = await import("./triggers.ts");
    return teardown(this.getSql());
  }

  async getSchemaSnapshot(tables: string[]): Promise<SchemaSnapshot> {
    const { getSchemaSnapshot } = await import("./introspect.ts");
    return getSchemaSnapshot(this.getSql(), tables);
  }

  async queryChangelog(filter: ChangelogFilter): Promise<ChangelogEntry[]> {
    const { queryChangelog } = await import("./query.ts");
    return queryChangelog(this.getSql(), filter);
  }

  async getTransactionGroups(filter: ChangelogFilter): Promise<TransactionGroup[]> {
    const { getTransactionGroups } = await import("./query.ts");
    return getTransactionGroups(this.getSql(), filter);
  }

  async healthCheck(entities: EntityConfig[]): Promise<HealthCheckResult> {
    const { healthCheck } = await import("./health.ts");
    return healthCheck(this.getSql(), entities);
  }
}
