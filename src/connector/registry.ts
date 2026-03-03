import type { Connector } from "./interface.ts";
import { PostgresConnector } from "../connectors/postgres/index.ts";

export const connectors: Record<string, () => Connector> = {
  postgres: () => new PostgresConnector(),
};

export function getConnector(engine: string): Connector {
  const factory = connectors[engine];
  if (!factory) {
    throw new Error(
      `Unknown engine "${engine}". Available: ${Object.keys(connectors).join(", ")}`,
    );
  }
  return factory();
}
