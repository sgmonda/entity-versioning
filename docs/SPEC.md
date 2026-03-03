# Entity Versioning — Technical Specification

**Version:** 0.1.0-draft
**Date:** 2026-03-03
**Status:** Draft for implementation

---

## 1. Overview

Entity Versioning (working name: `ev`) is a CLI tool that connects to existing relational databases, infers semantic entities from the foreign key graph, and tracks data changes over time — without requiring modifications to the target application.

The tool is engine-agnostic by design: an adapter interface (called **connector**) encapsulates all engine-specific behavior (triggers, DDL detection, introspection). New connectors can be contributed independently.

### 1.1 Goals for v1

- Connect to an existing database and infer semantic entities from FK relationships.
- Allow manual adjustment of inferred entities via a configuration file.
- Capture all INSERT, UPDATE, and DELETE operations on versioned tables automatically.
- Group changes into changesets (by transaction or time window).
- Provide a CLI to browse the change history of any entity instance.
- Support PostgreSQL as the only connector in v1.
- Install and uninstall cleanly, leaving zero residue in the target database.

### 1.2 Explicit non-goals for v1

- Rollback / revert operations (planned for v2).
- Web UI (planned for v2).
- User authentication or multi-tenancy.
- MySQL / MariaDB support (planned for v2, requires manual `refresh` post-migration).
- SQL Server support (planned for v2, pending mature Deno driver).
- Versioning of schema changes themselves (v1 only records schema change events as markers).

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      CLI (ev)                           │
│  init · entities · start · stop · status · log · teardown│
├─────────────────────────────────────────────────────────┤
│                    Core Engine                          │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌────────┐ │
│  │ Schema   │ │ Entity    │ │ Changeset  │ │ Query  │ │
│  │ Analyzer │ │ Resolver  │ │ Builder    │ │ Engine │ │
│  └──────────┘ └───────────┘ └────────────┘ └────────┘ │
├─────────────────────────────────────────────────────────┤
│                 Connector Interface                     │
│  introspect · install_triggers · install_ddl_hooks      │
│  uninstall · get_transaction_id · serialize_row          │
├──────────┬──────────────────────────────────────────────┤
│ Postgres │  (future: MySQL, MariaDB, SQL Server)        │
│ Connector│                                              │
└──────────┴──────────────────────────────────────────────┘
         │
         ▼
   ┌───────────┐
   │ Target DB │
   │ (PG)      │
   └───────────┘
```

### 2.1 Layer responsibilities

**CLI Layer:** Parses commands, reads configuration, delegates to Core Engine. No business logic.

**Core Engine:** Engine-agnostic logic. Analyzes FK graphs, resolves entity membership, builds changesets from raw changelog rows, and queries history. Never touches SQL directly — always goes through a connector.

**Connector Interface:** Abstract contract that every database connector must implement. Defined as a set of functions/methods with clear input/output types (see section 5).

**Connectors:** Engine-specific implementations. Each connector lives in its own directory within the repository and is loaded dynamically based on the `engine` field in the configuration file.

---

## 3. Repository structure

```
entity-versioning/
├── README.md
├── LICENSE
├── CONTRIBUTING.md          # How to write a connector
├── deno.json                # Deno config: tasks, imports, compile options
├── deno.lock
├── ev.config.example.yaml
├── src/
│   ├── cli/                 # CLI commands
│   │   ├── mod.ts           # Command router
│   │   ├── init.ts
│   │   ├── entities.ts
│   │   ├── start.ts
│   │   ├── stop.ts
│   │   ├── status.ts
│   │   ├── log.ts
│   │   └── teardown.ts
│   ├── core/                # Engine-agnostic logic
│   │   ├── schema-analyzer.ts
│   │   ├── entity-resolver.ts
│   │   ├── changeset-builder.ts
│   │   └── query-engine.ts
│   ├── connector/           # Connector interface
│   │   └── interface.ts     # Abstract types and contract
│   └── connectors/          # One directory per engine
│       └── postgres/
│           ├── index.ts
│           ├── introspect.ts
│           ├── triggers.ts
│           ├── ddl-hooks.ts
│           └── templates/   # SQL templates for trigger generation
├── main.ts                  # Entry point (deno compile target)
├── tests/
│   ├── core/                # Unit tests for engine-agnostic logic
│   ├── connectors/
│   │   └── postgres/        # Integration tests (require a PG instance)
│   ├── harness/             # Generic test harness for connector authors
│   │   └── connector-tests.ts
│   └── fixtures/            # Sample schemas for testing
│       └── edtech-schema.sql
├── docker-compose.yml       # PostgreSQL for integration tests
└── docs/
    ├── SPEC.md              # This document
    ├── CONNECTOR_GUIDE.md   # How to implement a new connector
    └── ARCHITECTURE.md      # Deeper architecture docs
```

### 3.1 Runtime and language

TypeScript on **Deno**. Rationale:

- **Native TypeScript execution** — no build step, no `tsconfig.json`, no `tsc`. A contributor clones the repo and runs `deno test`. That's it.
- **`deno compile`** — produces a single standalone binary for Linux, macOS, and Windows. Users can download and run `ev` without installing Deno, Node, or any runtime. Cross-compilation is supported via `--target`.
- **Security model** — Deno's explicit permissions (`--allow-net`, `--allow-read`, `--allow-env`) are a natural fit for a tool that connects to third-party databases. The compiled binary embeds only the permissions it needs.
- **Standard library** — Deno's `@std` modules cover CLI argument parsing, YAML, file I/O, and testing without third-party dependencies.
- **npm compatibility** — Deno 2 supports `npm:` specifiers, so npm packages (e.g., `pg` as a fallback driver) can be used if needed alongside Deno-native modules.

**PostgreSQL driver:** [`postgres`](https://github.com/porsager/postgres) (Postgres.js) — 8.5k stars, the most widely used PostgreSQL client in the JS ecosystem. Multi-runtime (Node, Deno, Bun, Cloudflare Workers), with a dedicated `deno/` build. Key features relevant to this project:

- **Tagged template queries** — `sql`\`select * from ${sql(table)} where id = ${id}\`` prevents SQL injection by design. Useful for the query engine and dynamic changelog queries.
- **Transactions** — `sql.begin(async sql => { ... })` provides scoped connections, which aligns with our changeset grouping logic.
- **LISTEN/NOTIFY** — built-in support for PostgreSQL's pub/sub. Enables the v2 auto-refresh feature (DDL hook sends NOTIFY, `ev` daemon regenerates triggers without manual `refresh`).
- **Connection pooling** — lazy connections, configurable pool size, automatic reconnection.
- **Unlicense** — public domain, no licensing concerns for an open-source project.

**CLI framework:** Deno's built-in `@std/cli` for argument parsing, or `npm:commander` / `npm:cliffy` if richer features are needed. Decision deferred to implementation.

**Configuration:** `@std/yaml` for reading/writing `ev.config.yaml`.

**`deno.json` configuration:**

```json
{
  "name": "entity-versioning",
  "version": "0.1.0",
  "tasks": {
    "dev": "deno run --allow-net --allow-read --allow-env main.ts",
    "test": "deno test --allow-net --allow-read --allow-env",
    "test:unit": "deno test tests/core/",
    "test:integration": "deno test --allow-net tests/connectors/",
    "compile": "deno compile --allow-net --allow-read --allow-env --output ev main.ts",
    "compile:all": "deno task compile:linux && deno task compile:macos && deno task compile:windows",
    "compile:linux": "deno compile --target x86_64-unknown-linux-gnu --output ev-linux main.ts",
    "compile:macos": "deno compile --target aarch64-apple-darwin --output ev-macos main.ts",
    "compile:windows": "deno compile --target x86_64-pc-windows-msvc --output ev.exe main.ts"
  },
  "imports": {
    "@std/": "jsr:@std/",
    "postgres": "https://deno.land/x/postgresjs/mod.js"
  }
}
```

**Distribution channels (v1):**

1. **Compiled binaries** — GitHub Releases with pre-built binaries for linux-x64, macos-arm64, windows-x64. A CI pipeline (GitHub Actions) builds these on every tagged release.
2. **Direct execution** — `deno run --allow-net --allow-read --allow-env https://deno.land/x/entity_versioning/main.ts init` for users who have Deno installed.
3. **npm (future consideration)** — Deno supports publishing to npm via `dnt` (Deno to Node Transform). This could be explored for v2 to reach the Node.js audience, but is not a v1 goal.

### 3.2 Naming conventions

All objects created by the tool in the target database use the prefix `__ev_`. This applies to tables, triggers, functions, and event triggers. The prefix makes ownership unambiguous and teardown safe (drop everything matching `__ev_*`).

---

## 4. Configuration file

Generated by `ev init`, lives in the project root as `ev.config.yaml`. The user commits this file to their repository.

```yaml
# ev.config.yaml
version: 1

connection:
  engine: postgres            # postgres (v1) | mysql, mssql (v2)
  host: localhost
  port: 5432
  database: myapp
  # Credentials: resolved from env vars, not stored in config
  user_env: EV_DB_USER        # Name of env var containing username
  password_env: EV_DB_PASSWORD # Name of env var containing password

settings:
  changelog_table: __ev_changelog
  schema_snapshots_table: __ev_schema_snapshots
  autocommit_grouping_window_ms: 500   # Time window to group autocommit operations
  max_entity_depth: 1                  # FK depth (1 = direct children only in v1)
  capture_old_values: true             # Store pre-change state
  capture_new_values: true             # Store post-change state

entities:
  course:
    root_table: course
    root_pk: id
    children:
      - table: course_upsell
        fk_column: courseId
      - table: course_service
        fk_column: courseId
      - table: course_users_user
        fk_column: courseId
      - table: course_teacher_blacklist
        fk_column: courseId
      - table: course_forum_topic
        fk_column: courseId

  billing:
    root_table: billing
    root_pk: id
    children:
      - table: billing_line
        fk_column: billingId
      - table: billing_rate_incentive
        fk_column: billingId
      - table: billing_bonus_course_tutor
        fk_column: invoiceId

  class:
    root_table: class
    root_pk: id
    children:
      - table: class_evaluations
        fk_column: classId
      - table: class_feedback_teacher
        fk_column: classId
      - table: class_issue
        fk_column: classId
      - table: class_history
        fk_column: classId
      - table: chat
        fk_column: classId

ignored_tables:
  - migrations
  - bi_calendar
  - tracking_event
  - location_tracking
```

### 4.1 Entity definition rules

Each entity has exactly one `root_table` with a `root_pk`. Each child entry specifies the `table` and the `fk_column` that references the root's PK. In v1, only depth-1 children are supported. The `fk_column` must be a direct FK to `root_table.root_pk`.

A table can appear in at most one entity definition. If the FK graph suggests a table belongs to multiple entities (e.g. `activity_answer` → `user` and `course`), the user must choose one or exclude it. The `ev entities` command flags these conflicts during the interactive adjustment phase.

---

## 5. Connector Interface

Every connector must implement the following contract. This is the only coupling point between the core engine and the database engine.

```typescript
interface Connector {
  // --- Connection ---
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  
  // --- Introspection ---
  // Returns all tables with their columns and types
  getTables(): Promise<TableInfo[]>;
  // Returns all FK relationships
  getForeignKeys(): Promise<ForeignKeyInfo[]>;
  
  // --- Installation ---
  // Creates the changelog and schema snapshots tables
  createChangelogTables(): Promise<void>;
  // Generates and installs DML triggers for the given entities
  installTriggers(entities: EntityConfig[]): Promise<TriggerInstallResult>;
  // Installs DDL event hooks (engine-specific mechanism)
  installDdlHooks(watchedTables: string[]): Promise<DdlHookInstallResult>;
  
  // --- Uninstallation ---
  // Removes all __ev_ objects from the database
  teardown(): Promise<TeardownResult>;
  
  // --- Schema ---
  // Returns current schema snapshot for the given tables
  getSchemaSnapshot(tables: string[]): Promise<SchemaSnapshot>;
  
  // --- Query ---
  // Reads changelog entries filtered by entity/id/time range
  queryChangelog(filter: ChangelogFilter): Promise<ChangelogEntry[]>;
  // Returns distinct transaction groups for changeset building
  getTransactionGroups(filter: ChangelogFilter): Promise<TransactionGroup[]>;
  
  // --- Health ---
  // Checks that all expected triggers exist and are enabled
  healthCheck(entities: EntityConfig[]): Promise<HealthCheckResult>;
}
```

### 5.1 Key types

```typescript
interface TableInfo {
  name: string;
  schema: string;        // 'public', 'dbo', etc.
  columns: ColumnInfo[];
}

interface ColumnInfo {
  name: string;
  dataType: string;       // Engine-native type as string
  nullable: boolean;
  isPrimaryKey: boolean;
}

interface ForeignKeyInfo {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  constraintName: string;
}

interface EntityConfig {
  name: string;
  rootTable: string;
  rootPk: string;
  children: ChildTableConfig[];
}

interface ChildTableConfig {
  table: string;
  fkColumn: string;
}

interface ChangelogEntry {
  id: bigint;
  entityType: string;
  entityId: string;
  tableName: string;
  rowId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  transactionId: string;
  createdAt: Date;
}

interface SchemaSnapshot {
  tables: Record<string, ColumnInfo[]>;
  capturedAt: Date;
}

interface HealthCheckResult {
  ok: boolean;
  missingTriggers: string[];
  schemaDrift: SchemaDriftEntry[];
}

interface SchemaDriftEntry {
  table: string;
  addedColumns: string[];
  removedColumns: string[];
  modifiedColumns: string[];
}

interface TriggerInstallResult {
  installed: number;
  errors: { table: string; error: string }[];
}

interface DdlHookInstallResult {
  supported: boolean;     // false for MySQL
  installed: boolean;
  mechanism: string;      // 'event_trigger', 'ddl_trigger', 'manual_refresh'
}

interface TeardownResult {
  droppedTriggers: string[];
  droppedTables: string[];
  droppedFunctions: string[];
  droppedEventTriggers: string[];
}
```

### 5.2 Connector registration

Connectors self-register via a simple map. Adding a new connector requires creating a directory under `src/connectors/<engine>/`, implementing the `Connector` interface, and adding one entry to the registry:

```typescript
// src/connectors/registry.ts
import { PostgresConnector } from './postgres/index.ts';

export const connectors: Record<string, () => Connector> = {
  postgres: () => new PostgresConnector(),
  // mysql: () => new MysqlConnector(),    // v2
  // mssql: () => new MssqlConnector(),    // v2
};
```

The `CONTRIBUTING.md` and `CONNECTOR_GUIDE.md` documents will explain the full contract, provide a test harness, and include a template directory that new contributors can copy.

---

## 6. Changelog table schema

A single table in the target database. Optimized for fast append (the trigger hot path). Secondary indexes are minimal — heavier queries use the `entity_type + entity_id + created_at` composite.

```sql
-- PostgreSQL
CREATE TABLE __ev_changelog (
  id            BIGSERIAL PRIMARY KEY,
  entity_type   VARCHAR(100)  NOT NULL,
  entity_id     VARCHAR(100)  NOT NULL,
  table_name    VARCHAR(100)  NOT NULL,
  row_id        VARCHAR(100)  NOT NULL,
  operation     VARCHAR(6)    NOT NULL,  -- INSERT, UPDATE, DELETE
  old_values    JSONB,
  new_values    JSONB,
  transaction_id VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX __ev_idx_entity_lookup
  ON __ev_changelog (entity_type, entity_id, created_at);

CREATE INDEX __ev_idx_transaction
  ON __ev_changelog (transaction_id);
```

### 6.1 Schema snapshots table

Stores periodic snapshots of the schema for versioned tables. Updated on `start`, on each `SCHEMA_CHANGE` event, and on `refresh`.

```sql
CREATE TABLE __ev_schema_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  table_name    VARCHAR(100)  NOT NULL,
  columns       JSONB         NOT NULL,  -- Array of {name, dataType, nullable}
  captured_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX __ev_idx_schema_table
  ON __ev_schema_snapshots (table_name, captured_at);
```

### 6.2 Schema change markers

When DDL is detected on a watched table, the DDL hook inserts a special row into `__ev_changelog` with `operation = 'SCHEMA_CHANGE'`, `old_values` containing the previous column list, and `new_values` containing the new column list. The `entity_id` is set to `'*'` (affects all instances). Immediately after, the hook inserts a new row in `__ev_schema_snapshots` and regenerates the DML triggers for the affected table.

---

## 7. Trigger design

### 7.1 General approach

For each versioned table, the connector generates three triggers (INSERT, UPDATE, DELETE). Each trigger writes one row to `__ev_changelog`, serializing the affected row as JSON.

The critical path inside the trigger is: resolve the entity_id → serialize OLD/NEW → insert into changelog. No other logic runs in the trigger.

### 7.2 Entity ID resolution

For the root table, the `entity_id` is simply the row's PK value.

For child tables, the `entity_id` is the value of the configured `fk_column` (which points to the root table's PK). This is read directly from the `NEW` record (for INSERT/UPDATE) or the `OLD` record (for DELETE).

No JOINs are needed because v1 only supports depth-1 children.

### 7.3 Transaction ID

The trigger captures the current transaction ID using engine-native functions:

- **PostgreSQL:** `txid_current()::TEXT` (or `pg_current_xact_id()::TEXT` on PG 13+)

Future connectors will use their engine-native equivalents (e.g., `CURRENT_TRANSACTION_ID()` on SQL Server, `INNODB_TRX` on MySQL).

### 7.4 PostgreSQL trigger template

```sql
-- Generated for child table 'billing_line' of entity 'billing'
CREATE OR REPLACE FUNCTION __ev_trigger_billing_line_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO __ev_changelog
      (entity_type, entity_id, table_name, row_id, operation,
       old_values, new_values, transaction_id)
    VALUES (
      'billing',
      NEW."billingId"::TEXT,
      'billing_line',
      NEW."id"::TEXT,
      'INSERT',
      NULL,
      to_jsonb(NEW),
      txid_current()::TEXT
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO __ev_changelog
      (entity_type, entity_id, table_name, row_id, operation,
       old_values, new_values, transaction_id)
    VALUES (
      'billing',
      NEW."billingId"::TEXT,
      'billing_line',
      NEW."id"::TEXT,
      'UPDATE',
      to_jsonb(OLD),
      to_jsonb(NEW),
      txid_current()::TEXT
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO __ev_changelog
      (entity_type, entity_id, table_name, row_id, operation,
       old_values, new_values, transaction_id)
    VALUES (
      'billing',
      OLD."billingId"::TEXT,
      'billing_line',
      OLD."id"::TEXT,
      'DELETE',
      to_jsonb(OLD),
      NULL,
      txid_current()::TEXT
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER __ev_trigger_billing_line
  AFTER INSERT OR UPDATE OR DELETE ON billing_line
  FOR EACH ROW EXECUTE FUNCTION __ev_trigger_billing_line_fn();
```

### 7.5 DDL hook — PostgreSQL

```sql
CREATE OR REPLACE FUNCTION __ev_ddl_hook_fn()
RETURNS event_trigger AS $$
DECLARE
  obj RECORD;
  watched_tables TEXT[] := ARRAY[
    'billing', 'billing_line', 'billing_rate_incentive',
    'course', 'course_upsell', 'class'
    -- ... generated from config
  ];
  old_snapshot JSONB;
  new_snapshot JSONB;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.object_type = 'table' AND obj.object_identity = ANY(watched_tables) THEN
      -- Capture old schema from snapshots table
      SELECT columns INTO old_snapshot
      FROM __ev_schema_snapshots
      WHERE table_name = obj.object_identity
      ORDER BY captured_at DESC LIMIT 1;

      -- Capture new schema from information_schema
      SELECT jsonb_agg(jsonb_build_object(
        'name', column_name,
        'dataType', data_type,
        'nullable', is_nullable = 'YES'
      )) INTO new_snapshot
      FROM information_schema.columns
      WHERE table_name = obj.object_identity
        AND table_schema = 'public';

      -- Record schema change in changelog
      INSERT INTO __ev_changelog
        (entity_type, entity_id, table_name, row_id, operation,
         old_values, new_values, transaction_id)
      VALUES (
        '__schema',
        '*',
        obj.object_identity,
        '*',
        'SCHEMA_CHANGE',
        old_snapshot,
        new_snapshot,
        txid_current()::TEXT
      );

      -- Update schema snapshot
      INSERT INTO __ev_schema_snapshots (table_name, columns)
      VALUES (obj.object_identity, new_snapshot);

      -- NOTE: Trigger regeneration happens asynchronously
      -- via the 'ev refresh' command or a NOTIFY/LISTEN mechanism.
      -- The existing triggers continue to work for added columns
      -- (to_jsonb captures all columns regardless of trigger definition).
      -- Removed/renamed columns are flagged by health check.
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE EVENT TRIGGER __ev_ddl_hook
  ON ddl_command_end
  WHEN TAG IN ('ALTER TABLE', 'DROP TABLE')
  EXECUTE FUNCTION __ev_ddl_hook_fn();
```

Important: because PostgreSQL triggers use `to_jsonb(NEW)` which serializes all columns dynamically, an `ALTER TABLE ADD COLUMN` does NOT break the trigger — the new column automatically appears in the JSON. Only `DROP COLUMN` or `RENAME COLUMN` cause data discontinuity, which the schema change marker captures.

---

## 8. Changeset builder

The Core Engine groups raw changelog rows into changesets using the following algorithm:

1. Query `__ev_changelog` for a given `entity_type` and `entity_id`, ordered by `created_at`.
2. Group consecutive rows that share the same `transaction_id` into a single changeset.
3. For rows without an explicit transaction (autocommit), group rows that fall within `autocommit_grouping_window_ms` of each other and share the same `entity_type + entity_id`.
4. Each changeset receives a sequential version number (v1, v2, v3...) for display purposes.

```typescript
interface Changeset {
  version: number;
  transactionId: string;
  timestamp: Date;                // earliest created_at in the group
  operations: ChangelogEntry[];   // ordered by created_at
  isAutocommitGrouped: boolean;   // true if grouped by time window
}
```

---

## 9. CLI commands

### 9.1 `ev init`

Connects to the database, runs introspection, infers entities from the FK graph, and generates `ev.config.yaml`.

**Entity inference algorithm:**
1. Build a directed graph from FK relationships (child → parent).
2. Classify tables with zero outgoing FKs and at least one incoming FK as **lookup tables**.
3. For each non-lookup table with incoming FKs, treat it as a candidate entity root.
4. For each candidate, collect all non-lookup tables that have a direct FK to it.
5. Rank candidates by number of children. Present the top N to the user.
6. Flag tables that appear as children of multiple candidates (ownership conflicts).
7. Write results to `ev.config.yaml` with conflicts marked as comments.

**Output:** `ev.config.yaml` file with inferred entities and `# CONFLICT` annotations.

### 9.2 `ev entities`

Interactive mode to review and adjust the entity configuration. Reads `ev.config.yaml`, presents entities, allows adding/removing children, resolving conflicts, and excluding tables. Writes changes back to `ev.config.yaml`.

For v1, this can be a simple guided CLI prompt (using something like `@cliffy/prompt`). A TUI or web-based editor is planned for later.

### 9.3 `ev start`

1. Validates `ev.config.yaml`.
2. Connects to the database.
3. Creates `__ev_changelog` and `__ev_schema_snapshots` tables (if not exists).
4. Takes an initial schema snapshot of all versioned tables.
5. Generates and installs DML triggers for all configured entities.
6. Installs DDL hooks (if supported by engine).
7. Runs a health check.
8. Prints summary: N triggers installed, DDL hooks status.

### 9.4 `ev stop`

Disables (or drops) all DML triggers and DDL hooks. Does NOT delete the changelog tables or their data. The tool can be restarted with `ev start` without data loss.

### 9.5 `ev status`

Runs a health check and reports:
- Connection status.
- Number of active triggers vs expected.
- Schema drift detection (compares current schema against latest snapshot).
- Changelog stats (total entries, entries per entity, disk usage estimate).

### 9.6 `ev log`

Displays the change history of a specific entity instance.

```bash
# Show all changesets for course 42
ev log --entity course --id 42

# Show changesets in a time range
ev log --entity course --id 42 --since 2026-01-01 --until 2026-02-01

# Show details of a specific changeset
ev log --entity course --id 42 --version 7

# Output as JSON for scripting
ev log --entity course --id 42 --format json
```

**Default output format** (inspired by `git log`):

```
changeset v12  [tx: 8a3f2b1c]  2026-02-15 14:23:07 UTC
  tables: course, course_upsell
  ── course (id=42)
     UPDATE  endDate: 2026-05-01 → 2026-06-01
  ── course_upsell (id=108)
     INSERT  licenses=10, hourCostTraining=45.50

changeset v11  [tx: 7b2e1a0d]  2026-02-14 09:12:33 UTC
  tables: course
  ── course (id=42)
     UPDATE  courseStateId: 2 → 3

schema change  2026-02-10 11:00:00 UTC
  ── course_upsell
     + column 'targetWalletId' (bigint, nullable)
```

For UPDATE operations, the display shows only the fields that changed (diff between `old_values` and `new_values`), not the full row. The full row data is available via `--verbose` or `--format json`.

### 9.7 `ev teardown`

1. Drops all DML triggers (`__ev_trigger_*`).
2. Drops all trigger functions (`__ev_trigger_*_fn`).
3. Drops DDL event triggers/hooks (`__ev_ddl_hook*`).
4. Drops `__ev_changelog` and `__ev_schema_snapshots` tables.
5. Prints summary of everything removed.

Requires `--confirm` flag to execute. Without it, prints a dry-run preview.

### 9.8 `ev refresh`

Compares the current database schema against the latest snapshot. For each table with drift:
1. Records a `SCHEMA_CHANGE` entry in the changelog.
2. Updates the schema snapshot.
3. Regenerates the DML triggers for the affected table.

This command is **required after migrations** on engines without DDL hooks (MySQL, planned for v2). On PostgreSQL (v1), DDL hooks handle this automatically, but `ev refresh` serves as a manual fallback if DDL hooks fail or are disabled.

---

## 10. Testing strategy

### 10.1 Core engine tests (unit)

No database required. Test the schema analyzer, entity resolver, and changeset builder with fixture data (mock FK graphs, mock changelog rows).

### 10.2 Connector tests (integration)

Each connector has its own integration test suite that runs against a real database instance (via Docker Compose or `docker run`). The v1 suite covers PostgreSQL only. Tests cover:

- **Introspection accuracy:** Load a known schema, verify `getTables` and `getForeignKeys` match expectations.
- **Trigger installation and teardown:** Install triggers, verify they exist, teardown, verify they're gone.
- **Change capture:** Perform INSERT/UPDATE/DELETE via raw SQL, verify changelog rows are correct.
- **Transaction grouping:** Perform multiple operations in one transaction, verify they share a `transaction_id`.
- **DDL detection:** ALTER a watched table, verify `SCHEMA_CHANGE` marker appears.
- **Schema drift:** ALTER a table, run health check, verify drift is reported.
- **Teardown cleanliness:** After teardown, verify zero `__ev_*` objects remain in the database.

### 10.3 Test harness for new connectors

The `CONNECTOR_GUIDE.md` includes a generic test suite that any new connector can run. It provides a standard schema fixture, a set of operations to perform, and the expected changelog output. A contributor implementing a MySQL or SQL Server connector can run this harness against a Docker container of their target engine to validate their implementation.

---

## 11. Connector contribution guide (summary)

Full details go in `CONNECTOR_GUIDE.md`. The key points:

1. Create a directory `src/connectors/<engine>/`.
2. Implement the `Connector` interface (section 5).
3. Add your connector to the registry (section 5.2).
4. Set `DdlHookInstallResult.supported = false` if your engine doesn't support DDL hooks. The core engine will then require `ev refresh` after migrations and will warn the user.
5. Provide SQL templates in `templates/` for trigger generation.
6. Write integration tests using the standard test harness.
7. Document engine-specific limitations in a `README.md` inside your connector directory.

---

## 12. Open questions for v2

These items are explicitly deferred but documented here for future reference:

- **Additional connectors:** MySQL/MariaDB (DDL detection via `refresh` only, no DDL hooks), SQL Server (DDL triggers supported, pending mature Deno driver — `tedious` via npm compat or ODBC/FFI).
- **Rollback mechanism:** Reconstructing entity state from changelog and applying reverse operations. Requires conflict detection (what if another entity references a row we want to revert?).
- **Depth > 1 children:** Requires JOINs inside triggers or denormalized `entity_id` columns. Performance implications need benchmarking.
- **Changelog retention and compaction:** Periodic snapshots + pruning of old deltas. Without this, the changelog table grows unboundedly.
- **Web UI:** Visual timeline of entity changes, diff viewer, search.
- **NOTIFY/LISTEN for auto-refresh:** On PostgreSQL, the DDL hook could NOTIFY a running `ev` daemon to regenerate triggers automatically, removing the need for `ev refresh` entirely.
- **Concurrent entity changes:** If two transactions modify the same entity simultaneously, changeset ordering and consistency guarantees.
- **Bulk operations performance:** Triggers firing on mass UPDATE/INSERT (e.g., migrations that update 100k rows). May need a mechanism to temporarily disable capture (`ev pause` / `ev resume`).
