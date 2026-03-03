# ev — Entity Versioning

Track every data change in your relational database — without modifying your application.

`ev` is a CLI tool that connects to an existing database, infers semantic entities from the foreign key graph, and installs lightweight triggers to capture INSERT, UPDATE, and DELETE operations. Changes are grouped into versioned changesets that you can browse, query, and export.

```
$ ev log --entity course --id 42

changeset v3  [tx: 8a3f2b1c]  2026-02-15 14:23:07 UTC
  tables: course, course_upsell
  -- course (id=42)
     UPDATE  endDate: 2026-05-01 -> 2026-06-01
  -- course_upsell (id=18)
     INSERT  courseId=42, licenses=10

changeset v2  [tx: 7b2e1a0d]  2026-02-10 09:15:33 UTC
  tables: course
  -- course (id=42)
     UPDATE  name: Intro to SQL -> Advanced SQL

changeset v1  [tx: 6c1d0f9e]  2026-02-01 11:00:00 UTC
  tables: course
  -- course (id=42)
     INSERT  name=Intro to SQL, startDate=2026-03-01
```

## Features

- **Zero application changes** — Works entirely through database triggers. No ORM plugins, no middleware, no code changes.
- **Automatic entity inference** — Analyzes your FK graph to discover entities and their child tables. A `course` with `course_upsell` and `course_service` children? Detected automatically.
- **Transaction-aware changesets** — Operations within the same database transaction are grouped into a single changeset. Autocommit operations are grouped by configurable time window.
- **Schema drift detection** — DDL hooks capture `ALTER TABLE` events and record schema changes alongside data changes.
- **Clean install/uninstall** — All database objects use the `__ev_` prefix. `ev teardown` removes everything with zero residue.
- **Single binary** — Compiles to a standalone executable via `deno compile`. No runtime required.
- **Connector architecture** — Engine-agnostic core with a pluggable connector interface. PostgreSQL supported in v1.

## Quick start

### Install

Download a prebuilt binary from [Releases](https://github.com/sgmonda/entity-versioning/releases), or build from source:

```bash
# Requires Deno >= 2.0
deno compile --allow-net --allow-read --allow-env --allow-write --output ev main.ts
```

Or run directly without installing:

```bash
deno run --allow-net --allow-read --allow-env --allow-write main.ts --help
```

### Initialize

Point `ev` at your database to auto-discover entities:

```bash
export EV_DB_USER=myuser
export EV_DB_PASSWORD=mypassword

ev init --host localhost --port 5432 --database myapp --engine postgres
```

This introspects the schema, infers entities from foreign key relationships, and generates `ev.config.yaml`:

```yaml
version: 1

connection:
  engine: postgres
  host: localhost
  port: 5432
  database: myapp
  user_env: EV_DB_USER
  password_env: EV_DB_PASSWORD

entities:
  course:
    root_table: course
    root_pk: id
    children:
      - table: course_upsell
        fk_column: courseId
      - table: course_service
        fk_column: courseId

  billing:
    root_table: billing
    root_pk: id
    children:
      - table: billing_line
        fk_column: billingId

ignored_tables:
  - migrations
  - bi_calendar
```

### Start tracking

```bash
ev start
```

This creates the changelog tables (`__ev_changelog`, `__ev_schema_snapshots`), installs DML triggers on all configured entity tables, and sets up DDL hooks for schema change detection.

### Browse history

```bash
# View full history of a specific entity instance
ev log --entity course --id 42

# JSON output for programmatic consumption
ev log --entity course --id 42 --format json

# Filter by time range
ev log --entity course --id 42 --since 2026-02-01 --until 2026-03-01

# View a specific version
ev log --entity course --id 42 --version 3

# Verbose mode — show full row values on INSERT and DELETE
ev log --entity course --id 42 --verbose
```

### Check status

```bash
ev status
```

Shows connection health, trigger status, changelog stats, and schema drift warnings.

### Stop and teardown

```bash
# Remove triggers but keep changelog data
ev stop

# Remove everything (dry-run by default)
ev teardown

# Actually remove all __ev_ objects
ev teardown --confirm
```

## Commands

| Command | Description |
|---------|-------------|
| `ev init` | Connect to database, infer entities, generate `ev.config.yaml` |
| `ev entities` | Review and adjust entity configuration |
| `ev start` | Install changelog tables, triggers, and DDL hooks |
| `ev stop` | Remove triggers and DDL hooks, keep changelog data |
| `ev status` | Show connection status, trigger health, changelog stats |
| `ev log` | Show change history of a specific entity instance |
| `ev teardown` | Remove all `__ev_` objects from the database |
| `ev refresh` | Detect schema drift, record changes, regenerate triggers |

## How it works

### Entity inference

`ev` analyzes your database's foreign key graph to automatically discover entities:

1. **Build FK graph** — Each table becomes a node, each foreign key an edge.
2. **Classify tables** — Tables with no outgoing FKs and incoming FKs from multiple tables are classified as **lookups** (e.g., `language`, `country`). Tables referenced by non-lookup children become **candidate entity roots**.
3. **Resolve entities** — Each candidate root gets its direct FK children. Tables that belong to multiple candidates are flagged as **conflicts** for manual resolution.

### Change capture

For each versioned table, `ev` installs an `AFTER INSERT OR UPDATE OR DELETE` trigger that writes one row to `__ev_changelog`:

- **Root tables**: `entity_id` is the row's primary key.
- **Child tables**: `entity_id` is resolved from the foreign key column pointing to the root.
- **Transaction ID**: `txid_current()` groups operations within the same transaction.
- **Serialization**: `to_jsonb(OLD)` / `to_jsonb(NEW)` capture the full row state.

### Changeset grouping

Raw changelog entries are grouped into semantic changesets:

1. Entries sharing the same `transaction_id` form a single changeset.
2. Autocommit entries (each with a unique `transaction_id`) within a configurable time window (default 500ms) are grouped together.
3. Changesets are assigned sequential version numbers (v1, v2, ...) from oldest to newest.

## Architecture

```
+-----------------------------------------------------------+
|                        CLI (ev)                            |
|  init - entities - start - stop - status - log - teardown  |
+-----------------------------------------------------------+
|                      Core Engine                           |
|  Schema Analyzer | Entity Resolver | Changeset Builder     |
+-----------------------------------------------------------+
|                   Connector Interface                      |
|  introspect - triggers - ddl_hooks - query - health        |
+-------------------+---------------------------------------+
| PostgreSQL        |  (future: MySQL, MariaDB, SQL Server)  |
+-------------------+---------------------------------------+
         |
         v
   +-----------+
   | Target DB |
   +-----------+
```

- **CLI Layer** — Parses commands, reads config, delegates to Core Engine.
- **Core Engine** — Engine-agnostic logic. Analyzes FK graphs, resolves entities, builds changesets. Never touches SQL directly.
- **Connector Interface** — Abstract contract that every database connector must implement.
- **Connectors** — Engine-specific implementations loaded dynamically based on the `engine` config field.

## Playground

A one-command demo that sets up a realistic EdTech scenario with courses, classes, and billing — all tracked by `ev`.

```bash
# Start the database
docker compose up -d

# Run the demo (creates schema, seeds data, starts ev, simulates operations)
deno task demo

# Explore the changelog
EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \
  deno task dev log --entity course --id 1 -c ev.config.demo.yaml

EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \
  deno task dev log --entity billing --id 1 -c ev.config.demo.yaml

EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \
  deno task dev status -c ev.config.demo.yaml

# Reset everything
deno task demo:reset
```

The playground is idempotent — run it multiple times without issues.

## Development

### Prerequisites

- [Deno](https://deno.com/) >= 2.0
- [Docker](https://www.docker.com/) (for integration tests)

### Setup

```bash
git clone https://github.com/sgmonda/entity-versioning.git
cd entity-versioning

# Start test database
docker compose up -d

# Run all tests
deno task test

# Run only unit tests (no database needed)
deno task test:unit

# Run integration tests (requires Docker PostgreSQL)
deno task test:integration
```

### Project structure

```
entity-versioning/
├── main.ts                      # Entry point
├── deno.json                    # Tasks, imports, config
├── docker-compose.yml           # PostgreSQL 16 for tests
├── ev.config.example.yaml       # Example configuration
├── src/
│   ├── cli/                     # CLI commands
│   │   ├── mod.ts               # Command router (Cliffy)
│   │   ├── init.ts              # ev init
│   │   ├── entities.ts          # ev entities
│   │   ├── start.ts             # ev start
│   │   ├── stop.ts              # ev stop
│   │   ├── status.ts            # ev status
│   │   ├── log.ts               # ev log
│   │   ├── teardown.ts          # ev teardown
│   │   └── refresh.ts           # ev refresh
│   ├── config.ts                # YAML config loader/writer
│   ├── connector/
│   │   ├── interface.ts         # Connector contract + all shared types
│   │   └── registry.ts          # Connector factory registry
│   ├── connectors/
│   │   └── postgres/            # PostgreSQL connector
│   │       ├── index.ts         # PostgresConnector class
│   │       ├── introspect.ts    # Schema introspection queries
│   │       ├── triggers.ts      # DML trigger lifecycle
│   │       ├── ddl-hooks.ts     # DDL event trigger hooks
│   │       ├── templates.ts     # SQL generation templates
│   │       ├── query.ts         # Changelog query engine
│   │       └── health.ts        # Health check + drift detection
│   └── core/                    # Engine-agnostic logic
│       ├── schema-analyzer.ts   # FK graph builder + table classifier
│       ├── entity-resolver.ts   # Entity inference + conflict detection
│       ├── changeset-builder.ts # Changelog entry grouping
│       └── query-engine.ts      # History query + formatting
├── tests/
│   ├── core/                    # Unit tests (no database)
│   ├── connectors/postgres/     # Integration tests
│   ├── harness/                 # Generic connector test harness
│   └── fixtures/                # SQL schemas for testing
└── docs/
    └── SPEC.md                  # Full technical specification
```

### Test coverage

| Suite | Tests | Requires DB |
|-------|-------|-------------|
| Core unit tests | 33 | No |
| PostgreSQL integration | 45 | Yes |
| Connector harness | 5 | Yes |
| **Total** | **83** | |

### Building

```bash
# Compile to standalone binary
deno task compile

# Cross-compile
deno compile --target x86_64-unknown-linux-gnu --output ev-linux main.ts
deno compile --target aarch64-apple-darwin --output ev-macos main.ts
deno compile --target x86_64-pc-windows-msvc --output ev.exe main.ts
```

## Writing a new connector

The connector interface is designed so new database engines can be added independently. To add support for MySQL, MariaDB, or SQL Server:

1. Create `src/connectors/<engine>/index.ts` implementing the `Connector` interface from `src/connector/interface.ts`.
2. Register it in `src/connector/registry.ts`.
3. Validate with the generic test harness in `tests/harness/connector-tests.ts`.

The `Connector` interface requires these methods:

```typescript
interface Connector {
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
```

See the PostgreSQL connector in `src/connectors/postgres/` as a reference implementation.

## Configuration reference

### Connection

| Field | Description |
|-------|-------------|
| `engine` | Database engine (`postgres` in v1) |
| `host` | Database host |
| `port` | Database port |
| `database` | Database name |
| `user_env` | Environment variable containing the username |
| `password_env` | Environment variable containing the password |

Credentials are never stored in the config file. They are read from environment variables at runtime.

### Settings

| Field | Default | Description |
|-------|---------|-------------|
| `changelog_table` | `__ev_changelog` | Name of the changelog table |
| `schema_snapshots_table` | `__ev_schema_snapshots` | Name of the schema snapshots table |
| `autocommit_grouping_window_ms` | `500` | Time window (ms) to group autocommit operations into changesets |
| `max_entity_depth` | `1` | FK depth for child resolution (only 1 supported in v1) |
| `capture_old_values` | `true` | Store pre-change row state |
| `capture_new_values` | `true` | Store post-change row state |

### Entity definitions

Each entity has a `root_table`, `root_pk`, and zero or more `children`. A table can appear in at most one entity. The `fk_column` on each child must reference the root's primary key.

## Limitations (v1)

- **PostgreSQL only** — MySQL, MariaDB, and SQL Server connectors are planned for v2.
- **Depth-1 children only** — Grandchild tables (FK chains longer than 1 hop) are not supported.
- **Single-column primary keys** — Composite PKs are not supported; tables with composite PKs are excluded with a warning.
- **DDL hooks require superuser** — PostgreSQL event triggers require superuser privileges. If unavailable, use `ev refresh` manually after schema changes.
- **No rollback** — Change history is read-only. Revert/rollback operations are planned for v2.

## License

MIT
