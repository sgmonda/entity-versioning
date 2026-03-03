import { assertEquals, assertRejects } from "@std/assert";
import { PostgresConnector } from "../../../src/connectors/postgres/index.ts";
import { TEST_CONFIG } from "../../test-helpers.ts";

Deno.test("PostgreSQL connection - connects with valid credentials", async () => {
  const connector = new PostgresConnector();
  await connector.connect(TEST_CONFIG);
  // Verify connection works by getting tables
  const tables = await connector.getTables();
  assertEquals(Array.isArray(tables), true);
  await connector.disconnect();
});

Deno.test("PostgreSQL connection - fails with invalid credentials", async () => {
  const connector = new PostgresConnector();
  await assertRejects(
    () =>
      connector.connect({
        ...TEST_CONFIG,
        password: "wrong_password",
      }),
    Error,
  );
});

Deno.test("PostgreSQL connection - disconnect is idempotent", async () => {
  const connector = new PostgresConnector();
  await connector.connect(TEST_CONFIG);
  await connector.disconnect();
  await connector.disconnect(); // second call should not throw
});
