import type { EntityConfig, TableInfo, ForeignKeyInfo } from "../connector/interface.ts";
import type { FkGraph, TableClassification } from "./schema-analyzer.ts";

export interface EntityResolution {
  entities: EntityCandidate[];
  conflicts: ConflictEntry[];
  unassigned: string[];
  warnings: string[];
}

export interface EntityCandidate {
  name: string;
  rootTable: string;
  rootPk: string;
  children: { table: string; fkColumn: string }[];
}

export interface ConflictEntry {
  table: string;
  claimedBy: string[];
}

export function resolveEntities(
  graph: FkGraph,
  classification: TableClassification,
  tables: TableInfo[],
): EntityResolution {
  const entities: EntityCandidate[] = [];
  const childOwnership = new Map<string, string[]>();
  const warnings: string[] = [];
  const tableMap = new Map(tables.map((t) => [t.name, t]));

  // For each candidate root, find direct children
  for (const root of classification.candidateRoots) {
    const tableInfo = tableMap.get(root);
    if (!tableInfo) continue;

    // Find PK
    const pkCol = tableInfo.columns.find((c) => c.isPrimaryKey);
    if (!pkCol) {
      warnings.push(`Table '${root}' has no primary key, skipping as entity root`);
      continue;
    }

    // Find children: non-lookup tables with direct FK to this root
    const children: { table: string; fkColumn: string }[] = [];
    for (const fk of graph.edges) {
      if (fk.toTable === root && fk.fromTable !== root) {
        if (classification.lookup.has(fk.fromTable)) continue;
        // Check child has PK
        const childInfo = tableMap.get(fk.fromTable);
        if (childInfo && !childInfo.columns.some((c) => c.isPrimaryKey)) {
          warnings.push(`Table '${fk.fromTable}' has no primary key, skipping as child of '${root}'`);
          continue;
        }
        children.push({ table: fk.fromTable, fkColumn: fk.fromColumn });

        // Track ownership for conflict detection
        if (!childOwnership.has(fk.fromTable)) {
          childOwnership.set(fk.fromTable, []);
        }
        childOwnership.get(fk.fromTable)!.push(root);
      }
    }

    entities.push({
      name: root,
      rootTable: root,
      rootPk: pkCol.name,
      children,
    });
  }

  // Sort by number of children (descending)
  entities.sort((a, b) => b.children.length - a.children.length);

  // Detect conflicts
  const conflicts: ConflictEntry[] = [];
  for (const [table, owners] of childOwnership) {
    if (owners.length > 1) {
      conflicts.push({ table, claimedBy: owners });
    }
  }

  // Find unassigned tables
  const assigned = new Set<string>();
  for (const entity of entities) {
    assigned.add(entity.rootTable);
    for (const child of entity.children) {
      assigned.add(child.table);
    }
  }
  const unassigned: string[] = [];
  for (const table of classification.all) {
    if (!assigned.has(table) && !classification.lookup.has(table) && !classification.isolated.has(table)) {
      unassigned.push(table);
    }
  }

  return { entities, conflicts, unassigned, warnings };
}

export function applyManualOverrides(
  resolution: EntityResolution,
  overrides: {
    reassign?: { table: string; toEntity: string }[];
    exclude?: string[];
  },
): EntityCandidate[] {
  const entities = structuredClone(resolution.entities);

  // Apply exclusions
  if (overrides.exclude) {
    for (const entity of entities) {
      entity.children = entity.children.filter(
        (c) => !overrides.exclude!.includes(c.table),
      );
    }
  }

  // Apply reassignments
  if (overrides.reassign) {
    for (const { table, toEntity } of overrides.reassign) {
      // Remove from current owner(s)
      for (const entity of entities) {
        entity.children = entity.children.filter((c) => c.table !== table);
      }
      // Find the FK to the target entity
      const targetEntity = entities.find((e) => e.name === toEntity);
      if (targetEntity) {
        const fk = resolution.entities
          .flatMap((e) => e.children)
          .find((c) => c.table === table);
        if (fk) {
          targetEntity.children.push(fk);
        }
      }
    }
  }

  return entities;
}

export function entityCandidatesToConfig(candidates: EntityCandidate[]): EntityConfig[] {
  return candidates.map((c) => ({
    name: c.name,
    rootTable: c.rootTable,
    rootPk: c.rootPk,
    children: c.children.map((ch) => ({
      table: ch.table,
      fkColumn: ch.fkColumn,
    })),
  }));
}
