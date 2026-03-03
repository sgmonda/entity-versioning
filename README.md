<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/deno-%3E%3D2.0-black?style=flat-square&logo=deno" alt="deno" />
  <img src="https://img.shields.io/badge/postgres-16-336791?style=flat-square&logo=postgresql&logoColor=white" alt="postgres" />
  <img src="https://img.shields.io/badge/mysql-8-4479A1?style=flat-square&logo=mysql&logoColor=white" alt="mysql" />
  <img src="https://img.shields.io/badge/tests-127%20passing-brightgreen?style=flat-square" alt="tests" />
</p>

<h1 align="center">ev</h1>

<p align="center">
  <strong>Full change history for your database — zero application changes.</strong>
</p>

<p align="center">
  <code>ev</code> connects to an existing PostgreSQL or MySQL database, infers semantic entities from
  <br/>the foreign key graph, and installs lightweight triggers to capture every INSERT, UPDATE, and DELETE.
  <br/>Changes are grouped into versioned changesets you can browse, query, and export.
</p>

---

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

## Why ev?

Most audit-log solutions require you to instrument your application — ORM hooks, middleware, custom triggers written by hand. `ev` takes a different approach:

1. **Point it at your database.** It reads your schema and figures out the rest.
2. **It installs triggers for you.** No hand-written SQL, no ORM plugins.
3. **It understands entities, not just tables.** A `course` with its `course_upsell` and `course_service` children is tracked as one logical unit.

All database objects use the `__ev_` prefix. Run `ev teardown` and it's gone — zero residue.

## Features

| | |
|---|---|
| **Zero app changes** | Works entirely through database triggers. No ORM plugins, no middleware, no code changes. |
| **Entity inference** | Analyzes your FK graph to discover entities and their child tables automatically. |
| **Transaction-aware** | Operations within the same DB transaction are grouped into a single changeset. |
| **Schema drift detection** | DDL hooks capture `ALTER TABLE` events and record schema changes alongside data changes. |
| **Clean teardown** | `ev teardown` removes everything. All objects are namespaced under `__ev_`. |
| **Single binary** | Compiles to a standalone executable via `deno compile`. No runtime needed. |
| **Pluggable connectors** | Engine-agnostic core with a connector interface. PostgreSQL and MySQL ship built-in. |

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

### 1. Initialize

Point `ev` at your database to auto-discover entities:

```bash
export EV_DB_USER=myuser
export EV_DB_PASSWORD=mypassword

ev init --host localhost --port 5432 --database myapp --engine postgres
# or for MySQL:
# ev init --host localhost --port 3306 --database myapp --engine mysql
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

ignored_tables:
  - migrations
```

### 2. Start tracking

```bash
ev start
```

This creates the changelog tables, installs DML triggers on all configured entity tables, and sets up DDL hooks for schema change detection.

### 3. Browse history

```bash
# Full history of a specific entity instance
ev log --entity course --id 42

# JSON output for programmatic consumption
ev log --entity course --id 42 --format json

# Filter by time range
ev log --entity course --id 42 --since 2026-02-01 --until 2026-03-01

# View a specific version
ev log --entity course --id 42 --version 3
```

### 4. Check status

```bash
ev status
```

Shows connection health, trigger status, changelog stats, and schema drift warnings.

### 5. Clean up

```bash
# Remove triggers but keep changelog data
ev stop

# Preview what would be removed
ev teardown

# Actually remove all __ev_ objects
ev teardown --confirm
```

## Commands

| Command | Description |
|---|---|
| `ev init` | Connect to a database, infer entities, generate config |
| `ev entities` | Review and adjust entity configuration |
| `ev start` | Install changelog tables, triggers, and DDL hooks |
| `ev stop` | Remove triggers and DDL hooks (keeps data) |
| `ev status` | Show connection, trigger health, and changelog stats |
| `ev log` | Query change history for a specific entity instance |
| `ev teardown` | Remove all `__ev_` objects from the database |
| `ev refresh` | Detect schema drift, record changes, regenerate triggers |

## How it works

### Entity inference

`ev` analyzes your database's foreign key graph to discover entities automatically:

```
  ┌─────────────────┐          ┌──────────────────┐
  │     country      │◄─lookup──│                  │
  │   (lookup table) │          │                  │
  └─────────────────┘          │     course        │ ◄── entity root
                               │   (root table)    │
  ┌─────────────────┐          │                  │
  │    language      │◄─lookup──│                  │
  │   (lookup table) │          └────────┬─────────┘
  └─────────────────┘                   │
                                ┌───────┼───────┐
                                │       │       │
                                ▼       ▼       ▼
                        ┌───────────┐ ┌───┐ ┌───────────┐
                        │  upsell   │ │...│ │  service   │
                        │  (child)  │ │   │ │  (child)   │
                        └───────────┘ └───┘ └───────────┘
```

1. **Build FK graph** — Each table becomes a node, each foreign key an edge.
2. **Classify tables** — Tables with no outgoing FKs referenced by many others become **lookups** (e.g., `language`, `country`). Tables referenced by non-lookup children become **entity roots**.
3. **Resolve entities** — Each root gets its direct FK children. Tables claimed by multiple roots are flagged as **conflicts** for manual resolution.

### Change capture

For each versioned table, `ev` installs triggers that write to `__ev_changelog`:

- **Root tables**: `entity_id` = the row's primary key
- **Child tables**: `entity_id` = the FK value pointing to the root
- **Transaction ID**: PostgreSQL uses `txid_current()` to group operations in the same transaction; MySQL uses `UUID()` per trigger (grouped by time window)
- **Serialization**: PostgreSQL uses `to_jsonb(OLD/NEW)` for full row state; MySQL uses `JSON_OBJECT()` built from the column list
- **Trigger count**: PostgreSQL uses 1 multi-event trigger per table; MySQL uses 3 separate triggers (INSERT/UPDATE/DELETE)

### Changeset grouping

Raw changelog entries are grouped into semantic changesets:

1. Entries sharing the same `transaction_id` form a single changeset.
2. Autocommit entries within a configurable time window (default: 500ms) are grouped together.
3. Changesets are assigned sequential version numbers per entity instance (v1, v2, ...).

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                       CLI (ev)                         │
│  init · entities · start · stop · status · log · ...   │
├───────────────────────────────────────────────────────┤
│                     Core Engine                        │
│  Schema Analyzer · Entity Resolver · Changeset Builder │
├───────────────────────────────────────────────────────┤
│                  Connector Interface                   │
│  introspect · triggers · ddl_hooks · query · health    │
├──────────────────┬──────────────┬─────────────────────┤
│  PostgreSQL      │    MySQL     │ MariaDB · SQLServer  │
│  (v1)            │    (v1)      │ (planned)            │
└──────────────────┴──────────────┴─────────────────────┘
         │
         ▼
    ┌──────────┐
    │ Your DB  │
    └──────────┘
```

- **CLI** — Parses commands, reads config, delegates to the core engine.
- **Core Engine** — Engine-agnostic logic: FK graph analysis, entity resolution, changeset building. Never touches SQL directly.
- **Connector Interface** — Abstract contract every database connector implements.
- **Connectors** — Engine-specific implementations, loaded dynamically based on config.

## Playground

A one-command demo with a realistic EdTech scenario — courses, classes, and billing, all tracked by `ev`.

```bash
# Start the database
docker compose up -d

# Run the full demo
deno task demo

# Explore the changelog
deno task dev log --entity course --id 1 -c demo/ev.config.demo.yaml
deno task dev status -c demo/ev.config.demo.yaml

# Reset everything
deno task demo:reset
```

> The playground is idempotent — run it as many times as you want.

## Development

### Prerequisites

- [Deno](https://deno.com/) >= 2.0
- [Docker](https://www.docker.com/) (for integration tests)

### Setup

```bash
git clone https://github.com/sgmonda/entity-versioning.git
cd entity-versioning
docker compose up -d
deno task test
```

### Tests

| Suite | Count | Requires DB |
|---|:---:|:---:|
| Core (unit) | 33 | No |
| PostgreSQL (integration) | 45 | PostgreSQL |
| MySQL (integration) | 39 | MySQL |
| Connector harness (PG + MySQL) | 10 | Both |
| **Total** | **127** | |

```bash
deno task test              # all tests
deno task test:unit         # unit only (no database)
deno task test:integration  # all integration (PG + MySQL)
deno task test:mysql        # MySQL integration only
```

### Building

```bash
# Standalone binary
deno task compile

# Cross-compile
deno compile --target x86_64-unknown-linux-gnu  --output ev-linux main.ts
deno compile --target aarch64-apple-darwin       --output ev-macos main.ts
deno compile --target x86_64-pc-windows-msvc     --output ev.exe   main.ts
```

### Project structure

```
src/
├── cli/                     Command definitions (Cliffy)
├── config.ts                YAML config loader/writer
├── connector/               Abstract interface + registry
├── connectors/postgres/     PostgreSQL implementation
├── connectors/mysql/        MySQL implementation
└── core/                    Engine-agnostic logic
    ├── schema-analyzer.ts   FK graph builder + table classifier
    ├── entity-resolver.ts   Entity inference + conflict detection
    ├── changeset-builder.ts Changelog grouping
    └── query-engine.ts      History query + formatting
tests/
├── core/                    Unit tests
├── connectors/postgres/     PostgreSQL integration tests
├── connectors/mysql/        MySQL integration tests
├── harness/                 Generic connector test harness
└── fixtures/                SQL test schemas (PG + MySQL)
```

## Writing a connector

The connector interface is designed so new database engines can be added independently:

1. Create `src/connectors/<engine>/index.ts` implementing the `Connector` interface.
2. Register it in `src/connector/registry.ts`.
3. Validate with the generic test harness in `tests/harness/`.

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

## Configuration reference

<details>
<summary><strong>Connection</strong></summary>

| Field | Description |
|---|---|
| `engine` | Database engine (`postgres` or `mysql`) |
| `host` | Database host |
| `port` | Database port |
| `database` | Database name |
| `user_env` | Env var containing the username |
| `password_env` | Env var containing the password |

Credentials are never stored in the config file — they're read from environment variables at runtime.

</details>

<details>
<summary><strong>Settings</strong></summary>

| Field | Default | Description |
|---|---|---|
| `changelog_table` | `__ev_changelog` | Changelog table name |
| `schema_snapshots_table` | `__ev_schema_snapshots` | Schema snapshots table name |
| `autocommit_grouping_window_ms` | `500` | Time window (ms) for grouping autocommit operations |
| `max_entity_depth` | `1` | FK depth for child resolution |
| `capture_old_values` | `true` | Store pre-change row state |
| `capture_new_values` | `true` | Store post-change row state |

</details>

<details>
<summary><strong>Entity definitions</strong></summary>

Each entity has a `root_table`, `root_pk`, and zero or more `children`. A table can appear in at most one entity. The `fk_column` on each child must reference the root's primary key.

```yaml
entities:
  course:
    root_table: course
    root_pk: id
    children:
      - table: course_upsell
        fk_column: courseId
```

</details>

## MySQL-specific notes

- **No DDL hooks** — MySQL does not support event triggers. Schema changes are not automatically captured. Use `ev refresh` after `ALTER TABLE` operations.
- **Transaction IDs** — MySQL uses `UUID()` per trigger invocation instead of a shared transaction ID. Operations within the same transaction are grouped via the `autocommit_grouping_window_ms` time window rather than by shared `txid`.
- **3 triggers per table** — MySQL requires separate `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers instead of PostgreSQL's single multi-event trigger.
- **Binary logging** — MySQL with binary logging enabled requires `log_bin_trust_function_creators=1` to create triggers without SUPER privilege.

## Limitations

- **Depth-1 children** — Grandchild tables (FK chains > 1 hop) not yet supported.
- **Single-column PKs** — Tables with composite primary keys are excluded with a warning.
- **DDL hooks need superuser (PostgreSQL)** — PostgreSQL event triggers require superuser. Use `ev refresh` manually if unavailable.
- **No DDL hooks (MySQL)** — MySQL does not support event triggers at all.
- **Read-only history** — Revert/rollback operations planned for v2.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

```bash
git clone https://github.com/sgmonda/entity-versioning.git
cd entity-versioning
docker compose up -d
deno task test
```

## License

[MIT](LICENSE)
