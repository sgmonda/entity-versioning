import { assertEquals } from "@std/assert";
import { buildChangesets } from "../../src/core/changeset-builder.ts";
import type { ChangelogEntry } from "../../src/connector/interface.ts";

function makeEntry(
  overrides: Partial<ChangelogEntry> & { id: bigint; transactionId: string; createdAt: Date },
): ChangelogEntry {
  return {
    entityType: "course",
    entityId: "42",
    tableName: "course",
    rowId: "42",
    operation: "UPDATE",
    oldValues: null,
    newValues: null,
    ...overrides,
  };
}

Deno.test("changeset-builder - entries with same txid grouped into 1 changeset", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const entries: ChangelogEntry[] = [
    makeEntry({ id: 1n, transactionId: "tx1", createdAt: now }),
    makeEntry({ id: 2n, transactionId: "tx1", createdAt: new Date(now.getTime() + 10) }),
    makeEntry({ id: 3n, transactionId: "tx1", createdAt: new Date(now.getTime() + 20) }),
    makeEntry({ id: 4n, transactionId: "tx1", createdAt: new Date(now.getTime() + 30) }),
    makeEntry({ id: 5n, transactionId: "tx1", createdAt: new Date(now.getTime() + 40) }),
  ];

  const changesets = buildChangesets(entries);
  assertEquals(changesets.length, 1);
  assertEquals(changesets[0].operations.length, 5);
  assertEquals(changesets[0].version, 1);
  assertEquals(changesets[0].transactionId, "tx1");
});

Deno.test("changeset-builder - autocommit entries within window grouped", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const entries: ChangelogEntry[] = [
    makeEntry({ id: 1n, transactionId: "auto1", createdAt: now }),
    makeEntry({ id: 2n, transactionId: "auto2", createdAt: new Date(now.getTime() + 100) }),
    makeEntry({ id: 3n, transactionId: "auto3", createdAt: new Date(now.getTime() + 200) }),
  ];

  const changesets = buildChangesets(entries, 500);
  assertEquals(changesets.length, 1);
  assertEquals(changesets[0].isAutocommitGrouped, true);
});

Deno.test("changeset-builder - autocommit entries outside window separate", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const entries: ChangelogEntry[] = [
    makeEntry({ id: 1n, transactionId: "auto1", createdAt: now }),
    makeEntry({ id: 2n, transactionId: "auto2", createdAt: new Date(now.getTime() + 1000) }),
    makeEntry({ id: 3n, transactionId: "auto3", createdAt: new Date(now.getTime() + 2000) }),
  ];

  const changesets = buildChangesets(entries, 500);
  assertEquals(changesets.length, 3);
});

Deno.test("changeset-builder - mix transactional + autocommit", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const entries: ChangelogEntry[] = [
    // Transaction group
    makeEntry({ id: 1n, transactionId: "tx1", createdAt: now }),
    makeEntry({ id: 2n, transactionId: "tx1", createdAt: new Date(now.getTime() + 10) }),
    // Autocommit
    makeEntry({ id: 3n, transactionId: "auto1", createdAt: new Date(now.getTime() + 5000) }),
  ];

  const changesets = buildChangesets(entries, 500);
  assertEquals(changesets.length, 2);
});

Deno.test("changeset-builder - version numbering: v1 oldest, vN newest", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const entries: ChangelogEntry[] = [
    makeEntry({ id: 1n, transactionId: "tx1", createdAt: now }),
    makeEntry({ id: 2n, transactionId: "tx1", createdAt: new Date(now.getTime() + 10) }),
    makeEntry({ id: 3n, transactionId: "tx2", createdAt: new Date(now.getTime() + 5000) }),
    makeEntry({ id: 4n, transactionId: "tx2", createdAt: new Date(now.getTime() + 5010) }),
  ];

  const changesets = buildChangesets(entries);
  assertEquals(changesets[0].version, 1);
  assertEquals(changesets[1].version, 2);
});

Deno.test("changeset-builder - single entry produces 1 changeset", () => {
  const entries: ChangelogEntry[] = [
    makeEntry({ id: 1n, transactionId: "tx1", createdAt: new Date() }),
  ];
  const changesets = buildChangesets(entries);
  assertEquals(changesets.length, 1);
});

Deno.test("changeset-builder - empty array produces empty array", () => {
  const changesets = buildChangesets([]);
  assertEquals(changesets.length, 0);
});
