// SQL templates for MySQL trigger generation

export function changelogTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS __ev_changelog (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type   VARCHAR(100)  NOT NULL,
  entity_id     VARCHAR(100)  NOT NULL,
  table_name    VARCHAR(100)  NOT NULL,
  row_id        VARCHAR(100)  NOT NULL,
  operation     VARCHAR(20)   NOT NULL,
  old_values    JSON,
  new_values    JSON,
  transaction_id VARCHAR(100) NOT NULL,
  created_at    DATETIME(6)   NOT NULL DEFAULT NOW(6),
  INDEX __ev_idx_entity_lookup (entity_type, entity_id, created_at),
  INDEX __ev_idx_transaction (transaction_id)
);
`;
}

export function schemaSnapshotsTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS __ev_schema_snapshots (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  table_name    VARCHAR(100)  NOT NULL,
  columns       JSON          NOT NULL,
  captured_at   DATETIME(6)   NOT NULL DEFAULT NOW(6),
  INDEX __ev_idx_schema_table (table_name, captured_at)
);
`;
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function buildJsonObject(columns: string[], ref: "NEW" | "OLD"): string {
  const pairs = columns.map((col) => `'${col}', ${ref}.${quoteIdent(col)}`);
  return `JSON_OBJECT(${pairs.join(", ")})`;
}

export function triggerInsertSQL(
  tableName: string,
  entityType: string,
  entityIdExpr: string,
  pkColumn: string,
  columns: string[],
): string {
  const trigName = `__ev_trigger_${tableName}_insert`;
  return `
CREATE TRIGGER ${trigName}
  AFTER INSERT ON ${quoteIdent(tableName)}
  FOR EACH ROW
BEGIN
  INSERT INTO __ev_changelog
    (entity_type, entity_id, table_name, row_id, operation,
     old_values, new_values, transaction_id, created_at)
  VALUES (
    '${entityType}',
    ${entityIdExpr},
    '${tableName}',
    CAST(NEW.${quoteIdent(pkColumn)} AS CHAR),
    'INSERT',
    NULL,
    ${buildJsonObject(columns, "NEW")},
    UUID(),
    NOW(6)
  );
END;
`;
}

export function triggerUpdateSQL(
  tableName: string,
  entityType: string,
  entityIdExpr: string,
  pkColumn: string,
  columns: string[],
): string {
  const trigName = `__ev_trigger_${tableName}_update`;
  return `
CREATE TRIGGER ${trigName}
  AFTER UPDATE ON ${quoteIdent(tableName)}
  FOR EACH ROW
BEGIN
  INSERT INTO __ev_changelog
    (entity_type, entity_id, table_name, row_id, operation,
     old_values, new_values, transaction_id, created_at)
  VALUES (
    '${entityType}',
    ${entityIdExpr},
    '${tableName}',
    CAST(NEW.${quoteIdent(pkColumn)} AS CHAR),
    'UPDATE',
    ${buildJsonObject(columns, "OLD")},
    ${buildJsonObject(columns, "NEW")},
    UUID(),
    NOW(6)
  );
END;
`;
}

export function triggerDeleteSQL(
  tableName: string,
  entityType: string,
  entityIdExpr: string,
  pkColumn: string,
  columns: string[],
): string {
  const trigName = `__ev_trigger_${tableName}_delete`;
  return `
CREATE TRIGGER ${trigName}
  AFTER DELETE ON ${quoteIdent(tableName)}
  FOR EACH ROW
BEGIN
  INSERT INTO __ev_changelog
    (entity_type, entity_id, table_name, row_id, operation,
     old_values, new_values, transaction_id, created_at)
  VALUES (
    '${entityType}',
    ${entityIdExpr},
    '${tableName}',
    CAST(OLD.${quoteIdent(pkColumn)} AS CHAR),
    'DELETE',
    ${buildJsonObject(columns, "OLD")},
    NULL,
    UUID(),
    NOW(6)
  );
END;
`;
}

export function triggerDropSQL(tableName: string): string[] {
  return [
    `DROP TRIGGER IF EXISTS __ev_trigger_${tableName}_insert`,
    `DROP TRIGGER IF EXISTS __ev_trigger_${tableName}_update`,
    `DROP TRIGGER IF EXISTS __ev_trigger_${tableName}_delete`,
  ];
}
