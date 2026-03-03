import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { EntityConfig, ChildTableConfig } from "./connector/interface.ts";

export interface EvConfig {
  version: number;
  connection: {
    engine: string;
    host: string;
    port: number;
    database: string;
    user_env: string;
    password_env: string;
  };
  settings: {
    changelog_table: string;
    schema_snapshots_table: string;
    autocommit_grouping_window_ms: number;
    max_entity_depth: number;
    capture_old_values: boolean;
    capture_new_values: boolean;
  };
  entities: Record<
    string,
    {
      root_table: string;
      root_pk: string;
      children: { table: string; fk_column: string }[];
    }
  >;
  ignored_tables: string[];
}

const DEFAULT_SETTINGS: EvConfig["settings"] = {
  changelog_table: "__ev_changelog",
  schema_snapshots_table: "__ev_schema_snapshots",
  autocommit_grouping_window_ms: 500,
  max_entity_depth: 1,
  capture_old_values: true,
  capture_new_values: true,
};

export function validateConfig(config: EvConfig): string[] {
  const errors: string[] = [];
  if (!config.version) errors.push("Missing 'version'");
  if (!config.connection) errors.push("Missing 'connection'");
  if (config.connection) {
    if (!config.connection.engine) errors.push("Missing 'connection.engine'");
    if (!["postgres"].includes(config.connection.engine)) {
      errors.push(`Invalid engine '${config.connection.engine}'. Supported: postgres`);
    }
    if (!config.connection.host) errors.push("Missing 'connection.host'");
    if (!config.connection.port) errors.push("Missing 'connection.port'");
    if (!config.connection.database) errors.push("Missing 'connection.database'");
    if (!config.connection.user_env) errors.push("Missing 'connection.user_env'");
    if (!config.connection.password_env) errors.push("Missing 'connection.password_env'");
  }
  if (!config.entities || Object.keys(config.entities).length === 0) {
    errors.push("At least one entity is required");
  }

  // Check for duplicate tables across entities
  const tableToEntity = new Map<string, string>();
  for (const [name, entity] of Object.entries(config.entities ?? {})) {
    if (tableToEntity.has(entity.root_table)) {
      errors.push(
        `Table '${entity.root_table}' is assigned to both '${tableToEntity.get(entity.root_table)}' and '${name}'`,
      );
    }
    tableToEntity.set(entity.root_table, name);
    for (const child of entity.children ?? []) {
      if (tableToEntity.has(child.table)) {
        errors.push(
          `Table '${child.table}' is assigned to both '${tableToEntity.get(child.table)}' and '${name}'`,
        );
      }
      tableToEntity.set(child.table, name);
    }
  }
  return errors;
}

export function resolveCredentials(config: EvConfig): { user: string; password: string } {
  const user = Deno.env.get(config.connection.user_env);
  if (!user) {
    throw new Error(
      `Environment variable '${config.connection.user_env}' is not set`,
    );
  }
  const password = Deno.env.get(config.connection.password_env);
  if (!password) {
    throw new Error(
      `Environment variable '${config.connection.password_env}' is not set`,
    );
  }
  return { user, password };
}

export function loadConfig(yaml: string): EvConfig {
  const raw = parseYaml(yaml) as Record<string, unknown>;
  const config: EvConfig = {
    version: (raw.version as number) ?? 1,
    connection: raw.connection as EvConfig["connection"],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings as Partial<EvConfig["settings"]> ?? {}) },
    entities: raw.entities as EvConfig["entities"] ?? {},
    ignored_tables: (raw.ignored_tables as string[]) ?? [],
  };
  return config;
}

export async function loadConfigFile(path: string): Promise<EvConfig> {
  const text = await Deno.readTextFile(path);
  return loadConfig(text);
}

export function writeConfig(config: EvConfig): string {
  return stringifyYaml(config as unknown as Record<string, unknown>, {
    lineWidth: -1,
  });
}

export async function writeConfigFile(
  path: string,
  config: EvConfig,
): Promise<void> {
  const yaml = writeConfig(config);
  await Deno.writeTextFile(path, yaml);
}

export function configToEntityConfigs(config: EvConfig): EntityConfig[] {
  return Object.entries(config.entities).map(([name, entity]) => ({
    name,
    rootTable: entity.root_table,
    rootPk: entity.root_pk,
    children: (entity.children ?? []).map(
      (c): ChildTableConfig => ({
        table: c.table,
        fkColumn: c.fk_column,
      }),
    ),
  }));
}
