/**
 * Demo playground for entity-versioning.
 *
 * Spins up a realistic EdTech scenario with courses, classes, billing,
 * and then simulates a lifecycle of changes — all tracked by ev.
 *
 * Usage:
 *   deno task demo          # Full demo
 *   deno task demo:reset    # Clean up everything
 */

import { PostgresConnector } from "../src/connectors/postgres/index.ts";
import {
  loadConfigFile,
  configToEntityConfigs,
  writeConfigFile,
} from "../src/config.ts";
import type { EvConfig } from "../src/config.ts";
import type { Sql } from "../src/connectors/postgres/types.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_CONFIG = {
  engine: "postgres" as const,
  host: "localhost",
  port: 5433,
  database: "ev_test",
  user: "ev_user",
  password: "ev_pass",
};

const CONFIG_PATH = "ev.config.demo.yaml";
const RESET_FLAG = Deno.args.includes("--reset");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function step(msg: string) {
  console.log(`\n  ${">>>"} ${msg}`);
}

function info(msg: string) {
  console.log(`      ${msg}`);
}

// ---------------------------------------------------------------------------
// Database cleanup (idempotent)
// ---------------------------------------------------------------------------

async function cleanAll(sql: Sql) {
  step("Cleaning previous state...");

  // Drop __ev_ event triggers
  const evtTriggers = await sql`SELECT evtname FROM pg_event_trigger WHERE evtname LIKE '__ev_%'`;
  for (const et of evtTriggers) {
    await sql.unsafe(`DROP EVENT TRIGGER IF EXISTS ${et.evtname}`);
  }

  // Drop __ev_ triggers
  const triggers = await sql`
    SELECT tgname, c.relname FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE tgname LIKE '__ev_%'
  `;
  for (const t of triggers) {
    await sql.unsafe(`DROP TRIGGER IF EXISTS ${t.tgname} ON "${t.relname}"`);
  }

  // Drop __ev_ functions
  const fns = await sql`SELECT proname FROM pg_proc WHERE proname LIKE '__ev_%'`;
  for (const f of fns) {
    await sql.unsafe(`DROP FUNCTION IF EXISTS ${f.proname} CASCADE`);
  }

  // Drop __ev_ tables
  await sql.unsafe(`DROP TABLE IF EXISTS __ev_changelog CASCADE`);
  await sql.unsafe(`DROP TABLE IF EXISTS __ev_schema_snapshots CASCADE`);

  // Drop all public tables
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  for (const t of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
  }

  info("Done.");
}

// ---------------------------------------------------------------------------
// Schema & seed
// ---------------------------------------------------------------------------

async function loadSchema(sql: Sql) {
  step("Loading EdTech schema...");
  const schemaSql = await Deno.readTextFile(
    new URL("../tests/fixtures/edtech-schema.sql", import.meta.url),
  );
  await sql.unsafe(schemaSql);
  info("22 tables created.");
}

async function loadSeedData(sql: Sql) {
  step("Inserting lookup data...");
  const seedSql = await Deno.readTextFile(
    new URL("./seed-data.sql", import.meta.url),
  );
  await sql.unsafe(seedSql);
  info("3 languages, 4 course states, 5 users, 3 countries.");
}

// ---------------------------------------------------------------------------
// Config generation
// ---------------------------------------------------------------------------

async function generateConfig() {
  step(`Generating ${CONFIG_PATH}...`);
  const config: EvConfig = {
    version: 1,
    connection: {
      engine: "postgres",
      host: "localhost",
      port: 5433,
      database: "ev_test",
      user_env: "EV_DEMO_USER",
      password_env: "EV_DEMO_PASS",
    },
    settings: {
      changelog_table: "__ev_changelog",
      schema_snapshots_table: "__ev_schema_snapshots",
      autocommit_grouping_window_ms: 500,
      max_entity_depth: 1,
      capture_old_values: true,
      capture_new_values: true,
    },
    entities: {
      course: {
        root_table: "course",
        root_pk: "id",
        children: [
          { table: "course_upsell", fk_column: "courseId" },
          { table: "course_service", fk_column: "courseId" },
          { table: "course_users_user", fk_column: "courseId" },
          { table: "course_teacher_blacklist", fk_column: "courseId" },
          { table: "course_forum_topic", fk_column: "courseId" },
        ],
      },
      billing: {
        root_table: "billing",
        root_pk: "id",
        children: [
          { table: "billing_line", fk_column: "billingId" },
          { table: "billing_rate_incentive", fk_column: "billingId" },
          { table: "billing_bonus_course_tutor", fk_column: "invoiceId" },
        ],
      },
      class: {
        root_table: "class",
        root_pk: "id",
        children: [
          { table: "class_evaluations", fk_column: "classId" },
          { table: "class_feedback_teacher", fk_column: "classId" },
          { table: "class_issue", fk_column: "classId" },
          { table: "class_history", fk_column: "classId" },
          { table: "chat", fk_column: "classId" },
        ],
      },
    },
    ignored_tables: [
      "migrations",
      "bi_calendar",
      "tracking_event",
      "category",
      "activity_answer",
      "country",
    ],
  };
  await writeConfigFile(CONFIG_PATH, config);
  info("Config written.");
}

// ---------------------------------------------------------------------------
// ev start (programmatic)
// ---------------------------------------------------------------------------

async function evStart(connector: PostgresConnector) {
  step("Running ev start (changelog tables + triggers + DDL hooks)...");

  const config = await loadConfigFile(CONFIG_PATH);
  const entities = configToEntityConfigs(config);

  // Create changelog tables
  await connector.createChangelogTables();
  info("Changelog tables created.");

  // Schema snapshot
  const allTables = entities.flatMap((e) => [
    e.rootTable,
    ...e.children.map((c) => c.table),
  ]);
  const snapshot = await connector.getSchemaSnapshot(allTables);
  const sql = connector.getSql();
  for (const [table, columns] of Object.entries(snapshot.tables)) {
    await sql`
      INSERT INTO __ev_schema_snapshots (table_name, columns)
      VALUES (${table}, ${JSON.stringify(columns)})
    `;
  }
  info("Schema snapshot saved.");

  // Install triggers
  const trigResult = await connector.installTriggers(entities);
  info(`${trigResult.installed} triggers installed.`);

  // Install DDL hooks
  const ddlResult = await connector.installDdlHooks(allTables);
  if (ddlResult.installed) {
    info(`DDL hooks active (${ddlResult.mechanism}).`);
  } else {
    info("DDL hooks not available (superuser required). Use 'ev refresh' manually.");
  }

  // Health check
  const health = await connector.healthCheck(entities);
  info(health.ok ? "Health check: OK" : "Health check: issues found");
}

// ---------------------------------------------------------------------------
// Simulated operations
// ---------------------------------------------------------------------------

async function simulateOperations(sql: Sql) {
  step("Simulating EdTech platform lifecycle...");

  // --- Phase 1: First courses ---
  info("Phase 1: Creating courses...");

  // Course 1 — with upsell + service in a transaction
  // deno-lint-ignore no-explicit-any
  await (sql as any).begin(async (tx: any) => {
    await tx`
      INSERT INTO course (id, name, "languageId", "courseStateId", "startDate", "endDate")
      VALUES (1, 'Intro to TypeScript', 1, 2, '2026-03-15', '2026-06-15')
    `;
    await tx`
      INSERT INTO course_upsell (id, "courseId", licenses, "hourCostTraining")
      VALUES (1, 1, 5, 45.00)
    `;
    await tx`
      INSERT INTO course_service (id, "courseId", "serviceName", active)
      VALUES (1, 1, 'Live tutoring', true)
    `;
  });
  info("  Course 1 created with upsell + service (single transaction).");
  await delay(100);

  // Enroll students + teacher
  await sql`INSERT INTO course_users_user ("courseId", "userId", role) VALUES (1, 1, 'teacher')`;
  await sql`INSERT INTO course_users_user ("courseId", "userId", role) VALUES (1, 3, 'student')`;
  await sql`INSERT INTO course_users_user ("courseId", "userId", role) VALUES (1, 4, 'student')`;
  await sql`INSERT INTO course_users_user ("courseId", "userId", role) VALUES (1, 5, 'student')`;
  await delay(100);

  // Course 2
  await sql`
    INSERT INTO course (id, name, "languageId", "courseStateId", "startDate", "endDate")
    VALUES (2, 'Advanced SQL', 1, 1, '2026-04-01', '2026-07-01')
  `;
  info("  Course 2 'Advanced SQL' created.");
  await delay(100);

  // Advance sequences past explicit IDs to avoid conflicts
  await sql.unsafe(`SELECT setval('course_id_seq', 2)`);
  await sql.unsafe(`SELECT setval('course_upsell_id_seq', 1)`);
  await sql.unsafe(`SELECT setval('course_service_id_seq', 2)`);
  await sql.unsafe(`SELECT setval('class_id_seq', 3)`);
  await sql.unsafe(`SELECT setval('billing_id_seq', 1)`);

  // --- Phase 2: Course 1 lifecycle ---
  info("Phase 2: Course 1 lifecycle...");

  // Rename
  await sql`UPDATE course SET name = 'TypeScript Fundamentals' WHERE id = 1`;
  info("  Renamed: 'Intro to TypeScript' -> 'TypeScript Fundamentals'.");
  await delay(100);

  // Change end date
  await sql`UPDATE course SET "endDate" = '2026-07-15' WHERE id = 1`;
  info("  Extended end date to 2026-07-15.");
  await delay(100);

  // Add another service
  await sql`
    INSERT INTO course_service (id, "courseId", "serviceName", active)
    VALUES (2, 1, 'Recorded sessions', true)
  `;
  await delay(100);

  // Create classes
  await sql`
    INSERT INTO class (id, "courseId", "teacherId", "scheduledAt", duration, status)
    VALUES (1, 1, 1, '2026-03-20 10:00:00+00', 90, 'scheduled')
  `;
  await sql`
    INSERT INTO class (id, "courseId", "teacherId", "scheduledAt", duration, status)
    VALUES (2, 1, 1, '2026-03-27 10:00:00+00', 90, 'scheduled')
  `;
  info("  2 classes created for course 1.");
  await delay(100);

  // Class 1: evaluate students
  await sql`
    INSERT INTO class_evaluations ("classId", "studentId", score, feedback)
    VALUES (1, 3, 85, 'Great understanding of basics')
  `;
  await sql`
    INSERT INTO class_evaluations ("classId", "studentId", score, feedback)
    VALUES (1, 4, 72, 'Needs more practice with generics')
  `;
  await delay(100);

  // Chat messages
  await sql`INSERT INTO chat ("classId", "userId", message) VALUES (1, 3, 'Can we review interfaces again?')`;
  await sql`INSERT INTO chat ("classId", "userId", message) VALUES (1, 1, 'Sure, we will cover them next class.')`;
  info("  Evaluations + chat messages added.");
  await delay(100);

  // Forum topic
  await sql`INSERT INTO course_forum_topic ("courseId", title) VALUES (1, 'Tips for the final project')`;
  await delay(100);

  // --- Phase 3: Billing ---
  info("Phase 3: Billing...");

  // Create invoice with lines in a transaction
  // deno-lint-ignore no-explicit-any
  await (sql as any).begin(async (tx: any) => {
    await tx`
      INSERT INTO billing (id, "userId", amount, status)
      VALUES (1, 3, 350.00, 'pending')
    `;
    await tx`
      INSERT INTO billing_line ("billingId", description, amount)
      VALUES (1, 'TypeScript Fundamentals - enrollment', 250.00)
    `;
    await tx`
      INSERT INTO billing_line ("billingId", description, amount)
      VALUES (1, 'Live tutoring add-on', 100.00)
    `;
    await tx`
      INSERT INTO billing_rate_incentive ("billingId", rate, "incentiveType")
      VALUES (1, 10.00, 'early_bird')
    `;
  });
  info("  Invoice #1 created with 2 lines + incentive (single transaction).");
  await delay(100);

  // Pay the invoice
  await sql`UPDATE billing SET status = 'paid' WHERE id = 1`;
  info("  Invoice #1 marked as paid.");
  await delay(100);

  // --- Phase 4: More activity ---
  info("Phase 4: More activity...");

  // Course 2 updates
  await sql`UPDATE course SET "courseStateId" = 2 WHERE id = 2`;
  await delay(100);
  await sql`UPDATE course SET name = 'Advanced SQL Mastery' WHERE id = 2`;
  await delay(100);
  await sql`INSERT INTO course_service (id, "courseId", "serviceName", active) VALUES (3, 2, 'Certificate of completion', true)`;
  await delay(100);

  // Enroll teacher + student to course 2
  await sql`INSERT INTO course_users_user ("courseId", "userId", role) VALUES (2, 2, 'teacher')`;
  await sql`INSERT INTO course_users_user ("courseId", "userId", role) VALUES (2, 4, 'student')`;
  await delay(100);

  // Class for course 2
  await sql`
    INSERT INTO class (id, "courseId", "teacherId", "scheduledAt", duration, status)
    VALUES (3, 2, 2, '2026-04-05 14:00:00+00', 120, 'scheduled')
  `;
  info("  Course 2 updated and class created.");
  await delay(100);

  // Class issue
  await sql`
    INSERT INTO class_issue ("classId", "issueType", description, resolved)
    VALUES (1, 'technical', 'Student reported audio issues during session', false)
  `;
  await delay(100);

  // Resolve the issue
  await sql`UPDATE class_issue SET resolved = true WHERE id = 1`;
  info("  Class issue reported and resolved.");
  await delay(100);

  // Teacher feedback
  await sql`
    INSERT INTO class_feedback_teacher ("classId", rating, comment)
    VALUES (1, 4, 'Good session overall, minor technical hiccups')
  `;
  await delay(100);

  // Delete a service from course 1
  await sql`DELETE FROM course_service WHERE id = 2 AND "courseId" = 1`;
  info("  'Recorded sessions' service removed from course 1.");
  await delay(100);

  // Class status update
  await sql`UPDATE class SET status = 'completed' WHERE id = 1`;
  await sql`INSERT INTO class_history ("classId", status) VALUES (1, 'completed')`;
  info("  Class 1 marked as completed.");
  await delay(100);

  // --- Phase 5: Schema drift ---
  info("Phase 5: Schema drift...");
  await sql.unsafe(`ALTER TABLE course ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20)`);
  info("  ALTER TABLE course ADD COLUMN difficulty VARCHAR(20).");
  await delay(100);

  // Use the new column
  await sql`UPDATE course SET difficulty = 'beginner' WHERE id = 1`;
  await sql`UPDATE course SET difficulty = 'advanced' WHERE id = 2`;
  info("  Difficulty set on both courses.");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

async function printSummary(sql: Sql) {
  const [{ count: changelogCount }] = await sql`SELECT count(*) FROM __ev_changelog`;
  const [{ count: triggerCount }] = await sql`
    SELECT count(*) FROM pg_trigger WHERE tgname LIKE '__ev_%'
  `;

  console.log(`
  ===================================================
   ev playground ready!
  ===================================================

  3 entities  |  ${triggerCount} triggers  |  ~${changelogCount} changelog entries

  Try these commands:

    # View course history
    EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \\
      deno task dev log --entity course --id 1 -c ${CONFIG_PATH}

    # View billing history
    EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \\
      deno task dev log --entity billing --id 1 -c ${CONFIG_PATH}

    # View class history
    EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \\
      deno task dev log --entity class --id 1 -c ${CONFIG_PATH}

    # JSON output
    EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \\
      deno task dev log --entity course --id 1 -c ${CONFIG_PATH} --format json

    # Verbose (full row values)
    EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \\
      deno task dev log --entity course --id 1 -c ${CONFIG_PATH} --verbose

    # Status check
    EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass \\
      deno task dev status -c ${CONFIG_PATH}

  Reset:   deno task demo:reset
  Re-run:  deno task demo
  Stop:    EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass deno task dev stop -c ${CONFIG_PATH}
  Cleanup: EV_DEMO_USER=ev_user EV_DEMO_PASS=ev_pass deno task dev teardown --confirm -c ${CONFIG_PATH}
  ===================================================
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n  ev playground");
  console.log("  =============\n");

  const connector = new PostgresConnector();
  try {
    step("Connecting to PostgreSQL...");
    await connector.connect(DB_CONFIG);
    info(`${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);

    const sql = connector.getSql();

    // Always clean first (idempotent)
    await cleanAll(sql);

    if (RESET_FLAG) {
      info("Reset complete. Database is clean.");
      await connector.disconnect();
      return;
    }

    await loadSchema(sql);
    await loadSeedData(sql);
    await generateConfig();
    await evStart(connector);
    await simulateOperations(sql);
    await printSummary(sql);

    await connector.disconnect();
  } catch (err) {
    console.error(`\n  Error: ${err}`);
    try { await connector.disconnect(); } catch { /* ignore */ }
    Deno.exit(1);
  }
}

await main();
