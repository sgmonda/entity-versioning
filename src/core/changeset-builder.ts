import type { ChangelogEntry, Changeset } from "../connector/interface.ts";

export function buildChangesets(
  entries: ChangelogEntry[],
  groupingWindowMs: number = 500,
): Changeset[] {
  if (entries.length === 0) return [];

  // Sort by createdAt ascending
  const sorted = [...entries].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  // Group by transaction_id first
  const txGroups = new Map<string, ChangelogEntry[]>();
  for (const entry of sorted) {
    const key = entry.transactionId;
    if (!txGroups.has(key)) txGroups.set(key, []);
    txGroups.get(key)!.push(entry);
  }

  // For groups with only 1 entry (potential autocommit), try time-window grouping
  const explicitTxGroups: ChangelogEntry[][] = [];
  const autocommitEntries: ChangelogEntry[] = [];

  for (const [_txId, group] of txGroups) {
    if (group.length > 1) {
      // Multiple entries with same txid -> explicit transaction
      explicitTxGroups.push(group);
    } else {
      autocommitEntries.push(group[0]);
    }
  }

  // Group autocommit entries by time window
  const autocommitGroups: ChangelogEntry[][] = [];
  if (autocommitEntries.length > 0) {
    autocommitEntries.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    let currentGroup: ChangelogEntry[] = [autocommitEntries[0]];
    for (let i = 1; i < autocommitEntries.length; i++) {
      const prev = currentGroup[currentGroup.length - 1];
      const curr = autocommitEntries[i];
      const diff = curr.createdAt.getTime() - prev.createdAt.getTime();

      if (diff <= groupingWindowMs) {
        currentGroup.push(curr);
      } else {
        autocommitGroups.push(currentGroup);
        currentGroup = [curr];
      }
    }
    autocommitGroups.push(currentGroup);
  }

  // Combine all groups and sort by timestamp
  const allGroups: { entries: ChangelogEntry[]; isAutocommit: boolean }[] = [
    ...explicitTxGroups.map((g) => ({ entries: g, isAutocommit: false })),
    ...autocommitGroups.map((g) => ({
      entries: g,
      isAutocommit: g.length > 1 || autocommitEntries.includes(g[0]),
    })),
  ];

  allGroups.sort(
    (a, b) => a.entries[0].createdAt.getTime() - b.entries[0].createdAt.getTime(),
  );

  // Build changesets with version numbers
  return allGroups.map((group, idx) => ({
    version: idx + 1,
    transactionId: group.entries[0].transactionId,
    timestamp: group.entries[0].createdAt,
    operations: group.entries,
    isAutocommitGrouped: group.isAutocommit && group.entries.length > 1,
  }));
}
