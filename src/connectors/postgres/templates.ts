// SQL templates for PostgreSQL trigger generation

export function changelogTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS __ev_changelog (
  id            BIGSERIAL PRIMARY KEY,
  entity_type   VARCHAR(100)  NOT NULL,
  entity_id     VARCHAR(100)  NOT NULL,
  table_name    VARCHAR(100)  NOT NULL,
  row_id        VARCHAR(100)  NOT NULL,
  operation     VARCHAR(20)   NOT NULL,
  old_values    JSONB,
  new_values    JSONB,
  transaction_id VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS __ev_idx_entity_lookup
  ON __ev_changelog (entity_type, entity_id, created_at);

CREATE INDEX IF NOT EXISTS __ev_idx_transaction
  ON __ev_changelog (transaction_id);
`;
}

export function schemaSnapshotsTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS __ev_schema_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  table_name    VARCHAR(100)  NOT NULL,
  columns       JSONB         NOT NULL,
  captured_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS __ev_idx_schema_table
  ON __ev_schema_snapshots (table_name, captured_at);
`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function triggerFunctionSQL(
  tableName: string,
  entityType: string,
  entityIdExpr: { insert: string; update: string; delete: string },
  pkColumn: string,
): string {
  const fnName = `__ev_trigger_${tableName}_fn`;
  const qPk = quoteIdent(pkColumn);

  return `
CREATE OR REPLACE FUNCTION ${fnName}()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO __ev_changelog
      (entity_type, entity_id, table_name, row_id, operation,
       old_values, new_values, transaction_id)
    VALUES (
      '${entityType}',
      ${entityIdExpr.insert},
      '${tableName}',
      NEW.${qPk}::TEXT,
      'INSERT',
      NULL,
      to_jsonb(NEW),
      txid_current()::TEXT
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO __ev_changelog
      (entity_type, entity_id, table_name, row_id, operation,
       old_values, new_values, transaction_id)
    VALUES (
      '${entityType}',
      ${entityIdExpr.update},
      '${tableName}',
      NEW.${qPk}::TEXT,
      'UPDATE',
      to_jsonb(OLD),
      to_jsonb(NEW),
      txid_current()::TEXT
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO __ev_changelog
      (entity_type, entity_id, table_name, row_id, operation,
       old_values, new_values, transaction_id)
    VALUES (
      '${entityType}',
      ${entityIdExpr.delete},
      '${tableName}',
      OLD.${qPk}::TEXT,
      'DELETE',
      to_jsonb(OLD),
      NULL,
      txid_current()::TEXT
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;
`;
}

export function triggerSQL(tableName: string): string {
  const trigName = `__ev_trigger_${tableName}`;
  const fnName = `__ev_trigger_${tableName}_fn`;
  return `
DROP TRIGGER IF EXISTS ${trigName} ON ${quoteIdent(tableName)};
CREATE TRIGGER ${trigName}
  AFTER INSERT OR UPDATE OR DELETE ON ${quoteIdent(tableName)}
  FOR EACH ROW EXECUTE FUNCTION ${fnName}();
`;
}

export function ddlHookFunctionSQL(watchedTables: string[]): string {
  const tableArray = watchedTables.map((t) => `'${t}'`).join(", ");

  return `
CREATE OR REPLACE FUNCTION __ev_ddl_hook_fn()
RETURNS event_trigger AS $$
DECLARE
  obj RECORD;
  watched_tables TEXT[] := ARRAY[${tableArray}];
  old_snapshot JSONB;
  new_snapshot JSONB;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.object_type = 'table' AND split_part(obj.object_identity, '.', 2) = ANY(watched_tables) THEN
      SELECT columns INTO old_snapshot
      FROM __ev_schema_snapshots
      WHERE table_name = split_part(obj.object_identity, '.', 2)
      ORDER BY captured_at DESC LIMIT 1;

      SELECT jsonb_agg(jsonb_build_object(
        'name', column_name,
        'dataType', data_type,
        'nullable', is_nullable = 'YES'
      )) INTO new_snapshot
      FROM information_schema.columns
      WHERE table_name = split_part(obj.object_identity, '.', 2)
        AND table_schema = 'public';

      INSERT INTO __ev_changelog
        (entity_type, entity_id, table_name, row_id, operation,
         old_values, new_values, transaction_id)
      VALUES (
        '__schema',
        '*',
        split_part(obj.object_identity, '.', 2),
        '*',
        'SCHEMA_CHANGE',
        old_snapshot,
        new_snapshot,
        txid_current()::TEXT
      );

      INSERT INTO __ev_schema_snapshots (table_name, columns)
      VALUES (split_part(obj.object_identity, '.', 2), new_snapshot);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
`;
}

export function ddlEventTriggerSQL(): string {
  return `
DROP EVENT TRIGGER IF EXISTS __ev_ddl_hook;
CREATE EVENT TRIGGER __ev_ddl_hook
  ON ddl_command_end
  WHEN TAG IN ('ALTER TABLE', 'DROP TABLE')
  EXECUTE FUNCTION __ev_ddl_hook_fn();
`;
}
