import { assertEquals, assertRejects } from "@std/assert";
import { MySQLConnector } from "../../../src/connectors/mysql/index.ts";
import { MYSQL_TEST_CONFIG } from "../../test-helpers-mysql.ts";

Deno.test("MySQL connection - connects with valid credentials", async () => {
  const connector = new MySQLConnector();
  await connector.connect(MYSQL_TEST_CONFIG);
  const tables = await connector.getTables();
  assertEquals(Array.isArray(tables), true);
  await connector.disconnect();
});

Deno.test("MySQL connection - fails with invalid credentials", async () => {
  const connector = new MySQLConnector();
  await assertRejects(
    () =>
      connector.connect({
        ...MYSQL_TEST_CONFIG,
        password: "wrong_password",
      }),
    Error,
  );
});

Deno.test("MySQL connection - disconnect is idempotent", async () => {
  const connector = new MySQLConnector();
  await connector.connect(MYSQL_TEST_CONFIG);
  await connector.disconnect();
  await connector.disconnect(); // second call should not throw
});
