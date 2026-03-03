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

export class MySQLConnector implements Connector {
  private _pool: Sql | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    const mysql = await import("mysql2/promise");
    this._pool = await mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 10,
    });
    // Test connection
    await this._pool.query("SELECT 1");
  }

  async disconnect(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }

  getPool(): Sql {
    if (!this._pool) throw new Error("Not connected. Call connect() first.");
    return this._pool;
  }

  async getTables(): Promise<TableInfo[]> {
    const { getTables } = await import("./introspect.ts");
    return getTables(this.getPool());
  }

  async getForeignKeys(): Promise<ForeignKeyInfo[]> {
    const { getForeignKeys } = await import("./introspect.ts");
    return getForeignKeys(this.getPool());
  }

  async createChangelogTables(): Promise<void> {
    const { createChangelogTables } = await import("./triggers.ts");
    return createChangelogTables(this.getPool());
  }

  async installTriggers(entities: EntityConfig[]): Promise<TriggerInstallResult> {
    const { installTriggers } = await import("./triggers.ts");
    return installTriggers(this.getPool(), entities);
  }

  async installDdlHooks(watchedTables: string[]): Promise<DdlHookInstallResult> {
    const { installDdlHooks } = await import("./ddl-hooks.ts");
    return installDdlHooks(this.getPool(), watchedTables);
  }

  async teardown(): Promise<TeardownResult> {
    const { teardown } = await import("./triggers.ts");
    return teardown(this.getPool());
  }

  async getSchemaSnapshot(tables: string[]): Promise<SchemaSnapshot> {
    const { getSchemaSnapshot } = await import("./introspect.ts");
    return getSchemaSnapshot(this.getPool(), tables);
  }

  async queryChangelog(filter: ChangelogFilter): Promise<ChangelogEntry[]> {
    const { queryChangelog } = await import("./query.ts");
    return queryChangelog(this.getPool(), filter);
  }

  async getTransactionGroups(filter: ChangelogFilter): Promise<TransactionGroup[]> {
    const { getTransactionGroups } = await import("./query.ts");
    return getTransactionGroups(this.getPool(), filter);
  }

  async healthCheck(entities: EntityConfig[]): Promise<HealthCheckResult> {
    const { healthCheck } = await import("./health.ts");
    return healthCheck(this.getPool(), entities);
  }
}
