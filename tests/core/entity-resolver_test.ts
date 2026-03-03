import { assertEquals, assert } from "@std/assert";
import { buildFkGraph, classifyTables } from "../../src/core/schema-analyzer.ts";
import { resolveEntities, applyManualOverrides } from "../../src/core/entity-resolver.ts";
import type { TableInfo, ForeignKeyInfo } from "../../src/connector/interface.ts";

function mockTables(): TableInfo[] {
  return [
    { name: "user", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "language", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course_state", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course_upsell", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "course_service", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "billing", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "billing_line", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "class", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "class_evaluations", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "chat", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "activity_answer", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "migrations", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "no_pk_table", schema: "public", columns: [{ name: "data", dataType: "text", nullable: true, isPrimaryKey: false }] },
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
    { fromTable: "class_evaluations", fromColumn: "classId", toTable: "class", toColumn: "id", constraintName: "fk_9" },
    { fromTable: "chat", fromColumn: "classId", toTable: "class", toColumn: "id", constraintName: "fk_10" },
    // Conflict: activity_answer belongs to both course and class
    { fromTable: "activity_answer", fromColumn: "courseId", toTable: "course", toColumn: "id", constraintName: "fk_11" },
    { fromTable: "activity_answer", fromColumn: "classId", toTable: "class", toColumn: "id", constraintName: "fk_12" },
  ];
}

Deno.test("entity-resolver - resolveEntities produces correct entities", () => {
  const tables = mockTables();
  const fks = mockFks();
  const graph = buildFkGraph(tables, fks);
  const classification = classifyTables(graph);
  const resolution = resolveEntities(graph, classification, tables);

  const entityNames = resolution.entities.map((e) => e.name).sort();
  assert(entityNames.includes("course"), "Should include course entity");
  assert(entityNames.includes("class"), "Should include class entity");
  assert(entityNames.includes("billing"), "Should include billing entity");
});

Deno.test("entity-resolver - detects conflicts for multi-parent tables", () => {
  const tables = mockTables();
  const fks = mockFks();
  const graph = buildFkGraph(tables, fks);
  const classification = classifyTables(graph);
  const resolution = resolveEntities(graph, classification, tables);

  const conflict = resolution.conflicts.find((c) => c.table === "activity_answer");
  assert(conflict, "activity_answer should be a conflict");
  assert(conflict.claimedBy.includes("course"));
  assert(conflict.claimedBy.includes("class"));
});

Deno.test("entity-resolver - applyManualOverrides reassigns table", () => {
  const tables = mockTables();
  const fks = mockFks();
  const graph = buildFkGraph(tables, fks);
  const classification = classifyTables(graph);
  const resolution = resolveEntities(graph, classification, tables);

  const updated = applyManualOverrides(resolution, {
    reassign: [{ table: "activity_answer", toEntity: "course" }],
  });

  const courseEntity = updated.find((e) => e.name === "course");
  assert(courseEntity);
  const hasActivityAnswer = courseEntity.children.some(
    (c) => c.table === "activity_answer",
  );
  assert(hasActivityAnswer, "activity_answer should be child of course after reassignment");

  // class should NOT have activity_answer anymore
  const classEntity = updated.find((e) => e.name === "class");
  assert(classEntity);
  const classHasIt = classEntity.children.some((c) => c.table === "activity_answer");
  assertEquals(classHasIt, false, "class should not have activity_answer after reassignment");
});

Deno.test("entity-resolver - table without PK generates warning", () => {
  const tables = mockTables();
  const fks = [
    ...mockFks(),
    { fromTable: "no_pk_table", fromColumn: "some_col", toTable: "course", toColumn: "id", constraintName: "fk_nopk" },
  ];
  const graph = buildFkGraph(tables, fks);
  const classification = classifyTables(graph);
  const resolution = resolveEntities(graph, classification, tables);

  const hasWarning = resolution.warnings.some((w) => w.includes("no_pk_table"));
  assert(hasWarning, "Should have warning about table without PK");
});

Deno.test("entity-resolver - deduplicates child with multiple FKs to same root", () => {
  // user needs an outgoing FK so it's not classified as a lookup table
  const tables: TableInfo[] = [
    { name: "user", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "country", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "class_history", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
  ];
  const fks: ForeignKeyInfo[] = [
    { fromTable: "user", fromColumn: "countryId", toTable: "country", toColumn: "id", constraintName: "fk_country" },
    { fromTable: "class_history", fromColumn: "createdByUserId", toTable: "user", toColumn: "id", constraintName: "fk_created" },
    { fromTable: "class_history", fromColumn: "modifiedByUserId", toTable: "user", toColumn: "id", constraintName: "fk_modified" },
  ];

  const graph = buildFkGraph(tables, fks);
  const classification = classifyTables(graph);
  const resolution = resolveEntities(graph, classification, tables);

  const userEntity = resolution.entities.find((e) => e.name === "user");
  assert(userEntity, "user entity should exist");
  // class_history should appear only once as a child, not twice
  const classHistoryChildren = userEntity.children.filter((c) => c.table === "class_history");
  assertEquals(classHistoryChildren.length, 1, "class_history should appear only once as child of user");

  // No conflicts should be reported (same root, not a real conflict)
  assertEquals(resolution.conflicts.length, 0, "Should not have conflicts for same-root deduplication");
});

Deno.test("entity-resolver - entity root with children is valid", () => {
  const tables: TableInfo[] = [
    { name: "parent", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "child_a", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "child_b", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
    { name: "lookup", schema: "public", columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] },
  ];
  const fks: ForeignKeyInfo[] = [
    { fromTable: "child_a", fromColumn: "parentId", toTable: "parent", toColumn: "id", constraintName: "fk_1" },
    { fromTable: "child_b", fromColumn: "parentId", toTable: "parent", toColumn: "id", constraintName: "fk_2" },
    { fromTable: "parent", fromColumn: "lookupId", toTable: "lookup", toColumn: "id", constraintName: "fk_3" },
  ];

  const graph = buildFkGraph(tables, fks);
  const classification = classifyTables(graph);
  const resolution = resolveEntities(graph, classification, tables);

  const parentEntity = resolution.entities.find((e) => e.name === "parent");
  assert(parentEntity, "parent entity should exist");
  assertEquals(parentEntity.children.length, 2);
});
