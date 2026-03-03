// Connector Interface — all types from SPEC section 5

export interface ConnectionConfig {
  engine: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ForeignKeyInfo {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  constraintName: string;
}

export interface EntityConfig {
  name: string;
  rootTable: string;
  rootPk: string;
  children: ChildTableConfig[];
}

export interface ChildTableConfig {
  table: string;
  fkColumn: string;
}

export interface ChangelogEntry {
  id: bigint;
  entityType: string;
  entityId: string;
  tableName: string;
  rowId: string;
  operation: "INSERT" | "UPDATE" | "DELETE" | "SCHEMA_CHANGE";
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  transactionId: string;
  createdAt: Date;
}

export interface SchemaSnapshot {
  tables: Record<string, ColumnInfo[]>;
  capturedAt: Date;
}

export interface HealthCheckResult {
  ok: boolean;
  missingTriggers: string[];
  schemaDrift: SchemaDriftEntry[];
}

export interface SchemaDriftEntry {
  table: string;
  addedColumns: string[];
  removedColumns: string[];
  modifiedColumns: string[];
}

export interface TriggerInstallResult {
  installed: number;
  errors: { table: string; error: string }[];
}

export interface DdlHookInstallResult {
  supported: boolean;
  installed: boolean;
  mechanism: string;
}

export interface TeardownResult {
  droppedTriggers: string[];
  droppedTables: string[];
  droppedFunctions: string[];
  droppedEventTriggers: string[];
}

export interface ChangelogFilter {
  entityType?: string;
  entityId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  version?: number;
}

export interface TransactionGroup {
  transactionId: string;
  count: number;
  minCreatedAt: Date;
  maxCreatedAt: Date;
}

export interface Changeset {
  version: number;
  transactionId: string;
  timestamp: Date;
  operations: ChangelogEntry[];
  isAutocommitGrouped: boolean;
}

export interface Connector {
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;

  getTables(): Promise<TableInfo[]>;
  getForeignKeys(): Promise<ForeignKeyInfo[]>;

  createChangelogTables(): Promise<void>;
  installTriggers(entities: EntityConfig[]): Promise<TriggerInstallResult>;
  installDdlHooks(watchedTables: string[]): Promise<DdlHookInstallResult>;

  teardown(): Promise<TeardownResult>;

  getSchemaSnapshot(tables: string[]): Promise<SchemaSnapshot>;

  queryChangelog(filter: ChangelogFilter): Promise<ChangelogEntry[]>;
  getTransactionGroups(filter: ChangelogFilter): Promise<TransactionGroup[]>;

  healthCheck(entities: EntityConfig[]): Promise<HealthCheckResult>;
}
