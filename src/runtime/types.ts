/**
 * Application-provided configuration.
 * Platform code must never hardcode app-specific values; the host app supplies AppConfig.
 */
export type AppConfig = {
  name: string;
  version: string;
  dataApiVersion: string;
};

export type VersionResponse = {
  application: string;
  applicationVersion: string;
  platformVersion: string;
  dataApiVersion: string;
};

export type DatabaseEngine = "pglite" | "postgresql";

export type DatabaseHealth = {
  status: "ok" | "error";
  engine: DatabaseEngine;
};

export type HealthResponse = {
  status: "ok" | "degraded";
  platformVersion: string;
  database: DatabaseHealth;
};
