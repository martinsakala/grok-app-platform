import { describe, expect, it, vi } from "vitest";
import { createPlatformClient } from "../src/ui/client.js";
import { PlatformClientError } from "../src/ui/errors.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("createPlatformClient", () => {
  it("sends Authorization bearer and GETs /me", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/platform/me");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer gk_test");
      return jsonResponse(200, { kind: "api-key", keyId: "k1", keyName: "ci", roles: ["member"] });
    });
    const client = createPlatformClient({
      fetch: fetchFn as unknown as typeof fetch,
      getBearer: () => "gk_test",
    });
    const me = await client.me();
    expect(me.kind).toBe("api-key");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("maps 401/403/404 without copying extra body fields", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/me")) {
        return jsonResponse(401, { error: "Unauthorized", key: "gk_should_not_leak", token: "secret" });
      }
      if (url.includes("/admin/users")) {
        return jsonResponse(403, { error: "Forbidden", code: "forbidden", hash: "abc" });
      }
      return jsonResponse(404, { error: "Not Found", code: "not_found" });
    });
    const client = createPlatformClient({ fetch: fetchFn as unknown as typeof fetch });
    await expect(client.me()).rejects.toMatchObject({ status: 401, message: "Unauthorized" });
    try {
      await client.me();
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformClientError);
      expect(String((error as Error).message)).not.toContain("gk_");
      expect(String((error as Error).message)).not.toContain("secret");
      expect(JSON.stringify(error)).not.toContain("gk_should_not_leak");
    }
    await expect(client.listUsers()).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(client.getSetting("missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("PUTs settings and POSTs api-keys", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/settings/app.theme") && init?.method === "PUT") {
        expect(init.body).toBe(JSON.stringify({ value: { color: "dark" } }));
        return jsonResponse(200, { key: "app.theme", value: { color: "dark" }, updatedBy: "u1", updatedAt: null });
      }
      if (url.endsWith("/api-keys") && init?.method === "POST") {
        return jsonResponse(201, {
          id: "1",
          name: "ci",
          prefix: "abcd1234",
          ownerUserId: "u1",
          roles: ["member"],
          createdAt: null,
          lastUsedAt: null,
          revokedAt: null,
          key: "gk_plaintext_once",
        });
      }
      return jsonResponse(500, { error: "Internal Server Error" });
    });
    const client = createPlatformClient({ fetch: fetchFn as unknown as typeof fetch });
    const setting = await client.setSetting("app.theme", { color: "dark" });
    expect(setting.key).toBe("app.theme");
    const created = await client.createApiKey({ name: "ci", roles: ["member"] });
    expect(created.key).toBe("gk_plaintext_once");
  });

  it("uses a custom baseUrl without trailing slash duplication", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://example.test/api/platform/health");
      return jsonResponse(200, {
        status: "ok",
        platformVersion: "0.9.0",
        database: { status: "ok", engine: "pglite" },
      });
    });
    const client = createPlatformClient({
      baseUrl: "https://example.test/api/platform/",
      fetch: fetchFn as unknown as typeof fetch,
    });
    const health = await client.health();
    expect(health.status).toBe("ok");
  });

  it("GET/PUT/DELETE /design", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/design") && (!init?.method || init.method === "GET")) {
        return jsonResponse(200, { tokens: { "--pf-bg": "#0f1115" }, override: null });
      }
      if (url.endsWith("/design") && init?.method === "PUT") {
        expect(init.body).toBe(JSON.stringify({ colors: { accent: "#ff00aa" } }));
        return jsonResponse(200, {
          tokens: { "--pf-bg": "#0f1115", "--pf-accent": "#ff00aa" },
          override: { colors: { accent: "#ff00aa" } },
        });
      }
      if (url.endsWith("/design") && init?.method === "DELETE") {
        return jsonResponse(200, { tokens: { "--pf-bg": "#0f1115" }, override: null });
      }
      return jsonResponse(500, { error: "Internal Server Error" });
    });
    const client = createPlatformClient({ fetch: fetchFn as unknown as typeof fetch });
    const got = await client.getDesign();
    expect(got.override).toBeNull();
    const set = await client.setDesign({ colors: { accent: "#ff00aa" } });
    expect(set.tokens["--pf-accent"]).toBe("#ff00aa");
    const reset = await client.resetDesign();
    expect(reset.override).toBeNull();
  });

  it("import/export/gallery design methods", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/design/gallery")) {
        return jsonResponse(200, {
          presets: [{ id: "dark-neutral", name: "Dark neutral", tagline: "x", colors: { bg: "#0f1115" } }],
        });
      }
      if (url.endsWith("/design/import") && init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({ preset: "dark-neutral" }));
        return jsonResponse(200, {
          tokens: { "--pf-bg": "#0f1115" },
          override: { source: "preset" },
        });
      }
      if (url.endsWith("/design/export")) {
        return new Response("# Brand\nname: App\n", {
          status: 200,
          headers: { "content-type": "text/markdown; charset=utf-8" },
        });
      }
      return jsonResponse(500, { error: "Internal Server Error" });
    });
    const client = createPlatformClient({ fetch: fetchFn as unknown as typeof fetch });
    const gallery = await client.listDesignGallery();
    expect(gallery.presets[0]?.id).toBe("dark-neutral");
    const imported = await client.importDesign({ preset: "dark-neutral" });
    expect(imported.override?.source).toBe("preset");
    const md = await client.exportDesign();
    expect(md).toContain("# Brand");
  });
});
