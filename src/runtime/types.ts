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

export type HealthResponse = {
  status: "ok";
  platformVersion: string;
};
