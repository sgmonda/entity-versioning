import type { TableInfo, ForeignKeyInfo } from "../connector/interface.ts";

export interface FkGraph {
  // adjacency: child -> Set of parents (tables it has FKs to)
  outgoing: Map<string, Set<string>>;
  // adjacency: parent -> Set of children (tables with FKs to it)
  incoming: Map<string, Set<string>>;
  // Details of each FK relationship
  edges: ForeignKeyInfo[];
}

export interface TableClassification {
  lookup: Set<string>;
  candidateRoots: Set<string>;
  isolated: Set<string>;
  all: Set<string>;
}

export function buildFkGraph(
  tables: TableInfo[],
  fks: ForeignKeyInfo[],
): FkGraph {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const t of tables) {
    outgoing.set(t.name, new Set());
    incoming.set(t.name, new Set());
  }

  for (const fk of fks) {
    // Skip self-referential FKs for graph classification purposes
    if (fk.fromTable === fk.toTable) continue;

    if (!outgoing.has(fk.fromTable)) outgoing.set(fk.fromTable, new Set());
    if (!incoming.has(fk.toTable)) incoming.set(fk.toTable, new Set());

    outgoing.get(fk.fromTable)!.add(fk.toTable);
    incoming.get(fk.toTable)!.add(fk.fromTable);
  }

  return { outgoing, incoming, edges: fks };
}

export function classifyTables(graph: FkGraph): TableClassification {
  const lookup = new Set<string>();
  const candidateRoots = new Set<string>();
  const isolated = new Set<string>();
  const all = new Set<string>();

  for (const table of graph.outgoing.keys()) {
    all.add(table);
  }
  for (const table of graph.incoming.keys()) {
    all.add(table);
  }

  for (const table of all) {
    const outDegree = graph.outgoing.get(table)?.size ?? 0;
    const inDegree = graph.incoming.get(table)?.size ?? 0;

    if (outDegree === 0 && inDegree === 0) {
      isolated.add(table);
    } else if (outDegree === 0 && inDegree >= 1) {
      // No outgoing FKs but has incoming -> lookup table
      lookup.add(table);
    }
  }

  // Candidate roots: non-lookup tables with incoming FKs
  for (const table of all) {
    if (lookup.has(table) || isolated.has(table)) continue;
    const inDegree = graph.incoming.get(table)?.size ?? 0;
    if (inDegree >= 1) {
      candidateRoots.add(table);
    }
  }

  return { lookup, candidateRoots, isolated, all };
}
