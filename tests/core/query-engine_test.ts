import { assertEquals, assert } from "@std/assert";
import { formatChangeset } from "../../src/core/query-engine.ts";
import type { Changeset, ChangelogEntry } from "../../src/connector/interface.ts";

function makeChangeset(overrides: Partial<Changeset> = {}): Changeset {
  return {
    version: 1,
    transactionId: "8a3f2b1c4d5e6f70",
    timestamp: new Date("2026-02-15T14:23:07Z"),
    isAutocommitGrouped: false,
    operations: [
      {
        id: 1n,
        entityType: "course",
        entityId: "42",
        tableName: "course",
        rowId: "42",
        operation: "UPDATE",
        oldValues: { id: 42, endDate: "2026-05-01", name: "Test" },
        newValues: { id: 42, endDate: "2026-06-01", name: "Test" },
        transactionId: "8a3f2b1c4d5e6f70",
        createdAt: new Date("2026-02-15T14:23:07Z"),
      },
    ],
    ...overrides,
  };
}

Deno.test("query-engine - formatChangeset text format", () => {
  const cs = makeChangeset();
  const output = formatChangeset(cs, "text");

  assert(output.includes("changeset v1"), "Should include version");
  assert(output.includes("[tx: 8a3f2b1c]"), "Should include tx short id");
  assert(output.includes("UPDATE"), "Should include operation");
  assert(output.includes("endDate"), "Should include changed field");
  assert(output.includes("2026-05-01"), "Should include old value");
  assert(output.includes("2026-06-01"), "Should include new value");
});

Deno.test("query-engine - formatChangeset JSON is valid", () => {
  const cs = makeChangeset();
  const json = formatChangeset(cs, "json");
  const parsed = JSON.parse(json);
  assertEquals(parsed.version, 1);
  assert(parsed.operations.length > 0);
});

Deno.test("query-engine - UPDATE only shows changed fields", () => {
  const cs = makeChangeset();
  const output = formatChangeset(cs, "text");

  // 'name' did not change, should not appear in UPDATE line
  assert(!output.includes("name: Test"), "Unchanged field should not appear");
  assert(output.includes("endDate"), "Changed field should appear");
});

Deno.test("query-engine - INSERT shows all new fields", () => {
  const cs = makeChangeset({
    operations: [
      {
        id: 1n,
        entityType: "course",
        entityId: "42",
        tableName: "course_upsell",
        rowId: "108",
        operation: "INSERT",
        oldValues: null,
        newValues: { id: 108, licenses: 10, hourCostTraining: 45.50 },
        transactionId: "8a3f2b1c",
        createdAt: new Date("2026-02-15T14:23:07Z"),
      },
    ],
  });
  const output = formatChangeset(cs, "text");
  assert(output.includes("INSERT"), "Should include INSERT");
  assert(output.includes("licenses"), "Should include new value field");
});

Deno.test("query-engine - DELETE shows DELETE label", () => {
  const cs = makeChangeset({
    operations: [
      {
        id: 1n,
        entityType: "course",
        entityId: "42",
        tableName: "course",
        rowId: "42",
        operation: "DELETE",
        oldValues: { id: 42, name: "Test" },
        newValues: null,
        transactionId: "8a3f2b1c",
        createdAt: new Date("2026-02-15T14:23:07Z"),
      },
    ],
  });
  const output = formatChangeset(cs, "text");
  assert(output.includes("DELETE"), "Should include DELETE");
});

Deno.test("query-engine - schema change shows columns added/removed", () => {
  const cs = makeChangeset({
    operations: [
      {
        id: 1n,
        entityType: "__schema",
        entityId: "*",
        tableName: "course_upsell",
        rowId: "*",
        operation: "SCHEMA_CHANGE",
        oldValues: [
          { name: "id", dataType: "integer", nullable: false },
          { name: "courseId", dataType: "integer", nullable: false },
        ] as unknown as Record<string, unknown>,
        newValues: [
          { name: "id", dataType: "integer", nullable: false },
          { name: "courseId", dataType: "integer", nullable: false },
          { name: "targetWalletId", dataType: "bigint", nullable: true },
        ] as unknown as Record<string, unknown>,
        transactionId: "schema_tx",
        createdAt: new Date("2026-02-10T11:00:00Z"),
      },
    ],
  });
  const output = formatChangeset(cs, "text");
  assert(output.includes("schema change"), "Should indicate schema change");
  assert(output.includes("targetWalletId"), "Should show added column");
});

Deno.test("query-engine - verbose mode shows full values on DELETE", () => {
  const cs = makeChangeset({
    operations: [
      {
        id: 1n,
        entityType: "course",
        entityId: "42",
        tableName: "course",
        rowId: "42",
        operation: "DELETE",
        oldValues: { id: 42, name: "Test Course", endDate: "2026-05-01" },
        newValues: null,
        transactionId: "del_tx",
        createdAt: new Date("2026-02-15T14:23:07Z"),
      },
    ],
  });
  const verbose = formatChangeset(cs, "text", true);
  assert(verbose.includes("name=Test Course"), "Verbose should show all old values");
});
