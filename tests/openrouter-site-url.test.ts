import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenRouterSiteUrl } from "@/lib/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveOpenRouterSiteUrl", () => {
  it("prefers a non-localhost env URL", () => {
    process.env.OPENROUTER_SITE_URL = "https://rivatutor-production.up.railway.app";

    expect(resolveOpenRouterSiteUrl()).toBe("https://rivatutor-production.up.railway.app");
  });

  it("derives the production URL from forwarded request headers when env is localhost", () => {
    process.env.OPENROUTER_SITE_URL = "http://localhost:3000";
    const request = new Request("https://ignored", {
      headers: {
        host: "rivatutor-production.up.railway.app",
        "x-forwarded-host": "rivatutor-production.up.railway.app",
        "x-forwarded-proto": "https",
      },
    });

    expect(resolveOpenRouterSiteUrl(request)).toBe("https://rivatutor-production.up.railway.app");
  });

  it("falls back to localhost when no request headers are available", () => {
    delete process.env.OPENROUTER_SITE_URL;

    expect(resolveOpenRouterSiteUrl()).toBe("http://localhost:3000");
  });
});
