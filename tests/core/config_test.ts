import { assertEquals, assert } from "@std/assert";
import { loadConfig, writeConfig, validateConfig, resolveCredentials } from "../../src/config.ts";
import type { EvConfig } from "../../src/config.ts";

const VALID_YAML = `
version: 1
connection:
  engine: postgres
  host: localhost
  port: 5432
  database: myapp
  user_env: EV_DB_USER
  password_env: EV_DB_PASSWORD
settings:
  autocommit_grouping_window_ms: 500
entities:
  course:
    root_table: course
    root_pk: id
    children:
      - table: course_upsell
        fk_column: courseId
ignored_tables:
  - migrations
`;

Deno.test("config - loadConfig parses valid YAML", () => {
  const config = loadConfig(VALID_YAML);
  assertEquals(config.version, 1);
  assertEquals(config.connection.engine, "postgres");
  assertEquals(config.connection.host, "localhost");
  assertEquals(config.connection.database, "myapp");
  assert(config.entities.course);
  assertEquals(config.entities.course.root_table, "course");
});

Deno.test("config - validateConfig rejects missing required fields", () => {
  const config = loadConfig(`
version: 1
connection:
  engine: postgres
  host: localhost
  port: 5432
  database: myapp
  user_env: EV_DB_USER
  password_env: EV_DB_PASSWORD
entities: {}
`);
  const errors = validateConfig(config);
  assert(errors.length > 0, "Should have validation errors");
  assert(errors.some((e) => e.includes("entity")));
});

Deno.test("config - validateConfig rejects invalid engine", () => {
  const config = loadConfig(`
version: 1
connection:
  engine: sqlite
  host: localhost
  port: 3306
  database: myapp
  user_env: EV_DB_USER
  password_env: EV_DB_PASSWORD
entities:
  test:
    root_table: test
    root_pk: id
    children: []
`);
  const errors = validateConfig(config);
  assert(errors.some((e) => e.includes("engine")));
});

Deno.test("config - validateConfig rejects duplicate tables", () => {
  const config = loadConfig(`
version: 1
connection:
  engine: postgres
  host: localhost
  port: 5432
  database: myapp
  user_env: EV_DB_USER
  password_env: EV_DB_PASSWORD
entities:
  entity_a:
    root_table: a
    root_pk: id
    children:
      - table: shared_table
        fk_column: aId
  entity_b:
    root_table: b
    root_pk: id
    children:
      - table: shared_table
        fk_column: bId
`);
  const errors = validateConfig(config);
  assert(errors.some((e) => e.includes("shared_table")));
});

Deno.test("config - writeConfig produces valid YAML", () => {
  const config = loadConfig(VALID_YAML);
  const yaml = writeConfig(config);
  assert(yaml.includes("version:"), "YAML should contain version");
  assert(yaml.includes("postgres"), "YAML should contain engine");
});

Deno.test("config - round-trip: load -> write -> load", () => {
  const config1 = loadConfig(VALID_YAML);
  const yaml = writeConfig(config1);
  const config2 = loadConfig(yaml);

  assertEquals(config1.version, config2.version);
  assertEquals(config1.connection.engine, config2.connection.engine);
  assertEquals(config1.connection.host, config2.connection.host);
  assertEquals(config1.connection.database, config2.connection.database);
  assertEquals(config1.entities.course.root_table, config2.entities.course.root_table);
});

Deno.test("config - resolveCredentials reads env vars", () => {
  const config = loadConfig(VALID_YAML);
  Deno.env.set("EV_DB_USER", "testuser");
  Deno.env.set("EV_DB_PASSWORD", "testpass");
  try {
    const creds = resolveCredentials(config);
    assertEquals(creds.user, "testuser");
    assertEquals(creds.password, "testpass");
  } finally {
    Deno.env.delete("EV_DB_USER");
    Deno.env.delete("EV_DB_PASSWORD");
  }
});

Deno.test("config - resolveCredentials throws on missing env var", () => {
  const config = loadConfig(VALID_YAML);
  Deno.env.delete("EV_DB_USER");
  Deno.env.delete("EV_DB_PASSWORD");

  let threw = false;
  try {
    resolveCredentials(config);
  } catch (e) {
    threw = true;
    assert(String(e).includes("EV_DB_USER"));
  }
  assert(threw, "Should throw on missing env var");
});
