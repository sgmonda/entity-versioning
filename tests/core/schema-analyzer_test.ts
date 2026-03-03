import { assertEquals, assert } from "@std/assert";
import { buildFkGraph, classifyTables } from "../../src/core/schema-analyzer.ts";
import type { TableInfo, ForeignKeyInfo } from "../../src/connector/interface.ts";

// Mock edtech data
function mockTables(): TableInfo[] {
  return [
    { name: "user", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "language", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "country", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course_state", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course_upsell", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course_service", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "billing", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "billing_line", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "class", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "class_evaluations", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "chat", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "migrations", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "bi_calendar", schema: "public", columns: [{ name: "date", dataType: "date", nullable: false, isPrimaryKey: true }] },
    { name: "category", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
  ];
}

function mockFks(): ForeignKeyInfo[] {
  return [
    { fromTable: "course", fromColumn: "languageId", toTable: "language", toColumn: "id", constraintName: "fk_1" },
    { fromTable: "course", fromColumn: "courseStateId", toTable: "course_state", toColumn: "id", constraintName: "fk_2" },
    { fromTable: "course_upsell", fromColumn: "courseId", toTable: "course", toColumn: "id", constraintName: "fk_3" },
    { fromTable: "course_service", fromColumn: "courseId", toTable: "course", toColumn: "id", constraintName: "fk_4" },
    { fromTable: "billing_line", fromColumn: "billingId", toTable: "billing", toColumn: "id", constraintName: "fk_5" },
    { fromTable: "billing", fromColumn: "userId", toTable: "user", toColumn: "id", constraintName: "fk_6" },
    { fromTable: "class", fromColumn: "courseId", toTable: "course", toColumn: "id", constraintName: "fk_7" },
    { fromTable: "class", fromColumn: "teacherId", toTable: "user", toColumn: "id", constraintName: "fk_8" },
    { fromTable: "class_evaluations", fromColumn: "classId", toTable: "class", toColumn: "id", constraintName: "fk_9" },
    { fromTable: "chat", fromColumn: "classId", toTable: "class", toColumn: "id", constraintName: "fk_10" },
    { fromTable: "category", fromColumn: "parentId", toTable: "category", toColumn: "id", constraintName: "fk_self" },
  ];
}

Deno.test("schema-analyzer - buildFkGraph builds correct adjacency", () => {
  const graph = buildFkGraph(mockTables(), mockFks());

  // course_upsell -> course (outgoing)
  assert(graph.outgoing.get("course_upsell")?.has("course"));
  // course has incoming from course_upsell
  assert(graph.incoming.get("course")?.has("course_upsell"));
});

Deno.test("schema-analyzer - classifyTables identifies lookups", () => {
  const graph = buildFkGraph(mockTables(), mockFks());
  const classification = classifyTables(graph);

  // user, language, country, course_state are lookups (no outgoing FKs, have incoming)
  assert(classification.lookup.has("user"), "user should be lookup");
  assert(classification.lookup.has("language"), "language should be lookup");
  assert(classification.lookup.has("course_state"), "course_state should be lookup");
});

Deno.test("schema-analyzer - classifyTables identifies candidate roots", () => {
  const graph = buildFkGraph(mockTables(), mockFks());
  const classification = classifyTables(graph);

  assert(classification.candidateRoots.has("course"), "course should be candidate root");
  assert(classification.candidateRoots.has("billing"), "billing should be candidate root");
  assert(classification.candidateRoots.has("class"), "class should be candidate root");
});

Deno.test("schema-analyzer - classifyTables identifies isolated tables", () => {
  const graph = buildFkGraph(mockTables(), mockFks());
  const classification = classifyTables(graph);

  assert(classification.isolated.has("migrations"), "migrations should be isolated");
  assert(classification.isolated.has("bi_calendar"), "bi_calendar should be isolated");
});

Deno.test("schema-analyzer - empty graph returns empty classification", () => {
  const graph = buildFkGraph([], []);
  const classification = classifyTables(graph);

  assertEquals(classification.lookup.size, 0);
  assertEquals(classification.candidateRoots.size, 0);
  assertEquals(classification.isolated.size, 0);
});

Deno.test("schema-analyzer - self-referential FK handled correctly", () => {
  const graph = buildFkGraph(mockTables(), mockFks());

  // Self-referential FKs should be ignored in graph building
  assert(
    !graph.outgoing.get("category")?.has("category"),
    "Self-referential FK should be excluded from outgoing",
  );
});
