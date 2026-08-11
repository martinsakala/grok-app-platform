import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAppConfig,
  defineAppConfig,
  getHealthResponse,
  getPlatformVersion,
  getVersionResponse,
} from "../src/runtime/index.js";
import { clearPlatformVersionCache } from "../src/runtime/platform-version.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const platformVersionOnDisk = readFileSync(join(repoRoot, "VERSION"), "utf8").trim();

afterEach(() => {
  clearPlatformVersionCache();
});

describe("defineAppConfig / assertAppConfig", () => {
  it("accepts a valid AppConfig", () => {
    const config = defineAppConfig({
      name: "example-app",
      version: "1.2.3",
      dataApiVersion: "1",
    });
    expect(config).toEqual({
      name: "example-app",
      version: "1.2.3",
      dataApiVersion: "1",
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("trims whitespace on valid fields", () => {
    const config = defineAppConfig({
      name: "  my-app  ",
      version: " 0.1.0 ",
      dataApiVersion: " v1 ",
    });
    expect(config.name).toBe("my-app");
    expect(config.version).toBe("0.1.0");
    expect(config.dataApiVersion).toBe("v1");
  });

  it("rejects missing or empty fields", () => {
    expect(() =>
      defineAppConfig({ name: "", version: "1", dataApiVersion: "1" }),
    ).toThrow(/name/);
    expect(() =>
      defineAppConfig({ name: "a", version: "", dataApiVersion: "1" }),
    ).toThrow(/version/);
    expect(() =>
      defineAppConfig({ name: "a", version: "1", dataApiVersion: "" }),
    ).toThrow(/dataApiVersion/);
  });

  it("assertAppConfig validates unknown input", () => {
    expect(() => assertAppConfig(null)).toThrow();
    expect(() => assertAppConfig({ name: "a", version: "1", dataApiVersion: "1" })).not.toThrow();
  });
});

describe("getVersionResponse", () => {
  it("returns application fields from AppConfig and platformVersion from VERSION", () => {
    const config = defineAppConfig({
      name: "demo",
      version: "9.9.9",
      dataApiVersion: "2",
    });
    const response = getVersionResponse(config);
    expect(response).toEqual({
      application: "demo",
      applicationVersion: "9.9.9",
      platformVersion: platformVersionOnDisk,
      dataApiVersion: "2",
    });
  });
});

describe("getHealthResponse", () => {
  it("returns ok status with platformVersion from VERSION", () => {
    expect(getHealthResponse()).toEqual({
      status: "ok",
      platformVersion: platformVersionOnDisk,
    });
  });
});

describe("getPlatformVersion", () => {
  it("matches the platform VERSION file (current release)", () => {
    expect(getPlatformVersion()).toBe(platformVersionOnDisk);
    expect(getPlatformVersion()).toBe("0.2.0");
  });
});
